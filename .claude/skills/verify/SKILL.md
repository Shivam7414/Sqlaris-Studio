---
name: verify
description: The full check before saying a change in Sqlaris Studio is done - syntax, both test suites, API tests against real databases, a look at the page in the browser, a security and copy review of the diff, and an honest report. Use before finishing any code change, before a commit, and whenever the user asks to check, test or verify something.
---

# Verify a change

Do every step that applies. Do not skip one because the change "looks simple". Keep notes
of what you ran and what you saw; the report at the end is built from them.

## 1. Know exactly what changed

```
git status
git diff HEAD
```

Read the whole diff, including files you did not mean to touch. Anything unexpected, such
as changes the user made themselves, you leave alone and mention.

## 2. Syntax and tests

```
php -l <each changed .php file>
node --check <each changed .js file>
node --test
php tests/php/run.php
```

The Stop hook runs these too, but run them yourself so you see the output.

For new behaviour or a bug fix, there must be a test that failed before the change and
passes after it. If you wrote the test after the code, take the change out (or break the
line it guards), run the test, see it fail, and put the change back. A test you have
never seen fail may not test anything.

## 3. The API against real databases

Needed when anything in `api.php` or `src/` changed. Look at the end of the PHP test
output: `pgsql: skipped` or `mysql: skipped` means that system was not tested.

- If `tests/.env` or `TEST_*` variables exist, the run above already covered it.
- If not, check whether a local server is there. Under XAMPP, MySQL is usually on
  `127.0.0.1:3306` as `root` with an empty password. Only with the user's OK, run once with
  the variables set for that command only:
  `TEST_MYSQL_HOST=127.0.0.1 php tests/php/run.php`. It creates and drops a database
  called `sqlaris_test`, so that name must be free.
- Never write `tests/.env` or put a password in a file without being asked.
- If neither system can be tested, say so plainly in the report.

For a change that writes data, the test must read the result back through PDO, not
through the viewer, and cover the hostile version of the request (a name that is not in
the catalog, a quote character, SQL in a value).

## 4. Look at it

For anything the page shows:

1. Start the app in the background: `php -S 127.0.0.1:8765 router.php`.
2. Open `http://127.0.0.1:8765/` in a browser if one is available (Claude in Chrome or
   the built-in browser). The sign-in is the user's own; ask them to sign in, do not read
   `.env` for the password.
3. Use the feature the way a person would. Check the states from the `build-ui` skill:
   loading, empty, a lot of data, long names, an error, dark and light theme.
4. Look at the browser console for errors.
5. Stop the server when done.

If there is no browser, check the API the page calls with curl the way CI does (see
`.github/workflows/tests.yml`), and say in the report that nobody has looked at the page.

## 5. Review the diff against the rules

Go through the diff with CLAUDE.md next to it:

- Table and column names from the catalog only; every value bound; SQL fragments from a
  fixed list.
- Works on both PostgreSQL and MySQL/MariaDB, or the difference is said in the UI and the
  README.
- No PHP newer than 8.1, no SQL that PostgreSQL 12 or MySQL 8.0 lack.
- No new runtime dependency, no build step, nothing edited in `assets/vendor/`. A dev-only
  test tool is fine if the app and the unit and API suites still run without it.
- UI text follows `.claude/skills/build-ui/copy.md`. Read every new string out loud.
- README updated if behaviour it describes changed (features, shortcuts, options, the
  MySQL differences).

For a change of more than a few lines, also hand the diff to the `reviewer` agent and deal
with what it finds. It has not seen your reasoning, which is the point.

## 6. Report

Tell the user, in plain sentences:

- What changed, in one or two lines.
- What you checked and saw pass (name the commands).
- What you could not check and why (no MySQL server, no browser, ...).
- Anything odd you noticed but did not touch.

Never say "tested" or "works" for something you did not run or see in this session.
