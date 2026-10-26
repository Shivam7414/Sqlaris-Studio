// The SQL text helpers of assets/sqltext.js: split a script into statements, find the one
// under the cursor, lay a statement out, and say whether a result can be edited where it shows.
// Node's own runner, no package. From the project folder:
//     node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const { statements, statementAt, format, editableSource } = require('../assets/sqltext.js');

const MYSQL = { dialect: 'mysql' };
const PGSQL = { dialect: 'pgsql' };

const texts = (sql, options) => statements(sql, options).map(s => s.text);

// The piece a statement should come out as, worked out from the text and not from statements().
function piece(sql, text) {
  const from = sql.indexOf(text);
  assert.notEqual(from, -1, `the test text has no ${text}`);
  return { from, to: from + text.length, text };
}

// ------------------------------------------------------------ statements

test('statements: a script splits at each semicolon, and a last statement needs none', () => {
  assert.deepEqual(texts('select 1; select 2'), ['select 1', 'select 2']);
  assert.deepEqual(texts('select 1;\nselect 2;\nselect 3\n'), ['select 1', 'select 2', 'select 3']);
  assert.deepEqual(texts('select 1;\r\nselect 2;\r\n'), ['select 1', 'select 2']);
});

test('statements: from and to are offsets into the text, around the statement only', () => {
  const sql = '  select 1 ;\n\n  select 2  ';

  assert.deepEqual(statements(sql), [piece(sql, 'select 1'), piece(sql, 'select 2')]);
});

test('statements: slice(from, to) is the text, also after emoji and accents, and the text has no spaces around it', () => {
  const scripts = [
    "select '😀;'; select 'é' ;\r\nselect 3",
    '  select "ü;ñ" ;;\n\n\t select 2 ; ',
    "select 'a;b' -- ç; 😀\n; select 2",
  ];

  for (const sql of scripts) {
    const found = statements(sql);
    assert.ok(found.length >= 2, sql);
    for (const s of found) {
      assert.equal(sql.slice(s.from, s.to), s.text);
      assert.equal(s.text, s.text.trim());
    }
  }
});

test('statements: pieces that are empty after trimming are left out', () => {
  assert.deepEqual(statements(''), []);
  assert.deepEqual(statements('  \n\t \n'), []);
  assert.deepEqual(statements(';;'), []);
  assert.deepEqual(texts('  ;  ; select 1 ;;  '), ['select 1']);
});

test('statements: a semicolon inside a single-quoted string does not split', () => {
  assert.deepEqual(texts("select 'a;b'; select 2"), ["select 'a;b'", 'select 2']);
});

test('statements: a doubled quote stays inside the string', () => {
  assert.deepEqual(texts("select 'it''s; fine'; select 2"), ["select 'it''s; fine'", 'select 2']);
});

test('statements: in mysql a backslash escapes a quote, in pgsql it does not', () => {
  const escaped = String.raw`select 'a\';b'; select 2`;
  assert.deepEqual(texts(escaped, MYSQL), [String.raw`select 'a\';b'`, 'select 2']);

  const closed = String.raw`select 'a\'; select 2`;
  assert.deepEqual(texts(closed), [String.raw`select 'a\'`, 'select 2'], 'pgsql is the default');
  assert.deepEqual(texts(closed, PGSQL), [String.raw`select 'a\'`, 'select 2']);
  assert.deepEqual(texts(closed, MYSQL), [closed], 'the quote is escaped, so the string never closes');
});

test('statements: in mysql a backslash escapes a quote in a double-quoted string too, and a doubled backslash escapes itself', () => {
  assert.deepEqual(texts(String.raw`select "a\";b"; select 2`, MYSQL), [String.raw`select "a\";b"`, 'select 2']);
  assert.deepEqual(texts(String.raw`select 'a\\'; select 2`, MYSQL), [String.raw`select 'a\\'`, 'select 2']);
});

test('statements: a double-quoted name or string keeps its semicolon, in both dialects', () => {
  for (const options of [undefined, PGSQL, MYSQL]) {
    assert.deepEqual(texts('select "a;b" from t; select 2', options), ['select "a;b" from t', 'select 2']);
  }
});

test('statements: a backtick name keeps its semicolon, in both dialects', () => {
  for (const options of [undefined, PGSQL, MYSQL]) {
    assert.deepEqual(texts('select `a;b` from t; select 2', options), ['select `a;b` from t', 'select 2']);
  }
});

test('statements: a -- comment runs to the end of the line and hides its semicolon', () => {
  for (const options of [undefined, MYSQL]) {
    assert.deepEqual(texts('select 1 -- a; b\n; select 2', options), ['select 1 -- a; b', 'select 2']);
    assert.deepEqual(texts('select 1 -- a; b\n, 2; select 3', options), ['select 1 -- a; b\n, 2', 'select 3']);
  }
});

test('statements: a /* */ comment hides its semicolon, over several lines too', () => {
  for (const options of [undefined, MYSQL]) {
    assert.deepEqual(texts('select 1 /* a; b */; select 2', options), ['select 1 /* a; b */', 'select 2']);
    assert.deepEqual(texts('select 1 /* a;\n b;\n c */ + 1; select 2', options), ['select 1 /* a;\n b;\n c */ + 1', 'select 2']);
  }
});

test('statements: in mysql a # comment hides its semicolon, in pgsql # is just an operator', () => {
  assert.deepEqual(texts('select 1 # not; a split\n, 2; select 3', MYSQL), ['select 1 # not; a split\n, 2', 'select 3']);
  assert.deepEqual(texts('select 1 # a; select 2'), ['select 1 # a', 'select 2']);
  assert.deepEqual(texts('select 1 # a; select 2', PGSQL), ['select 1 # a', 'select 2']);
});

test('statements: comment marks inside a string are text, and quotes inside a comment are text', () => {
  assert.deepEqual(texts("select '-- no'; select 2"), ["select '-- no'", 'select 2']);
  assert.deepEqual(texts("select '/*'; select 2"), ["select '/*'", 'select 2']);
  assert.deepEqual(texts('select "--"; select 2'), ['select "--"', 'select 2']);
  assert.deepEqual(texts("select 1 -- it's\n; select 2"), ["select 1 -- it's", 'select 2']);
  assert.deepEqual(texts("select 1 /* it's */; select 2"), ["select 1 /* it's */", 'select 2']);
  assert.deepEqual(texts("select '#'; select 2", MYSQL), ["select '#'", 'select 2']);
});

