<?php

// A sample setup. Copy it to config.php and change what you need.
//
// Passwords come from .env in this folder, which git ignores, so this file
// can be kept in git. Copy .env.example to .env and fill it in. Without a
// .env, as in a container, the same names are read from the environment.
$env = dbv_env_file(__DIR__.'/.env') + getenv();
$servers = [];

// The database servers, by a short key that shows up in the page's links.
// Each one lists every database its login can open. A server whose host is
// empty in .env is left out.
if (($env['PGSQL_HOST'] ?? '') !== '') {
    $servers['pg'] = [
        'label' => 'Local PostgreSQL',
        'driver' => 'pgsql',
        'host' => $env['PGSQL_HOST'],
        'port' => (int) ($env['PGSQL_PORT'] ?? 5432),
        'username' => $env['PGSQL_USERNAME'] ?? 'postgres',
        'password' => $env['PGSQL_PASSWORD'] ?? '',

        // PostgreSQL always connects to one database, and the list is read
        // from this one. Any database the login can open will do.
        'database' => $env['PGSQL_DATABASE'] ?? 'postgres',

        // Optional. Only databases whose name matches "only", and none that
        // match "hide". * matches anything.
        // 'only' => ['shop*'],
        'hide' => ['postgres'],

        // Optional. How the databases show in the list, by name. The first
        // rule that matches wins, and databases a rule names come first, in
        // this order. "group" puts them under a heading of their own, {1} is
        // what the first * matched, "note" is a short tag next to the name,
        // and "color" is the page's accent while one is open.
        // 'databases' => [
        //     'shop' => ['note' => 'Live copy', 'color' => '#b35a00'],
        //     'shop_*' => ['group' => 'Shop copies', 'note' => '{1}'],
        //     '*' => ['group' => 'Other databases', 'collapsed' => true],
        // ],

        // Optional. The accent of every database on this server.
        // 'color' => '#2458e6',
    ];
}

// MySQL 5.7 and later, or MariaDB 10.2 and later.
if (($env['MYSQL_HOST'] ?? '') !== '') {
    $servers['mysql'] = [
        'label' => 'Local MySQL',
        'driver' => 'mysql',
        'host' => $env['MYSQL_HOST'],
        'port' => (int) ($env['MYSQL_PORT'] ?? 3306),
        'username' => $env['MYSQL_USERNAME'] ?? 'root',
        'password' => $env['MYSQL_PASSWORD'] ?? '',
        'color' => '#b35a00',
    ];
}

return [
    // The sign-in for the viewer itself.
    'username' => $env['VIEWER_USERNAME'] ?? '',
    'password' => $env['VIEWER_PASSWORD'] ?? '',

    'servers' => $servers,

    // The SQL tab shows at most this many rows. The query itself still runs in full.
    // 'sql_row_limit' => 2000,

    // An export stops after this many rows.
    // 'export_row_limit' => 100000,

    // One import takes at most this many rows, all in one transaction.
    // 'import_row_limit' => 5000,

    // A foreign key's search shows these columns of the row it points at,
    // the first two the table has.
    // 'label_columns' => ['name', 'full_name', 'display_name', 'title', 'label', 'username', 'email', 'code'],

    // "Hide audit columns" in the Columns menu hides these.
    // 'audit_columns' => ['created_at', 'updated_at', 'deleted_at', 'created_by', 'updated_by'],

    // Optional. A warning shown above every form that edits a row, for the
    // rules your own app keeps that a direct write skips.
    // 'edit_warning' => 'This skips the app, so no audit entry is written.',
];
