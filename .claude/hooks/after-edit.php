<?php

declare(strict_types=1);

// PostToolUse on Edit and Write: checks the file that was just changed, so a
// mistake is fixed while it is still fresh. Exit code 2 shows the problems to
// Claude; the edit itself has already happened.

require __DIR__.'/checks.php';

$input = hook_input();
$root = project_dir($input);
$rel = project_path((string) ($input['tool_input']['file_path'] ?? ''), $root);

if ($rel === null || str_starts_with($rel, 'assets/vendor/') || ! is_file("{$root}/{$rel}")) {
    exit(0);
}

$problems = array_filter([syntax_problem($rel, $root)]);

if (is_ui_text_file($rel) || $rel === 'assets/app.css') {
    $lines = added_lines($rel, $root);
    $problems = [
        ...$problems,
        ...(is_ui_text_file($rel) ? copy_problems($rel, $lines) : []),
        ...style_problems($rel, $lines),
    ];
}

if ($problems === []) {
    exit(0);
}

fwrite(STDERR, "Check of {$rel}:\n\n".implode("\n\n", $problems)."\n\nFix these now. If one is a false alarm (a static SVG string, a colour that really is a token), leave it and say why.\n");
exit(2);
