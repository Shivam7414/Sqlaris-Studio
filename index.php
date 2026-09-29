<?php

declare(strict_types=1);

require __DIR__.'/src/lib.php';

dbv_guard();
dbv_start_session();

header('Cache-Control: no-store');

$e = fn (string $text): string => htmlspecialchars($text, ENT_QUOTES, 'UTF-8');
$error = null;
$ready = false;
$username = '';
$wantUser = '';
$hint = DBV_DEFAULTS['setup_hint'];

try {
    [$wantUser, $wantPass] = dbv_login_config();
    $ready = $wantUser !== '' && $wantPass !== '';
    $hint = (string) dbv_config('setup_hint');
} catch (DbvError $problem) {
    $error = $problem->getMessage();
}

// The form carries a token from this session, so another site cannot sign this browser in.
$_SESSION['dbv_token'] ??= bin2hex(random_bytes(16));

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST' && $ready) {
    $username = (string) ($_POST['username'] ?? '');
    $tokenOk = hash_equals($_SESSION['dbv_token'], (string) ($_POST['token'] ?? ''));

    if ($tokenOk && dbv_attempt_login($username, (string) ($_POST['password'] ?? ''))) {
        header('Location: ./', true, 303);
        exit;
    }

    $error = $tokenOk ? 'That username and password do not match.' : 'The form expired. Try again.';
}

$signedIn = $ready && dbv_signed_in();

// Changing a file changes the version, so the browser never runs an old copy.
$version = filemtime(__DIR__.'/assets/app.js').'-'.filemtime(__DIR__.'/assets/diagram.js').'-'.filemtime(__DIR__.'/assets/app.css');

// The libraries from src/libraries.php. A missing one is left out, and the page falls back to the browser's own controls.
$vendor = array_values(array_filter(['tom-select', 'flatpickr', 'codemirror'], fn ($name) => is_file(__DIR__."/assets/vendor/{$name}.js")));
?>
<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title><?= $signedIn ? 'Sqlaris Studio' : 'Sign in | Sqlaris Studio' ?></title>
    <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%234f46e5' stroke-width='2.2' stroke-linecap='round'%3E%3Cellipse cx='12' cy='5' rx='8' ry='3'/%3E%3Cpath d='M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5'/%3E%3Cpath d='M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3'/%3E%3C/svg%3E">
<?php foreach ($vendor as $name) { ?>
    <link rel="stylesheet" href="assets/vendor/<?= $name ?>.css?v=<?= filemtime(__DIR__."/assets/vendor/{$name}.css") ?>">
<?php } ?>
    <link rel="stylesheet" href="assets/app.css?v=<?= $version ?>">
    <script>
        // Set the theme and the page colours before the first paint, so the page never flashes
        // another look. Dark, in the database's colours, until this browser picks others. The tints are TINTS in app.js.
        try {
            const theme = JSON.parse(localStorage.getItem('dbv:theme')) || 'dark';
            if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
            const tint = JSON.parse(localStorage.getItem('dbv:tint'));
            if (['midnight', 'graphite', 'ocean', 'forest', 'plum', 'sand'].includes(tint)) document.documentElement.dataset.tint = tint;
        } catch (e) {}
    </script>
</head>
<?php if ($signedIn) { ?>
<body data-user="<?= $e($wantUser) ?>">
    <div id="app"></div>
<?php foreach ($vendor as $name) { ?>
    <script src="assets/vendor/<?= $name ?>.js?v=<?= filemtime(__DIR__."/assets/vendor/{$name}.js") ?>"></script>
<?php } ?>
    <script src="assets/diagram.js?v=<?= $version ?>"></script>
    <script src="assets/app.js?v=<?= $version ?>"></script>
</body>
<?php } else { ?>
<body class="login-page">
    <div class="aurora" aria-hidden="true"></div>
    <form class="login" method="post" action="./">
        <div class="brand">
            <svg class="i" viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/></svg>
            <span>Sqlaris Studio</span>
        </div>
        <p class="muted">Sign in to see your databases.</p>

        <?php if ($error !== null) { ?>
            <div class="callout error"><?= $e($error) ?></div>
        <?php } elseif (! $ready) { ?>
            <div class="callout warn"><div><?= $e($hint) ?></div></div>
        <?php } ?>

        <input type="hidden" name="token" value="<?= $e($_SESSION['dbv_token']) ?>">
        <label>
            <span>Username</span>
            <input class="input" name="username" autocomplete="username" value="<?= $e($username) ?>" required autofocus <?= $ready ? '' : 'disabled' ?>>
        </label>
        <label>
            <span>Password</span>
            <input class="input" name="password" type="password" autocomplete="current-password" required <?= $ready ? '' : 'disabled' ?>>
        </label>
        <button class="btn primary" type="submit" <?= $ready ? '' : 'disabled' ?>>Sign in</button>
    </form>
</body>
<?php } ?>
</html>
