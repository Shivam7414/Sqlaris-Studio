<?php

// Downloads the three libraries and two fonts the page uses into
// assets/vendor, at the versions below, each with its license. From the
// viewer's folder:
//
//     php src/libraries.php
//
// The files are kept in git, so this only runs again to change a version.
// Without them the page still works, with the browser's own dropdowns and
// date pickers, a plain SQL box and the system font.

declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

const LIBRARIES = [
    // Dropdowns you can type into.
    'tom-select' => [
        'package' => 'tom-select@2.6.2',
        'js' => ['dist/js/tom-select.complete.min.js'],
        'css' => ['dist/css/tom-select.min.css'],
        'license' => 'LICENSE',
    ],
    // The date and time picker.
    'flatpickr' => [
        'package' => 'flatpickr@4.6.13',
        'js' => ['dist/flatpickr.min.js'],
        'css' => ['dist/flatpickr.min.css'],
        'license' => 'LICENSE.md',
    ],
    // The SQL editor. Version 5, because 6 needs a build step.
    'codemirror' => [
        'package' => 'codemirror@5.65.21',
        'js' => [
            'lib/codemirror.min.js',
            'mode/sql/sql.min.js',
            'addon/hint/show-hint.min.js',
            'addon/hint/sql-hint.min.js',
            'addon/edit/matchbrackets.min.js',
            'addon/edit/closebrackets.min.js',
            'addon/comment/comment.min.js',
            'addon/selection/active-line.min.js',
            'addon/display/placeholder.min.js',
        ],
        'css' => ['lib/codemirror.min.css', 'addon/hint/show-hint.min.css'],
        'license' => 'LICENSE',
    ],
];

// Inter for the page, JetBrains Mono for values and SQL. Latin and the
// accented Latin letters; other scripts, such as Chinese, use the system font.
const FONTS = [
    'inter' => [
        'package' => '@fontsource-variable/inter@5.3.0',
        'files' => ['latin' => 'files/inter-latin-wght-normal.woff2', 'latin-ext' => 'files/inter-latin-ext-wght-normal.woff2'],
    ],
    'jetbrains-mono' => [
        'package' => '@fontsource-variable/jetbrains-mono@5.3.0',
        'files' => ['latin' => 'files/jetbrains-mono-latin-wght-normal.woff2', 'latin-ext' => 'files/jetbrains-mono-latin-ext-wght-normal.woff2'],
    ],
];

$dir = __DIR__.'/../assets/vendor';

if (! is_dir("{$dir}/fonts") && ! mkdir("{$dir}/fonts", 0777, true)) {
    fwrite(STDERR, "Cannot create {$dir}\n");
    exit(1);
}

$fetch = function (string $package, string $file): string {
    $url = "https://cdn.jsdelivr.net/npm/{$package}/{$file}";
    $body = @file_get_contents($url);

    if ($body === false || $body === '') {
        fwrite(STDERR, "Could not download {$url}\n");
        exit(1);
    }

    return $body;
};

foreach (LIBRARIES as $name => $lib) {
    // One file per library and kind, so the page loads three scripts and three stylesheets.
    $js = implode(";\n", array_map(fn ($f) => $fetch($lib['package'], $f), $lib['js']));
    $css = implode("\n", array_map(fn ($f) => $fetch($lib['package'], $f), $lib['css']));

    file_put_contents("{$dir}/{$name}.js", "/* {$lib['package']} */\n{$js}\n");
    file_put_contents("{$dir}/{$name}.css", "/* {$lib['package']} */\n{$css}\n");
    file_put_contents("{$dir}/{$name}.LICENSE.txt", $fetch($lib['package'], $lib['license']));

    echo "{$lib['package']}\n";
}

foreach (FONTS as $name => $font) {
    foreach ($font['files'] as $subset => $file) {
        file_put_contents("{$dir}/fonts/{$name}-{$subset}.woff2", $fetch($font['package'], $file));
    }

    file_put_contents("{$dir}/fonts/{$name}.LICENSE.txt", $fetch($font['package'], 'LICENSE'));

    echo "{$font['package']}\n";
}

echo "Saved in assets/vendor.\n";
