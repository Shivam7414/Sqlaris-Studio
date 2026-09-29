<?php

// For PHP's own server, run from this folder: php -S 127.0.0.1:8765 router.php
// Without it, that server sends any file it is asked for, .env included. This
// serves the page, the API and assets/, and nothing else.
$path = (string) parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);

if ($path === '/' || $path === '/index.php') {
    require __DIR__.'/index.php';

    return true;
}

if ($path === '/api.php') {
    require __DIR__.'/api.php';

    return true;
}

if (str_starts_with($path, '/assets/') && ! str_contains($path, '..') && is_file(__DIR__.$path)) {
    return false;
}

http_response_code(404);

return true;
