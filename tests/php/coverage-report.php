<?php

declare(strict_types=1);

// Adds up what coverage.php wrote and prints the line coverage of the app's
// PHP, file by file. From the project folder, after a run with COVERAGE_DIR set:
//
//     php tests/php/coverage-report.php <COVERAGE_DIR> [lowest percent]
//
// With a lowest percent, a total under it fails.

$dir = $argv[1] ?? '';
$lowest = isset($argv[2]) ? (float) $argv[2] : null;
$root = str_replace('\\', '/', dirname(__DIR__, 2)).'/';
$lines = [];

foreach (glob($dir.'/*.json') ?: [] as $file) {
    foreach ((array) json_decode((string) file_get_contents($file), true) as $path => $hits) {
        $rel = str_replace([$root, '\\'], ['', '/'], str_replace('\\', '/', $path));

        // Only the app: not the tests, the Claude hooks or the downloaded libraries.
        if (preg_match('~^(tests|\.claude|assets/vendor)/~', $rel) || ! str_ends_with($rel, '.php')) {
            continue;
        }

        foreach ($hits as $line => $count) {
            $lines[$rel][$line] = ($lines[$rel][$line] ?? false) || $count > 0;
        }
    }
}

if ($lines === []) {
    fwrite(STDERR, "No coverage in {$dir}. Run the tests with PCOV loaded and COVERAGE_DIR set.\n");
    exit(1);
}

ksort($lines);
$all = 0;
$run = 0;

foreach ($lines as $rel => $hit) {
    $n = count(array_filter($hit));
    $all += count($hit);
    $run += $n;
    printf("%6.1f%%  %4d of %4d lines  %s\n", 100 * $n / count($hit), $n, count($hit), $rel);
}

$total = 100 * $run / $all;
printf("%6.1f%%  %4d of %4d lines  in all\n", $total, $run, $all);

if ($lowest !== null && $total < $lowest) {
    fwrite(STDERR, sprintf("Line coverage is %.1f%%, under the %.1f%% this run asks for.\n", $total, $lowest));
    exit(1);
}