test('statements: in pgsql a $$ body or a $tag$ body keeps its semicolons', () => {
  const fn = 'create function f() returns int as $$ begin return 1; end; $$ language plpgsql; select 2';
  const expected = ['create function f() returns int as $$ begin return 1; end; $$ language plpgsql', 'select 2'];
  assert.deepEqual(texts(fn), expected, 'pgsql is the default');
  assert.deepEqual(texts(fn, PGSQL), expected);
  assert.deepEqual(statements(fn), statements(fn, PGSQL));

  assert.deepEqual(texts('do $body$ begin perform 1; end $body$; select 2'), ['do $body$ begin perform 1; end $body$', 'select 2']);
});

test('statements: a dollar quote is closed only by its own tag', () => {
  assert.deepEqual(texts('select $a$ x; $$ y; $a$; select 2'), ['select $a$ x; $$ y; $a$', 'select 2']);
  assert.deepEqual(texts('select $$ x; $a$ y; $$; select 2'), ['select $$ x; $a$ y; $$', 'select 2']);
});

test('statements: $1 is a parameter, not a dollar quote', () => {
  assert.deepEqual(texts('select * from t where a = $1 and b = $2; select 3'), ['select * from t where a = $1 and b = $2', 'select 3']);
  assert.deepEqual(texts('select $1; select $2'), ['select $1', 'select $2']);
});

test('statements: in mysql $$ is not a quote', () => {
  assert.deepEqual(texts('select $$a; b$$', MYSQL), ['select $$a', 'b$$']);
});

test('statements: an unclosed string or comment runs to the end of the text and does not throw', () => {
  assert.deepEqual(texts("select 1; select 'abc; def"), ['select 1', "select 'abc; def"]);
  assert.deepEqual(texts('select 1; select "abc; def'), ['select 1', 'select "abc; def']);
  assert.deepEqual(texts('select 1; select `abc; def'), ['select 1', 'select `abc; def']);
  assert.deepEqual(texts('select 1 /* open; select 2'), ['select 1 /* open; select 2']);
  assert.deepEqual(texts('select 1 -- open; select 2'), ['select 1 -- open; select 2']);
  assert.deepEqual(texts('select 1; select $$ open; select 2'), ['select 1', 'select $$ open; select 2']);
  assert.deepEqual(texts('select 1 # open; select 2', MYSQL), ['select 1 # open; select 2']);
  assert.deepEqual(texts(String.raw`select 'a\'; select 2`, MYSQL), [String.raw`select 'a\'; select 2`]);
});

// ------------------------------------------------------------ statementAt

test('statementAt: inside a statement it is that statement, from its first character to just before the semicolon', () => {
  const sql = 'select 1;\n\n\nselect 2 from t;  \nselect 3';
  const two = piece(sql, 'select 2 from t');

  assert.deepEqual(statementAt(sql, two.from), two);
  assert.deepEqual(statementAt(sql, two.from + 4), two);
  assert.deepEqual(statementAt(sql, two.to), two);
  assert.deepEqual(statementAt(sql, 3), piece(sql, 'select 1'));
});

test('statementAt: a semicolon inside a string is still inside the statement', () => {
  const sql = "select 'a;b' from t; select 2";

  assert.deepEqual(statementAt(sql, sql.indexOf(';')), piece(sql, "select 'a;b' from t"));
  assert.deepEqual(statementAt(sql, sql.indexOf('select 2') + 2), piece(sql, 'select 2'));
});

test('statementAt: right after its semicolon, and in the spaces after it on the same line, it is that statement', () => {
  const sql = 'select 1;\n\n\nselect 2 from t;  \nselect 3';
  const one = piece(sql, 'select 1');
  const two = piece(sql, 'select 2 from t');
  const semi = sql.indexOf(';', two.to);

  assert.deepEqual(statementAt(sql, sql.indexOf(';') + 1), one);
  assert.deepEqual(statementAt(sql, semi + 1), two);
  assert.deepEqual(statementAt(sql, semi + 2), two);
  assert.deepEqual(statementAt(sql, semi + 3), two, 'at the end of the line, which is where people press run');
});

test('statementAt: the start of the next line is the next statement', () => {
  const sql = 'select 1;\nselect 2;   select 3';
  const two = piece(sql, 'select 2');
  const semi = sql.indexOf(';', two.to);

  assert.deepEqual(statementAt(sql, two.from), two);
  assert.deepEqual(statementAt(sql, semi + 1), two);
  assert.deepEqual(statementAt(sql, semi + 3), two, 'still in the spaces after the semicolon');
  assert.deepEqual(statementAt(sql, sql.length), piece(sql, 'select 3'), 'the end of a last statement that has no semicolon');
});

// The contract names the spaces after a semicolon and "inside a statement", and the offset between the two
// (the cursor just before the first character of a statement that follows on the same line) is in both.
// A cursor placed in front of a statement belongs to it: that is the reading this test holds to.
test('statementAt: the cursor just before the first character of a statement is in that statement, even on the line of the one before', () => {
  const sql = 'select 1;   select 2';

  assert.deepEqual(statementAt(sql, sql.indexOf('select 2')), piece(sql, 'select 2'));
});

test('statementAt: in the blank lines between two statements it is the one below, not the last one', () => {
  const sql = 'select 1;\n\n\nselect 2 from t;\n\n\nselect 3';
  const two = piece(sql, 'select 2 from t');
  const semi = sql.indexOf(';', two.to);

  assert.deepEqual(statementAt(sql, 10), two);
  assert.deepEqual(statementAt(sql, 11), two);
  assert.deepEqual(statementAt(sql, semi + 1), two, 'right after the semicolon is still that statement');
  assert.deepEqual(statementAt(sql, semi + 2), piece(sql, 'select 3'));
  assert.deepEqual(statementAt(sql, semi + 3), piece(sql, 'select 3'));
});

