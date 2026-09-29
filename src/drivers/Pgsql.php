<?php

declare(strict_types=1);

final class DbvPgsql extends DbvDriver
{
    public const DRIVER = 'pgsql';

    public const LABEL = 'PostgreSQL';

    public const PORT = 5432;

    private const KINDS = ['r' => 'table', 'p' => 'partitioned table', 'v' => 'view', 'm' => 'materialized view', 'f' => 'foreign table'];

    private const CONSTRAINTS = ['p' => 'primary key', 'u' => 'unique', 'f' => 'foreign key', 'c' => 'check', 'x' => 'exclude', 't' => 'trigger'];

    /** The relations the viewer lists: tables, views and foreign tables, outside the system schemas and never a partition. */
    private const LISTED = "c.relkind in ('r', 'p', 'v', 'm', 'f')
              and n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg\\_%'
              and not c.relispartition";

    public const MAINTENANCE = [
        'vacuum' => ['label' => 'Vacuum and analyze', 'hint' => 'Makes the space of deleted and updated rows reusable, and refreshes the numbers the planner picks plans by. Safe while the app runs.', 'locks' => false],
        'analyze' => ['label' => 'Analyze', 'hint' => 'Refreshes the numbers the planner picks plans by. Quick, and safe while the app runs.', 'locks' => false],
        'reindex' => ['label' => 'Rebuild indexes', 'hint' => 'Builds every index again from the rows, which shrinks a bloated one. Writes wait until it is done.', 'locks' => true],
        'vacuum_full' => ['label' => 'Vacuum full', 'hint' => 'Rewrites the table to give the space of deleted rows back to the disk. The table cannot be read or written until it is done.', 'locks' => true],
    ];

    public const SYSTEM_DATABASES = ['postgres', 'template0', 'template1'];

    public static function connect(array $server, ?string $database): PDO
    {
        // PostgreSQL always connects to one database, so the list is read from this one.
        $database ??= (string) ($server['database'] ?? 'postgres');
        $dsn = sprintf("pgsql:host=%s;port=%d;dbname='%s'", $server['host'], $server['port'], addcslashes($database, "'\\"));
        $pdo = new PDO($dsn, (string) $server['username'], (string) $server['password'], [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_TIMEOUT => 5,
        ]);

        // Times come back in UTC, so the page shows the same time whoever wrote it.
        $pdo->exec("set time zone 'UTC'");
        $pdo->exec("set client_encoding to 'UTF8'");
        $pdo->exec("set statement_timeout = '30s'");

        return $pdo;
    }

    public static function databases(PDO $pdo): array
    {
        return $pdo->query('select datname from pg_database where not datistemplate and datallowconn order by datname')->fetchAll(PDO::FETCH_COLUMN);
    }

    public function quote(string $name): string
    {
        return self::ident($name);
    }

    private static function ident(string $name): string
    {
        return '"'.str_replace('"', '""', $name).'"';
    }

    public function defaultSchema(): string
    {
        return 'public';
    }

