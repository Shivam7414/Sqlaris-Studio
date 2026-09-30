---
name: add-api-action
description: The steps for adding or changing an API action in Sqlaris Studio end to end - driver methods for PostgreSQL and MySQL, the dbv_action_ function, the api.php route, the front-end call, the tests and the README. Use whenever a feature needs the server to read or change something new.
---

# Add an API action

Work through these in order. Read an existing action that is close to the new one first
(for a write, `dbv_action_update` or `dbv_action_truncate`; for a read,
`dbv_action_structure` or `dbv_action_health`).

## 1. Driver

If the SQL differs between PostgreSQL and MySQL/MariaDB, add an `abstract` method to
`DbvDriver` in `src/drivers/Driver.php` with a one-line comment saying what it returns,
then implement it in both `Pgsql.php` and `Mysql.php`. If it is the same everywhere, put it
in `Driver.php` as a normal method.

- Quote identifiers with `$this->quote()`, and only ones that came from `dbv_table()` /
  `dbv_column()`.
- Bind every value. Anything that goes into SQL as text (a direction, an operator, a
  maintenance op) is checked against a fixed list first.
- New names the user types go through the same check as copy and rename: letters, digits
  and underscores only.
- If MySQL cannot do something PostgreSQL can, throw a `DbvError` that says so in plain
  words and what to do instead (see the existing "MySQL cannot empty the tables that point
  to this one..." message).

## 2. Action

Add `function dbv_action_<name>(DbvDriver $d, array $t, array $req): array` to
`src/actions.php`, near the actions it belongs with.

- Resolve tables with `dbv_table()` and columns with `dbv_column()`; never use a name
  from `$req` directly.
- Writes to many rows go in one transaction; on failure nothing is kept and the error names
  the row.
- A destructive action requires the typed name, like `dbv_action_drop_table`.
- Error messages follow `.claude/skills/build-ui/copy.md`.

## 3. Route

Add one line to the `match` in `api.php`. Actions that work on the server rather than a
database go above `dbv_open()`, like `create_database`.

## 4. Front end

Call it with `api('<name>', { db, table, ... })` from `assets/app.js`. Use the `build-ui`
skill for anything it shows. After a change, refresh what the change affects
(`afterTableChange`, `loadRows`, `bumpCount`) and give a toast that says what happened,
with Undo when it can be undone.

## 5. Tests

In `tests/php/api.test.php`:

- The normal request, then read the database directly through `$pdo` to confirm the
  effect. The viewer does not get to vouch for itself.
- The hostile requests: a table or column name that is not in the catalog, a name with a
  quote in it (the fixtures have `odd "name" table`), SQL in a value, a missing field.
- For a many-row write, one bad row and a check that nothing was kept.
- Both systems. Guard system-specific checks with the `$driver` argument.

Pure logic without a database goes in `tests/php/unit.test.php`.

Run `php tests/php/run.php` against at least one real server (see the `verify` skill,
step 3) before calling it done.

## 6. README

If a person can see or use the new thing, add it to "What it does". If MySQL behaves
differently, add a line to "MySQL and MariaDB". A new shortcut goes in the shortcuts table.