test('statementAt: in the blank lines before the first statement it is the first one, not the last', () => {
  const sql = '\n\n  select 1;\nselect 2;\nselect 3';

  assert.deepEqual(statementAt(sql, 0), piece(sql, 'select 1'));
  assert.deepEqual(statementAt(sql, 1), piece(sql, 'select 1'));
});

test('statementAt: in the blank lines after the last statement it is the last one', () => {
  const sql = 'select 1;\n\nselect 2;\n\n\n';
  const two = piece(sql, 'select 2');
  const semi = sql.lastIndexOf(';');

  assert.deepEqual(statementAt(sql, semi + 2), two);
  assert.deepEqual(statementAt(sql, semi + 3), two);
  assert.deepEqual(statementAt(sql, sql.length), two);
  assert.deepEqual(statementAt('select 1\n\n  ', 10), piece('select 1\n\n  ', 'select 1'));
});

test('statementAt: empty or blank text has no statement', () => {
  assert.equal(statementAt('', 0), null);
  assert.equal(statementAt('   \n\t\n  ', 0), null);
  assert.equal(statementAt('   \n\t\n  ', 4), null);
});

test('statementAt: the dialect option decides where a statement ends', () => {
  const sql = String.raw`select 'a\';b'; select 2`;
  const inString = sql.indexOf(';');

  assert.deepEqual(statementAt(sql, inString, MYSQL), piece(sql, String.raw`select 'a\';b'`));
  assert.deepEqual(statementAt(sql, inString), piece(sql, String.raw`select 'a\'`), 'pgsql does not take the backslash as an escape');

  const fn = 'create function f() returns int as $$ begin return 1; end; $$ language plpgsql; select 2';
  assert.deepEqual(statementAt(fn, fn.indexOf('return 1'), PGSQL), piece(fn, 'create function f() returns int as $$ begin return 1; end; $$ language plpgsql'));
});

// ------------------------------------------------------------ format

const bare = sql => sql.replace(/\s+/g, '');

// A line of the output, with at most closing parentheses after it: where the ) of a subquery goes is the formatter's choice.
function hasLine(out, text) {
  return out.split('\n').some(line => line.startsWith(text) && /^\)*$/.test(line.slice(text.length)));
}

test('format: columns go one per line, and each clause starts a line at the statement level', () => {
  assert.equal(format('select a, b from t where x = 1 and y = 2'), 'select\n  a,\n  b\nfrom t\nwhere x = 1\n  and y = 2');
});

test('format: group by, having, order by, limit and offset each start a line', () => {
  assert.equal(
    format('select a, count(*) from t where b > 1 group by a having count(*) > 1 order by a limit 10 offset 5'),
    'select\n  a,\n  count(*)\nfrom t\nwhere b > 1\ngroup by a\nhaving count(*) > 1\norder by a\nlimit 10\noffset 5',
  );
});

test('format: a clause is found in any case, and the case is kept as written', () => {
  assert.equal(format('SELECT a FROM t WHERE x = 1 AND y = 2 ORDER BY a'), 'SELECT\n  a\nFROM t\nWHERE x = 1\n  AND y = 2\nORDER BY a');
  assert.equal(format('select a from t where x = 1 and y = 2'), 'select\n  a\nfrom t\nwhere x = 1\n  and y = 2');
  assert.equal(format('Select Max(A), b From Tbl Where b = 1 Or c = 2'), 'Select\n  Max(A),\n  b\nFrom Tbl\nWhere b = 1\n  Or c = 2');
});

test('format: spaces or a line break inside group by and order by do not split them', () => {
  const out = format('select a from t group   by a order\nby a');

  assert.match(out, /^select\n {2}a\nfrom t\n/);
  assert.match(out, /^group[ \t]+by a$/m);
  assert.match(out, /^order[ \t]+by a$/m);
});

test('format: every kind of join starts a line, and its on stays with it', () => {
  const sql = 'select a from t inner join u on t.id = u.t_id left join v on v.id = u.v_id left outer join w on w.id = v.w_id '
    + 'right join x on x.id = w.x_id full join y on y.id = x.y_id cross join z join q on q.id = z.q_id where a = 1';

  assert.equal(format(sql), [
    'select',
    '  a',
    'from t',
    'inner join u on t.id = u.t_id',
    'left join v on v.id = u.v_id',
    'left outer join w on w.id = v.w_id',
    'right join x on x.id = w.x_id',
    'full join y on y.id = x.y_id',
    'cross join z',
    'join q on q.id = z.q_id',
    'where a = 1',
  ].join('\n'));
});

test('format: and and or start an indented line in on and having as well as where', () => {
  assert.equal(
    format('select a from t join u on t.id = u.t_id and u.x = 1 or u.y = 2 group by a having count(*) > 1 and sum(b) < 9'),
    'select\n  a\nfrom t\njoin u on t.id = u.t_id\n  and u.x = 1\n  or u.y = 2\ngroup by a\nhaving count(*) > 1\n  and sum(b) < 9',
  );
});

test('format: and and or break after any kind of join, not only a bare join', () => {
  assert.equal(
    format('select a from t inner join u on t.id = u.t_id and u.x = 1 left outer join v on v.id = u.v_id or v.y = 2'),
    'select\n  a\nfrom t\ninner join u on t.id = u.t_id\n  and u.x = 1\nleft outer join v on v.id = u.v_id\n  or v.y = 2',
  );
});

test('format: and and or inside plain parentheses stay on the line, only the top level breaks', () => {
  assert.equal(
    format('select a from t where (a = 1 and b = 2) or c in (1, 2) and d = coalesce(e, f)'),
    'select\n  a\nfrom t\nwhere (a = 1 and b = 2)\n  or c in (1, 2)\n  and d = coalesce(e, f)',
  );
});

test('format: the and of a between belongs to it and does not break the line, a later and does', () => {
  assert.equal(
    format('select a from t where x between 1 and 2 and y = 3'),
    'select\n  a\nfrom t\nwhere x between 1 and 2\n  and y = 3',
  );
  assert.equal(
    format('select a from t where a between 1 and 2 or b not between 3 and 4 and c = 5'),
    'select\n  a\nfrom t\nwhere a between 1 and 2\n  or b not between 3 and 4\n  and c = 5',
  );
  assert.equal(
    format('select a from t group by a having count(*) between 1 and 2 and sum(b) > 1'),
    'select\n  a\nfrom t\ngroup by a\nhaving count(*) between 1 and 2\n  and sum(b) > 1',
  );
  assert.equal(
    format('select a from t join u on u.x between 1 and 2 and u.y = 3'),
    'select\n  a\nfrom t\njoin u on u.x between 1 and 2\n  and u.y = 3',
  );
});

