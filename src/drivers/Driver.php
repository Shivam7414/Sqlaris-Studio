<?php

declare(strict_types=1);

/**
 * The part of the viewer that differs between database systems: reading the
 * catalog, quoting names, turning values into text and back, and a few pieces
 * of SQL. The actions in actions.php are written once against this class.
 * Another system is one more subclass, listed in DBV_DRIVERS in lib.php.
 *
 * A table, as table() returns it and every method takes it:
 *   schema, name, kind ("table", "view", ...), comment, pk (column names),
 *   fks and refs (name, schema, tbl, cols, ref_cols), and columns by name.
 * A column: name, type, category (see CATEGORIES), nullable, default,
 *   default_sql (the default as SQL that would set it again, or null),
 *   readonly (the database fills it), auto (the database numbers it),
 *   generated (worked out from other columns), comment, and options (the
 *   allowed values, or null).
 *
 * A column spec, what the column form asks for: name, type (as SQL),
 *   nullable, default (as SQL, or null for none) and comment (or null).
 */
abstract class DbvDriver
{
    /** The name config.php and the page use for this system. */
    public const DRIVER = '';

    /** The name people know it by. */
    public const LABEL = '';

    public const PORT = 0;

    /** What the page knows about a column's type, whatever the system calls it. */
    public const CATEGORIES = ['number', 'text', 'bool', 'date', 'datetime', 'time', 'interval', 'json', 'uuid', 'binary', 'array', 'other'];

    // Every query names its table "dbv". A bare "t" would be read as a column
    // if the table happens to have one called t.
    public const ALIAS = 'dbv';

    /**
     * The upkeep this system offers, for one table or the whole database, by
     * the name maintain() takes. "locks" marks the ones that block the table
     * while they run, so the page asks first.
     *
     * @var array<string, array{label: string, hint: string, locks: bool}>
     */
    public const MAINTENANCE = [];

    /** The databases a server needs for itself. They are never dropped from here. */
    public const SYSTEM_DATABASES = [];

    public function __construct(public readonly PDO $pdo, public readonly string $database) {}

    /** Opens a connection. Without a database, to wherever the list of databases can be read. */
    abstract public static function connect(array $server, ?string $database): PDO;

    /** @return list<string> every database on the server this login may open */
    abstract public static function databases(PDO $pdo): array;

    abstract public function quote(string $name): string;

    /** The schema a table belongs to when nothing else is said. The page leaves it out of names. */
    abstract public function defaultSchema(): string;

    /** @return array{tables: list<array<string, mixed>>, info: array<string, mixed>} */
    abstract public function tables(): array;

    /** One table or view, in the shape described above, or null when there is none. */
    abstract public function table(string $schema, string $name): ?array;

    /** @return array{indexes: list<array>, constraints: list<array>, triggers: list<array>, sizes: array, view: ?string} */
    abstract public function structure(array $t): array;

    /** @return list<array{schema: string, name: string, columns: list<string>}> for the SQL editor's suggestions */
    abstract public function schema(): array;

    /**
     * Every table and view tables() lists, in the same order, for the diagram:
     * schema, name, kind, columns (name and type), pk (column names) and fks,
     * each fk in the shape table() gives (name, schema, tbl, cols, ref_cols).
     * It reads the catalog in a fixed number of queries, however many tables.
     *
     * @return list<array<string, mixed>>
     */
    abstract public function diagram(): array;

    /** A column's value as the text the page shows and can send back unchanged. */
    abstract public function text(string $expr, array $column): string;

    /** Any value as plain text, to search it or compare it as text. */
    abstract public function asText(string $expr): string;

    /** Every column of the row as one text, for the search box. */
    abstract public function rowText(array $t): string;

    /** A LIKE that ignores upper and lower case. */
    abstract public function ilike(): string;

    abstract public function isDistinct(string $a, string $b): string;

    /** Sorts with NULLs last either way. */
    abstract public function orderBy(string $expr, string $dir): string;

    /** Whether = and < work on the column's own type. The rest compare as text. */
    abstract public function comparable(array $column): bool;

    /**
     * Inserts one row and returns its primary key, to read the row back, or
     * null when the database cannot say what the key became.
     *
     * @param  array<string, ?string>  $values
     */
    abstract public function insert(array $t, array $values): ?array;

    /** The start of a DELETE that can use the table's alias in its WHERE. */
    abstract public function deleteFrom(array $t): string;

    /** What turns an INSERT into "or update the row with this primary key". */
    abstract public function upsert(array $t, array $names): string;

    abstract public function truncate(array $t, bool $cascade): void;

    /** From here on this connection refuses to change anything. */
    abstract public function readOnly(): void;

    /** The query that shows how this one runs. */
    abstract public function explain(string $sql): string;

    /** Whether a column type of a query result, as PDO names it, is a number. */
    abstract public function numeric(string $nativeType): bool;

    /**
     * Runs one of MAINTENANCE on a table, or on every table when $t is null.
     *
     * @return list<array{table: string, type: string, text: string}> what the database said, where it says anything
     */
    abstract public function maintain(?array $t, string $op): array;

    /** Bytes on disk for a table with its indexes, or for the whole database. */
    abstract public function size(?array $t): int;

    abstract public function renameTable(array $t, string $to): void;

    /** A new table beside this one with the same columns, defaults, indexes and checks, and its rows if asked. */
    abstract public function copyTable(array $t, string $to, bool $withRows): void;

