<?php

declare(strict_types=1);

/**
 * Everything the viewer needs to know about one table, read from the
 * database's own catalog. Every table and column name a query uses comes from
 * here, never straight from the request.
 */
function dbv_table(DbvDriver $d, mixed $ref): array
{
    $schema = is_array($ref) ? (string) ($ref['schema'] ?? $d->defaultSchema()) : $d->defaultSchema();
    $name = is_array($ref) ? (string) ($ref['name'] ?? '') : '';

    return $d->table($schema, $name) ?? throw new DbvError("There is no table {$schema}.{$name} in this database.");
}

function dbv_public_meta(array $t): array
{
    return [
        'schema' => $t['schema'],
        'name' => $t['name'],
        'kind' => $t['kind'],
        'comment' => $t['comment'],
        'columns' => array_values($t['columns']),
        'pk' => $t['pk'],
        'fks' => $t['fks'],
        'refs' => $t['refs'],
        'editable' => dbv_editable($t),
    ];
}

function dbv_editable(array $t): bool
{
    return in_array($t['kind'], ['table', 'partitioned table'], true) && $t['pk'] !== [];
}

function dbv_column(array $t, string $name): array
{
    return $t['columns'][$name] ?? throw new DbvError("{$t['name']} has no column called {$name}.");
}

/**
 * The select list, every column as text so the page shows exactly what the
 * database holds and can send it back unchanged.
 *
 * @param  list<string>|null  $only
 */
function dbv_text_columns(DbvDriver $d, array $t, ?array $only = null): string
{
    $columns = $only === null ? $t['columns'] : array_map(fn ($n) => dbv_column($t, (string) $n), $only);

    return $columns === [] ? 'null' : implode(', ', array_map(fn ($c) => $d->text($d->col($c['name']), $c), $columns));
}

/** @return array{0: string, 1: list<string>} */
function dbv_where(DbvDriver $d, array $t, array $req): array
{
    $sql = [];
    $params = [];
    $like = $d->ilike();

    foreach ((array) ($req['filters'] ?? []) as $filter) {
        if (! is_array($filter)) {
            continue;
        }

        $column = dbv_column($t, (string) ($filter['col'] ?? ''));
        $c = $d->col($column['name']);
        $text = $d->text($c, $column);
        $op = (string) ($filter['op'] ?? 'contains');
        $value = (string) ($filter['value'] ?? '');

        if ($op === 'null' || $op === 'notnull') {
            $sql[] = $c.($op === 'null' ? ' is null' : ' is not null');

            continue;
        }

        // A filter still being typed matches everything rather than nothing.
        if ($value === '') {
            continue;
        }

        $typed = $d->param($column);
        $bound = $d->value($column, $value);
        $comparable = $d->comparable($column);

        [$expr, $bind] = match ($op) {
            'contains' => ["{$text} {$like} ?", ['%'.dbv_like($value).'%']],
            'not_contains' => ["({$c} is null or {$text} not {$like} ?)", ['%'.dbv_like($value).'%']],
            'starts' => ["{$text} {$like} ?", [dbv_like($value).'%']],
            'ends' => ["{$text} {$like} ?", ['%'.dbv_like($value)]],
            'eq' => $comparable ? ["{$c} = {$typed}", [$bound]] : ["{$text} = ?", [$value]],
            'neq' => $comparable ? [$d->isDistinct($c, $typed), [$bound]] : [$d->isDistinct($text, '?'), [$value]],
            'gt' => ["{$c} > {$typed}", [$bound]],
            'gte' => ["{$c} >= {$typed}", [$bound]],
            'lt' => ["{$c} < {$typed}", [$bound]],
            'lte' => ["{$c} <= {$typed}", [$bound]],
            'in' => dbv_in($text, $value),
            default => throw new DbvError("Unknown filter: {$op}."),
        };

        $sql[] = $expr;
        array_push($params, ...$bind);
    }

    $search = trim((string) ($req['search'] ?? ''));

    if ($search !== '') {
        // The whole row as text, so one box searches every column.
        $sql[] = $d->rowText($t)." {$like} ?";
        $params[] = '%'.dbv_like($search).'%';
    }

    return [$sql === [] ? '' : ' where '.implode(' and ', $sql), $params];
}