test('format: a between in the select list does not make the and of the where stay on the line', () => {
  assert.equal(
    format('select a between 1 and 2 as ok from t where b = 1 and c = 2'),
    'select\n  a between 1 and 2 as ok\nfrom t\nwhere b = 1\n  and c = 2',
  );
});

test('format: and outside where, having and on is just a word', () => {
  assert.equal(format('select a and b as ok from t'), 'select\n  a and b as ok\nfrom t');
});

test('format: a comma inside parentheses, a string or a quoted name does not split the columns', () => {
  assert.equal(
    format(`select coalesce(a, b), 'x, y', "p, q", f(g(1, 2), 3) as z from t`),
    `select\n  coalesce(a, b),\n  'x, y',\n  "p, q",\n  f(g(1, 2), 3) as z\nfrom t`,
  );
});

test('format: parentheses that are not a subquery stay inline, even with a clause word inside', () => {
  assert.equal(format('select a from t where x in (1, 2)'), 'select\n  a\nfrom t\nwhere x in (1, 2)');
  assert.equal(
    format('select row_number() over (partition by a order by b) as rn from t'),
    'select\n  row_number() over (partition by a order by b) as rn\nfrom t',
  );
});

test('format: a word that only contains a clause word, or sits in a string or a quoted name, starts no line', () => {
  assert.equal(
    format('select sorted_from, offset_x, set_a, values_b, limits from t'),
    'select\n  sorted_from,\n  offset_x,\n  set_a,\n  values_b,\n  limits\nfrom t',
  );
  assert.equal(format("select 'from where select' as x from t"), "select\n  'from where select' as x\nfrom t");
  assert.equal(format('select "order by", `group by` from t'), 'select\n  "order by",\n  `group by`\nfrom t');
});

test('format: a clause word after a dot is a column name, and starts no line', () => {
  assert.equal(
    format('select t.values, t.limit, t.set from t where t.offset = 1'),
    'select\n  t.values,\n  t.limit,\n  t.set\nfrom t\nwhere t.offset = 1',
  );
});

test('format: only the select list is split at its commas, group by and order by keep theirs on the line', () => {
  assert.equal(
    format('select a, b from t group by a, b order by a, b'),
    'select\n  a,\n  b\nfrom t\ngroup by a, b\norder by a, b',
  );
});

test('format: a subquery in where is laid out the same way, two more spaces in', () => {
  const out = format('select a from t where x in (select id from u where y = 1 and z = 2) order by a');

  assert.ok(hasLine(out, 'select'), out);
  assert.ok(hasLine(out, '  a'), out);
  assert.ok(hasLine(out, 'from t'), out);
  assert.ok(hasLine(out, 'where x in ('), out);
  assert.ok(hasLine(out, '  select'), out);
  assert.ok(hasLine(out, '    id'), out);
  assert.ok(hasLine(out, '  from u'), out);
  assert.ok(hasLine(out, '  where y = 1'), out);
  assert.ok(hasLine(out, '    and z = 2'), out);
  assert.ok(hasLine(out, 'order by a'), out, 'after the subquery the statement is back at its own level');
  assert.ok(out.indexOf('order by a') > out.indexOf('and z = 2'));
});

test('format: a subquery inside a subquery goes in two more spaces again', () => {
  const out = format('select a from t where x in (select id from u where y in (select z from v where w = 1)) and k = 2');

  assert.ok(hasLine(out, 'where x in ('), out);
  assert.ok(hasLine(out, '  select'), out);
  assert.ok(hasLine(out, '    id'), out);
  assert.ok(hasLine(out, '  from u'), out);
  assert.ok(hasLine(out, '  where y in ('), out);
  assert.ok(hasLine(out, '    select'), out);
  assert.ok(hasLine(out, '      z'), out);
  assert.ok(hasLine(out, '    from v'), out);
  assert.ok(hasLine(out, '    where w = 1'), out);
  assert.ok(hasLine(out, '  and k = 2'), out, 'the and after both subqueries is back at the top level');
});

test('format: a subquery in from is laid out too, and the clauses after it are at the statement level', () => {
  const out = format('select a from (select b from u) s where a = 1');

  assert.ok(hasLine(out, 'from ('), out);
  assert.ok(hasLine(out, '  select'), out);
  assert.ok(hasLine(out, '    b'), out);
  assert.ok(hasLine(out, '  from u'), out);
  assert.ok(hasLine(out, 'where a = 1'), out);
  assert.match(out, /\) s$/m, 'the alias stays after the closing parenthesis');
});

test('format: a with inside parentheses is a subquery too', () => {
  const out = format('select a from (with y as (select 1 as a) select a from y) s where a = 1');

  assert.ok(hasLine(out, 'from ('), out);
  assert.ok(hasLine(out, '  with y as ('), out);
  assert.ok(hasLine(out, '    select'), out);
  assert.ok(hasLine(out, '      1 as a'), out);
  assert.ok(hasLine(out, '  select'), out);
  assert.ok(hasLine(out, '    a'), out);
  assert.ok(hasLine(out, '  from y'), out);
  assert.ok(hasLine(out, 'where a = 1'), out);
  assert.match(out, /\) s$/m, out);
});

test('format: union and union all sit on their own line between two selects', () => {
  assert.equal(format('select a from t union all select b from u'), 'select\n  a\nfrom t\nunion all\nselect\n  b\nfrom u');
  assert.equal(format('select a from t union select b from u'), 'select\n  a\nfrom t\nunion\nselect\n  b\nfrom u');
});

