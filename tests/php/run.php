<?php

declare(strict_types=1);

// The PHP tests. From the project folder:
//
//     php tests/php/run.php
//
// The unit tests always run. The API tests run against each server named in
// TEST_PGSQL_* or TEST_MYSQL_* (the same names as in .env, with TEST_ in
// front), from the environment or from tests/.env. Each one gets a database
// called sqlaris_test, made fresh for the run and dropped after it, so point
// them at a server where that name is free.

require __DIR__.'/../../src/lib.php';
require __DIR__.'/../../src/actions.php';
require __DIR__.'/harness.php';
require __DIR__.'/unit.test.php';
require __DIR__.'/api.test.php';

const TEST_DATABASE = 'sqlaris_test';

$env = dbv_env_file(__DIR__.'/../.env') + getenv();
$failed = 0;

echo "Unit tests\n";
// The unit tests were added when unit.test.php was read.
$failed += run_tests();

$servers = [];

foreach (['pg' => ['PGSQL', 'pgsql', 5432, 'postgres'], 'my' => ['MYSQL', 'mysql', 3306, 'root']] as $key => [$prefix, $driver, $port, $user]) {
    $host = (string) ($env["TEST_{$prefix}_HOST"] ?? '');

    if ($host === '') {
        echo "\n{$driver}: skipped, TEST_{$prefix}_HOST is not set\n";

        continue;
    }

    $servers[$key] = [
        'label' => $driver,
        'driver' => $driver,
        'host' => $host,
        'port' => (int) ($env["TEST_{$prefix}_PORT"] ?? $port),
        'username' => (string) ($env["TEST_{$prefix}_USERNAME"] ?? $user),
        'password' => (string) ($env["TEST_{$prefix}_PASSWORD"] ?? ''),
        'database' => 'postgres',
        'only' => [TEST_DATABASE],
    ];
}

if ($servers !== []) {
    $username = 'tester';
    $password = bin2hex(random_bytes(12));
    $config = tempnam(sys_get_temp_dir(), 'sqlaris-config');
    file_put_contents($config, '<?php return '.var_export(['username' => $username, 'password' => $password, 'servers' => $servers], true).";\n");

    // A free port, found by asking the system for one.
    $probe = stream_socket_server('tcp://127.0.0.1:0');
    $port = (int) substr(strrchr((string) stream_socket_get_name($probe, false), ':'), 1);
    fclose($probe);
    $server = new TestServer($config, $port);

    try {
        echo "\nHTTP\n";
        http_tests($server, $username, $password);
        $failed += run_tests();

        foreach ($servers as $key => $settings) {
            $class = DBV_DRIVERS[$settings['driver']];
            $admin = $class::connect($settings, $settings['driver'] === 'pgsql' ? 'postgres' : null);
            test_database_drop($admin, $settings['driver']);
            $admin->exec('create database '.TEST_DATABASE);

            $pdo = $class::connect($settings, TEST_DATABASE);

            foreach (FIXTURES[$settings['driver']] as $statement) {
                $pdo->exec($statement);
            }

            $version = (string) $pdo->query('select version()')->fetchColumn();
            echo "\n{$settings['driver']}: ".strtok($version, ',')."\n";

            $client = new TestClient($server);
            $client->signIn($username, $password);
            api_tests("[{$settings['driver']}]", $settings['driver'], $client, $key.'/'.TEST_DATABASE, $pdo);
            $failed += run_tests();

            $pdo = null;
            test_database_drop($admin, $settings['driver']);
        }
    } finally {
        $server->stop();
        unlink($config);
    }
}

echo $failed === 0 ? "\nAll passed.\n" : "\n{$failed} failed.\n";
exit($failed === 0 ? 0 : 1);

function test_database_drop(PDO $admin, string $driver): void
{
    if ($driver === 'pgsql') {
        // The viewer's own connections may still be open, so they are closed first.
        $admin->exec("select pg_terminate_backend(pid) from pg_stat_activity where datname = '".TEST_DATABASE."' and pid <> pg_backend_pid()");
    }

    $admin->exec('drop database if exists '.TEST_DATABASE);
}