/** @return array{0: string, 1: list<string>} */
function dbv_in(string $text, string $value): array
{
    $items = array_values(array_filter(array_map('trim', preg_split('/[\n,]+/', $value) ?: []), fn ($i) => $i !== ''));

    if ($items === []) {
        return ['1 = 1', []];
    }

    return ["{$text} in (".implode(', ', array_fill(0, count($items), '?')).')', $items];
}

function dbv_order(DbvDriver $d, array $t, mixed $sort): string
{
    $parts = [];

    if (is_array($sort) && isset($sort['col'])) {
        $column = dbv_column($t, (string) $sort['col']);
        $c = $d->col($column['name']);
        $parts[] = $d->orderBy($d->comparable($column) ? $c : $d->asText($c), ($sort['dir'] ?? 'asc') === 'desc' ? 'desc' : 'asc');
    }

    // The primary key last, so paging is stable when many rows share a value.
    foreach ($t['pk'] as $key) {
        $parts[] = $d->col($key);
    }

    return $parts === [] ? '' : ' order by '.implode(', ', $parts);
}

/** @return array{0: string, 1: list<string>} */
function dbv_key_where(DbvDriver $d, array $t, mixed $key): array
{
    if (! dbv_editable($t)) {
        throw new DbvError('This table has no primary key, or it is a view, so one row cannot be picked out. Use the SQL tab.');
    }

    $sql = [];
    $params = [];

    foreach ($t['pk'] as $name) {
        if (! is_array($key) || ! isset($key[$name])) {
            throw new DbvError('The row key is missing. Refresh and try again.');
        }

        $column = $t['columns'][$name];
        $sql[] = $d->col($name).' = '.$d->param($column);
        $params[] = $d->value($column, (string) $key[$name]);
    }

    return [implode(' and ', $sql), $params];
}

/** Runs a write that must touch exactly one row. More or fewer, and the caller's transaction is undone. */
function dbv_one_row(DbvDriver $d, string $sql, array $params): void
{
    $statement = $d->pdo->prepare($sql);
    $statement->execute($params);
    $count = $statement->rowCount();

    if ($count !== 1) {
        throw new DbvError($count === 0
            ? 'A row is not there any more. It may have been changed or deleted. Nothing was saved. Refresh and try again.'
            : 'More than one row matched, so nothing was saved.');
    }
}

/** One row as text, found by its primary key. */
function dbv_row_by_key(DbvDriver $d, array $t, array $key): ?array
{
    [$where, $params] = dbv_key_where($d, $t, $key);
    $statement = $d->pdo->prepare('select '.dbv_text_columns($d, $t).' from '.$d->from($t)." where {$where}");
    $statement->execute($params);

    return $statement->fetch(PDO::FETCH_NUM) ?: null;
}

/**
 * Changes one row and returns it as it is afterwards. When the change moves
 * the primary key, the row is read back by its new key.
 */
function dbv_update_row(DbvDriver $d, array $t, mixed $key, array $changes): array
{
    [$names, $exprs, $params] = $d->values($t, $changes);

    if ($names === []) {
        throw new DbvError('Nothing changed.');
    }

    [$where, $keyParams] = dbv_key_where($d, $t, $key);
    $set = implode(', ', array_map(fn ($n, $e) => "{$n} = {$e}", $names, $exprs));
    dbv_one_row($d, 'update '.$d->from($t)." set {$set} where {$where}", [...$params, ...$keyParams]);

    foreach ($t['pk'] as $name) {
        if (array_key_exists($name, $changes)) {
            $key[$name] = $changes[$name];
        }
    }

    return dbv_row_by_key($d, $t, $key) ?? throw new DbvError('The row changed, but it could not be read back. Refresh to see it.');
}

/** @return list<mixed> the row keys the page sent, at most 1000 */
function dbv_keys(array $req): array
{
    $keys = array_values((array) ($req['keys'] ?? []));

    if ($keys === []) {
        throw new DbvError('Pick at least one row.');
    }

    if (count($keys) > 1000) {
        throw new DbvError('At most 1000 rows at a time.');
    }

    return $keys;
}

function dbv_action_tables(DbvDriver $d): array
{
    $result = $d->tables();
    // What upkeep this system offers, so the page shows only that.
    $result['info']['maintenance'] = array_map(fn ($op, $m) => ['op' => $op] + $m, array_keys($d::MAINTENANCE), $d::MAINTENANCE);

    return $result;
}

function dbv_action_structure(DbvDriver $d, array $t): array
{
    return ['table' => dbv_public_meta($t)] + $d->structure($t);
}

