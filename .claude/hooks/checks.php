<?php

declare(strict_types=1);

// Shared by the Claude Code hooks in this folder. Plain PHP, like the project,
// so the hooks need nothing that the project does not already need.

/** The hook's input, as Claude Code sends it on stdin. */
function hook_input(): array
{
    $input = json_decode((string) stream_get_contents(STDIN), true);

    return is_array($input) ? $input : [];
}

function project_dir(array $input = []): string
{
    $dir = getenv('CLAUDE_PROJECT_DIR') ?: ($input['cwd'] ?? getcwd());

    return rtrim(str_replace('\\', '/', (string) $dir), '/');
}

/** A path relative to the project, with forward slashes, or null when it is outside it. */
function project_path(string $path, string $root): ?string
{
    $path = str_replace('\\', '/', $path);

    if (! preg_match('~^([a-zA-Z]:)?/~', $path)) {
        return preg_replace('~^\./~', '', $path);
    }

    return stripos($path, $root.'/') === 0 ? substr($path, strlen($root) + 1) : null;
}

/** Runs a command in the project folder and returns [exit code, output]. */
function run(string $command, string $root): array
{
    $process = proc_open($command, [1 => ['pipe', 'w'], 2 => ['redirect', 1]], $pipes, $root);

    if (! is_resource($process)) {
        return [1, "Could not run: {$command}"];
    }

    $output = (string) stream_get_contents($pipes[1]);
    fclose($pipes[1]);

    return [proc_close($process), trim($output)];
}

/** The files whose text is shown to people: the page, the API and its error messages. */
function is_ui_text_file(string $rel): bool
{
    return (bool) preg_match('~^(index\.php|api\.php|src/.+\.php|assets/[^/]+\.js)$~', $rel);
}

/** A syntax check for one file, or null when it is fine or not checked. */
function syntax_problem(string $rel, string $root): ?string
{
    $quoted = escapeshellarg($rel);
    [$code, $out] = match (pathinfo($rel, PATHINFO_EXTENSION)) {
        'php' => run(escapeshellarg(PHP_BINARY)." -l {$quoted}", $root),
        'js' => run("node --check {$quoted}", $root),
        default => [0, ''],
    };

    return $code === 0 ? null : "{$rel} does not parse:\n{$out}";
}

/**
 * The lines this change adds to a file, as [line number => text]. For a file
 * git does not track yet, that is every line.
 */
function added_lines(string $rel, string $root): array
{
    [$tracked] = run('git ls-files --error-unmatch '.escapeshellarg($rel), $root);

    if ($tracked !== 0) {
        $text = @file_get_contents("{$root}/{$rel}");

        return $text === false ? [] : array_combine(range(1, substr_count($text, "\n") + 1), explode("\n", $text));
    }

    [, $diff] = run('git diff HEAD -U0 --no-color -- '.escapeshellarg($rel), $root);
    $lines = [];
    $at = 0;

    foreach (explode("\n", $diff) as $line) {
        if (preg_match('/^@@ -\S+ \+(\d+)/', $line, $m)) {
            $at = (int) $m[1];
        } elseif (str_starts_with($line, '+') && ! str_starts_with($line, '+++')) {
            $lines[$at++] = substr($line, 1);
        }
    }

    return $lines;
}

/** Phrases that make UI text sound like a template or a chatbot, with what to write instead. */
const COPY_RULES = [
    '/\b(Oops|Whoops|Uh[- ]oh)\b/i' => 'Drop the interjection. Say what happened.',
    '/Something went wrong/i' => 'Say what went wrong: "Could not connect to pgsql." or pass on the database\'s own message.',
    '/\bSuccessfully\b/i' => 'Say the result: "Row deleted.", not "Successfully deleted".',
    '/Are you sure/i' => 'Ask the real question: "Delete this row?", "Throw away your changes?".',
    '/\bPlease\b/' => 'Plain instructions do not need "Please": "Sign in again."',
    '/\b(Error|Warning|Success):/' => 'No labels in front of the message. The toast kind already says it.',
    '/(^|[\'"`])(Invalid|Failed to)\b/' => 'Name the thing and the problem: "There is no column qty in items." instead of "Invalid column".',
    '/\b(seamless(ly)?|effortless(ly)?|unleash|supercharge|powerful|robust|blazing|elevate)\b/i' => 'Marketing words. Describe what it does.',
    '/\b(Click here|Let\'s|Awesome|Great job)\b/i' => 'Say what the link or step does, in a plain sentence.',
    '/[A-Za-z)]!(?=[\s\'"`])/' =>'No exclamation marks in UI text.',
    '/[\x{1F300}-\x{1FAFF}\x{2600}-\x{27BF}\x{2B50}\x{2705}]/u' => 'No emoji in UI text. Use icon() if it needs a symbol.',
];

/** Problems with the wording of UI text on the given lines. */
function copy_problems(string $rel, array $lines): array
{
    $found = [];

    foreach ($lines as $n => $line) {
        $code = ltrim($line);

        // Comments are for people reading the code, not the page.
        if ($code === '' || preg_match('~^(//|/?\*|#)~', $code)) {
            continue;
        }

        foreach (COPY_RULES as $pattern => $advice) {
            // Only text inside a string literal is UI text.
            if (preg_match($pattern, $line, $m, PREG_OFFSET_CAPTURE) && preg_match('/[\'"`]/', substr($line, 0, $m[0][1] + 1))) {
                $found[] = "{$rel}:{$n}: \"{$m[0][0]}\" in: ".trim($line)."\n    {$advice}";
            }
        }
    }

    return $found;
}

/** Front-end habits that break the look or the safety of the page. Advice, not a gate. */
function style_problems(string $rel, array $lines): array
{
    $found = [];

    foreach ($lines as $n => $line) {
        if ($rel === 'assets/app.css' && ! preg_match('/--[\w-]+\s*:/', $line) && preg_match('/#[0-9a-fA-F]{3,8}\b|\b(rgba?|hsla?)\(/', $line)) {
            $found[] = "{$rel}:{$n}: raw colour in a rule: ".trim($line)."\n    Use a token from :root (and give it a light-theme value too).";
        }

        if (str_ends_with($rel, '.js') && preg_match('/\b(innerHTML|outerHTML|insertAdjacentHTML)\b/', $line)) {
            $found[] = "{$rel}:{$n}: ".trim($line)."\n    Build elements with h() / put(). Markup strings are only for fixed SVG with no data in it.";
        }
    }

    return $found;
}