test('format: insert, update and delete lay out their clauses', () => {
  assert.equal(format('insert into t (a, b) values (1, 2) returning id'), 'insert into t (a, b)\nvalues (1, 2)\nreturning id');
  assert.equal(format('insert into t (a) select b from u'), 'insert into t (a)\nselect\n  b\nfrom u');
  assert.equal(format('update t set a = 1 where id = 3 returning a'), 'update t\nset a = 1\nwhere id = 3\nreturning a');
  assert.equal(format('delete from t where id = 1 and x = 2 returning id'), 'delete from t\nwhere id = 1\n  and x = 2\nreturning id');
});

test('format: with starts the statement, its query is a subquery, and the main select is back at the left', () => {
  const lines = format('with x as (select a from t) select * from x').split('\n');

  assert.equal(lines[0], 'with x as (');
  assert.deepEqual(lines.slice(1, 4), ['  select', '    a', '  from t']);
  assert.deepEqual(lines.slice(-3), ['select', '  *', 'from x']);
});

test('format: insert, update and delete start a line after a with as well', () => {
  const after = (sql, count) => format(sql).split('\n').slice(-count);

  assert.deepEqual(after('with x as (select 1 as a) insert into t (a) select a from x', 4), ['insert into t (a)', 'select', '  a', 'from x']);
  assert.deepEqual(after('with x as (select 1 as a) update t set b = 1 from x where t.a = x.a', 4), ['update t', 'set b = 1', 'from x', 'where t.a = x.a']);
  assert.deepEqual(after('with x as (select 1 as a) delete from t using x where t.a = x.a', 2), ['delete from t using x', 'where t.a = x.a']);
});

test('format: several statements are separated by the semicolon and one blank line', () => {
  assert.equal(format('select a from t;select b from u ;'), 'select\n  a\nfrom t;\n\nselect\n  b\nfrom u;');
  assert.equal(format("select 'a;b' ; select 2;"), "select\n  'a;b';\n\nselect\n  2;");
});

test('format: a statement ends with a semicolon exactly when it had one', () => {
  assert.equal(format('select 1; select 2'), 'select\n  1;\n\nselect\n  2');
  assert.equal(format('select 1'), 'select\n  1');
  assert.equal(format('select 1;'), 'select\n  1;');
  assert.equal(format('select 1\n\n\n'), 'select\n  1');
});

test('format: the output has no space or line break at either end, and empty input gives an empty string', () => {
  assert.equal(format('\n\n  select 1 \n\n'), 'select\n  1');
  assert.equal(format(''), '');
  assert.equal(format('  \n\t '), '');
});

test('format: a line comment at the end of a statement does not swallow its semicolon', () => {
  const sql = 'select 1 -- note   here\n; select 2';
  const out = format(sql);

  assert.ok(out.includes('-- note   here\n'), out);
  assert.equal(texts(out).length, 2, 'the semicolon is still a semicolon');
  assert.equal(bare(out), bare(sql));
});

// A script that is a mess on purpose: odd spacing, a comment on a line of its own and one after code, strings,
// quoted names and a function body that all hold the words and marks the formatter looks for.
const LITERALS = [
  "'x;  select   from where'",
  '"odd ;  name"',
  '`back  ;tick`',
  "'it''s;   ok'",
  '/* block \n   with   select ;  */',
  '-- keep   this   ;  where   comment',
  '$fn$\n  BEGIN\n    SELECT   1 ;  \n   RETURN   1;\n  END;\n$fn$',
  "'multi\n   line  ;  from  string'",
  "'select  from   where'",
  "'x  y'",
];
const MESSY = [
  `  SELECT   a ,b,\n\n   ${LITERALS[0]}   AS   lit,`,
  `   ${LITERALS[1]}  ,${LITERALS[2]}   FROM   t   ${LITERALS[5]}`,
  `  WHERE a  =  ${LITERALS[3]}   ${LITERALS[4]}  AND b IN (1,2)  ;`,
  '',
  `CREATE   FUNCTION f()   RETURNS int AS ${LITERALS[6]} LANGUAGE plpgsql;`,
  `  insert into t (a) values (${LITERALS[7]})  ;`,
  `update t set a = ${LITERALS[8]} where id = $1 ;`,
  `   delete   from t where a = ${LITERALS[9]}   `,
].join('\n');

test('format: a messy script changes only whitespace, and strings, quoted names and comments come out exactly as they went in', () => {
  const out = format(MESSY);

  assert.equal(bare(out), bare(MESSY));
  for (const literal of LITERALS) assert.ok(out.includes(literal), `${JSON.stringify(literal)} should come out unchanged in\n${out}`);
  assert.ok(out.includes(`${LITERALS[5]}\n`), 'the comment still ends at the end of its line');
  assert.equal(statements(out).length, statements(MESSY).length);
  assert.ok(!out.endsWith(';'), 'the last statement had no semicolon');
  assert.equal(out, out.trim());
});

test('format: a comment in the middle of a statement ends its line, so what follows it is not in the comment', () => {
  const sql = 'select a from t where x = -- the   value\n 1 /* then */ + 2';
  const out = format(sql);

  assert.ok(out.includes('-- the   value\n'), out);
  assert.ok(out.includes('/* then */'), out);
  assert.equal(bare(out), bare(sql));
});

test('format: in mysql a # comment at the end of a statement does not swallow its semicolon either', () => {
  const sql = 'select 1 # note   here\n; select 2';
  const out = format(sql, MYSQL);

  assert.ok(out.includes('# note   here\n'), out);
  assert.equal(texts(out, MYSQL).length, 2);
});

test('format: in mysql the backslash and # rules hold inside strings and comments', () => {
  const comment = '# note   here';
  const string = String.raw`'a\';b   c'`;
  const sql = `select ${string} from t ${comment}\nwhere x = 1; select 2`;
  const out = format(sql, MYSQL);

  assert.ok(out.includes(string), out);
  assert.ok(out.includes(`${comment}\n`), out);
  assert.equal(bare(out), bare(sql));
  assert.equal(texts(out, MYSQL).length, 2);
});

test('format: the case of keywords and names is kept, and only whitespace is added or removed', () => {
  const sql = 'Select  Name , COUNT(*) as N FrOm  Users  Where Age >= 18 aNd  "Odd Name" = \'MiXed\' Group By Name';
  const out = format(sql);

  assert.equal(bare(out), bare(sql));
  assert.ok(out.includes('Select') && out.includes('FrOm') && out.includes('Where') && out.includes('aNd') && out.includes('Group By'), out);
  assert.match(out, /^FrOm Users$/m);
  assert.match(out, /^ {2}aNd "Odd Name" = 'MiXed'$/m);
});

