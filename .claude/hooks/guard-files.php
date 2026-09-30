<?php

declare(strict_types=1);

// PreToolUse on Edit and Write: the user's own settings need their say-so, and
// the bundled libraries only change through src/libraries.php.

require __DIR__.'/checks.php';

$input = hook_input();
$root = project_dir($input);
$rel = project_path((string) ($input['tool_input']['file_path'] ?? ''), $root);

if ($rel === null) {
    exit(0);
}

$decision = match (true) {
    // The tests are written apart from the code they check, so the agent that writes them stays out of the code.
    ($input['agent_type'] ?? '') === 'test-writer' && ! str_starts_with($rel, 'tests/') => [
        'deny',
        'The test-writer agent only edits files under tests/. Say what else the test needs and let the main agent make it.',
    ],
    in_array($rel, ['.env', 'config.php', 'layout.json', 'tests/.env'], true) => [
        'ask',
        "{$rel} is the user's own settings file and git ignores it. Only change it when they asked for exactly this.",
    ],
    str_starts_with($rel, 'assets/vendor/') => [
        'deny',
        'assets/vendor holds third-party libraries as downloaded. Change the version in src/libraries.php and run it instead of editing the files.',
    ],
    default => null,
};

if ($decision !== null) {
    echo json_encode(['hookSpecificOutput' => [
        'hookEventName' => 'PreToolUse',
        'permissionDecision' => $decision[0],
        'permissionDecisionReason' => $decision[1],
    ]]);
}
