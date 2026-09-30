<?php

declare(strict_types=1);

// Stop: before Claude hands the turn back, every changed file must parse, both
// test suites must pass and no new UI text may use the phrases in COPY_RULES.
// If not, Claude is sent back to fix it. After three tries in a row it may
// stop anyway, and the user is told what is still failing.

require __DIR__.'/checks.php';

const MAX_TRIES = 3;

$input = hook_input();
$root = project_dir($input);
$tries = sys_get_temp_dir().'/sqlaris-stop-'.preg_replace('/\W/', '', (string) ($input['session_id'] ?? 'session'));

[, $status] = run('git status --porcelain --untracked-files=all', $root);
$changed = [];

foreach (array_filter(explode("\n", $status)) as $line) {
    $rel = trim(substr($line, 3), '"');
    $rel = str_contains($rel, ' -> ') ? explode(' -> ', $rel)[1] : $rel;

    if (preg_match('/\.(php|js|css)$/', $rel) && ! str_starts_with($rel, 'assets/vendor/') && ! str_starts_with($rel, '.claude/') && is_file("{$root}/{$rel}")) {
        $changed[] = $rel;
    }
}

if ($changed === []) {
    @unlink($tries);
    exit(0);
}

$problems = [];
$advice = [];

foreach ($changed as $rel) {
    if ($p = syntax_problem($rel, $root)) {
        $problems[] = $p;
    }

    if (is_ui_text_file($rel) || $rel === 'assets/app.css') {
        $lines = added_lines($rel, $root);
        array_push($problems, ...(is_ui_text_file($rel) ? copy_problems($rel, $lines) : []));
        array_push($advice, ...style_problems($rel, $lines));
    }
}

[$code, $out] = run('node --test', $root);
if ($code !== 0) {
    $problems[] = "node --test failed:\n".substr($out, -3000);
}

[$code, $out] = run(escapeshellarg(PHP_BINARY).' tests/php/run.php', $root);
if ($code !== 0) {
    $problems[] = "php tests/php/run.php failed:\n".substr($out, -3000);
}

$skipped = preg_match_all('/^(\w+): skipped/m', $out, $m) ? $m[1] : [];
$touchesApi = (bool) array_filter($changed, fn ($f) => preg_match('~^(api\.php|src/)~', $f));
$note = $touchesApi && $skipped !== []
    ? 'The API tests did not run for '.implode(' and ', $skipped).' (no TEST_* server set), so the change to the API is not tested against a database.'
    : null;

if ($problems === []) {
    @unlink($tries);
    // Style notes do not block. Claude already saw them after each edit; the user sees them here.
    $message = implode(' ', array_filter(['Checks passed for '.count($changed).' changed file(s).', $note]));
    $message .= $advice === [] ? '' : "\nStyle notes:\n".implode("\n", $advice);
    echo json_encode(['systemMessage' => $message]);
    exit(0);
}

$count = (int) @file_get_contents($tries) + 1;

if ($count > MAX_TRIES) {
    @unlink($tries);
    echo json_encode(['systemMessage' => 'Stopped with checks still failing after '.MAX_TRIES." tries:\n".implode("\n\n", $problems)]);
    exit(0);
}

file_put_contents($tries, (string) $count);
echo json_encode([
    'decision' => 'block',
    'reason' => "Not done yet. These checks fail on the current changes (try {$count} of ".MAX_TRIES."):\n\n"
        .implode("\n\n", $problems)
        ."\n\nFix the cause, not the test. If a failure has nothing to do with this change, say so to the user instead of working around it.",
]);