test('format: laying out already laid out SQL changes nothing', () => {
  const inputs = [
    'select a, b from t where x = 1 and y = 2',
    'select a, count(*) from t join u on t.id = u.t_id and u.x = 1 where b > 1 group by a having count(*) > 1 order by a limit 10 offset 5',
    'select a from t where x in (select id from u where y in (select z from v where w = 1 or w = 2)) and k = 2',
    'select a from (select b from u) s where a = 1',
    'select a from t union all select b from u',
    'with x as (select a from t) select * from x',
    'insert into t (a, b) values (1, 2) returning id',
    'update t set a = 1 where id = 3 and b = 4',
    'delete from t where id = 1',
    "select 'a;b' ; select 2;select 3",
    'select 1 -- note   here\n; select 2',
    'select a /* inside   */ , b from t -- last',
    MESSY,
    '   \n  select   1  ',
    '',
  ];

  for (const sql of inputs) {
    const once = format(sql);
    assert.equal(format(once), once, `format twice differs for ${JSON.stringify(sql)}`);
  }

  const mysql = String.raw`select 'a\';b' from t # note` + '\nwhere x = 1';
  assert.equal(format(format(mysql, MYSQL), MYSQL), format(mysql, MYSQL));
});

// ------------------------------------------------------------ editableSource
//
// The gate for editing a result where it shows: a cell is saved as that column of that table, so
// anything that would make a result column something other than a stored column must give null.

const source = (schema, name, columns) => ({ schema, name, columns });

// Every text in the list is refused, and the failure lists all the ones that were not.
function refused(list, options) {
  const accepted = list.filter(sql => editableSource(sql, options) !== null);
  assert.deepEqual(accepted, [], 'these should not be editable');
}

test('editableSource: a select of plain columns from one table gives the table and the columns in order', () => {
  assert.deepEqual(editableSource('select a, b from t'), source(null, 't', ['a', 'b']));
  assert.deepEqual(editableSource('select b, a, b from t'), source(null, 't', ['b', 'a', 'b']));
  assert.deepEqual(editableSource('select a from s.t'), source('s', 't', ['a']));
});

test('editableSource: a star is a column called *, and so is t.*, and a qualified column is just its column', () => {
  assert.deepEqual(editableSource('select * from t'), source(null, 't', ['*']));
  assert.deepEqual(editableSource('select t.* from t'), source(null, 't', ['*']));
  assert.deepEqual(editableSource('select t.a, t.b from t'), source(null, 't', ['a', 'b']));
  assert.deepEqual(editableSource('select a, t.*, b from t'), source(null, 't', ['a', '*', 'b']));
  assert.deepEqual(editableSource('select x.a from s.t as x'), source('s', 't', ['a']));
});

test('editableSource: a semicolon at the end is fine', () => {
  assert.deepEqual(editableSource('select a from t;'), source(null, 't', ['a']));
  assert.deepEqual(editableSource('select a from t ;  \n'), source(null, 't', ['a']));
});

test('editableSource: where, order by, limit and offset may follow, in any case', () => {
  assert.deepEqual(editableSource('select a from t where b = 1 order by a limit 10 offset 5'), source(null, 't', ['a']));
  assert.deepEqual(editableSource('select a from t order by a'), source(null, 't', ['a']));
  assert.deepEqual(editableSource('select a from t limit 10'), source(null, 't', ['a']));
  assert.deepEqual(editableSource('select a from t offset 10'), source(null, 't', ['a']));
  assert.deepEqual(editableSource('SELECT a FROM t WHERE b = 1 ORDER BY a LIMIT 1 OFFSET 2'), source(null, 't', ['a']));
  assert.deepEqual(editableSource('Select * From s.t As x Where x.a = 1'), source('s', 't', ['*']));
});

test('editableSource: the table may have an alias, with or without as', () => {
  assert.deepEqual(editableSource('select x.a from t x'), source(null, 't', ['a']));
  assert.deepEqual(editableSource('select x.a from t as x where x.a = 1'), source(null, 't', ['a']));
  assert.deepEqual(editableSource('select x.a from t x order by x.a'), source(null, 't', ['a']));
  assert.deepEqual(editableSource('select a from s.t "my alias" where a = 1'), source('s', 't', ['a']));
});

test('editableSource: double-quoted names lose their quotes, and a doubled quote becomes one', () => {
  assert.deepEqual(editableSource('select "a b", "c""d" from "my ""odd"" table"'), source(null, 'my "odd" table', ['a b', 'c"d']));
  assert.deepEqual(editableSource('select "t"."a", "t".* from "my schema"."t"'), source('my schema', 't', ['a', '*']));
  assert.deepEqual(editableSource('select "from", "a.b" from "select"'), source(null, 'select', ['from', 'a.b']));
  assert.deepEqual(editableSource('select "x" from "t" "alias"'), source(null, 't', ['x']));
});

test('editableSource: backtick names lose their quotes, and a doubled backtick becomes one, in both dialects', () => {
  for (const options of [undefined, PGSQL, MYSQL]) {
    assert.deepEqual(editableSource('select `a b`, `c``d` from `db x`.`my``t`', options), source('db x', 'my`t', ['a b', 'c`d']));
    assert.deepEqual(editableSource('select `t`.`a`, `t`.* from `t`', options), source(null, 't', ['a', '*']));
  }
});

test('editableSource: whitespace, line breaks and comments anywhere are ignored', () => {
  const expected = source('s', 't', ['a', 'b']);

  assert.deepEqual(editableSource('select\n\ta, -- first\n\tb /* second */\nfrom /* x */ s.t /* y */ as /* z */ x -- tail\nwhere a = 1'), expected);
  assert.deepEqual(editableSource('/* lead */ select a /* c */ , /* c */ b from s.t'), expected);
  assert.deepEqual(editableSource('-- lead\nselect a, b from s.t'), expected);
  assert.deepEqual(editableSource('select a, b from s.t # note', MYSQL), expected);
});

