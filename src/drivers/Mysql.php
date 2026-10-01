<?php

declare(strict_types=1);

/**
 * MySQL and MariaDB. Here a database is also the schema, so every table's
 * schema is the database it is in.
 */
final class DbvMysql extends DbvDriver
{
    public const DRIVER = 'mysql';

    public const LABEL = 'MySQL';

    public const PORT = 3306;

    private const KINDS = ['BASE TABLE' => 'table', 'SYSTEM VERSIONED' => 'table', 'VIEW' => 'view', 'SYSTEM VIEW' => 'view', 'SEQUENCE' => 'sequence'];

    private const HIDDEN = ['information_schema', 'performance_schema', 'mysql', 'sys'];

    private const NUMBERS = ['tinyint', 'smallint', 'mediumint', 'int', 'integer', 'bigint', 'decimal', 'numeric', 'float', 'double', 'real', 'year'];

    private const TEXTS = ['char', 'varchar', 'tinytext', 'text', 'mediumtext', 'longtext', 'enum', 'set'];

    private const BINARIES = ['binary', 'varbinary', 'tinyblob', 'blob', 'mediumblob', 'longblob', 'bit'];

    private const SHAPES = ['geometry', 'point', 'linestring', 'polygon', 'multipoint', 'multilinestring', 'multipolygon', 'geometrycollection'];

    public const MAINTENANCE = [
        'optimize' => ['label' => 'Optimize', 'hint' => 'Rebuilds the table to give the space of deleted rows back and to pack its indexes. InnoDB copies the whole table to do it.', 'locks' => true],
        'analyze' => ['label' => 'Analyze', 'hint' => 'Refreshes the index numbers the planner picks plans by. Quick.', 'locks' => false],
        'check' => ['label' => 'Check', 'hint' => 'Looks for errors in the table and its indexes. Changes nothing.', 'locks' => false],
    ];

    public const SYSTEM_DATABASES = self::HIDDEN;

    public static function connect(array $server, ?string $database): PDO
    {
        // PHP 8.4 moved the MySQL options onto their own class.
        $foundRows = class_exists('Pdo\Mysql') ? Pdo\Mysql::ATTR_FOUND_ROWS : PDO::MYSQL_ATTR_FOUND_ROWS;
        $dsn = sprintf('mysql:host=%s;port=%d;charset=utf8mb4', $server['host'], $server['port']).($database === null ? '' : ';dbname='.$database);
        $pdo = new PDO($dsn, (string) $server['username'], (string) $server['password'], [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_TIMEOUT => 5,
            // An UPDATE counts the rows it found, not only the ones it changed, so saving an unchanged value is not "row gone".
            $foundRows => true,
        ]);

        // Times come back in UTC, so the page shows the same time whoever wrote it.
        $pdo->exec("set time_zone = '+00:00'");
        // Without strict mode a wrong value is quietly changed, such as an unknown enum value saved as ''.
        // Here it is refused with a message instead.
        $pdo->exec("set session sql_mode = if(@@sql_mode = '', 'STRICT_ALL_TABLES', concat(@@sql_mode, ',STRICT_ALL_TABLES'))");
        self::timeout($pdo, 30);

        // MySQL 8 keeps table sizes for a day by default, so a size after OPTIMIZE would be the old one.
        try {
            $pdo->exec('set session information_schema_stats_expiry = 0');
        } catch (PDOException) {
            // MariaDB and older MySQL read them fresh already.
        }

        return $pdo;
    }

    private static function mariadb(PDO $pdo): bool
    {
        return stripos((string) $pdo->getAttribute(PDO::ATTR_SERVER_VERSION), 'mariadb') !== false;
    }

    /** MySQL and MariaDB each have their own setting, and older versions have neither. */
    private static function timeout(PDO $pdo, int $seconds): void
    {
        try {
            $pdo->exec(self::mariadb($pdo) ? "set session max_statement_time = {$seconds}" : 'set session max_execution_time = '.($seconds * 1000));
        } catch (PDOException) {
            // No limit on this server.
        }
    }

    public static function databases(PDO $pdo): array
    {
        return array_values(array_filter($pdo->query('show databases')->fetchAll(PDO::FETCH_COLUMN),
            fn ($name) => ! in_array(strtolower($name), self::HIDDEN, true)));
    }

    public function quote(string $name): string
    {
        return '`'.str_replace('`', '``', $name).'`';
    }

    public function defaultSchema(): string
    {
        return $this->database;
    }