function dbv_action_rows(DbvDriver $d, array $t, array $req): array
{
    $started = hrtime(true);
    $perPage = max(1, min(1000, (int) ($req['perPage'] ?? 50)));
    $page = max(1, (int) ($req['page'] ?? 1));
    [$where, $params] = dbv_where($d, $t, $req);

    $count = $d->pdo->prepare('select count(*) from '.$d->from($t).$where);
    $count->execute($params);

    $rows = $d->pdo->prepare('select '.dbv_text_columns($d, $t).' from '.$d->from($t).$where.dbv_order($d, $t, $req['sort'] ?? null)
        ." limit {$perPage} offset ".(($page - 1) * $perPage));
    $rows->execute($params);

    return [
        'table' => dbv_public_meta($t),
        'rows' => $rows->fetchAll(PDO::FETCH_NUM),
        'total' => (int) $count->fetchColumn(),
        'page' => $page,
        'perPage' => $perPage,
        'ms' => (int) round((hrtime(true) - $started) / 1e6),
    ];
}

/** How many rows in other tables point at this one, per foreign key. */
function dbv_action_refs(DbvDriver $d, array $t, array $req): array
{
    $row = (array) ($req['row'] ?? []);
    $out = [];

    foreach ($t['refs'] as $ref) {
        $where = [];
        $params = [];

        foreach ($ref['cols'] as $i => $column) {
            $value = $row[$ref['ref_cols'][$i]] ?? null;

            if ($value === null) {
                $out[] = $ref + ['count' => null];

                continue 2;
            }

            // Left untyped, the value takes the column's type and the index is used.
            $where[] = $d->quote($column).' = ?';
            $params[] = $d->value($t['columns'][$ref['ref_cols'][$i]], (string) $value);
        }

        $count = $d->pdo->prepare('select count(*) from '.$d->quote($ref['schema']).'.'.$d->quote($ref['tbl']).' where '.implode(' and ', $where));
        $count->execute($params);
        $out[] = $ref + ['count' => (int) $count->fetchColumn()];
    }

    return ['refs' => $out];
}

/** Sets the same values on one row or many: one row for an edited cell, many for a selection. */
function dbv_action_update(DbvDriver $d, array $t, array $req): array
{
    $changes = (array) ($req['changes'] ?? []);

    return ['rows' => $d->transaction(fn () => array_map(fn ($key) => dbv_update_row($d, $t, $key, $changes), dbv_keys($req)))];
}

function dbv_action_insert(DbvDriver $d, array $t, array $req): array
{
    if (! dbv_editable($t)) {
        throw new DbvError('Rows can only be added here to a table with a primary key. Use the SQL tab.');
    }

    $values = array_map(fn ($v) => $v === null ? null : (is_bool($v) ? ($v ? 'true' : 'false') : (string) $v), (array) ($req['values'] ?? []));

    // The row comes back null when the database cannot say what its key became. The page reloads instead.
    return ['row' => $d->transaction(function () use ($d, $t, $values) {
        $key = $d->insert($t, $values);

        return $key === null ? null : dbv_row_by_key($d, $t, $key);
    })];
}

function dbv_action_delete(DbvDriver $d, array $t, array $req): array
{
    $keys = dbv_keys($req);

    $d->transaction(function () use ($d, $t, $keys) {
        foreach ($keys as $key) {
            [$where, $params] = dbv_key_where($d, $t, $key);
            dbv_one_row($d, $d->deleteFrom($t)." where {$where}", $params);
        }
    });

    return ['deleted' => count($keys)];
}

/** One column's values over the rows that match the search and filters: how many, and the most common ones. */
function dbv_action_values(DbvDriver $d, array $t, array $req): array
{
    $column = dbv_column($t, (string) ($req['col'] ?? ''));
    $c = $d->col($column['name']);
    $text = $d->text($c, $column);
    [$where, $params] = dbv_where($d, $t, $req);
    $from = $d->from($t).$where;
    // Lowest and highest only mean something for numbers, dates, text and intervals.
    $ranged = in_array($column['category'], ['number', 'text', 'date', 'datetime', 'time', 'interval'], true) && $d->comparable($column);

    return [
        'stats' => dbv_one($d->pdo,
            "select count(*) as total, count({$c}) as filled, count(distinct {$text}) as distinct_values"
            .($ranged ? ', '.$d->asText("min({$c})").' as low, '.$d->asText("max({$c})").' as high' : '')
            ." from {$from}", $params),
        'values' => dbv_all($d->pdo,
            "select {$text} as value, count(*) as n from {$from} group by 1 order by 2 desc, 1 limit 100", $params),
    ];
}

