<?php

declare(strict_types=1);

// A small test runner, so the tests need nothing but PHP. test() adds a test,
// the checks below throw when they fail, and run() prints one line per test.

final class TestFailure extends RuntimeException {}

/** @var list<array{0: string, 1: callable}> */
$GLOBALS['tests'] = [];

function test(string $name, callable $fn): void
{
    $GLOBALS['tests'][] = [$name, $fn];
}

function check(bool $condition, string $message): void
{
    if (! $condition) {
        throw new TestFailure($message);
    }
}

function same(mixed $expected, mixed $actual, string $message = ''): void
{
    if ($expected !== $actual) {
        throw new TestFailure(($message === '' ? '' : $message."\n")
            .'expected: '.var_export($expected, true)."\n  actual: ".var_export($actual, true));
    }
}

/** $fn must throw, and the message must contain $part. */
function fails(callable $fn, string $part = ''): void
{
    try {
        $fn();
    } catch (TestFailure $e) {
        throw $e;
    } catch (Throwable $e) {
        check($part === '' || str_contains($e->getMessage(), $part),
            "threw, but the message does not mention \"{$part}\": ".$e->getMessage());

        return;
    }

    throw new TestFailure('expected an error, but nothing was thrown');
}

/** Runs every test added so far. Returns how many failed. */
function run_tests(): int
{
    $failed = 0;

    foreach ($GLOBALS['tests'] as [$name, $fn]) {
        try {
            $fn();
            echo "  ok   {$name}\n";
        } catch (Throwable $e) {
            $failed++;
            echo "  FAIL {$name}\n";
            echo '       '.str_replace("\n", "\n       ", $e instanceof TestFailure ? $e->getMessage() : get_class($e).': '.$e->getMessage())."\n";
        }
    }

    $GLOBALS['tests'] = [];

    return $failed;
}

/**
 * The viewer, running on PHP's built-in server with a config of the tests'
 * own. Requests go through router.php, index.php and api.php exactly as a
 * browser's do.
 */
final class TestServer
{
    public readonly string $base;

    /** Where this server keeps saved diagram views, so a test can read the file itself. */
    public readonly string $views;

    private $process;

    public function __construct(string $config, public readonly int $port)
    {
        $root = dirname(__DIR__, 2);
        $env = getenv() + [];
        $env['SQLARIS_CONFIG'] = $config;
        $env['SQLARIS_LAYOUT'] = sys_get_temp_dir().'/sqlaris-test-layout-'.$port.'.json';
        $this->views = sys_get_temp_dir().'/sqlaris-test-views-'.$port.'.json';
        $env['SQLARIS_VIEWS'] = $this->views;
        $this->process = proc_open([PHP_BINARY, '-S', "127.0.0.1:{$port}", 'router.php'], [
            0 => ['pipe', 'r'],
            1 => ['file', sys_get_temp_dir().'/sqlaris-test-server.log', 'a'],
            2 => ['file', sys_get_temp_dir().'/sqlaris-test-server.log', 'a'],
        ], $pipes, $root, $env);
        $this->base = "http://127.0.0.1:{$port}";

        for ($i = 0; $i < 100; $i++) {
            $socket = @fsockopen('127.0.0.1', $port, $code, $error, 0.1);

            if ($socket !== false) {
                fclose($socket);

                return;
            }

            usleep(50000);
        }

        throw new RuntimeException("The test server did not start on port {$port}.");
    }

    public function stop(): void
    {
        proc_terminate($this->process);
        proc_close($this->process);

        foreach ([$this->views, $this->views.'.lock'] as $file) {
            if (is_file($file)) {
                unlink($file);
            }
        }
    }
}

/** A browser of sorts: keeps the session cookie and sends what the page sends. */
final class TestClient
{
    private string $cookie = '';

    public function __construct(public readonly TestServer $server) {}

    /** @return array{status: int, body: string} */
    public function request(string $method, string $path, string $body = '', array $headers = []): array
    {
        $headers += ['Host' => "127.0.0.1:{$this->server->port}"];

        if ($this->cookie !== '') {
            $headers['Cookie'] = $this->cookie;
        }

        $curl = curl_init($this->server->base.$path);
        curl_setopt_array($curl, [
            CURLOPT_CUSTOMREQUEST => $method,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HEADER => true,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_TIMEOUT => 60,
            CURLOPT_HTTPHEADER => array_map(fn ($k, $v) => "{$k}: {$v}", array_keys($headers), $headers),
        ]);

        if ($body !== '') {
            curl_setopt($curl, CURLOPT_POSTFIELDS, $body);
        }

        $raw = (string) curl_exec($curl);
        $status = (int) curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
        $split = (int) curl_getinfo($curl, CURLINFO_HEADER_SIZE);

        if (preg_match('/^Set-Cookie:\s*(dbv_session=[^;]*)/mi', substr($raw, 0, $split), $m)) {
            $this->cookie = $m[1];
        }

        return ['status' => $status, 'body' => substr($raw, $split)];
    }

    /** Signs in through the form on the page, token and all. Returns the page that comes back. */
    public function signIn(string $username, string $password): array
    {
        $page = $this->request('GET', '/');
        preg_match('/name="token" value="([^"]+)"/', $page['body'], $m);

        return $this->request('POST', '/', http_build_query(['token' => $m[1] ?? '', 'username' => $username, 'password' => $password]),
            ['Content-Type' => 'application/x-www-form-urlencoded']);
    }

    /**
     * One call to api.php, the way the page makes it.
     *
     * @return array{status: int, json: mixed, body: string}
     */
    public function api(string $action, array $payload = [], array $headers = []): array
    {
        $response = $this->request('POST', '/api.php', json_encode(['action' => $action] + $payload),
            $headers + ['Content-Type' => 'application/json', 'X-Sqlaris' => '1']);

        return $response + ['json' => json_decode($response['body'], true)];
    }

    /** An api() call that must work. Returns its answer. */
    public function ok(string $action, array $payload = []): array
    {
        $r = $this->api($action, $payload);
        check($r['status'] === 200, "{$action} answered {$r['status']}: ".substr($r['body'], 0, 400));
        // A PHP warning printed before the JSON breaks the page, so it fails here too.
        check(is_array($r['json']), "{$action} did not answer with JSON: ".substr($r['body'], 0, 400));

        return $r['json'];
    }

    /** An api() call that must be refused with a message containing $part. Returns the message. */
    public function refused(string $action, array $payload, string $part = ''): string
    {
        $r = $this->api($action, $payload);
        check($r['status'] >= 400, "{$action} should have been refused, but answered {$r['status']}: ".substr($r['body'], 0, 400));
        $message = (string) ($r['json']['error'] ?? '');
        check($part === '' || str_contains($message, $part), "{$action} was refused, but the message does not mention \"{$part}\": {$message}");

        return $message;
    }
}
