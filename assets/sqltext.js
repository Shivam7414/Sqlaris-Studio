// SQL as text, for the SQL tab: where one statement ends and the next
// begins, and a tidy layout of a query. Neither knows the database; they read
// the text only, so tests/sqltext.test.js runs them in Node without a page.
//
// Both rest on one tokenizer that knows strings, quoted names, comments and
// PostgreSQL's dollar quotes, so a ; or a keyword inside any of those is left
// alone.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DbvSql = api;
})(typeof self !== 'undefined' ? self : this, () => {
  'use strict';

  const WORD = /[A-Za-z0-9_\u0080-￿]/;
  const OPERATOR = /[<>=!+\-*/%|&^~:?@]/;

  // The text as tokens, each { type, text, from, to }. type is ws, word,
  // string (strings and quoted names), comment, line (a comment that runs to
  // the end of its line), punct (; , . ( and )) or op. An unclosed string or
  // comment runs to the end.
  // A token that runs to the end of the text without its closing mark is
  // marked open, so a caller that must be sure can refuse it.
  function tokenize(sql, dialect = 'pgsql') {
    const mysql = dialect === 'mysql';
    const out = [];
    let i = 0;
    let open = false;
    const push = (type, to) => { out.push({ type, text: sql.slice(i, to), from: i, to, open }); i = to; open = false; };
    const until = (end, from) => {
      const at = sql.indexOf(end, from);
      if (at < 0) open = true;
      return at < 0 ? sql.length : at + end.length;
    };
    // A quoted run from `start` that ends at the quote q. A doubled quote stays inside, and so does a backslash escape where it counts.
    const quoted = (q, backslash, start = i) => {
      let j = start + 1;
      while (j < sql.length) {
        if (backslash && sql[j] === '\\') j += 2;
        else if (sql[j] === q && sql[j + 1] === q) j += 2;
        else if (sql[j] === q) return j + 1;
        else j++;
      }
      open = true;
      return sql.length;
    };

    while (i < sql.length) {
      const c = sql[i];
      const two = sql.slice(i, i + 2);
      if (/\s/.test(c)) {
        let j = i;
        while (j < sql.length && /\s/.test(sql[j])) j++;
        push('ws', j);
      } else if ((two === '--' && (!mysql || i + 2 >= sql.length || /\s/.test(sql[i + 2]))) || (mysql && c === '#')) {
        // MySQL takes -- as a comment only with a space after it; --x is minus minus x.
        const end = sql.indexOf('\n', i);
        push('line', end < 0 ? sql.length : end);
      } else if (two === '/*') {
        push('comment', until('*/', i + 2));
      } else if (!mysql && (c === 'e' || c === 'E') && sql[i + 1] === "'" && !(i > 0 && WORD.test(sql[i - 1]))) {
        // PostgreSQL's E'...' string takes backslash escapes, so E'\'' is one quote.
        push('string', quoted("'", true, i + 1));
      } else if (c === "'") {
        push('string', quoted("'", mysql));
      } else if (c === '"') {
        push('string', quoted('"', mysql));
      } else if (c === '`') {
        push('string', quoted('`', false));
      } else if (c === '$' && !mysql && /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.test(sql.slice(i))) {
        const tag = sql.slice(i).match(/^\$([A-Za-z_][A-Za-z0-9_]*)?\$/)[0];
        push('string', until(tag, i + tag.length));
      } else if (WORD.test(c) || c === '$') {
        let j = i + 1;
        while (j < sql.length && (WORD.test(sql[j]) || sql[j] === '$')) j++;
        push('word', j);
      } else if (';,.()'.includes(c)) {
        push('punct', i + 1);
      } else if (OPERATOR.test(c)) {
        let j = i + 1;
        while (j < sql.length && OPERATOR.test(sql[j]) && sql.slice(j, j + 2) !== '--' && sql.slice(j, j + 2) !== '/*') j++;
        push('op', j);
      } else {
        push('op', i + 1);
      }
    }
    return out;
  }

  // Every statement with where its ; ends (end), and whether it had one.
  function split(sql, options = {}) {
    const out = [];
    let start = 0;
    const add = (stop, end, semi) => {
      const piece = sql.slice(start, stop);
      const text = piece.trim();
      if (text) {
        const from = start + (piece.length - piece.trimStart().length);
        out.push({ from, to: from + text.length, text, end, semi });
      }
    };
    for (const t of tokenize(sql, options.dialect)) {
      if (t.type === 'punct' && t.text === ';') {
        add(t.from, t.to, true);
        start = t.to;
      }
    }
    add(sql.length, sql.length, false);
    return out;
  }

  const statements = (sql, options) => split(sql, options).map(({ from, to, text }) => ({ from, to, text }));

  // The statement the cursor is in. Just after a ;, or further along that
  // line, still counts as the statement before; on a blank line between two,
  // the one below.
  function statementAt(sql, offset, options) {
    const list = split(sql, options);
    if (!list.length) return null;
    const pick = s => ({ from: s.from, to: s.to, text: s.text });
    // A cursor on a statement's own text wins over the line of the one before.
    const inside = list.find(s => offset >= s.from && offset <= s.to);
    if (inside) return pick(inside);
    for (const s of list) {
      if (offset > s.to && offset <= s.end) return pick(s);
      if (offset > s.end && /^[^\S\n]*$/.test(sql.slice(s.end, offset))) return pick(s);
    }
    return pick(list.find(s => s.from >= offset) || list[list.length - 1]);
  }

  // ------------------------------------------------------------------ format

  // The clauses that start a line, longest first so "left outer join" wins over "join".
  const CLAUSES = [
    'left outer join', 'right outer join', 'full outer join',
    'group by', 'order by', 'union all', 'insert into', 'delete from', 'inner join', 'left join', 'right join', 'full join', 'cross join',
    'select', 'from', 'where', 'having', 'limit', 'offset', 'union', 'values', 'update', 'set', 'returning', 'with', 'join',
  ].map(c => c.split(' '));
  const JOIN = /join$/;

  // A layout of the SQL that changes only spaces and line breaks: words keep
  // their case, and strings, names and comments stay exactly as written.
  function format(sql, options = {}) {
    return split(sql, options).map(s => {
      const body = formatOne(s.text, options.dialect);
      const tokens = tokenize(s.text, options.dialect).filter(t => t.type !== 'ws');
      // A ; after a line comment would be part of the comment, so it goes on a line of its own.
      const last = tokens[tokens.length - 1];
      return body + (s.semi ? (last && last.type === 'line' ? '\n;' : ';') : '');
    }).join('\n\n');
  }

  function formatOne(sql, dialect) {
    const all = tokenize(sql, dialect);
    const tokens = [];
    // Each token remembers whether whitespace came before it, which is kept as one space.
    let spaced = false;
    for (const t of all) {
      if (t.type === 'ws') spaced = true;
      else { tokens.push({ ...t, spaced, low: t.type === 'word' ? t.text.toLowerCase() : t.text }); spaced = false; }
    }

    const lines = [];
    let line = { indent: 0, text: '' };
    const newline = indent => {
      if (line.text) { lines.push(line); line = { indent, text: '' }; }
      else line.indent = indent;
    };
    const write = (text, space) => { line.text += (space && line.text ? ' ' : '') + text; };

    // Each level of parentheses: a subquery has clauses of its own; any other is written inline.
    const top = { indent: 0, clause: null, sub: true, between: false };
    const stack = [top];
    const ctx = () => stack[stack.length - 1];
    const clauseAt = i => {
      if (i > 0 && tokens[i - 1].text === '.') return null;
      return CLAUSES.find(words => words.every((w, k) => tokens[i + k] && tokens[i + k].low === w)) || null;
    };
    const firstWord = i => { const t = tokens[i]; return t && (t.low === 'select' || t.low === 'with'); };

    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      const c = ctx();
      let space = t.spaced;

      if (t.type === 'word' && c.sub) {
        const words = clauseAt(i);
        if (words) {
          newline(c.indent);
          write(tokens.slice(i, i + words.length).map(x => x.text).join(' '), false);
          i += words.length - 1;
          c.clause = JOIN.test(words[words.length - 1]) ? 'join' : words.join(' ');
          c.between = false;
          if (c.clause === 'select') newline(c.indent + 2);
          continue;
        }
        if (t.low === 'on' && c.clause === 'join') c.clause = 'on';
        if (t.low === 'between') c.between = true;
        if ((t.low === 'and' || t.low === 'or') && ['where', 'having', 'on'].includes(c.clause)) {
          if (t.low === 'and' && c.between) c.between = false;
          else { newline(c.indent + 2); space = false; }
        }
      }

      if (t.text === '(') {
        write(t.text, space);
        if (firstWord(i + 1)) {
          stack.push({ indent: line.indent + 2, clause: null, sub: true, between: false, base: line.indent });
          newline(line.indent + 2);
        } else {
          stack.push({ sub: false });
        }
      } else if (t.text === ')' && stack.length > 1) {
        const closed = stack.pop();
        if (closed.sub) { newline(closed.base); write(')', false); }
        else write(')', space);
      } else {
        write(t.text, space);
      }

      if (t.text === ',' && c.sub && c.clause === 'select') newline(c.indent + 2);
      // A line comment ends its line, or it would swallow what follows.
      if (t.type === 'line') newline(line.indent);
    }
    newline(0);
    return lines.map(l => ' '.repeat(l.indent) + l.text).join('\n');
  }

  // --------------------------------------------------------- editable result

  const unquote = text => {
    const q = text[0];
    return text.slice(1, -1).split(q + q).join(q);
  };

  // What follows the table in a query whose rows can still be edited.
  const AFTER = ['where', 'order', 'limit', 'offset'];
  // Anything here, outside parentheses, makes rows that are not one table's own.
  const NOT_PLAIN = ['union', 'intersect', 'except', 'group', 'having', 'into', 'for', 'window', 'join'];
  // Words that are SQL, not a column or table, when they stand bare.
  const RESERVED = new Set([
    'select', 'from', 'where', 'as', 'distinct', 'all', 'only', 'on', 'and', 'or', 'not', 'null', 'true', 'false', 'unknown',
    'default', 'case', 'when', 'then', 'else', 'end', 'cast', 'array', 'row', 'exists', 'interval', 'date', 'time', 'timestamp',
    'current_date', 'current_time', 'current_timestamp', 'current_user', 'current_role', 'current_schema', 'current_catalog',
    'session_user', 'user', 'localtime', 'localtimestamp', 'binary', 'lateral', 'values', 'table', 'with',
    ...AFTER, ...NOT_PLAIN,
  ]);

  // The one table a plain query reads: a select of bare columns or *, from
  // one table, with at most where, order by, limit and offset after it. Only
  // then is each cell of the result one stored value, so it can be edited
  // where it shows. Gives { schema, name, columns } with columns the names
  // or '*', or null for anything else.
  function editableSource(sql, options = {}) {
    const mysql = options.dialect === 'mysql';
    const all = tokenize(sql, options.dialect);
    // Anything left open, or a comment MySQL runs (/*! ... */), and the text is not what it looks like.
    if (all.some(x => x.open || (mysql && x.type === 'comment' && /^\/\*M?!/.test(x.text)))) return null;
    const isCode = x => !['ws', 'comment', 'line'].includes(x.type);
    // A piece after the last ; that is only comments is not a second statement.
    const list = split(sql, options).filter(s => tokenize(s.text, options.dialect).some(isCode));
    if (list.length !== 1) return null;
    const t = tokenize(list[0].text, options.dialect).filter(isCode);
    const low = x => (x && x.type === 'word' ? x.text.toLowerCase() : x ? x.text : null);
    // A bare word that is a name, not a number, a parameter or a word of SQL. In MySQL "..." is a string, not a name.
    const name = x => {
      if (!x) return null;
      // PostgreSQL folds a bare name to lower case: Users is the table users.
      if (x.type === 'word') return /^[0-9$]/.test(x.text) || RESERVED.has(x.text.toLowerCase()) ? null : mysql ? x.text : x.text.toLowerCase();
      if (x.type === 'string' && (x.text[0] === '`' || (x.text[0] === '"' && !mysql))) return x.text.length > 2 ? unquote(x.text) : null;
      return null;
    };
    let i = 0;
    if (low(t[i++]) !== 'select') return null;

    const columns = [];
    for (;;) {
      if (t[i] && t[i].text === '*') {
        columns.push('*');
        i++;
      } else {
        let n = name(t[i++]);
        if (n == null) return null;
        if (t[i] && t[i].text === '.') {
          i++;
          if (t[i] && t[i].text === '*') { n = '*'; i++; } else if ((n = name(t[i++])) == null) return null;
        }
        columns.push(n);
      }
      if (!t[i] || t[i].text !== ',') break;
      i++;
    }

    if (low(t[i++]) !== 'from') return null;
    let schema = null;
    let table = name(t[i++]);
    if (table == null) return null;
    if (t[i] && t[i].text === '.') {
      i++;
      schema = table;
      if ((table = name(t[i++])) == null) return null;
    }
    // An alias, with or without "as".
    if (low(t[i]) === 'as') {
      if (name(t[i + 1]) == null) return null;
      i += 2;
    } else if (name(t[i]) != null) {
      i++;
    }
    if (t[i] && !AFTER.includes(low(t[i]))) return null;

    let depth = 0;
    for (let j = i; j < t.length; j++) {
      if (t[j].text === '(') depth++;
      else if (t[j].text === ')' && --depth < 0) return null;
      else if (depth === 0 && NOT_PLAIN.includes(low(t[j]))) return null;
    }
    return depth === 0 ? { schema, name: table, columns } : null;
  }

  return { tokenize, statements, statementAt, format, editableSource };
});