/**
 * Runs what the SQL tab sent. Unless the page asked for writes, the
 * connection is read only first, so a stray UPDATE is refused by the database
 * itself. Either way nothing is kept unless writes were asked for. With
 * writes, a script that ends the transaction itself is reported as "ended".
 */
function dbv_action_sql(DbvDriver $d, array $req): array
{
    $sql = trim((string) ($req['sql'] ?? ''));

    if ($sql === '') {
        throw new DbvError('Write a query first.');
    }

    $explain = ($req['explain'] ?? false) === true;
    $write = ! $explain && ($req['write'] ?? false) === true;
    $limit = (int) dbv_config('sql_row_limit');
    $pdo = $d->pdo;
    $started = hrtime(true);

    if ($explain) {
        $sql = $d->explain(rtrim($sql, "; \n\r\t"));
    }

    // Emulated, PDO sends the text as it is, so a script of several statements runs.
    $pdo->setAttribute(PDO::ATTR_EMULATE_PREPARES, true);

    if (! $write) {
        $d->readOnly();
    }

    $pdo->beginTransaction();

    try {
        $statement = $pdo->query($sql);
        $columns = [];
        $rows = [];
        $more = false;

        // The last statement that returns rows is the one shown.
        do {
            if ($statement->columnCount() > 0) {
                $columns = [];
                $rows = [];
                $more = false;

                for ($i = 0; $i < $statement->columnCount(); $i++) {
                    $meta = $statement->getColumnMeta($i) ?: [];
                    $columns[] = ['name' => (string) ($meta['name'] ?? "column {$i}"), 'numeric' => $d->numeric((string) ($meta['native_type'] ?? ''))];
                }

                while (($row = $statement->fetch(PDO::FETCH_NUM)) !== false) {
                    if (count($rows) >= $limit) {
                        $more = true;

                        break;
                    }

                    $rows[] = array_map('dbv_plain', $row);
                }
            }

            $affected = $statement->rowCount();
        } while ($d->nextResult($statement));

        // The script can end the transaction before we do: a COMMIT or ROLLBACK
        // of its own, or on MySQL a statement such as CREATE TABLE, which
        // commits by itself. Then the script decided what was kept, not us.
        // A script that then starts a new transaction cannot be told apart.
        $ended = ! $d->inTransaction();
    } catch (Throwable $e) {
        if ($d->inTransaction()) {
            $pdo->rollBack();
        } elseif ($write) {
            // Rolling back now cannot undo what the script committed before the
            // error, so the message must not let it look as if nothing changed.
            throw new DbvError("The script ended the transaction itself before this error, so part of the script may have been kept.\n"
                .($e instanceof PDOException ? DbvDriver::message($e) : $e->getMessage()), 0, $e);
        }

        throw $e;
    }

    // Outside the try, so a COMMIT the database refuses, such as one that
    // breaks a deferred constraint, is not taken for the script's own.
    if (! $ended) {
        $write ? $pdo->commit() : $pdo->rollBack();
    }

    return [
        'columns' => $columns,
        'rows' => $rows,
        'more' => $more,
        'affected' => $affected,
        'committed' => $write && ! $ended,
        'ended' => $write && $ended,
        'plan' => $explain,
        'ms' => (int) round((hrtime(true) - $started) / 1e6),
    ];
}

/**
 * Every row that matches the search and filters, as CSV, JSON or SQL INSERT
 * statements. CSV takes the columns on screen; JSON and SQL take them all,
 * and SQL leaves out the columns the database fills itself.
 */