test('editableSource: a comment after the semicolon, or on a line of its own around the select, does not make a second statement', () => {
  const expected = source(null, 't', ['a']);

  assert.deepEqual(editableSource('select a from t; -- done'), expected);
  assert.deepEqual(editableSource('select a from t;\n/* more\nlater */'), expected);
  assert.deepEqual(editableSource('-- first\nselect a from t;\n-- or this one\n'), expected);
  assert.deepEqual(editableSource('select a from t; # done', MYSQL), expected);
});

test('editableSource: a keyword in a comment, a string or a quoted name changes nothing', () => {
  const expected = source(null, 't', ['a']);

  assert.deepEqual(editableSource('select a from t -- join u\n'), expected);
  assert.deepEqual(editableSource('select a from t /* group by a */'), expected);
  assert.deepEqual(editableSource('select a from t where b = 1 -- union select 1'), expected);
  assert.deepEqual(editableSource("select a from t where b = 'a; join u union select 1'"), expected);
  assert.deepEqual(editableSource("select a from t where \"group\" = 1 and c = 'order by' and d = 'for update'"), expected);
  assert.deepEqual(editableSource('select a from t where b = $$ union select 1; group by $$'), expected);
  assert.deepEqual(editableSource('select "union" from "join"'), source(null, 'join', ['union']));
});

test('editableSource: a subquery in where is fine, even with a join, a union or a group by inside it', () => {
  const expected = source(null, 't', ['a']);

  assert.deepEqual(editableSource('select a from t where id in (select id from u)'), expected);
  assert.deepEqual(editableSource('select a from t where id in (select id from u union select id from v)'), expected);
  assert.deepEqual(editableSource('select a from t where id in (select id from u join v on u.x = v.x group by id having count(*) > 1)'), expected);
  assert.deepEqual(editableSource('select a from t where exists (select 1 from u where u.t_id = t.id) order by a'), expected);
  assert.deepEqual(editableSource('select a from t where id in (select id from u intersect (select id from v except select id from w)) limit 5'), expected);
});

test('editableSource: a laid out query is as editable as the same query on one line', () => {
  for (const sql of [
    'select a, b from s.t x where a = 1 and b in (select id from u) order by a limit 5',
    'select * from t',
    'select a from t where b = 1 -- note\n',
  ]) {
    assert.deepEqual(editableSource(format(sql)), editableSource(sql));
    assert.notEqual(editableSource(sql), null);
  }
  for (const sql of ['select count(*) from t', 'select a from t join u on t.id = u.id']) {
    assert.equal(editableSource(format(sql)), null);
  }
});

test('editableSource: more than one statement is refused', () => {
  refused([
    'select a from t; select b from t',
    'select a from t;\nselect a from t',
    'select a from t; delete from t',
    'select a from t where b = 1; update t set a = 1',
    'select a from t;select a from t;',
  ]);
});

test('editableSource: anything that is not a select is refused, and so is nothing at all', () => {
  refused([
    'update t set a = 1',
    'insert into t (a) values (1)',
    'insert into t select a from u',
    'delete from t where a = 1',
    'with x as (select a from t) select a from x',
    'with x as (select 1) select a from t',
    '(select a from t)',
    'explain select a from t',
    'table t',
    'values (1)',
    'show tables',
    'create table x as select a from t',
    'delete a from t',
    'delete t from t where b = 1',
    'show columns from t',
    'show index from t',
    'show tables from s',
    'selecta from t',
    '',
    '   \n',
    ';',
    '-- only a comment',
    '/* only a comment */',
  ]);
});

test('editableSource: distinct, all and the other words that go before the columns are refused', () => {
  refused([
    'select distinct a from t',
    'select distinct a, b from t',
    'select distinct from t',
    'select distinct on (a) a, b from t',
    'select DISTINCT a from t',
    'select all a from t',
    'select distinctrow a from t',
    'select sql_calc_found_rows a from t',
  ]);
});

test('editableSource: a function, an operator, a literal or a cast is not a column and is refused', () => {
  refused([
    'select count(*) from t',
    'select a, count(*) from t',
    'select f(a) from t',
    'select t.f(a) from t',
    'select a + 1 from t',
    'select -a from t',
    'select a || b from t',
    'select (a) from t',
    'select a, (select 1) from t',
    "select 'x' from t",
    "select a, 'x' from t",
    'select 1 from t',
    'select a, 1 from t',
    'select 1.5 from t',
    'select 1e3 from t',
    'select 0x1F from t',
    "select date '2020-01-01' from t",
    "select interval '1 day' from t",
    'select a::text from t',
    'select cast(a as text) from t',
    'select a[1] from t',
    "select a->>'k' from t",
    'select a is null from t',
    'select not a from t',
    'select a collate "C" from t',
    'select case when a then 1 end from t',
    'select exists (select 1) from t',
    'select $$x$$ from t',
    'select $1 from t',
    'select ? from t',
    'select @v from t',
    'select :x from t',
  ]);
});

test('editableSource: null, true, false and the current_ words are values and not columns', () => {
  refused([
    'select null from t',
    'select a, null from t',
    'select true from t',
    'select false from t',
    'select current_date from t',
    'select current_timestamp from t',
    'select a, current_user from t',
  ]);
});

test('editableSource: a name with too many parts, or a star with something after it, is refused', () => {
  refused([
    'select s.t.a from s.t',
    'select a.b.c from t',
    'select d.s.t.a from t',
    'select t.*.a from t',
    'select a from d.s.t',
    'select "d"."s"."t".a from t',
  ]);
});

test('editableSource: an alias on a column is refused, with or without as', () => {
  refused([
    'select a as b from t',
    'select a b from t',
    'select a, b c from t',
    'select t.a x from t',
    'select a as "b" from t',
    'select "a" "b" from t',
    'select * as x from t',
  ]);
});

test('editableSource: a broken list of columns is refused', () => {
  refused([
    'select from t',
    'select a, from t',
    'select , a from t',
    'select a,, b from t',
    'select a b, c from t',
    'select t. from t',
    'select a',
    'select * ',
    'select',
  ]);
});

