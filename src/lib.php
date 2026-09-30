<?php

declare(strict_types=1);

require __DIR__.'/drivers/Driver.php';
require __DIR__.'/drivers/Pgsql.php';
require __DIR__.'/drivers/Mysql.php';

/** A message meant for the person using the viewer, shown as it is. */
final class DbvError extends RuntimeException {}

/** The database systems the viewer can open, by the name config.php uses. */
const DBV_DRIVERS = [
    'pgsql' => DbvPgsql::class,
    'mysql' => DbvMysql::class,
    'mariadb' => DbvMysql::class,
];

/** What config.php may leave out. */
const DBV_DEFAULTS = [
    'username' => '',
    'password' => '',
    'setup_hint' => 'Copy .env.example to .env in the viewer folder, set VIEWER_USERNAME and VIEWER_PASSWORD, then reload this page.',
    'servers' => [],
    'sql_row_limit' => 2000,
    'export_row_limit' => 100000,
    'import_row_limit' => 5000,
    'label_columns' => ['name', 'full_name', 'display_name', 'title', 'label', 'username', 'email', 'code'],
    'audit_columns' => ['created_at', 'updated_at', 'deleted_at', 'created_by', 'updated_by'],
    'edit_warning' => null,
];

function dbv_config(string $key): mixed
{
    static $config = null;

    if ($config === null) {
        // SQLARIS_CONFIG points somewhere else, for the tests and for a container.
        $file = (string) (getenv('SQLARIS_CONFIG') ?: __DIR__.'/../config.php');

        if (! is_file($file)) {
            throw new DbvError('There is no config.php yet. Copy config.example.php to config.php and fill it in.');
        }

        $config = (array) (require $file) + DBV_DEFAULTS;
    }

    return $config[$key] ?? null;
}

/**
 * Reads KEY=value lines from a .env file, so config.php can take its
 * passwords from a file that is already kept out of git. A missing file
 * reads as empty.
 *
 * @return array<string, string>
 */
function dbv_env_file(string $file): array
{
    if (! is_file($file)) {
        return [];
    }

    $env = [];

    foreach (file($file, FILE_IGNORE_NEW_LINES) as $line) {
        if (! preg_match('/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/', $line, $m)) {
            continue;
        }

        $value = trim($m[2]);

        if (strlen($value) >= 2 && ($value[0] === '"' || $value[0] === "'") && $value[-1] === $value[0]) {
            $value = substr($value, 1, -1);
        } elseif (($hash = strpos($value, ' #')) !== false) {
            $value = rtrim(substr($value, 0, $hash));
        }

        $env[$m[1]] = $value;
    }

    return $env;
}

/**
 * Only this computer may open the viewer. The Host check stops a web page that
 * points its own domain at 127.0.0.1 from reaching it through the browser.
 */
function dbv_guard(): void
{
    if (! dbv_client_allowed($_SERVER['REMOTE_ADDR'] ?? '', (string) ($_SERVER['HTTP_HOST'] ?? ''), (string) getenv('SQLARIS_ALLOW_FROM'))) {
        http_response_code(403);
        header('Content-Type: text/plain; charset=utf-8');
        exit('Sqlaris Studio only opens on this computer, through localhost.');
    }
}

/**
 * The address must be this computer, and the Host header must name it too.
 * $allowFrom adds addresses, comma separated, each an IP or a CIDR range. A
 * container needs it: the host's requests arrive from the container network's
 * gateway, never from 127.0.0.1. The Host header is checked either way.
 */
function dbv_client_allowed(string $ip, string $host, string $allowFrom = ''): bool
{
    $host = strtolower($host);
    $host = str_starts_with($host, '[')
        ? substr($host, 1, max(0, (int) strpos($host, ']') - 1))
        : explode(':', $host)[0];

    if (! in_array($host, ['localhost', '127.0.0.1', '::1'], true)) {
        return false;
    }

    if (in_array($ip, ['127.0.0.1', '::1'], true)) {
        return true;
    }

    foreach (array_filter(array_map('trim', explode(',', $allowFrom))) as $range) {
        if (dbv_ip_in_range($ip, $range)) {
            return true;
        }
    }

    return false;
}