    public function tables(): array
    {
        $tables = dbv_all($this->pdo,
            'select table_name as name, table_type as type, table_rows as estimate,
                coalesce(data_length, 0) + coalesce(index_length, 0) as bytes, table_comment as comment
            from information_schema.tables where table_schema = ? order by table_name', [$this->database]);

        // Exact counts, in one round trip. If the database is too big to count
        // quickly, the estimate InnoDB keeps stands in.
        $counts = [];
        $parts = [];

        foreach ($tables as $table) {
            if ($table['type'] !== 'VIEW') {
                $parts[] = 'select '.$this->pdo->quote($table['name']).' as name, count(*) as n from '.$this->quote($this->database).'.'.$this->quote($table['name']);
            }
        }

        if ($parts !== []) {
            try {
                self::timeout($this->pdo, 5);
                foreach ($this->pdo->query(implode(' union all ', $parts))->fetchAll() as $row) {
                    $counts[$row['name']] = (int) $row['n'];
                }
            } catch (PDOException) {
                $counts = [];
            } finally {
                self::timeout($this->pdo, 30);
            }
        }

        $version = (string) $this->pdo->query('select version()')->fetchColumn();

        return [
            'tables' => array_map(fn (array $t) => [
                'schema' => $this->database,
                'name' => $t['name'],
                'kind' => self::KINDS[$t['type']] ?? 'table',
                'rows' => $counts[$t['name']] ?? ($t['estimate'] === null ? null : (int) $t['estimate']),
                'exact' => isset($counts[$t['name']]),
                'bytes' => (int) $t['bytes'],
                // A view's comment is the word VIEW.
                'comment' => $t['type'] === 'VIEW' || $t['comment'] === '' ? null : $t['comment'],
            ], $tables),
            'info' => [
                'size' => array_sum(array_column($tables, 'bytes')),
                'version' => (stripos($version, 'mariadb') !== false ? 'MariaDB ' : 'MySQL ').preg_replace('/-.*$/', '', $version),
                'schema' => $this->database,
            ],
        ];
    }

    public function table(string $schema, string $name): ?array
    {
        $table = dbv_one($this->pdo,
            'select table_type as type, table_comment as comment from information_schema.tables where table_schema = ? and table_name = ?',
            [$schema, $name]);

        if ($table === null) {
            return null;
        }

        $columns = [];

        foreach (dbv_all($this->pdo,
            'select column_name as name, column_type as type, data_type as native, is_nullable as nullable,
                column_default as def, extra as extra, column_comment as comment, collation_name as collation
            from information_schema.columns where table_schema = ? and table_name = ? order by ordinal_position',
            [$schema, $name]) as $column) {
            $native = strtolower($column['native']);
            $category = $this->category($native, strtolower($column['type']));
            $auto = stripos($column['extra'], 'auto_increment') !== false;
            $default = $column['def'] === null || strtoupper($column['def']) === 'NULL' ? null : $column['def'];

            $generated = (bool) preg_match('/generated|virtual|persistent|stored/i', $column['extra']);

            $columns[$column['name']] = [
                'name' => $column['name'],
                'type' => $column['type'],
                'native' => $native,
                'category' => $category,
                'nullable' => $column['nullable'] === 'YES',
                'default' => $auto ? 'auto_increment' : $default,
                'default_sql' => $auto ? null : $this->defaultSql($column),
                // A change rewrites the whole column, so these go back in with it.
                'collation' => $column['collation'],
                'on_update' => preg_match('/on update (current_timestamp(\(\d*\))?)/i', $column['extra'], $m) ? $m[1] : null,
                // Generated columns are filled by the database. Binary values and shapes
                // are shown as text that would not go back in as the same value.
                'readonly' => $generated || $category === 'binary' || in_array($native, self::SHAPES, true),
                'auto' => $auto,
                'generated' => $generated,
                'comment' => $column['comment'] === '' ? null : $column['comment'],
                'options' => $native === 'enum' ? $this->quoted(substr($column['type'], 5, -1)) : null,
            ];
        }

        foreach ($this->checks($schema, $name) as $check) {
            $def = trim($check['def']);

            // MariaDB keeps a JSON column as text with a json_valid() check.
            if (preg_match('/^json_valid\(`((?:[^`]|``)+)`\)$/i', $def, $m) && isset($columns[$m[1]])) {
                $columns[$m[1]]['category'] = 'json';
            } elseif (! preg_match('/\b(and|or)\b/i', $def) && preg_match('/^\(?`((?:[^`]|``)+)`\s+in\s*\((.*)\)\)?$/is', $def, $m) && isset($columns[$m[1]])) {
                $columns[$m[1]]['options'] = $this->quoted($m[2]);
            }
        }

        $keys = dbv_all($this->pdo,
            'select constraint_name as name, column_name as col, referenced_table_schema as ref_schema,
                referenced_table_name as ref_table, referenced_column_name as ref_col
            from information_schema.key_column_usage
            where table_schema = ? and table_name = ? order by constraint_name, ordinal_position', [$schema, $name]);

        $refs = dbv_all($this->pdo,
            'select constraint_name as name, table_schema as ref_schema, table_name as ref_table, column_name as col, referenced_column_name as ref_col
            from information_schema.key_column_usage
            where referenced_table_schema = ? and referenced_table_name = ?
            order by table_name, constraint_name, ordinal_position', [$schema, $name]);

        return [
            'schema' => $schema,
            'name' => $name,
            'kind' => self::KINDS[$table['type']] ?? 'table',
            'comment' => $table['type'] === 'VIEW' || $table['comment'] === '' ? null : $table['comment'],
            'columns' => $columns,
            'pk' => array_column(array_filter($keys, fn ($k) => $k['name'] === 'PRIMARY'), 'col'),
            'fks' => $this->group(array_filter($keys, fn ($k) => $k['ref_table'] !== null)),
            'refs' => $this->group($refs),
        ];
    }

    private function category(string $native, string $type): string
    {
        return match (true) {
            $native === 'tinyint' && str_starts_with($type, 'tinyint(1)') => 'bool',
            in_array($native, self::NUMBERS, true) => 'number',
            in_array($native, self::TEXTS, true) => 'text',
            $native === 'date' => 'date',
            $native === 'datetime', $native === 'timestamp' => 'datetime',
            $native === 'time' => 'time',
            $native === 'json' => 'json',
            $native === 'uuid' => 'uuid',
            in_array($native, self::BINARIES, true) => 'binary',
            default => 'other',
        };
    }

    /** @return list<string> the values in a list like 'a','b','it''s' */
    private function quoted(string $list): array
    {
        preg_match_all("/(?:_\\w+)?'((?:[^'\\\\]|''|\\\\.)*)'/", $list, $m);

        return array_map(fn ($v) => stripcslashes(str_replace("''", "'", $v)), $m[1]);
    }

    /** The CHECK constraints of a table. Servers older than MySQL 8.0.16 and MariaDB 10.2 have none to list. */
    private function checks(string $schema, string $name): array
    {
        try {
            // MariaDB names a column's CHECK after the column, so the same name is in many tables.
            return self::mariadb($this->pdo)
                ? dbv_all($this->pdo,
                    'select constraint_name as name, check_clause as def from information_schema.check_constraints
                    where constraint_schema = ? and table_name = ?', [$schema, $name])
                : dbv_all($this->pdo,
                    "select cc.constraint_name as name, cc.check_clause as def
                    from information_schema.table_constraints tc
                    join information_schema.check_constraints cc on cc.constraint_schema = tc.constraint_schema and cc.constraint_name = tc.constraint_name
                    where tc.table_schema = ? and tc.table_name = ? and tc.constraint_type = 'CHECK'", [$schema, $name]);
        } catch (PDOException) {
            return [];
        }
    }

    /** Key column rows, one per column, as one entry per foreign key. */
    private function group(array $rows): array
    {
        $out = [];

        foreach ($rows as $row) {
            $key = $row['ref_schema'].'.'.$row['ref_table'].'.'.$row['name'];
            $out[$key] ??= ['name' => $row['name'], 'schema' => $row['ref_schema'], 'tbl' => $row['ref_table'], 'cols' => [], 'ref_cols' => []];
            $out[$key]['cols'][] = $row['col'];
            $out[$key]['ref_cols'][] = $row['ref_col'];
        }

        return array_values($out);
    }

    public function structure(array $t): array
    {
        $params = [$t['schema'], $t['name']];
        $indexes = [];

        foreach (dbv_all($this->pdo,
            "select index_name as name, non_unique as non_unique, column_name as col, sub_part as sub_part, index_type as type
            from information_schema.statistics where table_schema = ? and table_name = ?
            order by index_name = 'PRIMARY' desc, index_name, seq_in_index", $params) as $row) {
            $indexes[$row['name']] ??= ['name' => $row['name'], 'unique' => ! $row['non_unique'], 'type' => $row['type'], 'cols' => []];
            $indexes[$row['name']]['cols'][] = $this->quote($row['col']).($row['sub_part'] === null ? '' : "({$row['sub_part']})");
        }

        $keys = [];

        foreach (dbv_all($this->pdo,
            'select constraint_name as name, column_name as col, referenced_table_schema as ref_schema,
                referenced_table_name as ref_table, referenced_column_name as ref_col
            from information_schema.key_column_usage
            where table_schema = ? and table_name = ? order by ordinal_position', $params) as $row) {
            $keys[$row['name']][] = $row;
        }

        $rules = [];

        foreach (dbv_all($this->pdo,
            'select constraint_name as name, update_rule as update_rule, delete_rule as delete_rule from information_schema.referential_constraints
            where constraint_schema = ? and table_name = ?', $params) as $row) {
            $rules[$row['name']] = $row;
        }

        $checks = array_column($this->checks($t['schema'], $t['name']), 'def', 'name');
        $cols = fn (string $name, string $field): string => implode(', ', array_map(fn ($k) => $this->quote($k[$field]), $keys[$name] ?? []));
        $constraints = [];

        foreach (dbv_all($this->pdo,
            "select constraint_name as name, constraint_type as type from information_schema.table_constraints
            where table_schema = ? and table_name = ?
            order by field(constraint_type, 'PRIMARY KEY', 'UNIQUE', 'FOREIGN KEY', 'CHECK'), constraint_name", $params) as $c) {
            $first = $keys[$c['name']][0] ?? null;
            $constraints[] = [
                'name' => $c['name'],
                'kind' => strtolower($c['type']),
                'definition' => match ($c['type']) {
                    'PRIMARY KEY' => 'PRIMARY KEY ('.$cols($c['name'], 'col').')',
                    'UNIQUE' => 'UNIQUE ('.$cols($c['name'], 'col').')',
                    'FOREIGN KEY' => 'FOREIGN KEY ('.$cols($c['name'], 'col').') REFERENCES '
                        .($first && $first['ref_schema'] !== $t['schema'] ? $this->quote($first['ref_schema']).'.' : '')
                        .$this->quote((string) ($first['ref_table'] ?? '')).' ('.$cols($c['name'], 'ref_col').')'
                        .' ON DELETE '.($rules[$c['name']]['delete_rule'] ?? 'RESTRICT').' ON UPDATE '.($rules[$c['name']]['update_rule'] ?? 'RESTRICT'),
                    'CHECK' => 'CHECK ('.($checks[$c['name']] ?? '').')',
                    default => '',
                },
            ];
        }

        $sizes = dbv_one($this->pdo,
            'select coalesce(data_length, 0) + coalesce(index_length, 0) as total, data_length as data, index_length as indexes
            from information_schema.tables where table_schema = ? and table_name = ?', $params);

        return [
            'indexes' => array_map(fn (array $ix) => [
                'name' => $ix['name'],
                'definition' => $ix['name'] === 'PRIMARY'
                    ? 'PRIMARY KEY ('.implode(', ', $ix['cols']).')'
                    : (in_array($ix['type'], ['FULLTEXT', 'SPATIAL'], true) ? $ix['type'].' ' : ($ix['unique'] ? 'UNIQUE ' : ''))
                        .'INDEX '.$this->quote($ix['name']).' ('.implode(', ', $ix['cols']).')'
                        .(in_array($ix['type'], ['BTREE', 'HASH'], true) ? ' USING '.$ix['type'] : ''),
                'is_primary' => $ix['name'] === 'PRIMARY',
                'is_unique' => $ix['unique'],
                // MySQL keeps one size for all of a table's indexes, shown at the top.
                'bytes' => null,
            ], array_values($indexes)),
            'constraints' => $constraints,
            'upkeep' => $t['kind'] === 'view' ? [] : $this->upkeep($t),
            'triggers' => dbv_all($this->pdo,
                "select trigger_name as name, concat(action_timing, ' ', event_manipulation, ' FOR EACH ROW ', action_statement) as definition
                from information_schema.triggers where event_object_schema = ? and event_object_table = ? order by trigger_name", $params),
            'sizes' => $sizes,
            'view' => $t['kind'] === 'view'
                ? dbv_one($this->pdo, 'select view_definition as definition from information_schema.views where table_schema = ? and table_name = ?', $params)['definition'] ?? null
                : null,
        ];
    }

    public function diagram(): array
    {
        $tables = [];

        foreach (dbv_all($this->pdo,
            'select table_name as name, table_type as type from information_schema.tables where table_schema = ? order by table_name',
            [$this->database]) as $t) {
            $tables[$t['name']] = ['schema' => $this->database, 'name' => $t['name'], 'kind' => self::KINDS[$t['type']] ?? 'table', 'columns' => [], 'pk' => [], 'unique' => [], 'fks' => []];
        }

        foreach (dbv_all($this->pdo,
            'select table_name as tbl, column_name as name, column_type as type, data_type as native from information_schema.columns
            where table_schema = ? order by table_name, ordinal_position', [$this->database]) as $column) {
            if (isset($tables[$column['tbl']])) {
                $native = strtolower($column['native']);
                $tables[$column['tbl']]['columns'][] = [
                    'name' => $column['name'],
                    'type' => $column['type'],
                    'native' => $native,
                    'category' => $this->category($native, strtolower($column['type'])),
                ];
            }
        }

        // Primary keys and foreign keys both live in key_column_usage, one row per column, in key order.
        $fks = [];

        foreach (dbv_all($this->pdo,
            "select table_name as tbl, constraint_name as name, column_name as col, referenced_table_schema as ref_schema,
                referenced_table_name as ref_table, referenced_column_name as ref_col
            from information_schema.key_column_usage
            where table_schema = ? and (constraint_name = 'PRIMARY' or referenced_table_name is not null)
            order by table_name, constraint_name, ordinal_position", [$this->database]) as $key) {
            if (! isset($tables[$key['tbl']])) {
                continue;
            }

            if ($key['ref_table'] === null) {
                $tables[$key['tbl']]['pk'][] = $key['col'];
            } else {
                $fks[$key['tbl']][] = $key;
            }
        }

        foreach ($fks as $tbl => $rows) {
            $tables[$tbl]['fks'] = $this->group($rows);
        }

        // A functional index has no column name, so it is left out.
        foreach (dbv_all($this->pdo,
            "select distinct table_name as tbl, column_name as col from information_schema.statistics
            where table_schema = ? and non_unique = 0 and index_name <> 'PRIMARY' and column_name is not null", [$this->database]) as $unique) {
            if (isset($tables[$unique['tbl']])) {
                $tables[$unique['tbl']]['unique'][] = $unique['col'];
            }
        }

        return array_values($tables);
    }

    public function schema(): array
    {
        $tables = [];

        foreach (dbv_all($this->pdo,
            'select table_name as tbl, column_name as col from information_schema.columns
            where table_schema = ? order by table_name, ordinal_position', [$this->database]) as $row) {
            $tables[$row['tbl']] ??= ['schema' => $this->database, 'name' => $row['tbl'], 'columns' => []];
            $tables[$row['tbl']]['columns'][] = $row['col'];
        }

        return array_values($tables);
    }

    public function text(string $expr, array $column): string
    {
        return match (true) {
            // tinyint(1) holds 1 and 0. The page shows true and false, as it does for PostgreSQL.
            $column['category'] === 'bool' => "case when {$expr} is null then null when {$expr} <> 0 then 'true' else 'false' end",
            $column['category'] === 'binary' => "concat('0x', hex({$expr}))",
            in_array($column['native'] ?? '', self::SHAPES, true) => "st_astext({$expr})",
            default => "cast({$expr} as char)",
        };
    }

    public function asText(string $expr): string
    {
        return "cast({$expr} as char)";
    }

    public function rowText(array $t): string
    {
        return 'concat_ws(char(9), '.implode(', ', array_map(fn ($c) => $this->text($this->col($c['name']), $c), $t['columns'])).')';
    }

    /** The usual collations ignore case already. */
    public function ilike(): string
    {
        return 'like';
    }

    public function isDistinct(string $a, string $b): string
    {
        return "not ({$a} <=> {$b})";
    }

    public function orderBy(string $expr, string $dir): string
    {
        return "{$expr} is null, {$expr} {$dir}";
    }

    public function comparable(array $column): bool
    {
        return ! in_array($column['category'], ['json', 'binary', 'other'], true);
    }

    public function value(array $column, string $value): string
    {
        if ($column['category'] === 'bool') {
            return match (strtolower($value)) {
                'true', 't', 'yes' => '1',
                'false', 'f', 'no' => '0',
                default => $value,
            };
        }

        // MySQL reads the text '1 or 1=1' as the number 1, with only a warning
        // outside INSERT and UPDATE, so a bad key would delete row 1. A number
        // column only takes a number here, as PostgreSQL's cast already makes sure.
        if ($column['category'] === 'number') {
            $whole = in_array($column['native'], ['tinyint', 'smallint', 'mediumint', 'int', 'integer', 'bigint', 'year'], true);
            $number = trim($value);

            if (! preg_match($whole ? '/^[+-]?\d+$/' : '/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/', $number)) {
                throw new DbvError("{$column['name']} takes ".($whole ? 'a whole number' : 'a number').", and \"{$value}\" is not one.");
            }

            return $number;
        }

        return $value;
    }

    public function insert(array $t, array $values): ?array
    {
        [$names, $exprs, $params] = $this->values($t, $values);
        $this->pdo->prepare('insert into '.$this->tableName($t).' ('.implode(', ', $names).') values ('.implode(', ', $exprs).')')
            ->execute($params);

        $key = [];

        foreach ($t['pk'] as $name) {
            if (($values[$name] ?? null) !== null) {
                $key[$name] = (string) $values[$name];
            } elseif ($t['columns'][$name]['auto']) {
                $key[$name] = (string) $this->pdo->lastInsertId();
            } else {
                // A key filled by a DEFAULT expression, such as uuid(). MySQL cannot say which.
                return null;
            }
        }

        return $key;
    }

    public function deleteFrom(array $t): string
    {
        return 'delete '.self::ALIAS.' from '.$this->from($t);
    }

    public function upsert(array $t, array $names): string
    {
        // VALUES() is the form both MySQL and MariaDB accept.
        $updates = array_map(fn ($n) => $this->quote($n).' = values('.$this->quote($n).')', array_values(array_diff($names, $t['pk'])));

        return ' on duplicate key update '.($updates === []
            ? $this->quote($t['pk'][0]).' = '.$this->quote($t['pk'][0])
            : implode(', ', $updates));
    }

    public function truncate(array $t, bool $cascade): void
    {
        if ($cascade) {
            throw new DbvError('MySQL cannot empty the tables that point to this one in the same step. Empty those first.');
        }

        $this->pdo->exec('truncate table '.$this->tableName($t));
    }

    public function readOnly(): void
    {
        $this->pdo->exec('set session transaction read only');
    }

    public function explain(string $sql): string
    {
        return 'explain '.$sql;
    }

    public function numeric(string $nativeType): bool
    {
        return in_array($nativeType, ['TINY', 'SHORT', 'LONG', 'LONGLONG', 'INT24', 'NEWDECIMAL', 'DECIMAL', 'FLOAT', 'DOUBLE', 'YEAR'], true);
    }

    public function nextResult(PDOStatement $statement): bool
    {
        return $statement->nextRowset();
    }

    public function inTransaction(): bool
    {
        // PDO reads the flag the server sends with each successful answer. An
        // error carries none, so after a failed CREATE TABLE, which has already
        // committed, PDO still says a transaction is open. One more statement
        // brings the flag up to date.
        try {
            $this->pdo->exec('do 0');
        } catch (PDOException) {
            // A connection that cannot answer keeps whatever flag it had.
        }

        return $this->pdo->inTransaction();
    }

    public function maintain(?array $t, string $op): array
    {
        $names = $t === null
            ? array_map(fn ($name) => $this->quote($this->database).'.'.$this->quote($name), array_column(dbv_all($this->pdo,
                "select table_name as name from information_schema.tables where table_schema = ? and table_type = 'BASE TABLE'", [$this->database]), 'name'))
            : [$this->tableName($t)];

        if ($names === []) {
            return [];
        }

        $verb = match ($op) {
            'optimize' => 'optimize table ',
            'analyze' => 'analyze table ',
            'check' => 'check table ',
        };

        return array_map(fn (array $r) => ['table' => $r['Table'], 'type' => $r['Msg_type'], 'text' => $r['Msg_text']],
            $this->pdo->query($verb.implode(', ', $names))->fetchAll());
    }

    public function size(?array $t): int
    {
        return (int) dbv_one($this->pdo,
            'select coalesce(sum(data_length + index_length), 0) as n from information_schema.tables where table_schema = ?'.($t === null ? '' : ' and table_name = ?'),
            $t === null ? [$this->database] : [$t['schema'], $t['name']])['n'];
    }

    public function renameTable(array $t, string $to): void
    {
        $this->pdo->exec('rename table '.$this->tableName($t).' to '.$this->quote($t['schema']).'.'.$this->quote($to));
    }

    /** The default as SQL. MariaDB keeps it that way already; MySQL keeps a value bare and marks an expression. */
    private function defaultSql(array $column): ?string
    {
        $def = $column['def'];

        if ($def === null || strtoupper($def) === 'NULL') {
            return null;
        }

        if (self::mariadb($this->pdo) || preg_match("/^b'[01]*'$/", $def)) {
            return $def;
        }

        if (stripos($column['extra'], 'default_generated') !== false) {
            return preg_match('/^current_timestamp(\(\d*\))?$/i', $def) ? $def : "({$def})";
        }

        return $this->pdo->quote($def);
    }

    public function columnSql(array $t, ?array $column, array $spec): array
    {
        if ($column !== null && $column['generated']) {
            throw new DbvError("{$column['name']} is worked out from other columns. Change its expression in the SQL tab.");
        }

        if ($column !== null && $spec === ['name' => $column['name'], 'type' => $column['type'], 'nullable' => $column['nullable'], 'default' => $column['default_sql'], 'comment' => $column['comment']]) {
            return [];
        }

        $def = $this->quote($spec['name']).' '.$spec['type'];

        // Without it a text column would take the table's collation instead of its own.
        if (($column['collation'] ?? null) !== null && preg_match('/^\s*((var)?char|(tiny|medium|long)?text|enum|set)\b/i', $spec['type'])) {
            $def .= ' collate '.$column['collation'];
        }

        $def .= $spec['nullable'] ? ' null' : ' not null';
        $def .= $spec['default'] === null ? '' : ' default '.$spec['default'];
        $def .= ($column['on_update'] ?? null) === null ? '' : ' on update '.$column['on_update'];
        $def .= ($column['auto'] ?? false) ? ' auto_increment' : '';
        $def .= $spec['comment'] === null ? '' : ' comment '.$this->pdo->quote($spec['comment']);

        return ['alter table '.$this->tableName($t).($column === null ? ' add column ' : ' change column '.$this->quote($column['name']).' ').$def];
    }

    public function copyTable(array $t, string $to, bool $withRows): void
    {
        $old = $this->tableName($t);
        $new = $this->quote($t['schema']).'.'.$this->quote($to);
        $columns = array_keys(array_filter($t['columns'], fn ($c) => ! $c['generated']));
        self::copyRows($this->pdo, $old, $new, $columns, $withRows);
    }

    /** CREATE TABLE ... LIKE takes the columns and indexes, not the foreign keys. MySQL cannot undo it, so a failed copy is dropped. */
    private static function copyRows(PDO $pdo, string $old, string $new, array $columns, bool $withRows): void
    {
        $pdo->exec("create table {$new} like {$old}");

        if (! $withRows) {
            return;
        }

        $list = implode(', ', array_map(fn ($c) => '`'.str_replace('`', '``', $c).'`', $columns));

        try {
            $pdo->exec("insert into {$new} ({$list}) select {$list} from {$old}");
        } catch (PDOException $e) {
            $pdo->exec("drop table {$new}");

            throw $e;
        }
    }

    private function upkeep(array $t): array
    {
        $u = dbv_one($this->pdo,
            'select engine as engine, row_format as row_format, table_rows as estimate, data_free as free, table_collation as collation,
                unix_timestamp(create_time) * 1000 as created, unix_timestamp(update_time) * 1000 as updated
            from information_schema.tables where table_schema = ? and table_name = ?', [$t['schema'], $t['name']]);

        if ($u === null) {
            return [];
        }

        $u = self::ints($u, ['estimate', 'free', 'created', 'updated']);

        return [
            ['label' => 'Engine', 'value' => $u['engine'], 'type' => 'text'],
            ['label' => 'Row format', 'value' => $u['row_format'], 'type' => 'text'],
            ['label' => 'Rows, estimated', 'value' => $u['estimate'], 'type' => 'number'],
            ['label' => 'Space to give back', 'value' => $u['free'], 'type' => 'bytes'],
            ['label' => 'Created', 'value' => $u['created'], 'type' => 'time'],
            ['label' => 'Last written', 'value' => $u['updated'], 'type' => 'time'],
            ['label' => 'Collation', 'value' => $u['collation'], 'type' => 'text'],
        ];
    }

    /** @return array<string, int> SHOW GLOBAL STATUS, by lower-case name */
    private function status(): array
    {
        $status = [];

        foreach ($this->pdo->query('show global status')->fetchAll(PDO::FETCH_NUM) as [$name, $value]) {
            $status[strtolower($name)] = (int) $value;
        }

        return $status;
    }

    public function health(): array
    {
        $tables = array_map(fn (array $t) => self::ints($t, ['data', 'indexes', 'live', 'free', 'updated']), dbv_all($this->pdo,
            "select t.table_schema as `schema`, t.table_name as name, t.engine as engine, t.table_rows as live,
                coalesce(t.data_length, 0) as data, coalesce(t.index_length, 0) as indexes, t.data_free as free,
                unix_timestamp(t.update_time) * 1000 as updated,
                exists (select 1 from information_schema.table_constraints c
                    where c.table_schema = t.table_schema and c.table_name = t.table_name and c.constraint_type = 'PRIMARY KEY') as has_pk
            from information_schema.tables t
            where t.table_schema = ? and t.table_type = 'BASE TABLE'
            order by coalesce(t.data_length, 0) + coalesce(t.index_length, 0) desc, t.table_name", [$this->database]));

        $findings = [];

        foreach ($tables as $t) {
            if ($t['free'] >= 1048576 && $t['free'] > 0.2 * ($t['data'] + $t['indexes'])) {
                $findings[] = $this->finding('Space to give back', 'warn', $t['schema'], $t['name'],
                    "{$t['name']} holds ".dbv_bytes($t['free']).' of free space',
                    'Deleted rows left gaps in the table file. Optimize packs the rows again and gives the space back to the disk.', 'optimize');
            }

            if ($t['engine'] !== null && strcasecmp($t['engine'], 'InnoDB') !== 0) {
                $findings[] = $this->finding('Tables not on InnoDB', 'info', $t['schema'], $t['name'],
                    "{$t['name']} runs on {$t['engine']}",
                    'This engine keeps no transactions and no foreign keys, and a crash can damage the table.', null,
                    'alter table '.$this->quote($t['name']).' engine = InnoDB;');
            }

            if (! $t['has_pk']) {
                $findings[] = $this->finding('Tables without a primary key', 'info', $t['schema'], $t['name'],
                    "{$t['name']} has no primary key",
                    'Nothing tells one row from another, so a row cannot be edited here, and InnoDB adds a hidden key of its own.');
            }
        }

        $status = $this->status();
        $requests = $status['innodb_buffer_pool_read_requests'] ?? 0;

        return [
            'scope' => 'server',
            'summary' => [
                'size' => $this->size(null),
                'cache_hit' => $requests > 0 ? 1 - ($status['innodb_buffer_pool_reads'] ?? 0) / $requests : null,
                'since' => (int) ((microtime(true) - ($status['uptime'] ?? 0)) * 1000),
            ],
            'tables' => array_map(fn ($t) => array_diff_key($t, ['has_pk' => 1]) + ['other' => null], $tables),
            'findings' => $findings,
        ];
    }

    public function activity(): array
    {
        $s = $this->status();
        // Threads_running also counts the server's own threads, so the sessions are counted here instead, without this one.
        $threads = dbv_one($this->pdo,
            "select count(*) as connections, coalesce(sum(command <> 'Sleep'), 0) as running
            from information_schema.processlist where id <> connection_id() and command <> 'Daemon'");

        return [
            'scope' => 'server',
            'at' => (int) (microtime(true) * 1000),
            'totals' => [
                'connections' => (int) $threads['connections'],
                'running' => (int) $threads['running'],
                'queries' => $s['questions'] ?? 0,
                'rows_read' => $s['innodb_rows_read'] ?? 0,
                'rows_written' => ($s['innodb_rows_inserted'] ?? 0) + ($s['innodb_rows_updated'] ?? 0) + ($s['innodb_rows_deleted'] ?? 0),
                'cache_hits' => $s['innodb_buffer_pool_read_requests'] ?? 0,
                'cache_misses' => $s['innodb_buffer_pool_reads'] ?? 0,
                'rollbacks' => $s['com_rollback'] ?? 0,
            ],
            'sessions' => array_map(fn ($row) => self::ints($row, ['id', 'ms']), dbv_all($this->pdo,
                "select id as id, `user` as `user`, null as app, host as client,
                    case command when 'Sleep' then 'idle' when 'Query' then 'active' else lower(command) end as state,
                    time * 1000 as ms, state as wait, left(info, 2000) as query
                from information_schema.processlist
                where id <> connection_id() and db = ?
                order by command = 'Query' desc, time desc", [$this->database])),
        ];
    }

    public function stop(int $id, bool $kill): void
    {
        if (dbv_one($this->pdo, 'select id from information_schema.processlist where id = ? and db = ?', [$id, $this->database]) === null) {
            throw new DbvError('That session has ended already.');
        }

        $this->pdo->exec(($kill ? 'kill ' : 'kill query ').$id);
    }

    public static function createDatabase(PDO $pdo, string $name, ?string $copyOf): array
    {
        $quote = fn (string $n): string => '`'.str_replace('`', '``', $n).'`';
        $pdo->exec('create database '.$quote($name));

        if ($copyOf === null) {
            return [];
        }

        // MySQL has no copy of a whole database, so it goes table by table.
        try {
            foreach (dbv_all($pdo, "select table_name as name from information_schema.tables where table_schema = ? and table_type = 'BASE TABLE'", [$copyOf]) as $table) {
                $columns = array_column(dbv_all($pdo,
                    "select column_name as name from information_schema.columns
                    where table_schema = ? and table_name = ? and extra not like '%GENERATED%' order by ordinal_position",
                    [$copyOf, $table['name']]), 'name');
                self::copyRows($pdo, $quote($copyOf).'.'.$quote($table['name']), $quote($name).'.'.$quote($table['name']), $columns, true);
            }
        } catch (Throwable $e) {
            $pdo->exec('drop database '.$quote($name));

            throw $e;
        }

        return ['MySQL copies tables with their indexes and rows. Foreign keys, views, triggers and routines are not copied.'];
    }

    public static function dropDatabase(PDO $pdo, string $name): void
    {
        $pdo->exec('drop database `'.str_replace('`', '``', $name).'`');
    }

    public function dropTable(array $t, bool $cascade): void
    {
        if ($cascade) {
            throw new DbvError('MySQL cannot drop the tables that point to this one in the same step. Drop those first.');
        }

        parent::dropTable($t, false);
    }

    public function dropColumn(array $t, array $column, bool $cascade): void
    {
        if ($cascade) {
            throw new DbvError('MySQL cannot drop what depends on this column in the same step. Drop that first.');
        }

        parent::dropColumn($t, $column, false);
    }
}