    public function tables(): array
    {
        $tables = dbv_all($this->pdo,
            "select c.oid, n.nspname as schema, c.relname as name, c.relkind as kind,
                greatest(c.reltuples, 0)::bigint as estimate, pg_total_relation_size(c.oid) as bytes,
                obj_description(c.oid, 'pg_class') as comment
            from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where ".self::LISTED."
            order by n.nspname <> 'public', n.nspname, c.relname");

        // Exact counts, in one round trip. A local database counts in milliseconds;
        // if this one is too big, the estimate from the last ANALYZE stands in.
        $counts = [];
        $parts = [];

        foreach ($tables as $table) {
            if (in_array($table['kind'], ['r', 'p', 'm'], true)) {
                $parts[] = 'select '.(int) $table['oid'].'::bigint as oid, count(*) as n from '.$this->quote($table['schema']).'.'.$this->quote($table['name']);
            }
        }

        if ($parts !== []) {
            try {
                $this->pdo->exec("set statement_timeout = '5s'");
                foreach ($this->pdo->query(implode(' union all ', $parts))->fetchAll() as $row) {
                    $counts[(int) $row['oid']] = (int) $row['n'];
                }
            } catch (PDOException) {
                $counts = [];
            } finally {
                $this->pdo->exec("set statement_timeout = '30s'");
            }
        }

        $info = dbv_one($this->pdo, "select pg_database_size(current_database()) as size, current_setting('server_version') as version");

        return [
            'tables' => array_map(fn (array $t) => [
                'schema' => $t['schema'],
                'name' => $t['name'],
                'kind' => self::KINDS[$t['kind']],
                'rows' => $counts[(int) $t['oid']] ?? (in_array($t['kind'], ['v', 'f'], true) ? null : (int) $t['estimate']),
                'exact' => isset($counts[(int) $t['oid']]),
                'bytes' => (int) $t['bytes'],
                'comment' => $t['comment'],
            ], $tables),
            'info' => ['size' => (int) $info['size'], 'version' => 'PostgreSQL '.$info['version'], 'schema' => 'public'],
        ];
    }

    public function table(string $schema, string $name): ?array
    {
        $table = dbv_one($this->pdo,
            "select c.oid, c.relkind as kind, obj_description(c.oid, 'pg_class') as comment
            from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = ? and c.relname = ? and c.relkind in ('r', 'p', 'v', 'm', 'f')",
            [$schema, $name]);

        if ($table === null) {
            return null;
        }

        $oid = (int) $table['oid'];
        $columns = [];

        foreach (dbv_all($this->pdo,
            'select a.attname as name, format_type(a.atttypid, a.atttypmod) as type, t.typcategory as category,
                a.attnotnull as not_null, pg_get_expr(d.adbin, d.adrelid) as default_value,
                a.attidentity as identity, a.attgenerated as generated, col_description(a.attrelid, a.attnum) as comment,
                (select json_agg(e.enumlabel order by e.enumsortorder) from pg_enum e where e.enumtypid = t.oid) as enum_values
            from pg_attribute a
            join pg_type t on t.oid = a.atttypid
            left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
            where a.attrelid = ? and a.attnum > 0 and not a.attisdropped
            order by a.attnum', [$oid]) as $column) {
            $columns[$column['name']] = [
                'name' => $column['name'],
                'type' => $column['type'],
                'category' => $this->category($column['category'], $column['type']),
                'nullable' => ! $column['not_null'],
                'default' => $column['default_value'],
                'default_sql' => $column['default_value'],
                // The database fills these itself and refuses a value from us.
                'readonly' => $column['identity'] === 'a' || $column['generated'] !== '',
                'auto' => $column['identity'] !== '' || str_starts_with((string) $column['default_value'], 'nextval('),
                'generated' => $column['generated'] !== '',
                'comment' => $column['comment'],
                'options' => $column['enum_values'] === null ? null : json_decode($column['enum_values'], true),
            ];
        }

        // A CHECK that lists the allowed values of one column, such as
        // status = ANY (ARRAY['draft', 'active']), gives the editor a dropdown.
        foreach (dbv_all($this->pdo,
            "select a.attname as col, pg_get_constraintdef(con.oid) as def
            from pg_constraint con
            join pg_attribute a on a.attrelid = con.conrelid and a.attnum = con.conkey[1]
            where con.conrelid = ? and con.contype = 'c' and cardinality(con.conkey) = 1", [$oid]) as $check) {
            $def = preg_replace('/\(\w+ IS NULL\) OR /', '', $check['def']);

            if (! preg_match('/\b(AND|OR)\b/', $def) && preg_match('/= ANY \(ARRAY\[(.+)\]\)/', $def, $list)
                && preg_match_all("/'((?:[^']|'')*)'::/", $list[1], $values)) {
                $columns[$check['col']]['options'] = array_map(fn ($v) => str_replace("''", "'", $v), $values[1]);
            }
        }

        $pk = dbv_one($this->pdo,
            'select json_agg(a.attname order by k.ord) as cols
            from pg_index ix
            cross join unnest(ix.indkey::int2[]) with ordinality k(num, ord)
            join pg_attribute a on a.attrelid = ix.indrelid and a.attnum = k.num
            where ix.indrelid = ? and ix.indisprimary', [$oid]);

        $fks = dbv_all($this->pdo,
            "select con.conname as name, n.nspname as schema, c.relname as tbl,
                {$this->keyColumns('conkey', 'conrelid')} as cols, {$this->keyColumns('confkey', 'confrelid')} as ref_cols
            from pg_constraint con
            join pg_class c on c.oid = con.confrelid join pg_namespace n on n.oid = c.relnamespace
            where con.contype = 'f' and con.conrelid = ?
            order by con.conname", [$oid]);

        $refs = dbv_all($this->pdo,
            "select con.conname as name, n.nspname as schema, c.relname as tbl,
                {$this->keyColumns('conkey', 'conrelid')} as cols, {$this->keyColumns('confkey', 'confrelid')} as ref_cols
            from pg_constraint con
            join pg_class c on c.oid = con.conrelid join pg_namespace n on n.oid = c.relnamespace
            where con.contype = 'f' and con.confrelid = ?
            order by c.relname, con.conname", [$oid]);

        $decode = fn (array $fk): array => ['cols' => json_decode($fk['cols'], true), 'ref_cols' => json_decode($fk['ref_cols'], true)] + $fk;

        return [
            'oid' => $oid,
            'schema' => $schema,
            'name' => $name,
            'kind' => self::KINDS[$table['kind']],
            'comment' => $table['comment'],
            'columns' => $columns,
            'pk' => json_decode((string) ($pk['cols'] ?? 'null'), true) ?? [],
            'fks' => array_map($decode, $fks),
            'refs' => array_map($decode, $refs),
        ];
    }

    private function category(string $typcategory, string $type): string
    {
        return match (true) {
            $typcategory === 'B' => 'bool',
            $typcategory === 'N' => 'number',
            $typcategory === 'S', $typcategory === 'E' => 'text',
            $typcategory === 'A' => 'array',
            $typcategory === 'T' => 'interval',
            $type === 'date' => 'date',
            str_starts_with($type, 'timestamp') => 'datetime',
            str_starts_with($type, 'time') => 'time',
            $type === 'json', $type === 'jsonb' => 'json',
            $type === 'uuid' => 'uuid',
            $type === 'bytea' => 'binary',
            default => 'other',
        };
    }

    public function structure(array $t): array
    {
        $oid = $t['oid'];

        return [
            'indexes' => dbv_all($this->pdo,
                'select i.relname as name, pg_get_indexdef(ix.indexrelid) as definition,
                    ix.indisprimary as is_primary, ix.indisunique as is_unique, pg_relation_size(ix.indexrelid) as bytes,
                    s.idx_scan as scans
                from pg_index ix join pg_class i on i.oid = ix.indexrelid
                left join pg_stat_user_indexes s on s.indexrelid = ix.indexrelid
                where ix.indrelid = ?
                order by ix.indisprimary desc, i.relname', [$oid]),
            'upkeep' => $this->upkeep($oid),
            // PostgreSQL 18 also lists each NOT NULL as a constraint. The columns show that already.
            'constraints' => array_map(fn (array $c) => ['kind' => self::CONSTRAINTS[$c['kind']] ?? $c['kind']] + $c, dbv_all($this->pdo,
                "select conname as name, contype as kind, pg_get_constraintdef(oid, true) as definition
                from pg_constraint
                where conrelid = ? and contype <> 'n'
                order by position(contype::text in 'pufcx'), conname", [$oid])),
            'triggers' => dbv_all($this->pdo,
                'select tgname as name, pg_get_triggerdef(oid, true) as definition
                from pg_trigger where tgrelid = ? and not tgisinternal order by tgname', [$oid]),
            'sizes' => dbv_one($this->pdo,
                'select pg_total_relation_size(?::oid::regclass) as total, pg_relation_size(?::oid::regclass) as data,
                    pg_indexes_size(?::oid::regclass) as indexes', [$oid, $oid, $oid]),
            'view' => str_contains($t['kind'], 'view')
                ? dbv_one($this->pdo, 'select pg_get_viewdef(?::oid, true) as sql', [$oid])['sql']
                : null,
        ];
    }

    /** The column names of a constraint's keys as a JSON array, in key order. $table is conrelid or confrelid. */
    private function keyColumns(string $keys, string $table): string
    {
        return "(select json_agg(a.attname order by k.ord)
            from unnest(con.{$keys}) with ordinality k(num, ord)
            join pg_attribute a on a.attrelid = con.{$table} and a.attnum = k.num)";
    }

    public function diagram(): array
    {
        $tables = [];

        foreach (dbv_all($this->pdo,
            "select c.oid, n.nspname as schema, c.relname as name, c.relkind as kind
            from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where ".self::LISTED."
            order by n.nspname <> 'public', n.nspname, c.relname") as $t) {
            $tables[(int) $t['oid']] = ['schema' => $t['schema'], 'name' => $t['name'], 'kind' => self::KINDS[$t['kind']], 'columns' => [], 'pk' => [], 'fks' => []];
        }

        foreach (dbv_all($this->pdo,
            'select a.attrelid as oid, a.attname as name, format_type(a.atttypid, a.atttypmod) as type
            from pg_attribute a
            join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
            where a.attnum > 0 and not a.attisdropped and '.self::LISTED.'
            order by a.attrelid, a.attnum') as $column) {
            $tables[(int) $column['oid']]['columns'][] = ['name' => $column['name'], 'type' => $column['type']];
        }

        foreach (dbv_all($this->pdo,
            'select ix.indrelid as oid, json_agg(a.attname order by k.ord) as cols
            from pg_index ix
            cross join unnest(ix.indkey::int2[]) with ordinality k(num, ord)
            join pg_attribute a on a.attrelid = ix.indrelid and a.attnum = k.num
            where ix.indisprimary
            group by ix.indrelid') as $pk) {
            if (isset($tables[(int) $pk['oid']])) {
                $tables[(int) $pk['oid']]['pk'] = json_decode($pk['cols'], true);
            }
        }

        foreach (dbv_all($this->pdo,
            "select con.conrelid as oid, con.conname as name, n.nspname as schema, c.relname as tbl,
                {$this->keyColumns('conkey', 'conrelid')} as cols, {$this->keyColumns('confkey', 'confrelid')} as ref_cols
            from pg_constraint con
            join pg_class c on c.oid = con.confrelid join pg_namespace n on n.oid = c.relnamespace
            where con.contype = 'f'
            order by con.conrelid, con.conname") as $fk) {
            if (isset($tables[(int) $fk['oid']])) {
                $tables[(int) $fk['oid']]['fks'][] = [
                    'name' => $fk['name'],
                    'schema' => $fk['schema'],
                    'tbl' => $fk['tbl'],
                    'cols' => json_decode($fk['cols'], true),
                    'ref_cols' => json_decode($fk['ref_cols'], true),
                ];
            }
        }

        return array_values($tables);
    }

    public function schema(): array
    {
        $tables = [];

        foreach (dbv_all($this->pdo,
            "select table_schema as schema, table_name as tbl, column_name as col
            from information_schema.columns
            where table_schema not in ('pg_catalog', 'information_schema') and table_schema not like 'pg\_%'
            order by table_schema, table_name, ordinal_position") as $row) {
            $key = $row['schema'].'.'.$row['tbl'];
            $tables[$key] ??= ['schema' => $row['schema'], 'name' => $row['tbl'], 'columns' => []];
            $tables[$key]['columns'][] = $row['col'];
        }

        return array_values($tables);
    }

    public function text(string $expr, array $column): string
    {
        return $expr.'::text';
    }

    public function asText(string $expr): string
    {
        return $expr.'::text';
    }

    public function rowText(array $t): string
    {
        // The whole row as one text: "(1,Asha,active)".
        return self::ALIAS.'::text';
    }

    public function ilike(): string
    {
        return 'ilike';
    }

    public function isDistinct(string $a, string $b): string
    {
        return "{$a} is distinct from {$b}";
    }

    public function orderBy(string $expr, string $dir): string
    {
        return "{$expr} {$dir} nulls last";
    }

    /** json, xml and the shapes have no = or < operator. */
    public function comparable(array $column): bool
    {
        return ! in_array($column['type'], ['json', 'xml', 'point', 'polygon', 'circle', 'box', 'line', 'lseg', 'path'], true);
    }

    /** The value goes in as text and PostgreSQL casts it, so it checks the value the usual way. */
    public function param(array $column): string
    {
        return "cast(? as {$column['type']})";
    }

    public function insert(array $t, array $values): ?array
    {
        [$names, $exprs, $params] = $this->values($t, $values);
        $statement = $this->pdo->prepare('insert into '.$this->tableName($t)
            .($names === [] ? ' default values' : ' ('.implode(', ', $names).') values ('.implode(', ', $exprs).')')
            .' returning '.implode(', ', array_map(fn ($k) => $this->quote($k).'::text as '.$this->quote($k), $t['pk'])));
        $statement->execute($params);

        return $statement->fetch() ?: null;
    }

    public function deleteFrom(array $t): string
    {
        return 'delete from '.$this->from($t);
    }

    public function upsert(array $t, array $names): string
    {
        $updates = array_map(fn ($n) => $this->quote($n).' = excluded.'.$this->quote($n), array_values(array_diff($names, $t['pk'])));

        return ' on conflict ('.implode(', ', array_map([$this, 'quote'], $t['pk'])).') do '
            .($updates === [] ? 'nothing' : 'update set '.implode(', ', $updates));
    }

    public function truncate(array $t, bool $cascade): void
    {
        $this->pdo->exec('truncate table '.$this->tableName($t).($cascade ? ' cascade' : ''));
    }

    public function readOnly(): void
    {
        // For the session, not one transaction, so a COMMIT inside a script does not end it.
        $this->pdo->exec('set session characteristics as transaction read only');
    }

    public function explain(string $sql): string
    {
        return 'explain (analyze, buffers) '.$sql;
    }

    public function numeric(string $nativeType): bool
    {
        return in_array($nativeType, ['int2', 'int4', 'int8', 'numeric', 'float4', 'float8', 'money', 'oid'], true);
    }

    public function maintain(?array $t, string $op): array
    {
        $target = $t === null ? '' : ' '.$this->tableName($t);

        // Upkeep of a big table takes longer than a query is allowed to.
        $this->pdo->exec('set statement_timeout = 0');
        $this->pdo->exec(match ($op) {
            'vacuum' => 'vacuum (analyze)'.$target,
            'analyze' => 'analyze'.$target,
            'reindex' => $t === null ? 'reindex database '.$this->quote($this->database) : 'reindex table'.$target,
            'vacuum_full' => 'vacuum (full, analyze)'.$target,
        });

        return [];
    }

    public function size(?array $t): int
    {
        return (int) ($t === null
            ? $this->pdo->query('select pg_database_size(current_database())')->fetchColumn()
            : dbv_one($this->pdo, 'select pg_total_relation_size(?::oid::regclass) as n', [$t['oid']])['n']);
    }

    public function renameTable(array $t, string $to): void
    {
        $this->pdo->exec('alter '.$this->kindWord($t).' '.$this->tableName($t).' rename to '.$this->quote($to));
    }

    public function columnSql(array $t, ?array $column, array $spec): array
    {
        $alter = 'alter table '.$this->tableName($t);
        $name = $this->quote($spec['name']);
        $comment = 'comment on column '.$this->tableName($t).'.';
        $commentText = $spec['comment'] === null ? 'null' : $this->pdo->quote($spec['comment']);

        if ($column === null) {
            $sql = [$alter.' add column '.$name.' '.$spec['type'].($spec['nullable'] ? '' : ' not null')
                .($spec['default'] === null ? '' : ' default '.$spec['default'])];

            return $spec['comment'] === null ? $sql : [...$sql, $comment.$name.' is '.$commentText];
        }

        $sql = [];
        $col = $alter.' alter column '.$this->quote($column['name']);

        if ($spec['type'] !== $column['type']) {
            // A default that cannot be cast to the new type would stop the change,
            // so it comes off first and goes back on after.
            if ($column['default_sql'] !== null) {
                $sql[] = $col.' drop default';
            }
            $sql[] = $col.' type '.$spec['type'].' using '.$this->quote($column['name']).'::'.$spec['type'];
            if ($spec['default'] !== null) {
                $sql[] = $col.' set default '.$spec['default'];
            }
        } elseif ($spec['default'] !== $column['default_sql']) {
            $sql[] = $col.($spec['default'] === null ? ' drop default' : ' set default '.$spec['default']);
        }

        if ($spec['nullable'] !== $column['nullable']) {
            $sql[] = $col.($spec['nullable'] ? ' drop not null' : ' set not null');
        }

        if ($spec['comment'] !== $column['comment']) {
            $sql[] = $comment.$this->quote($column['name']).' is '.$commentText;
        }

        if ($spec['name'] !== $column['name']) {
            $sql[] = $alter.' rename column '.$this->quote($column['name']).' to '.$name;
        }

        return $sql;
    }

    public function copyTable(array $t, string $to, bool $withRows): void
    {
        $old = $this->tableName($t);
        $new = $this->quote($t['schema']).'.'.$this->quote($to);

        $this->transaction(function () use ($t, $old, $new, $withRows) {
            $this->pdo->exec("create table {$new} (like {$old} including all)");

            if (! $withRows) {
                return;
            }

            $columns = implode(', ', array_map([$this, 'quote'], array_keys(array_filter($t['columns'], fn ($c) => ! $c['generated']))));
            $this->pdo->exec("insert into {$new} ({$columns}) overriding system value select {$columns} from {$old}");

            // The copy's own numbering carries on after the highest copied id.
            foreach ($t['columns'] as $c) {
                if ($c['auto']) {
                    dbv_all($this->pdo, 'select setval(pg_get_serial_sequence(?, ?), coalesce(max('.$this->quote($c['name'])."), 0) + 1, false) from {$new}", [$new, $c['name']]);
                }
            }
        });
    }

    private function upkeep(int $oid): array
    {
        $s = dbv_one($this->pdo,
            'select n_live_tup as live, n_dead_tup as dead, seq_scan, idx_scan, n_tup_ins + n_tup_upd + n_tup_del as writes,
                (extract(epoch from greatest(last_vacuum, last_autovacuum)) * 1000)::bigint as vacuumed,
                (extract(epoch from greatest(last_analyze, last_autoanalyze)) * 1000)::bigint as analyzed
            from pg_stat_user_tables where relid = ?', [$oid]);

        if ($s === null) {
            return [];
        }

        $s = self::ints($s, array_keys($s));

        return [
            ['label' => 'Live rows', 'value' => $s['live'], 'type' => 'number'],
            ['label' => 'Dead rows', 'value' => $s['dead'], 'type' => 'number'],
            ['label' => 'Whole-table reads', 'value' => $s['seq_scan'], 'type' => 'number'],
            ['label' => 'Reads through an index', 'value' => $s['idx_scan'], 'type' => 'number'],
            ['label' => 'Rows written', 'value' => $s['writes'], 'type' => 'number'],
            ['label' => 'Last vacuum', 'value' => $s['vacuumed'], 'type' => 'time'],
            ['label' => 'Last analyze', 'value' => $s['analyzed'], 'type' => 'time'],
        ];
    }

    public function health(): array
    {
        $tables = array_map(fn (array $t) => self::ints($t, ['data', 'indexes', 'other', 'live', 'dead', 'full_scans', 'index_scans', 'writes', 'vacuumed', 'analyzed']), dbv_all($this->pdo,
            "select n.nspname as schema, c.relname as name, c.relkind as kind,
                pg_relation_size(c.oid) as data, pg_indexes_size(c.oid) as indexes,
                pg_total_relation_size(c.oid) - pg_relation_size(c.oid) - pg_indexes_size(c.oid) as other,
                s.n_live_tup as live, s.n_dead_tup as dead, s.seq_scan as full_scans, s.idx_scan as index_scans,
                s.n_tup_ins + s.n_tup_upd + s.n_tup_del as writes,
                (extract(epoch from greatest(s.last_vacuum, s.last_autovacuum)) * 1000)::bigint as vacuumed,
                (extract(epoch from greatest(s.last_analyze, s.last_autoanalyze)) * 1000)::bigint as analyzed,
                exists (select 1 from pg_index i where i.indrelid = c.oid and i.indisprimary) as has_pk
            from pg_class c join pg_namespace n on n.oid = c.relnamespace
            left join pg_stat_user_tables s on s.relid = c.oid
            where c.relkind in ('r', 'p', 'm')
              and n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg\\_%'
              and not c.relispartition
            order by pg_total_relation_size(c.oid) desc, n.nspname, c.relname"));

        $findings = [];

        foreach ($tables as $t) {
            $name = $this->label($t['schema'], $t['name']);

            if ($t['dead'] >= 1000 && $t['dead'] > 0.2 * $t['live']) {
                $findings[] = $this->finding('Dead rows to clean up', 'warn', $t['schema'], $t['name'],
                    "{$name} holds ".number_format($t['dead']).' dead rows',
                    'Deleted and updated rows still take space and slow down reads until a vacuum makes the space reusable.', 'vacuum');
            }

            if ($t['full_scans'] > 100 && $t['live'] > 10000 && $t['full_scans'] > (int) $t['index_scans']) {
                $findings[] = $this->finding('Big tables read whole', 'warn', $t['schema'], $t['name'],
                    "{$name} was read whole ".number_format($t['full_scans']).' times',
                    'Most reads of this table go through every row. An index on the columns it is searched by would answer them faster.');
            }

            if ($t['analyzed'] === null && $t['live'] >= 1000) {
                $findings[] = $this->finding('Statistics never gathered', 'info', $t['schema'], $t['name'],
                    "{$name} was never analyzed",
                    'Without statistics the planner guesses how many rows a query finds, and can pick a slow plan.', 'analyze');
            }

            if ($t['kind'] !== 'm' && ! $t['has_pk']) {
                $findings[] = $this->finding('Tables without a primary key', 'info', $t['schema'], $t['name'],
                    "{$name} has no primary key",
                    'Nothing tells one row from another, so a row cannot be edited here, and duplicate rows are never refused.');
            }
        }

        // A foreign key whose columns do not start any index. PostgreSQL does not add one by itself.
        foreach (dbv_all($this->pdo,
            "select n.nspname as schema, c.relname as tbl, con.conname as name, rn.nspname as ref_schema, r.relname as ref_tbl,
                (select json_agg(a.attname order by k.ord) from unnest(con.conkey) with ordinality k(num, ord)
                    join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.num) as cols
            from pg_constraint con
            join pg_class c on c.oid = con.conrelid join pg_namespace n on n.oid = c.relnamespace
            join pg_class r on r.oid = con.confrelid join pg_namespace rn on rn.oid = r.relnamespace
            where con.contype = 'f' and con.conparentid = 0
              and not exists (select 1 from pg_index i where i.indrelid = con.conrelid
                  and (i.indkey::int2[])[0:cardinality(con.conkey) - 1] @> con.conkey)
            order by n.nspname, c.relname, con.conname") as $fk) {
            $cols = json_decode($fk['cols'], true);
            $findings[] = $this->finding('Foreign keys without an index', 'info', $fk['schema'], $fk['tbl'],
                $this->label($fk['schema'], $fk['tbl']).' ('.implode(', ', $cols).')',
                'Each delete in '.$this->label($fk['ref_schema'], $fk['ref_tbl']).' and each join on this key reads the whole table.', null,
                'create index on '.$this->quote($fk['schema']).'.'.$this->quote($fk['tbl']).' ('.implode(', ', array_map([$this, 'quote'], $cols)).');');
        }

        // Only a table that is read often says anything about an index it never uses.
        foreach (dbv_all($this->pdo,
            'select s.schemaname as schema, s.relname as tbl, s.indexrelname as name, pg_relation_size(s.indexrelid) as bytes
            from pg_stat_user_indexes s
            join pg_index i on i.indexrelid = s.indexrelid
            join pg_stat_user_tables t on t.relid = s.relid
            where s.idx_scan = 0 and not i.indisunique and not i.indisprimary
              and t.seq_scan + coalesce(t.idx_scan, 0) >= 1000
            order by 4 desc') as $ix) {
            $findings[] = $this->finding('Indexes never used', 'info', $ix['schema'], $ix['tbl'],
                "{$ix['name']} on ".$this->label($ix['schema'], $ix['tbl']),
                'The table is read often, but never through this index. It still costs space and time on every write.', null,
                'drop index '.$this->quote($ix['schema']).'.'.$this->quote($ix['name']).';');
        }

        $db = dbv_one($this->pdo,
            'select blks_hit as hits, blks_read as reads, (extract(epoch from stats_reset) * 1000)::bigint as since
            from pg_stat_database where datname = current_database()');
        $hits = (int) $db['hits'];
        $reads = (int) $db['reads'];

        return [
            'scope' => 'database',
            'summary' => [
                'size' => $this->size(null),
                'cache_hit' => $hits + $reads > 0 ? $hits / ($hits + $reads) : null,
                'since' => $db['since'] === null ? null : (int) $db['since'],
            ],
            'tables' => array_map(fn ($t) => array_diff_key($t, ['kind' => 1, 'has_pk' => 1]), $tables),
            'findings' => $findings,
        ];
    }

    public function activity(): array
    {
        $totals = dbv_one($this->pdo,
            'select xact_commit + xact_rollback as queries, tup_returned as rows_read,
                tup_inserted + tup_updated + tup_deleted as rows_written,
                blks_hit as cache_hits, blks_read as cache_misses, xact_rollback as rollbacks
            from pg_stat_database where datname = current_database()');

        $sessions = dbv_all($this->pdo,
            "select pid as id, usename as user, application_name as app, host(client_addr) as client, state,
                (extract(epoch from now() - coalesce(state_change, backend_start)) * 1000)::bigint as ms,
                wait_event_type || ': ' || wait_event as wait, left(query, 2000) as query
            from pg_stat_activity
            where datname = current_database() and pid <> pg_backend_pid() and backend_type = 'client backend'
            order by state = 'active' desc, state_change");

        return [
            'scope' => 'database',
            'at' => (int) (microtime(true) * 1000),
            'totals' => array_map('intval', $totals) + [
                'connections' => count($sessions),
                'running' => count(array_filter($sessions, fn ($s) => $s['state'] === 'active')),
            ],
            'sessions' => array_map(fn ($s) => self::ints($s, ['id', 'ms']), $sessions),
        ];
    }

    public function stop(int $id, bool $kill): void
    {
        $found = dbv_one($this->pdo,
            'select '.($kill ? 'pg_terminate_backend' : 'pg_cancel_backend').'(pid) as done
            from pg_stat_activity where pid = ? and datname = current_database()', [$id]);

        if ($found === null) {
            throw new DbvError('That session has ended already.');
        }
    }

    /** Ends every other session in a database. PostgreSQL copies or drops only a database nobody is in. */
    private static function closeSessions(PDO $pdo, string $name): void
    {
        dbv_all($pdo, 'select pg_terminate_backend(pid) from pg_stat_activity where datname = ? and pid <> pg_backend_pid()', [$name]);
    }

    public static function createDatabase(PDO $pdo, string $name, ?string $copyOf): array
    {
        if ($copyOf !== null) {
            self::closeSessions($pdo, $copyOf);
        }

        $pdo->exec('create database '.self::ident($name).($copyOf === null ? '' : ' template '.self::ident($copyOf)));

        return [];
    }

    public static function dropDatabase(PDO $pdo, string $name): void
    {
        if ($pdo->query('select current_database()')->fetchColumn() === $name) {
            throw new DbvError("The viewer reads the list of databases through {$name}, so it cannot drop it. Point this server's database in config.php at another one first.");
        }

        self::closeSessions($pdo, $name);
        $pdo->exec('drop database '.self::ident($name));
    }
}