/** Whether $ip is $range, an address or a CIDR range such as 172.17.0.0/16. IPv4 and IPv6. */
function dbv_ip_in_range(string $ip, string $range): bool
{
    [$base, $bits] = array_pad(explode('/', $range, 2), 2, null);
    $ip = @inet_pton($ip);
    $base = @inet_pton((string) $base);

    if ($ip === false || $base === false || strlen($ip) !== strlen($base)) {
        return false;
    }

    $max = strlen($ip) * 8;
    $bits = $bits === null ? $max : $bits;

    if (! ctype_digit((string) $bits) || (int) $bits > $max) {
        return false;
    }

    $bits = (int) $bits;
    $whole = intdiv($bits, 8);
    $rest = $bits % 8;

    if (substr($ip, 0, $whole) !== substr($base, 0, $whole)) {
        return false;
    }

    if ($rest === 0) {
        return true;
    }

    $mask = (0xFF << (8 - $rest)) & 0xFF;

    return (ord($ip[$whole]) & $mask) === (ord($base[$whole]) & $mask);
}

function dbv_start_session(): void
{
    $path = rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '/')), '/').'/';

    // A name and path of its own, so other apps on the same server never share this cookie.
    session_name('dbv_session');
    session_set_cookie_params(['lifetime' => 0, 'path' => $path, 'httponly' => true, 'samesite' => 'Strict']);
    session_start();
}

/** @return array{0: string, 1: string} username and password from config.php */
function dbv_login_config(): array
{
    return [trim((string) dbv_config('username')), (string) dbv_config('password')];
}

/** The session keeps a hash of the sign-in it was opened with, so a new password signs everyone out. */
function dbv_login_mark(string $username, string $password): string
{
    return hash('sha256', $username."\0".$password);
}

function dbv_signed_in(): bool
{
    [$username, $password] = dbv_login_config();

    return $username !== '' && $password !== ''
        && hash_equals(dbv_login_mark($username, $password), (string) ($_SESSION['dbv_login'] ?? ''));
}

function dbv_attempt_login(string $username, string $password): bool
{
    [$wantUser, $wantPass] = dbv_login_config();

    // Both are compared every time, so the answer takes as long for a wrong username as for a wrong password.
    $userOk = hash_equals($wantUser, $username);
    $passOk = hash_equals($wantPass, $password);

    if ($wantUser === '' || $wantPass === '' || ! $userOk || ! $passOk) {
        // Slows down anyone guessing.
        sleep(1);

        return false;
    }

    session_regenerate_id(true);
    $_SESSION['dbv_login'] = dbv_login_mark($wantUser, $wantPass);

    return true;
}

/**
 * The servers from config.php, by the key that appears in the page's links.
 *
 * @return array<string, array<string, mixed>>
 */
function dbv_servers(): array
{
    static $servers = null;

    if ($servers !== null) {
        return $servers;
    }

    $servers = [];

    foreach ((array) dbv_config('servers') as $key => $server) {
        $class = DBV_DRIVERS[$server['driver'] ?? ''] ?? null;

        if ($class === null) {
            throw new DbvError("Server {$key} in config.php needs a driver: ".implode(', ', array_keys(DBV_DRIVERS)).'.');
        }

        $servers[(string) $key] = $server + [
            'key' => (string) $key,
            'class' => $class,
            'label' => (string) $key,
            'host' => '127.0.0.1',
            'port' => $class::PORT,
            'username' => '',
            'password' => '',
            'only' => [],
            'hide' => [],
            'databases' => [],
            'color' => null,
        ];
    }

    return $servers;
}

/** A name pattern from config.php as a regex: * matches anything, and each * is captured for {1}, {2}. */
function dbv_pattern(string $glob): string
{
    return '/^'.str_replace('\*', '(.*)', preg_quote($glob, '/')).'$/i';
}

function dbv_matches(string $name, array $globs): bool
{
    foreach ($globs as $glob) {
        if (preg_match(dbv_pattern((string) $glob), $name)) {
            return true;
        }
    }

    return false;
}

