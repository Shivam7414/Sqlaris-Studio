<?php

declare(strict_types=1);

// A helper the API tests start as a process of their own, so that something happens on the database while the
// test goes on with something else: a query that runs for a while, or a look at what the server is running.
// The viewer's built-in server answers one request at a time, so a test cannot make a slow request and stop it
// from the same process. It is not a test.
//
//     php db-child.php <result-file> run <database> <sql>
//     php db-child.php <result-file> watch <database> <needle> <seconds> <enough>
//
// "run" does the SQL and writes {"ok": true|false, "seconds": n} to the result file when it is over. A query
// that is stopped from outside may end with ok false, or with ok true on a system that only cuts it short.
//
// "watch" looks at the statements the server is running, about fifty times a second. It writes
// <result-file>.ready after its first look, and when it has seen <enough> different statements that contain the
// needle, or after <seconds>, it writes the list of them, as JSON, to the result file.
//
// The server comes in SQLARIS_TEST_SERVER as JSON: the settings run.php gives the viewer.

require __DIR__.'/../../src/lib.php';

[, $result, $mode, $database] = $argv + [null, '', '', ''];
$settings = json_decode((string) getenv('SQLARIS_TEST_SERVER'), true);
$class = DBV_DRIVERS[$settings['driver']];
$pdo = $class::connect($settings, $database);

if ($mode === 'run') {
    $started = microtime(true);

    try {
        $pdo->query($argv[4])->fetchAll();
        $answer = ['ok' => true];
    } catch (Throwable $e) {
        $answer = ['ok' => false, 'error' => $e->getMessage()];
    }

    file_put_contents($result, json_encode($answer + ['seconds' => round(microtime(true) - $started, 2)]));
    exit;
}

// Its own session is left out, since the needle is in the text of its own question.
$look = $pdo->prepare($class === DbvPgsql::class
    ? "select query from pg_stat_activity where pid <> pg_backend_pid() and state = 'active' and query like ?"
    : 'select info from information_schema.processlist where id <> connection_id() and info like ?');
[$needle, $seconds, $enough] = [$argv[4], (float) $argv[5], (int) $argv[6]];
$seen = [];
$until = microtime(true) + $seconds;

do {
    $look->execute(['%'.$needle.'%']);

    foreach ($look->fetchAll(PDO::FETCH_COLUMN) as $statement) {
        $seen[(string) $statement] = true;
    }

    is_file($result.'.ready') || touch($result.'.ready');
    usleep(20000);
} while (count($seen) < $enough && microtime(true) < $until);

file_put_contents($result, json_encode(array_keys($seen)));