test('editableSource: a join of any kind, or a second table, is refused', () => {
  refused([
    'select a from t join u on t.id = u.id',
    'select a from t x join u on x.id = u.id',
    'select a from t inner join u on t.id = u.id',
    'select a from t left join u on t.id = u.id',
    'select a from t left outer join u on t.id = u.id',
    'select a from t right join u on t.id = u.id',
    'select a from t full join u on t.id = u.id',
    'select a from t cross join u',
    'select a from t natural join u',
    'select a from t join u using (id)',
    'select a from t straight_join u',
    'select a from t, u',
    'select a from t,u',
    'select a from t x, u y where x.id = y.id',
    'select a from t, u where t.id = u.id',
    'select a from (t join u on t.id = u.id)',
    'SELECT a FROM t JOIN u ON t.id = u.id',
    'SELECT a FROM t, u',
  ]);
});

test('editableSource: group by, having, union, intersect, except, into, for update and window at the top level are refused', () => {
  refused([
    'select a from t group by a',
    'select a from t where b = 1 group by a',
    'select a from t where b = 1 order by a group by a',
    'select a from t having a > 1',
    'select a from t where b = 1 having count(*) > 1',
    'select a from t union select a from u',
    'select a from t union all select a from u',
    'select a from t where b = 1 union select a from u',
    'select a from t intersect select a from u',
    'select a from t where b = 1 intersect select a from u',
    'select a from t except select a from u',
    'select a from t where b = 1 except select a from u',
    'select a from t order by a limit 1 union select a from u',
    'select a from t where id in (select id from u) group by a',
    'select a from t where id in (select id from u) union select id from v',
    'select a from t where id in (select id from u) for update',
    'select a from t where (b = 1) union select 1',
    'select a into x from t',
    "select a from t into outfile 'f'",
    'select a from t where b = 1 into @v',
    'select a from t for update',
    'select a from t where b = 1 for update',
    'select a from t where b = 1 order by a limit 1 for update',
    'select a from t where b = 1 for share',
    'select a from t window w as (order by a)',
    'select a from t where b = 1 window w as (partition by a)',
    'SELECT a FROM t GROUP BY a',
    'SELECT a FROM t UNION SELECT a FROM u',
    'SELECT a FROM t WHERE b = 1 FOR UPDATE',
    'Select a From t Where b = 1 Intersect Select a From u',
  ]);
});

test('editableSource: a subquery, a function or anything but a plain table after from is refused', () => {
  refused([
    'select a from (select a from t) x',
    'select a from (select a from t) as x where a = 1',
    'select a from (select a from t)',
    'select a from lateral (select 1) x',
    'select a from generate_series(1, 3)',
    'select a from generate_series(1, 3) g',
    'select a from unnest(arr) as u(x)',
    'select a from (t)',
    'select a from only t',
    'select a from t tablesample system (10)',
    'select a from',
    'select a from t as',
    'select a from t x y',
    'select a from .t',
    'select a from t.',
    "select a from 'abc'",
    'select a from 1',
  ]);
});

test('editableSource: an unclosed quote, or a bracket without its partner, is refused', () => {
  refused([
    'select "a from t',
    'select a from "t',
    'select a from `t',
    "select a from t where b = 'x",
    'select a from t where (b = 1',
    'select a from t where b = 1) union (select 1',
    'select a from t where b = 1) union select 1',
  ]);
});

test('editableSource: a hidden second query in a string that pgsql and mysql close differently is refused where it is code', () => {
  const backslash = String.raw`select a from t where b = 'x\' union select 1, 2 --'`;
  assert.equal(editableSource(backslash), null, 'pgsql: the string ends at the backslash quote, so the union is code');
  assert.equal(editableSource(backslash, PGSQL), null);
  assert.deepEqual(editableSource(backslash, MYSQL), source(null, 't', ['a']), 'mysql: the backslash escapes the quote, so the union is inside the string');

  const hash = 'select a from t where b = 1 # union select 2';
  assert.equal(editableSource(hash), null, 'pgsql: # is an operator, so the union is code');
  assert.deepEqual(editableSource(hash, MYSQL), source(null, 't', ['a']), 'mysql: # starts a comment');

  const inString = String.raw`select a from t where b = 'it\'s; fine'`;
  assert.deepEqual(editableSource(inString, MYSQL), source(null, 't', ['a']), 'mysql: the ; is inside the string, so it is one statement');
  assert.equal(editableSource(inString), null, 'pgsql: the string ends at the backslash quote, so s; fine is a second statement');
  assert.deepEqual(editableSource('select a from t # note; more', MYSQL), source(null, 't', ['a']), 'mysql: the ; is inside the comment');
});

test('editableSource: in pgsql an E string ends only at an unescaped quote, so a union behind a backslash quote is code', () => {
  refused([
    String.raw`select a from t where b = E'\'' union select 1`,
    String.raw`select a from t where b = e'\'' union select 1`,
    String.raw`select a from t where b = E'x\'' intersect select 1`,
  ]);
});

test('editableSource: a mysql conditional comment is code, so a select that has one is refused', () => {
  refused([
    'select a /*!, b + 1 as c */ from t',
    'select a from t /*! join u on 1 = 1 */',
    'select a from t /*!50000 where b = 1 union select 1, 2 */',
    'select a /*M! , 1 */ from t',
  ], MYSQL);
  assert.deepEqual(editableSource('select a /*!, b + 1 as c */ from t'), source(null, 't', ['a']), 'pgsql: it is a comment like any other');
});

test('editableSource: in mysql a -- with no space after it is not a comment, so what follows it on the line is code', () => {
  const sql = 'select a from t where b = 1 --x union select 2, 3';

  assert.equal(editableSource(sql, MYSQL), null);
  assert.deepEqual(editableSource(sql), source(null, 't', ['a']), 'pgsql: -- always starts a comment');
  assert.deepEqual(editableSource('select a from t where b = 1 -- union select 2, 3', MYSQL), source(null, 't', ['a']));
});

test('editableSource: a double-quoted word in mysql is a string, so it is a value and not a column', () => {
  refused(['select "a" from t', 'select a, "b" from t', 'select "t"."a" from t'], MYSQL);
  assert.deepEqual(editableSource('select "a" from t', PGSQL), source(null, 't', ['a']), 'in pgsql it is a name');
});