    /**
     * The statements that add a column to $t, or with $column change that
     * column, to match the spec. Only what differs is changed where the system
     * allows it, so an empty list means there is nothing to do.
     *
     * @return list<string>
     */
    abstract public function columnSql(array $t, ?array $column, array $spec): array;

    /**
     * Sizes and use of every table, and what could be better.
     *
     * @return array{scope: string, summary: array, tables: list<array>, findings: list<array>}
     */
    abstract public function health(): array;

    /**
     * Running totals, which the page turns into rates, and the open sessions.
     * The totals: connections, running, queries, rows_read, rows_written,
     * cache_hits, cache_misses, rollbacks. "scope" says whether they count
     * this database or the whole server.
     */
    abstract public function activity(): array;

    /** Stops a session's query, or with $kill ends the session. */
    abstract public function stop(int $id, bool $kill): void;

    /** Creates a database, empty or as a copy of another. @return list<string> anything the copy left out */
    abstract public static function createDatabase(PDO $pdo, string $name, ?string $copyOf): array;

    abstract public static function dropDatabase(PDO $pdo, string $name): void;

    /** The word SQL uses for this kind of table in DROP and ALTER. */
    public function kindWord(array $t): string
    {
        return in_array($t['kind'], ['view', 'materialized view', 'foreign table', 'sequence'], true) ? $t['kind'] : 'table';
    }

    public function dropTable(array $t, bool $cascade): void
    {
        $this->pdo->exec('drop '.$this->kindWord($t).' '.$this->tableName($t).($cascade ? ' cascade' : ''));
    }

    public function dropColumn(array $t, array $column, bool $cascade): void
    {
        $this->pdo->exec('alter table '.$this->tableName($t).' drop column '.$this->quote($column['name']).($cascade ? ' cascade' : ''));
    }

    /** Moves to the next result of a script of several statements, where the system has them. */
    public function nextResult(PDOStatement $statement): bool
    {
        return false;
    }

    /** Whether the server has a transaction open on this connection right now. */
    public function inTransaction(): bool
    {
        return $this->pdo->inTransaction();
    }

    /** The placeholder for a value going into a column. */
    public function param(array $column): string
    {
        return '?';
    }

    /** A value from the page as this system wants it bound. */
    public function value(array $column, string $value): string
    {
        return $value;
    }

    /** A value written into an SQL file, to go back into the same column. */
    public function literal(?string $value, array $column): string
    {
        if ($value === null) {
            return 'null';
        }

        return $column['category'] === 'bool' ? ($value === 'true' ? 'true' : 'false') : $this->pdo->quote($value);
    }

    public function tableName(array $t): string
    {
        return $this->quote($t['schema']).'.'.$this->quote($t['name']);
    }

    public function from(array $t): string
    {
        return $this->tableName($t).' as '.self::ALIAS;
    }

    public function col(string $name): string
    {
        return self::ALIAS.'.'.$this->quote($name);
    }

    /**
     * The columns and values of a write. A null value writes NULL; anything
     * else goes in through the column's own type, so the database checks it.
     *
     * @return array{0: list<string>, 1: list<string>, 2: list<string>} quoted names, expressions, params
     */
    public function values(array $t, array $values): array
    {
        $names = [];
        $exprs = [];
        $params = [];

        foreach ($values as $name => $value) {
            $column = $t['columns'][(string) $name] ?? throw new DbvError("{$t['name']} has no column called {$name}.");

            if ($column['readonly']) {
                throw new DbvError("{$column['name']} is filled by the database and cannot be set.");
            }

            $names[] = $this->quote($column['name']);

            if ($value === null) {
                $exprs[] = 'null';
            } else {
                $exprs[] = $this->param($column);
                $params[] = $this->value($column, is_bool($value) ? ($value ? 'true' : 'false') : (string) $value);
            }
        }

        return [$names, $exprs, $params];
    }

    /** Runs $work in one transaction: all of it is kept, or none of it. */
    public function transaction(callable $work): mixed
    {
        $this->pdo->beginTransaction();

        try {
            $result = $work();
            $this->pdo->commit();

            return $result;
        } catch (Throwable $e) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }

            throw $e;
        }
    }

    /** A table's name as the page writes it: bare in the usual schema. */
    protected function label(string $schema, string $name): string
    {
        return $schema === $this->defaultSchema() ? $name : "{$schema}.{$name}";
    }

    /** One thing health() found, in the shape the page lists. $op is a MAINTENANCE that fixes it, $sql a statement that would. */
    protected function finding(string $group, string $level, string $schema, string $name, string $title, string $detail, ?string $op = null, ?string $sql = null): array
    {
        return ['group' => $group, 'level' => $level, 'table' => ['schema' => $schema, 'name' => $name], 'title' => $title, 'detail' => $detail, 'op' => $op, 'sql' => $sql];
    }

    /** The named fields of a row as whole numbers, leaving NULL as it is. */
    protected static function ints(array $row, array $keys): array
    {
        foreach ($keys as $key) {
            $row[$key] = $row[$key] === null ? null : (int) $row[$key];
        }

        return $row;
    }

    /** PDO wraps the database's error in its own prefix. The page wants the database's words. */
    public static function message(PDOException $e): string
    {
        return trim((string) preg_replace('/^SQLSTATE\[\w+\](: [^:]+: \d+| \[\d+\]) /', '', $e->getMessage()));
    }
}