/** Whether config.php lets this database show. The page can open only these. */
function dbv_listed(array $server, string $name): bool
{
    return ($server['only'] === [] || dbv_matches($name, (array) $server['only'])) && ! dbv_matches($name, (array) $server['hide']);
}

/**
 * How one database shows in the list: its group, colour and note, from the
 * first rule in the server's "databases" that matches its name.
 *
 * @return array{0: int, 1: array<string, mixed>} the rule's place, for sorting, and the rule
 */
function dbv_look(array $server, string $name): array
{
    $place = 0;

    foreach ((array) $server['databases'] as $glob => $rule) {
        if (preg_match(dbv_pattern((string) $glob), $name, $m)) {
            $fill = fn (?string $text): ?string => $text === null ? null
                : preg_replace_callback('/\{(\d)\}/', fn ($x) => $m[(int) $x[1]] ?? '', $text);

            return [$place, [
                'group' => $fill($rule['group'] ?? null),
                'note' => $fill($rule['note'] ?? null),
                'color' => $rule['color'] ?? null,
                'collapsed' => (bool) ($rule['collapsed'] ?? false),
            ]];
        }

        $place++;
    }

    return [$place, []];
}

/**
 * The list the page shows, without any password. A server that does not
 * answer shows up as a group with its error, so the others still work.
 */
function dbv_database_groups(): array
{
    $groups = [];

    foreach (dbv_servers() as $server) {
        $where = "{$server['host']}:{$server['port']}";

        try {
            $names = $server['class']::databases($server['class']::connect($server, null));
        } catch (PDOException $e) {
            $groups[$server['label']] = ['label' => $server['label'], 'collapsed' => false, 'items' => [], 'error' => DbvDriver::message($e)];

            continue;
        }

        $found = [];

        foreach ($names as $name) {
            if (dbv_listed($server, $name)) {
                [$place, $look] = dbv_look($server, $name);
                $found[] = [$place, $name, $look];
            }
        }

        // The databases the rules name come first, in the rules' order.
        usort($found, fn ($a, $b) => [$a[0], $a[1]] <=> [$b[0], $b[1]]);

        foreach ($found as [, $name, $look]) {
            $group = $look['group'] ?? $server['label'];
            $groups[$group] ??= ['label' => $group, 'collapsed' => false, 'items' => []];
            $groups[$group]['collapsed'] = $groups[$group]['collapsed'] || ($look['collapsed'] ?? false);
            $groups[$group]['items'][] = [
                'id' => $server['key'].'/'.$name,
                'name' => $name,
                'note' => $look['note'] ?? null,
                'color' => $look['color'] ?? $server['color'],
                'driver' => $server['class']::DRIVER,
                'system' => $server['class']::LABEL,
                'where' => $where,
            ];
        }
    }

    return array_values($groups);
}

/** Your own arrangement of the database list, made in the page. Git ignores it. SQLARIS_LAYOUT moves it, for a container. */
define('DBV_LAYOUT_FILE', (string) (getenv('SQLARIS_LAYOUT') ?: __DIR__.'/../layout.json'));

function dbv_layout(): array
{
    $saved = is_file(DBV_LAYOUT_FILE) ? json_decode((string) file_get_contents(DBV_LAYOUT_FILE), true) : null;

    return dbv_clean_layout(is_array($saved) ? $saved : []);
}

/**
 * Keeps only the shape the page reads, so a file edited by hand or a bad
 * request can never break the list. "groups" are your own groups with the
 * database ids in each, "order" is the order of every group by its key,
 * "hidden" the databases kept out of the way, and "folded" the groups you
 * opened or closed.
 */
