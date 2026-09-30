# Sqlaris Studio

A local database browser for PostgreSQL and MySQL/MariaDB. Plain PHP 8.1+ and plain
JavaScript: no Composer, no npm, no build step. It only answers on localhost and is meant
for local development. The README is the user-facing spec; read the relevant section of it
before changing behaviour it describes.

## Commands

```
php -S 127.0.0.1:8765 router.php     # run it, then open http://127.0.0.1:8765/
node --test                          # diagram layout tests (tests/*.test.js)
php tests/php/run.php                # unit tests, plus API tests against real databases
npx playwright test                  # browser tests (dev-only, needs npm install and a TEST_* server)
php -l <file.php>                    # syntax check one PHP file
node --check <file.js>               # syntax check one JS file
```

The API tests only run for servers named in `TEST_PGSQL_*` / `TEST_MYSQL_*` (environment
or `tests/.env`). Without them the run prints "skipped" and still says "All passed". That is
not a pass for a change to `src/` or `api.php`: say plainly that the API tests did not run.

## Where things are

- `index.php` the page and sign-in form. `api.php` dispatches every call in one `match`.
- `src/lib.php` sign-in, the localhost and Host check, config loading.
- `src/actions.php` every `dbv_action_*`, written once for both databases.
- `src/drivers/Driver.php` the abstract `DbvDriver`; `Pgsql.php` and `Mysql.php` hold what
  differs. New SQL that differs between systems goes in a driver method, not in actions.
- `assets/app.js` the whole front end, one IIFE. `assets/diagram.js` the diagram layouts,
  also loaded by the Node tests. `assets/app.css` every style and every design token.
- `assets/vendor/` third-party code. Never edit it; libraries come in through
  `src/libraries.php` with their license file.

## Rules that are not negotiable

- The app itself has no build step and no runtime dependency. Nothing it needs to run
  may come from `npm install` or `composer install`, and nothing the page loads may be
  built. Third-party code the page uses goes through `src/libraries.php`.
- Tools for testing may be dev-only packages (a browser driver in `package.json`
  `devDependencies`, PCOV or Xdebug for coverage). The app must still run from a plain
  checkout without them, and the unit and API suites must keep running without them too.
- Table and column names come from the catalog (`dbv_table`, `dbv_column`), never from the
  request. Unknown names are refused before any SQL is written.
- Every value is bound as a parameter. Sort directions, filter operators and anything else
  that goes into SQL as text come from a fixed list.
- Every write to many rows runs in one transaction; on failure nothing is kept and the
  error names the row.
- Anything that changes data works on PostgreSQL and MySQL/MariaDB, or says where it does
  not, and gets a test in `tests/php/api.test.php` that checks the database directly.
- Front end: build DOM with `h()` / `put()`. Never `innerHTML` with anything that came from
  the database or the user. `icon()` is the only place SVG strings go in.
- Do not touch `.env`, `config.php`, `layout.json` or `tests/.env`. They are the user's own
  and git ignores them.

## How to work here

1. Before changing code, read the code around it and find the existing helper that
   already does the job. This codebase has one for most things (`toast`, `confirmBox`,
   `confirmByName`, `openModal`, `askText`, `nameForm`, `menuList`, `segmented`,
   `skeleton`, `stat`, `searchable`, `dateBox`). Reuse before adding.
2. For a change that touches more than one file, write down the steps and what each one
   needs before editing anything. For API work the order is in the `add-api-action` skill.
3. Tests first. Write the test that shows the change is needed and watch it fail for that
   reason. Then write the least code that makes it pass, then tidy up while it stays green.
   For a bug, the first test reproduces it. For a feature, have the `test-writer` agent
   write the tests: it runs on a different model and works from what the feature should
   do, not from your code.
4. Match the file you are in: its naming (`dbv_` prefix in PHP, `declare(strict_types=1)`),
   its comment density, and its habit of explaining *why* in plain sentences.
5. After each change, check it. Hooks lint every file you edit and run both test suites
   when you stop; a failing check blocks you from finishing. Fix the cause, never the test.
6. Before saying something is done, run the `verify` skill. For UI work that includes
   looking at the page in a browser in both the dark and the light theme.
7. Report what you checked and what you could not check, separately. "Tests pass" only
   when you saw them pass in this session.

## What the tests cover

- **Unit:** `tests/php/unit.test.php` for PHP with no database, `tests/diagram.test.js`
  for the diagram layouts.
- **Integration:** `tests/php/api.test.php` calls `api.php` over HTTP, signed in, against
  real PostgreSQL and MySQL/MariaDB servers, and reads the effect back through PDO.
- **In the browser:** `tests/e2e/*.spec.js` with Playwright (`npx playwright test`,
  after `npm install` and `npx playwright install chromium`). They need a `TEST_*` server,
  make a `sqlaris_e2e` database and fail on any console error. They are named `.spec.js`
  so `node --test` does not pick them up. A new critical flow gets a spec here.
- **Coverage:** CI measures PHP line coverage with PCOV on the PHP 8.4 job
  (`tests/php/coverage.php`, report by `tests/php/coverage-report.php`). Locally it needs
  PCOV and `COVERAGE_DIR` set; without them nothing is measured. Every action in `api.php`
  must also succeed in at least one API test; the run fails and names any that did not. `node --test --experimental-test-coverage` shows `diagram.js`:
  its layouts are covered, and `mount()` is DOM code that Node cannot run.

## UI and the words on it

The UI rules live in `.claude/rules/ui.md` and load when you touch `assets/` or
`index.php`. For anything bigger than a small fix, use the `build-ui` skill. The short
version:

- It must look like it belongs to this app, not like a generic AI dashboard. Use the tokens
  in `assets/app.css` (`--ink`, `--muted`, `--line`, `--accent`, `--r`, `--fast`, ...);
  no new hex colours, no gradients-for-decoration, no emoji, no icon on every line.
- Words are plain, short sentences a person would say out loud. "Delete this row?",
  "Copy did not work in this browser.", "There is no table orders in this database."
  Not "Are you sure?", "Oops! Something went wrong", "Successfully deleted!".
- Error messages coming out of PHP (`DbvError`) are UI text too. Same rules.

## Git

Work on a branch when asked to commit; `main` is the default branch. CI runs both suites on
PHP 8.1 + PostgreSQL 12 + MySQL 8.0 and PHP 8.4 + PostgreSQL 18 + MariaDB 11, so do not use
PHP newer than 8.1 or SQL that those versions lack.