function dbv_action_export(DbvDriver $d, array $t, array $req): never
{
    $format = in_array($req['format'] ?? 'csv', ['csv', 'json', 'sql'], true) ? $req['format'] : 'csv';
    $only = $format === 'csv' && isset($req['columns']) && is_array($req['columns']) ? $req['columns'] : null;
    $names = $only === null ? array_keys($t['columns']) : array_map(fn ($n) => dbv_column($t, (string) $n)['name'], $only);

    if ($format === 'sql') {
        $names = array_values(array_filter($names, fn ($n) => ! $t['columns'][$n]['readonly']));
    }

    [$where, $params] = dbv_where($d, $t, $req);

    $statement = $d->pdo->prepare('select '.dbv_text_columns($d, $t, $names).' from '.$d->from($t).$where
        .dbv_order($d, $t, $req['sort'] ?? null).' limit '.(int) dbv_config('export_row_limit'));
    $statement->execute($params);

    if ($format === 'json') {
        header('Content-Type: application/json; charset=utf-8');
        echo "[\n";
        $first = true;

        while (($row = $statement->fetch(PDO::FETCH_NUM)) !== false) {
            echo ($first ? '' : ",\n").'  '.json_encode(array_combine($names, $row), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
            $first = false;
        }

        echo "\n]\n";
        exit;
    }

    if ($format === 'sql') {
        header('Content-Type: text/plain; charset=utf-8');
        $columns = array_map(fn ($n) => $t['columns'][$n], $names);
        $into = 'insert into '.$d->tableName($t).' ('.implode(', ', array_map([$d, 'quote'], $names)).') values (';

        while (($row = $statement->fetch(PDO::FETCH_NUM)) !== false) {
            echo $into.implode(', ', array_map([$d, 'literal'], $row, $columns)).");\n";
        }

        exit;
    }

    header('Content-Type: text/csv; charset=utf-8');
    $out = fopen('php://output', 'w');
    // The byte order mark tells Excel the file is UTF-8, so accented and non-Latin text survives.
    fwrite($out, "\xEF\xBB\xBF");
    fputcsv($out, $names, ',', '"', '');

    while (($row = $statement->fetch(PDO::FETCH_NUM)) !== false) {
        fputcsv($out, $row, ',', '"', '');
    }

    exit;
}

/** Different changes for different rows, in one transaction. Used by a paste that covers many cells. */
function dbv_action_update_each(DbvDriver $d, array $t, array $req): array
{
    $items = array_values((array) ($req['items'] ?? []));

    if ($items === [] || count($items) > 1000) {
        throw new DbvError('Send between 1 and 1000 rows.');
    }

    return ['rows' => $d->transaction(fn () => array_map(
        fn ($item) => dbv_update_row($d, $t, $item['key'] ?? null, (array) ($item['changes'] ?? [])),
        $items))];
}

/**
 * Rows of a table a foreign key points at, found by any text in them, with a
 * readable label, so a key can be picked by name instead of typed as an id.
 * The label columns come from label_columns in config.php.
 */
function dbv_action_lookup(DbvDriver $d, array $t, array $req): array
{
    $column = dbv_column($t, (string) ($req['col'] ?? ''));
    $q = trim((string) ($req['q'] ?? ''));
    $label = dbv_label($d, $t['columns'], $column['name']) ?? 'null';

    return ['items' => dbv_all($d->pdo,
        'select '.$d->text($d->col($column['name']), $column).' as value, '.$label.' as label from '.$d->from($t)
        .($q === '' ? '' : ' where '.$d->rowText($t).' '.$d->ilike().' ?')
        .' order by 2, 1 limit 25',
        $q === '' ? [] : ['%'.dbv_like($q).'%'])];
}

/**
 * The SQL that names a row to a person: up to two of the label_columns in
 * config.php, or else the first text column. Null when the table has
 * neither. The column the row was found by is left out, since it is already
 * on screen.
 */
function dbv_label(DbvDriver $d, array $columns, string $except): ?string
{
    $labels = [];

    foreach ((array) dbv_config('label_columns') as $name) {
        if (isset($columns[$name]) && $name !== $except && count($labels) < 2) {
            $labels[] = $columns[$name];
        }
    }

    if ($labels === []) {
        foreach ($columns as $c) {
            if ($c['category'] === 'text' && $c['name'] !== $except) {
                $labels[] = $c;

                break;
            }
        }
    }

    return $labels === [] ? null : "concat_ws(', ', ".implode(', ', array_map(fn ($c) => $d->text($d->col($c['name']), $c), $labels)).')';
}

/**
 * Every column of the database that holds one id, with how many rows hold it.
 * It looks in each primary key, foreign key and unique column, the last for a
 * code such as an employee code, and in every other uuid column too, because
 * a column that points into another database cannot have a foreign key. A
 * value is only compared with a column of a type it could be, so the
 * comparison uses the column's index.
 */
function dbv_action_find_id(DbvDriver $d, array $req): array
{
    $value = trim((string) ($req['value'] ?? ''));

    if ($value === '' || strlen($value) > 200) {
        throw new DbvError('Type the id to look for, at most 200 characters.');
    }

    $fits = [
        'uuid' => (bool) preg_match('/^\{?[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}\}?$/i', $value),
        'number' => (bool) preg_match('/^-?\d+$/', $value),
        'text' => true,
    ];
    // One count per column adds up on a big database.
    set_time_limit(0);
    $started = hrtime(true);
    $found = [];
    $searched = 0;

    foreach ($d->diagram() as $t) {
        if (! in_array($t['kind'], ['table', 'partitioned table'], true)) {
            continue;
        }

        $columns = array_column($t['columns'], null, 'name');
        $points = [];

        foreach ($t['fks'] as $fk) {
            foreach ($fk['cols'] as $i => $col) {
                $points[$col] ??= ['schema' => $fk['schema'], 'tbl' => $fk['tbl'], 'col' => $fk['ref_cols'][$i]];
            }
        }

        foreach ($columns as $name => $column) {
            $inPk = in_array($name, $t['pk'], true);
            $unique = in_array($name, $t['unique'], true);
            $isKey = $inPk || $unique || isset($points[$name]);

            if (! ($fits[$column['category']] ?? false) || (! $isKey && $column['category'] !== 'uuid')) {
                continue;
            }

            // A value longer than the column cannot be in it. The cast to char(2)
            // would also cut "US-000001" down to "US" and find the wrong rows.
            if (preg_match('/char(?:acter)?(?: varying)?\((\d+)\)/i', $column['type'], $size) && mb_strlen($value) > (int) $size[1]) {
                continue;
            }

            // A row found by its whole primary key, or by a code, is the thing the id names, so it gets a label.
            $label = $t['pk'] === [$name] || $unique ? dbv_label($d, $columns, $name) : null;

            try {
                $hit = dbv_one($d->pdo,
                    'select count(*) as n'.($label === null ? '' : ", max({$label}) as label")
                    .' from '.$d->from($t).' where '.$d->col($name).' = '.$d->param($column),
                    [$d->value($column, $value)]);
            } catch (PDOException) {
                // Too big for the column's number type, or not one of its enum values, so it cannot be there.
                continue;
            }

            $searched++;

            if ((int) $hit['n'] > 0) {
                $found[] = [
                    'table' => ['schema' => $t['schema'], 'name' => $t['name']],
                    'column' => $name,
                    'type' => $column['type'],
                    'role' => $inPk ? 'pk' : (isset($points[$name]) ? 'fk' : ($unique ? 'uq' : 'id')),
                    'points' => $points[$name] ?? null,
                    'rows' => (int) $hit['n'],
                    'label' => $hit['label'] ?? null,
                ];
            }
        }
    }

    return ['found' => $found, 'searched' => $searched, 'ms' => (int) round((hrtime(true) - $started) / 1e6)];
}

/**
 * Rows from a CSV file or a paste, all in one transaction: one bad row and
 * nothing is kept, and the message names that row. With upsert, a row whose
 * primary key already exists is updated instead.
 */
function dbv_action_import(DbvDriver $d, array $t, array $req): array
{
    if (! dbv_editable($t)) {
        throw new DbvError('Rows can only be imported into a table with a primary key.');
    }

    $columns = array_map(fn ($n) => dbv_column($t, (string) $n), array_values((array) ($req['columns'] ?? [])));
    $rows = array_values((array) ($req['rows'] ?? []));
    $upsert = ($req['upsert'] ?? false) === true;
    $limit = (int) dbv_config('import_row_limit');

    if ($columns === []) {
        throw new DbvError('Match at least one column.');
    }

    if ($rows === [] || count($rows) > $limit) {
        throw new DbvError("Import between 1 and {$limit} rows at a time.");
    }

    foreach ($columns as $column) {
        if ($column['readonly']) {
            throw new DbvError("{$column['name']} is filled by the database and cannot be imported.");
        }
    }

    $names = array_map(fn ($c) => $c['name'], $columns);
    $sql = 'insert into '.$d->tableName($t).' ('.implode(', ', array_map([$d, 'quote'], $names)).') values ('
        .implode(', ', array_map([$d, 'param'], $columns)).')';

    if ($upsert) {
        if (array_diff($t['pk'], $names) !== []) {
            throw new DbvError('To update existing rows, match the primary key column too: '.implode(', ', $t['pk']).'.');
        }

        $sql .= $d->upsert($t, $names);
    }

    $count = $d->transaction(function () use ($d, $sql, $rows, $columns) {
        $statement = $d->pdo->prepare($sql);
        $count = 0;

        foreach ($rows as $i => $row) {
            $row = array_values((array) $row);

            if (count($row) !== count($columns)) {
                throw new DbvError('Row '.($i + 1).' has '.count($row).' values, but '.count($columns).' columns are matched.');
            }

            try {
                $statement->execute(array_map(fn ($v, $c) => $v === null ? null : $d->value($c, (string) $v), $row, $columns));
            } catch (PDOException $e) {
                throw new DbvError('Row '.($i + 1).': '.DbvDriver::message($e));
            } catch (DbvError $e) {
                throw new DbvError('Row '.($i + 1).': '.$e->getMessage());
            }

            // MySQL counts an updated row twice, so only "touched or not" is counted.
            $count += $statement->rowCount() > 0 ? 1 : 0;
        }

        return $count;
    });

    return ['count' => $count, 'rows' => count($rows)];
}

/** Empties a table. The page must send the table's name back, so it is never done by one stray click. */
function dbv_action_truncate(DbvDriver $d, array $t, array $req): array
{
    if (! in_array($t['kind'], ['table', 'partitioned table'], true)) {
        throw new DbvError('Only a table can be emptied.');
    }

    if (($req['confirm'] ?? '') !== $t['name']) {
        throw new DbvError('Type the table name to confirm.');
    }

    $d->truncate($t, ($req['cascade'] ?? false) === true);

    return ['ok' => true];
}

/** Vacuum, analyze, optimize and the rest, on one table or on all of them. The page sees the size before and after. */
function dbv_action_maintain(DbvDriver $d, ?array $t, array $req): array
{
    $op = (string) ($req['op'] ?? '');

    if (! isset($d::MAINTENANCE[$op])) {
        throw new DbvError('This database system has no such upkeep.');
    }

    if ($t !== null && ! in_array($t['kind'], ['table', 'partitioned table', 'materialized view'], true)) {
        throw new DbvError('Only a table can be maintained. A view holds no rows of its own.');
    }

    // A big table can take minutes, longer than PHP lets a request run.
    set_time_limit(0);
    $started = hrtime(true);
    $before = $d->size($t);
    $messages = $d->maintain($t, $op);

    return [
        'before' => $before,
        'after' => $d->size($t),
        'messages' => $messages,
        'ms' => (int) round((hrtime(true) - $started) / 1e6),
    ];
}

/** Drops a table or a view. The page must send its name back, as for emptying it. */
function dbv_action_drop_table(DbvDriver $d, array $t, array $req): array
{
    if (($req['confirm'] ?? '') !== $t['name']) {
        throw new DbvError('Type the table name to confirm.');
    }

    $d->dropTable($t, ($req['cascade'] ?? false) === true);

    return ['ok' => true];
}

function dbv_action_rename_table(DbvDriver $d, array $t, array $req): array
{
    $to = dbv_new_name($req['to'] ?? '');
    $d->renameTable($t, $to);

    return ['name' => $to];
}

function dbv_action_copy_table(DbvDriver $d, array $t, array $req): array
{
    if (! in_array($t['kind'], ['table', 'partitioned table'], true)) {
        throw new DbvError('Only a table can be copied. Copy a view by running its query in the SQL tab.');
    }

    $to = dbv_new_name($req['to'] ?? '');
    set_time_limit(0);
    $d->copyTable($t, $to, ($req['rows'] ?? true) === true);

    return ['name' => $to];
}

/**
 * What the column form sends, checked. The type and an SQL default go into the
 * statement as they are, like a query in the SQL tab, so they may not end it.
 * A default given as text is quoted here.
 */
function dbv_column_spec(DbvDriver $d, mixed $spec): array
{
    $spec = is_array($spec) ? $spec : [];
    $type = trim((string) ($spec['type'] ?? ''));
    $default = is_array($spec['default'] ?? null) ? $spec['default'] : ['mode' => 'none'];
    $value = (string) ($default['value'] ?? '');

    if ($type === '' || strlen($type) > 200 || preg_match('/;|--|\/\*/', $type)) {
        throw new DbvError('Give the column a type, such as integer or varchar(100).');
    }

    $default = match ($default['mode'] ?? 'none') {
        'text' => $d->pdo->quote($value),
        'sql' => trim($value) === '' ? throw new DbvError('Write the default as SQL, or pick another kind of default.') : trim($value),
        default => null,
    };

    $comment = trim((string) ($spec['comment'] ?? ''));

    return [
        'name' => dbv_new_name($spec['name'] ?? ''),
        'type' => $type,
        'nullable' => ($spec['nullable'] ?? true) === true,
        'default' => $default,
        'comment' => $comment === '' ? null : $comment,
    ];
}

/**
 * Adds a column, or with "column" changes that one. With "run" false it only
 * says what would run, so the page can show the SQL first.
 */
function dbv_action_save_column(DbvDriver $d, array $t, array $req): array
{
    if (! in_array($t['kind'], ['table', 'partitioned table'], true)) {
        throw new DbvError('Only a table has columns to change. A view takes its columns from its query.');
    }

    $column = isset($req['column']) ? dbv_column($t, (string) $req['column']) : null;
    $sql = $d->columnSql($t, $column, dbv_column_spec($d, $req['spec'] ?? null));

    if (($req['run'] ?? false) === true && $sql !== []) {
        // A change to a big table rewrites every row, which takes longer than a query may.
        set_time_limit(0);
        // PostgreSQL changes a table inside a transaction, so several statements
        // are all kept or none. MySQL's change is always one statement, and it
        // commits on its own, which would leave PDO no transaction to end.
        $run = function () use ($d, $sql) {
            foreach ($sql as $statement) {
                $d->pdo->exec($statement);
            }
        };
        count($sql) === 1 ? $run() : $d->transaction($run);
    }

    return ['sql' => $sql];
}

/** Drops a column. The page must send its name back, as for dropping a table. */
function dbv_action_drop_column(DbvDriver $d, array $t, array $req): array
{
    $column = dbv_column($t, (string) ($req['column'] ?? ''));

    if (($req['confirm'] ?? '') !== $column['name']) {
        throw new DbvError('Type the column name to confirm.');
    }

    $d->dropColumn($t, $column, ($req['cascade'] ?? false) === true);

    return ['ok' => true];
}

function dbv_action_health(DbvDriver $d): array
{
    return $d->health();
}

function dbv_action_activity(DbvDriver $d): array
{
    return $d->activity();
}

/** Stops the query of another session in this database, or ends that session. */
function dbv_action_stop(DbvDriver $d, array $req): array
{
    $d->stop((int) ($req['id'] ?? 0), ($req['kill'] ?? false) === true);

    return ['ok' => true];
}

/**
 * A new database on the same server as the one the page has open, empty or
 * as a copy of it. It has to be one config.php lets the list show, or it
 * would be made and then never seen.
 */
function dbv_action_create_database(array $req): array
{
    [$server, $current] = dbv_find((string) ($req['db'] ?? ''));
    $name = dbv_new_name($req['name'] ?? '');

    if (! dbv_listed($server, $name)) {
        throw new DbvError("config.php keeps a database called {$name} off the list, so it would not show here. Pick another name.");
    }

    set_time_limit(0);
    $notes = $server['class']::createDatabase($server['class']::connect($server, null), $name, ($req['copy'] ?? false) === true ? $current : null);

    return ['id' => $server['key'].'/'.$name, 'notes' => $notes];
}

/** Drops a whole database. The page must send its name back, and the server's own databases are refused. */
function dbv_action_drop_database(array $req): array
{
    [$server, $name] = dbv_find((string) ($req['db'] ?? ''));

    if (($req['confirm'] ?? '') !== $name) {
        throw new DbvError('Type the database name to confirm.');
    }

    if (in_array(strtolower($name), $server['class']::SYSTEM_DATABASES, true)) {
        throw new DbvError("{$name} belongs to the server itself, so it is not dropped from here.");
    }

    $server['class']::dropDatabase($server['class']::connect($server, null), $name);

    return ['ok' => true];
}

/** Every table and its columns, for the SQL editor's suggestions. */
function dbv_action_schema(DbvDriver $d): array
{
    return ['tables' => $d->schema()];
}

/** Every table for the diagram, and the views of it saved for this database. */
function dbv_action_diagram(DbvDriver $d, string $db): array
{
    return ['tables' => $d->diagram(), 'views' => dbv_views($db)];
}