function dbv_clean_layout(array $layout): array
{
    $isKey = fn (mixed $key): bool => is_string($key) && $key !== '' && strlen($key) <= 300;
    $ids = fn (mixed $list): array => array_values(array_unique(array_filter((array) $list, $isKey)));
    $groups = [];
    $folded = [];

    foreach ((array) ($layout['folded'] ?? []) as $key => $closed) {
        if ($isKey($key) && is_bool($closed)) {
            $folded[$key] = $closed;
        }
    }

    foreach ((array) ($layout['groups'] ?? []) as $group) {
        $id = $group['id'] ?? null;

        if (! is_string($id) || ! str_starts_with($id, 'u:') || ! preg_match('/^\S.{0,59}/u', trim((string) ($group['label'] ?? '')), $label)) {
            continue;
        }

        $groups[] = ['id' => $id, 'label' => $label[0], 'items' => $ids($group['items'] ?? [])];
    }

    // An object, so the page gets {} and not [] when nothing is folded.
    return ['groups' => $groups, 'order' => $ids($layout['order'] ?? []), 'hidden' => $ids($layout['hidden'] ?? []), 'folded' => (object) $folded];
}

function dbv_save_layout(array $layout): array
{
    $layout = dbv_clean_layout($layout);
    $temp = DBV_LAYOUT_FILE.'.tmp';

    // Written whole to a second file and then moved over, so a failed write never leaves half a layout.
    $written = file_put_contents($temp, json_encode($layout, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)."\n");

    if ($written === false || ! rename($temp, DBV_LAYOUT_FILE)) {
        throw new DbvError('Could not save layout.json. Check that the viewer folder can be written to.');
    }

    return $layout;
}

/** What the page needs from config.php besides the databases. */
function dbv_settings(): array
{
    return [
        'audit_columns' => array_values((array) dbv_config('audit_columns')),
        'edit_warning' => dbv_config('edit_warning'),
    ];
}

/**
 * The server and database name of the id the page sent, "server/database".
 * Only databases on the list are found.
 *
 * @return array{0: array<string, mixed>, 1: string}
 */
function dbv_find(string $id): array
{
    [$key, $name] = array_pad(explode('/', $id, 2), 2, '');
    $server = dbv_servers()[$key] ?? null;

    if ($server === null || $name === '' || ! dbv_listed($server, $name)) {
        throw new DbvError('That database is not on the list any more. Reload the page.');
    }

    return [$server, $name];
}

function dbv_open(string $id): DbvDriver
{
    [$server, $name] = dbv_find($id);

    return new $server['class']($server['class']::connect($server, $name), $name);
}

/**
 * A name typed on the page for a new table or database. Letters, digits and
 * underscores only, so it means the same thing on every system and in every
 * place it goes.
 */
function dbv_new_name(mixed $name): string
{
    $name = trim((string) $name);

    if (! preg_match('/^[A-Za-z_][A-Za-z0-9_]{0,62}$/', $name)) {
        throw new DbvError('Use only letters, digits and underscores, up to 63 characters, and do not start with a digit.');
    }

    return $name;
}

function dbv_bytes(int $bytes): string
{
    $units = ['B', 'KB', 'MB', 'GB', 'TB'];
    $i = 0;
    $value = (float) $bytes;

    while ($value >= 1024 && $i < count($units) - 1) {
        $value /= 1024;
        $i++;
    }

    return ($i === 0 ? (string) $bytes : number_format($value, $value < 10 ? 1 : 0)).' '.$units[$i];
}

function dbv_like(string $value): string
{
    return addcslashes($value, '\\%_');
}

function dbv_all(PDO $pdo, string $sql, array $params = []): array
{
    $statement = $pdo->prepare($sql);
    $statement->execute($params);

    return $statement->fetchAll();
}

function dbv_one(PDO $pdo, string $sql, array $params = []): ?array
{
    return dbv_all($pdo, $sql, $params)[0] ?? null;
}

/** Every value goes to the page as text, so a bigint keeps all its digits. */
function dbv_plain(mixed $value): ?string
{
    return match (true) {
        $value === null => null,
        is_bool($value) => $value ? 'true' : 'false',
        is_resource($value) => '\\x'.bin2hex((string) stream_get_contents($value)),
        default => (string) $value,
    };
}

function dbv_send(array $data, int $status = 200): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
}

function dbv_fail(string $message, int $status): never
{
    dbv_send(['error' => $message], $status);
}
