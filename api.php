<?php

declare(strict_types=1);

require __DIR__.'/src/lib.php';
require __DIR__.'/src/actions.php';

dbv_guard();

header('Cache-Control: no-store');

// A page on another site can post a form to localhost, but it cannot add a
// custom header without the browser asking this server first, and nothing
// here says yes. So the header proves the request came from our own page.
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST' || ($_SERVER['HTTP_X_SQLARIS'] ?? '') !== '1') {
    dbv_fail('Bad request.', 400);
}

$req = json_decode((string) file_get_contents('php://input'), true);

if (! is_array($req)) {
    dbv_fail('Bad request body.', 400);
}

dbv_start_session();

try {
    if (! dbv_signed_in()) {
        dbv_fail('You are signed out. Sign in again.', 401);
    }

    $action = (string) ($req['action'] ?? '');

    if ($action === 'logout') {
        $_SESSION = [];
        session_destroy();
        dbv_send(['ok' => true]);
    }

    // Release the session file, so the page's requests run side by side instead of one at a time.
    session_write_close();

    if ($action === 'databases') {
        dbv_send(['groups' => dbv_database_groups(), 'settings' => dbv_settings(), 'layout' => dbv_layout()]);
    }

    if ($action === 'layout') {
        dbv_send(['layout' => dbv_save_layout((array) ($req['layout'] ?? []))]);
    }

    // Saved diagram views live in a file of the viewer's own, so these do not connect at all.
    if ($action === 'save_view') {
        dbv_send(['views' => dbv_save_view((string) ($req['db'] ?? ''), (array) ($req['view'] ?? []))]);
    }

    if ($action === 'delete_view') {
        dbv_send(['views' => dbv_delete_view((string) ($req['db'] ?? ''), (string) ($req['name'] ?? ''))]);
    }

    // These two work on the server, so they connect to it rather than to the database.
    if ($action === 'create_database') {
        dbv_send(dbv_action_create_database($req));
    }

    if ($action === 'drop_database') {
        dbv_send(dbv_action_drop_database($req));
    }

    $d = dbv_open((string) ($req['db'] ?? ''));
    $table = fn () => dbv_table($d, $req['table'] ?? null);

    dbv_send(match ($action) {
        'tables' => dbv_action_tables($d),
        'structure' => dbv_action_structure($d, $table()),
        'rows' => dbv_action_rows($d, $table(), $req),
        'refs' => dbv_action_refs($d, $table(), $req),
        'update' => dbv_action_update($d, $table(), $req),
        'insert' => dbv_action_insert($d, $table(), $req),
        'delete' => dbv_action_delete($d, $table(), $req),
        'values' => dbv_action_values($d, $table(), $req),
        'update_each' => dbv_action_update_each($d, $table(), $req),
        'lookup' => dbv_action_lookup($d, $table(), $req),
        'import' => dbv_action_import($d, $table(), $req),
        'truncate' => dbv_action_truncate($d, $table(), $req),
        'schema' => dbv_action_schema($d),
        'diagram' => dbv_action_diagram($d, (string) $req['db']),
        'export' => dbv_action_export($d, $table(), $req),
        'sql' => dbv_action_sql($d, $req),
        'maintain' => dbv_action_maintain($d, isset($req['table']) ? $table() : null, $req),
        'drop_table' => dbv_action_drop_table($d, $table(), $req),
        'rename_table' => dbv_action_rename_table($d, $table(), $req),
        'copy_table' => dbv_action_copy_table($d, $table(), $req),
        'save_column' => dbv_action_save_column($d, $table(), $req),
        'drop_column' => dbv_action_drop_column($d, $table(), $req),
        'find_id' => dbv_action_find_id($d, $req),
        'health' => dbv_action_health($d),
        'activity' => dbv_action_activity($d),
        'stop' => dbv_action_stop($d, $req),
        default => throw new DbvError('Unknown action.'),
    });
} catch (DbvError $e) {
    dbv_fail($e->getMessage(), 422);
} catch (PDOException $e) {
    dbv_fail(DbvDriver::message($e), 422);
} catch (Throwable $e) {
    dbv_fail($e->getMessage(), 500);
}
