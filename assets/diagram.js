// The diagram of a whole database: every table as a box, every foreign key
// as a line from the column holding the key to the column it points at.
//
// The layouts are plain functions of the tables, so tests/diagram.test.js
// runs them in Node without a browser. mount() is the part that needs a
// page. It knows nothing about api.php or the rest of the viewer: the page
// hands it the tables and hears back through the callbacks it passes.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DbvDiagram = api;
})(typeof self !== 'undefined' ? self : this, () => {
  'use strict';

  // A box, in the diagram's own pixels. The .dg-node rules in app.css draw it to the same sizes.
  const W = 220;
  const HEAD = 36;
  const ROW = 22;
  const FOOT = 6;
  const BORDER = 1;

  const DETAILS = ['names', 'keys', 'all'];
  // In a view of some tables, a table can have keys and still none to the tables shown.
  const aloneLabel = model => (model.partial ? 'Unlinked tables' : 'Stand-alone tables');
  const aloneNote = model => (model.partial ? 'no keys to the tables shown' : 'no keys in or out');

  // ------------------------------------------------------------------ model

  const keyOf = (schema, name) => `${schema}.${name}`;

  // tables is the diagram action's answer. rows holds row counts by "schema.name".
  function buildModel(tables, rows = {}) {
    const nodes = tables.map((t, i) => ({
      key: keyOf(t.schema, t.name),
      schema: t.schema,
      name: t.name,
      kind: t.kind,
      columns: t.columns,
      pk: new Set(t.pk),
      fkCols: new Set(t.fks.flatMap(f => f.cols)),
      rows: rows[keyOf(t.schema, t.name)] ?? null,
      order: i,
      out: [],
      in: [],
      shown: [],
      h: BORDER * 2 + HEAD,
      x: 0,
      y: 0,
    }));
    const byKey = new Map(nodes.map(n => [n.key, n]));
    const links = [];
    tables.forEach((t, i) => {
      const from = nodes[i];
      for (const fk of t.fks) {
        const to = byKey.get(keyOf(fk.schema, fk.tbl));
        if (!to) continue;
        links.push({ from, to, name: fk.name, cols: fk.cols, refCols: fk.ref_cols, self: from === to });
        if (from === to) continue;
        if (!from.out.includes(to)) from.out.push(to);
        if (!to.in.includes(from)) to.in.push(from);
      }
    });
    // out and in change with the tables in view. allOut and allIn keep every link.
    for (const n of nodes) {
      n.allOut = n.out;
      n.allIn = n.in;
    }
    return { nodes, links, byKey, detail: null };
  }

  // ------------------------------------------------------------- the view
  //
  // A large database is never drawn whole: nobody can read a few hundred
  // tables at once. The diagram shows a set of tables, and grows it by
  // following their keys. The whole database is the set of every table.

  // Only the tables of keys, and the lines between them, as a model the
  // layouts take. Each table's out and in then hold only tables in view.
  function viewOf(full, keys) {
    const inView = new Set();
    for (const k of keys) if (full.byKey.has(k)) inView.add(full.byKey.get(k));
    for (const n of full.nodes) {
      n.out = n.allOut.filter(m => inView.has(m));
      n.in = n.allIn.filter(m => inView.has(m));
    }
    const nodes = full.nodes.filter(n => inView.has(n));
    return {
      nodes,
      links: full.links.filter(l => inView.has(l.from) && inView.has(l.to)),
      byKey: new Map(nodes.map(n => [n.key, n])),
      detail: full.detail,
      partial: nodes.length < full.nodes.length,
    };
  }

  const linkCount = n => n.allOut.length + n.allIn.length;
  const byLinks = (a, b) => linkCount(b) - linkCount(a) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

  // The tables most others point to, the natural places to start from.
  function hubs(full, count = 8) {
    return full.nodes.filter(n => linkCount(n))
      .sort((a, b) => b.allIn.length - a.allIn.length || byLinks(a, b))
      .slice(0, count);
  }

  // A table and the tables linked to it, the busiest first, up to most in
  // all. The tables it points to come before the ones pointing to it, since
  // there are few of them and they say what the table is.
  function around(full, key, most = 24) {
    const n = full.byKey.get(key);
    if (!n) return [];
    const out = [...n.allOut].sort(byLinks);
    const into = n.allIn.filter(m => !n.allOut.includes(m)).sort(byLinks);
    return [n, ...out, ...into].slice(0, most).map(m => m.key);
  }

  // The shortest chain of keys from one table to another, either way along
  // each key, as table keys from a to b. Null when none is up to most long.
  function pathBetween(full, a, b, most = 6) {
    const start = full.byKey.get(a);
    const end = full.byKey.get(b);
    if (!start || !end) return null;
    const back = new Map([[start, null]]);
    let edge = [start];
    for (let step = 0; step < most && edge.length && !back.has(end); step++) {
      const next = [];
      for (const n of edge) {
        for (const m of [...n.allOut, ...n.allIn]) {
          if (back.has(m)) continue;
          back.set(m, n);
          next.push(m);
        }
      }
      edge = next;
    }
    if (!back.has(end)) return null;
    const path = [];
    for (let n = end; n; n = back.get(n)) path.unshift(n.key);
    return path;
  }

  // Which columns each box shows at a detail level, and so how tall it is.
  function setDetail(model, detail) {
    model.detail = detail;
    for (const n of model.nodes) {
      n.shown = detail === 'names' ? []
        : detail === 'all' ? n.columns
          : n.columns.filter(c => n.pk.has(c.name) || n.fkCols.has(c.name));
      n.h = BORDER * 2 + HEAD + (n.shown.length ? n.shown.length * ROW + FOOT : 0);
    }
  }

  // Where a column's row sits inside its box. A column not shown uses the header.
  function rowY(n, col) {
    const i = n.shown.findIndex(c => c.name === col);
    return i < 0 ? BORDER + HEAD / 2 : BORDER + HEAD + i * ROW + ROW / 2;
  }

  // A table pointing only at itself counts as having no keys in or out.
  const isAlone = n => !n.out.length && !n.in.length;

  // ---------------------------------------------------------------- layouts

  // Moves a set of places so the top left box sits at 0, 0, and says how big they are together.
  function normalize(pos) {
    if (!pos.size) return { pos, w: 0, h: 0 };
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const [n, p] of pos) {
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x + W);
      y1 = Math.max(y1, p.y + n.h);
    }
    for (const p of pos.values()) {
      p.x -= x0;
      p.y -= y0;
    }
    return { pos, w: x1 - x0, h: y1 - y0 };
  }

  // Left to right: every table sits to the left of the tables it points to.
  // A table's rank is the longest chain of keys above it; a table that points
  // nowhere moves in to sit just right of the tables that point to it. Tables
  // in a rank are ordered to keep lines short, and a rank taller than maxH
  // wraps into lanes side by side.
  function flowOf(list, { gap = 150, lane = 40, vgap = 26, maxH = 1400 } = {}) {
    const inList = new Set(list);
    const up = n => n.out.filter(m => inList.has(m));
    const down = n => n.in.filter(m => inList.has(m));
    const near = n => [...up(n), ...down(n)];

    // A loop of keys is cut where the walk meets it again.
    const level = new Map();
    const walking = new Set();
    const levelOf = n => {
      if (level.has(n)) return level.get(n);
      if (walking.has(n)) return 0;
      walking.add(n);
      let l = 0;
      for (const m of up(n)) l = Math.max(l, levelOf(m) + 1);
      walking.delete(n);
      level.set(n, l);
      return l;
    };
    list.forEach(levelOf);
    const top = Math.max(0, ...level.values());
    const rank = new Map(list.map(n => [n, top - level.get(n)]));
    for (let pass = 0; pass < 3; pass++) {
      for (const n of list) {
        const kids = down(n);
        if (!up(n).length && kids.length) rank.set(n, Math.max(...kids.map(k => rank.get(k))) + 1);
      }
    }
    const ranks = [];
    for (const n of list) (ranks[rank.get(n)] ||= []).push(n);
    const columns = ranks.filter(Boolean);

    const y = new Map();
    const stack = col => {
      let at = 0;
      for (const n of col) {
        y.set(n, at + n.h / 2);
        at += n.h + vgap;
      }
      for (const n of col) y.set(n, y.get(n) - at / 2);
    };
    const pull = n => {
      const ns = near(n);
      return ns.length ? ns.reduce((sum, m) => sum + y.get(m), 0) / ns.length : y.get(n);
    };
    columns.forEach(stack);
    for (let sweep = 0; sweep < 14; sweep++) {
      for (const col of sweep % 2 ? [...columns].reverse() : columns) {
        const want = new Map(col.map(n => [n, pull(n)]));
        col.sort((a, b) => want.get(a) - want.get(b) || a.order - b.order);
        stack(col);
      }
    }

    const lanes = [];
    let x = 0;
    for (const col of columns) {
      const tall = col.reduce((sum, n) => sum + n.h + vgap, 0);
      const count = Math.min(col.length, Math.max(1, Math.ceil(tall / maxH)));
      const per = Math.ceil(col.length / count);
      for (let i = 0; i < col.length; i += per) {
        lanes.push({ x, nodes: col.slice(i, i + per) });
        x += W + lane;
      }
      x += gap - lane;
    }
    lanes.forEach(l => stack(l.nodes));

    // Each table slides toward the tables it is linked to. A lane is packed
    // from the top and from the bottom and the two averaged, so it keeps its
    // order and its gaps and drifts neither up nor down.
    for (let pass = 0; pass < 16; pass++) {
      for (const { nodes } of lanes) {
        const want = nodes.map(n => y.get(n) * 0.55 + pull(n) * 0.45 - n.h / 2);
        const fromTop = [];
        const fromBottom = [];
        let edge = -Infinity;
        nodes.forEach((n, i) => {
          fromTop[i] = Math.max(want[i], edge + vgap);
          edge = fromTop[i] + n.h;
        });
        edge = Infinity;
        for (let i = nodes.length - 1; i >= 0; i--) {
          fromBottom[i] = Math.min(want[i], edge - vgap - nodes[i].h);
          edge = fromBottom[i];
        }
        nodes.forEach((n, i) => y.set(n, (fromTop[i] + fromBottom[i]) / 2 + n.h / 2));
      }
    }

    const pos = new Map();
    for (const l of lanes) for (const n of l.nodes) pos.set(n, { x: l.x, y: y.get(n) - n.h / 2 });
    return normalize(pos);
  }

  // Tables with nothing to line up by, in rows of per.
  function gridOf(list, per, gap = 22) {
    const pos = new Map();
    let top = 0;
    for (let i = 0; i < list.length; i += per) {
      const row = list.slice(i, i + per);
      row.forEach((n, j) => pos.set(n, { x: j * (W + gap), y: top }));
      top += Math.max(...row.map(n => n.h)) + gap;
    }
    return normalize(pos);
  }

  // The flow of every table with a key in or out, and below it a box of the tables with none.
  function flow(model) {
    const alone = model.nodes.filter(isAlone);
    const main = flowOf(model.nodes.filter(n => !isAlone(n)));
    const pos = new Map(main.pos);
    const groups = [];
    if (alone.length) {
      const rest = gridOf(alone, 6);
      const top = main.pos.size ? main.h + 150 : 0;
      for (const [n, p] of rest.pos) pos.set(n, { x: p.x, y: p.y + top });
      groups.push({ label: aloneLabel(model), note: aloneNote(model), x: -28, y: top - 28, w: rest.w + 56, h: rest.h + 56 });
    }
    return { pos, groups };
  }

  // The first word of a table's name, with a plural folded, so companies and company_roles are one family.
  function familyOf(name) {
    const word = name.split('_')[0].toLowerCase();
    if (word.length > 4 && word.endsWith('ies')) return word.slice(0, -3) + 'y';
    if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
    return word;
  }

  // A family is named by the first word its own tables use most, as they
  // spell it. A table that only joined the family has no say.
  function labelOf(list, family) {
    const seen = new Map();
    for (const n of list) {
      const word = n.name.split('_')[0];
      if (familyOf(word) === family) seen.set(word, (seen.get(word) || 0) + 1);
    }
    return [...seen].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length || (a[0] < b[0] ? -1 : 1))[0][0];
  }

  // Tables grouped by the first word of their name. A table alone in its
  // family joins the family it shares most keys with. Each family is its own
  // small flow in a box, and the boxes are packed row by row.
  function families(model) {
    const home = new Map();
    const members = new Map();
    const join = (n, family) => {
      home.set(n, family);
      if (!members.has(family)) members.set(family, []);
      members.get(family).push(n);
    };
    const size = new Map();
    for (const n of model.nodes) size.set(familyOf(n.name), (size.get(familyOf(n.name)) || 0) + 1);
    for (const n of model.nodes) if (size.get(familyOf(n.name)) > 1) join(n, familyOf(n.name));
    for (let pass = 0; pass < 2; pass++) {
      for (const n of model.nodes) {
        if (home.has(n)) continue;
        const votes = new Map();
        for (const m of [...n.out, ...n.in]) {
          const family = home.get(m);
          if (family) votes.set(family, (votes.get(family) || 0) + 1);
        }
        const best = [...votes].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
        if (best) join(n, best[0]);
      }
    }
    const blocks = [...members].map(([family, list]) => ({ label: labelOf(list, family), list }));
    const rest = model.nodes.filter(n => !home.has(n));
    if (rest.some(n => !isAlone(n))) blocks.push({ label: 'Other tables', list: rest.filter(n => !isAlone(n)) });
    if (rest.some(isAlone)) blocks.push({ label: aloneLabel(model), list: rest.filter(isAlone) });

    const laid = blocks.map(b => {
      const linked = b.list.some(n => n.out.some(m => b.list.includes(m)));
      const box = linked ? flowOf(b.list, { gap: 90, vgap: 20 }) : gridOf(b.list, b.list.length > 4 ? 3 : 2);
      return { ...b, box, w: box.w + 56, h: box.h + 56 };
    }).sort((a, b) => b.w * b.h - a.w * a.h || (a.label < b.label ? -1 : 1));

    const area = laid.reduce((sum, b) => sum + b.w * b.h, 0);
    const wide = Math.max(Math.sqrt(area) * 1.7, ...laid.map(b => b.w));
    const pos = new Map();
    const groups = [];
    let x = 0;
    let y = 0;
    let rowH = 0;
    for (const b of laid) {
      if (x > 0 && x + b.w > wide) {
        x = 0;
        y += rowH + 90;
        rowH = 0;
      }
      for (const [n, p] of b.box.pos) pos.set(n, { x: x + 28 + p.x, y: y + 28 + p.y });
      groups.push({ label: b.label, note: `${b.list.length} ${b.list.length === 1 ? 'table' : 'tables'}`, x, y, w: b.w, h: b.h });
      x += b.w + 60;
      rowH = Math.max(rowH, b.h);
    }
    return { pos, groups };
  }

  // Linked tables pull together and every table pushes the others away. The
  // run starts from fixed points on a spiral and takes a fixed number of
  // steps, so the same database always settles the same way. Boxes still
  // overlapping at the end are pushed apart.
  function constellation(model) {
    const nodes = model.nodes;
    const count = nodes.length;
    const turn = Math.PI * (3 - Math.sqrt(5));
    const p = nodes.map((n, i) => ({
      x: Math.cos(i * turn) * 60 * Math.sqrt(i + 1),
      y: Math.sin(i * turn) * 60 * Math.sqrt(i + 1),
      vx: 0,
      vy: 0,
    }));
    const index = new Map(nodes.map((n, i) => [n, i]));
    const springs = model.links.filter(l => !l.self).map(l => [index.get(l.from), index.get(l.to)]);
    const steps = count > 300 ? 200 : 420;
    for (let step = 0; step < steps; step++) {
      const heat = 1 - step / steps;
      for (let i = 0; i < count; i++) {
        for (let j = i + 1; j < count; j++) {
          const dx = p[j].x - p[i].x;
          const dy = p[j].y - p[i].y;
          const d2 = Math.max(dx * dx + dy * dy, 100);
          const d = Math.sqrt(d2);
          const f = (160000 / d2) * heat;
          p[i].vx -= (dx / d) * f;
          p[i].vy -= (dy / d) * f;
          p[j].vx += (dx / d) * f;
          p[j].vy += (dy / d) * f;
        }
      }
      for (const [a, b] of springs) {
        const dx = p[b].x - p[a].x;
        const dy = p[b].y - p[a].y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        const f = (d - 320) * 0.035 * heat;
        p[a].vx += (dx / d) * f;
        p[a].vy += (dy / d) * f;
        p[b].vx -= (dx / d) * f;
        p[b].vy -= (dy / d) * f;
      }
      for (const q of p) {
        q.vx -= q.x * 0.012 * heat;
        q.vy -= q.y * 0.012 * heat;
        q.x += q.vx;
        q.y += q.vy;
        q.vx *= 0.55;
        q.vy *= 0.55;
      }
    }
    const side = (a, b) => (a < b ? -1 : 1);
    for (let pass = 0; pass < 300; pass++) {
      let moved = false;
      for (let i = 0; i < count; i++) {
        for (let j = i + 1; j < count; j++) {
          const ox = W + 40 - Math.abs(p[i].x - p[j].x);
          const oy = (nodes[i].h + nodes[j].h) / 2 + 30 - Math.abs(p[i].y - p[j].y);
          if (ox <= 0 || oy <= 0) continue;
          moved = true;
          if (ox < oy) {
            const s = (side(p[i].x, p[j].x) * ox) / 2;
            p[i].x += s;
            p[j].x -= s;
          } else {
            const s = (side(p[i].y, p[j].y) * oy) / 2;
            p[i].y += s;
            p[j].y -= s;
          }
        }
      }
      if (!moved) break;
    }
    const pos = new Map(nodes.map((n, i) => [n, { x: p[i].x - W / 2, y: p[i].y - n.h / 2 }]));
    return { pos: normalize(pos).pos, groups: [] };
  }

  const LAYOUTS = { flow, families, constellation };

  // Places for tables added to a view that already has its places, so the
  // tables on screen stay where they are. The new ones stand in a column
  // beside the table they came from, on the side the flow would put them
  // (side 1 right, -1 left), centred on it, and as close as the column goes
  // without covering a table. A long column wraps into lanes. placed and the
  // result hold { x, y } by table.
  function placeBeside(placed, anchor, added, side, { gap = 150, lane = 40, vgap = 26, maxH = 1400 } = {}) {
    const at = placed.get(anchor);
    const pos = new Map();
    if (!at || !added.length) return pos;
    const tall = added.reduce((sum, n) => sum + n.h + vgap, 0);
    const per = Math.ceil(added.length / Math.max(1, Math.ceil(tall / maxH)));
    const boxes = [...placed].map(([n, p]) => ({ x: p.x, y: p.y, h: n.h }));
    let x = at.x + side * (W + gap);
    for (let i = 0; i < added.length; i += per) {
      const column = added.slice(i, i + per);
      const high = column.reduce((sum, n) => sum + n.h + vgap, -vgap);
      const top = at.y + anchor.h / 2 - high / 2;
      const covers = cx => boxes.some(b => b.x < cx + W + lane / 2 && cx < b.x + W + lane / 2 && b.y < top + high + vgap && top < b.y + b.h + vgap);
      for (let step = 0; step < 60 && covers(x); step++) x += side * (W + lane);
      let y = top;
      for (const n of column) {
        pos.set(n, { x, y });
        boxes.push({ x, y, h: n.h });
        y += n.h + vgap;
      }
      x += side * (W + lane);
    }
    return pos;
  }

  // Moves tables down, as little as it takes, until no two boxes overlap.
  // Boxes grow when the detail changes, and this keeps a view's own places.
  function settle(pos, gap = 20) {
    const order = [...pos.keys()].sort((a, b) => pos.get(a).y - pos.get(b).y || pos.get(a).x - pos.get(b).x);
    for (let i = 1; i < order.length; i++) {
      const a = order[i];
      const p = pos.get(a);
      for (let moved = true; moved;) {
        moved = false;
        for (let j = 0; j < i; j++) {
          const b = order[j];
          const q = pos.get(b);
          if (Math.abs(p.x - q.x) < W + gap && p.y < q.y + b.h + gap && q.y < p.y + a.h + gap) {
            p.y = q.y + b.h + gap;
            moved = true;
          }
        }
      }
    }
    return pos;
  }

  // Every box's place for one layout at one detail level, in the diagram's
  // own pixels, and the boxes drawn around groups of tables.
  function layout(model, name, detail) {
    setDetail(model, detail);
    return LAYOUTS[name](model);
  }

  // ------------------------------------------------------------------- page

  const SVG = 'http://www.w3.org/2000/svg';
  const numbers = new Intl.NumberFormat();
  const counted = (n, word) => `${numbers.format(n)} ${word}${n === 1 ? '' : 's'}`;
  const clamp01 = t => Math.min(1, Math.max(0, t));
  const easeInOut = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  // With reduced motion asked for, everything arrives in place instead of moving there.
  const still = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function svgEl(tag, cls) {
    const e = document.createElementNS(SVG, tag);
    if (cls) e.setAttribute('class', cls);
    return e;
  }

  // The drawings on the zoom buttons. Fixed markup, never data.
  const GLYPHS = {
    out: '<path d="M6 12h12"/>',
    in: '<path d="M12 6v12M6 12h12"/>',
    fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  };

  function glyph(name) {
    const svg = svgEl('svg', 'i');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = GLYPHS[name];
    return svg;
  }

  // The smooth zoom and pan van Wijk and Nuij describe, the one d3 uses: a
  // long move zooms out, travels and zooms back in. A view is [centre x,
  // centre y, width seen], in the diagram's own pixels.
  const cosh = v => (Math.exp(v) + Math.exp(-v)) / 2;
  const sinh = v => (Math.exp(v) - Math.exp(-v)) / 2;
  const tanh = v => sinh(v) / cosh(v);

  function zoomPath([ux0, uy0, w0], [ux1, uy1, w1]) {
    const rho = Math.SQRT2;
    const dx = ux1 - ux0;
    const dy = uy1 - uy0;
    const d2 = dx * dx + dy * dy;
    let at;
    let s;
    if (d2 < 1e-12) {
      s = Math.log(w1 / w0) / rho;
      at = t => [ux0 + t * dx, uy0 + t * dy, w0 * Math.exp(rho * t * s)];
    } else {
      const d1 = Math.sqrt(d2);
      const b0 = (w1 * w1 - w0 * w0 + 4 * d2) / (4 * w0 * d1);
      const b1 = (w1 * w1 - w0 * w0 - 4 * d2) / (4 * w1 * d1);
      const r0 = Math.log(Math.sqrt(b0 * b0 + 1) - b0);
      const r1 = Math.log(Math.sqrt(b1 * b1 + 1) - b1);
      s = (r1 - r0) / rho;
      at = t => {
        const u = (w0 / (2 * d1)) * (cosh(r0) * tanh(rho * t * s + r0) - sinh(r0));
        return [ux0 + u * dx, uy0 + u * dy, (w0 * cosh(r0)) / cosh(rho * t * s + r0)];
      };
    }
    at.duration = Math.abs(s) * 1000;
    return at;
  }

  // More tables than this behind one "+" and the page is asked which to show.
  const PICK_OVER = 20;

  // Draws the diagram into host, which must be on the page already, and
  // returns the handle the page drives it with. opts:
  //   rows        row counts by "schema.name", from the tables action
  //   saved       what this browser remembered, as onChange gives it
  //   homeSchema  the schema whose tables go by their bare name
  //   focus       a table key to open with in focus
  //   onOpen(t)   a table was double-clicked, as { schema, name }
  //   onFocus(k)  the table in focus changed, or null
  //   onChange(s) anything worth keeping changed. s is { layout, detail,
  //               tables, at, arranged }: tables the keys shown, or null for
  //               every table; at where each shown table sits, as [x, y];
  //               arranged whether those are still the layout's own places.
  //   onPick(p)   more than PICK_OVER tables wait behind a "+". p is { title,
  //               choices: [{ key, label, links }], anchor }, and the answer
  //               is a promise of the keys to show, or null.
  function mount(host, tables, opts = {}) {
    const full = buildModel(tables, opts.rows || {});
    const given = opts.saved || {};
    const saved = {
      layout: LAYOUTS[given.layout] ? given.layout : 'flow',
      detail: DETAILS.includes(given.detail) ? given.detail : 'keys',
      tables: Array.isArray(given.tables) ? given.tables.filter(k => full.byKey.has(k)) : null,
      at: given.at && typeof given.at === 'object' ? { ...given.at } : {},
      arranged: given.arranged !== false,
    };
    // Before views, a browser kept only the tables dragged, by layout. They
    // go over the layout's places once, and are then kept the new way.
    const dragged = !given.at && given.positions && given.positions[saved.layout];
    let model = viewOf(full, saved.tables || full.nodes.map(n => n.key));
    const label = n => (n.schema === opts.homeSchema ? n.name : n.key);

    // ---- the stage

    // The lines are drawn on one canvas the size of the screen, between the
    // group boxes and the tables, and drawn again each frame the camera
    // moves. As SVG, every zoom step made the browser style and paint every
    // line again, which froze the page on a large database.
    const stage = el('div', 'dg-stage');
    const dots = el('div', 'dg-dots');
    const ground = el('div', 'dg-world');
    const lines = el('canvas', 'dg-edges');
    const world = el('div', 'dg-world');
    const tip = el('div', 'dg-tip');
    const mini = el('canvas', 'dg-minimap');
    mini.title = 'Click to move there';
    const zoomLabel = el('span', 'dg-chip dg-zoom');
    const button = (name, title, run) => {
      const b = el('button', 'dg-btn');
      b.type = 'button';
      b.title = title;
      b.append(glyph(name));
      b.addEventListener('click', run);
      return b;
    };
    const info = el('div', 'dg-hud dg-hud-tl');
    function drawInfo() {
      if (!model.partial) {
        const alone = model.nodes.filter(isAlone).length;
        info.replaceChildren(...[
          el('span', 'dg-chip', counted(model.nodes.length, 'table')),
          el('span', 'dg-chip', model.links.length ? counted(model.links.length, 'foreign key') : 'No foreign keys in this database'),
          alone && model.links.length ? el('span', 'dg-chip', `${numbers.format(alone)} stand-alone`) : null,
        ].filter(Boolean));
        return;
      }
      info.replaceChildren(
        el('span', 'dg-chip', `${numbers.format(model.nodes.length)} of ${counted(full.nodes.length, 'table')}`),
        el('span', 'dg-chip', counted(model.links.length, 'foreign key')));
    }
    // The table in focus, and what can be done with it.
    const bar = el('div', 'dg-hud dg-hud-bl dg-bar');
    const controls = el('div', 'dg-hud dg-hud-tr');
    controls.append(
      button('out', 'Zoom out', () => zoomBy(1 / 1.4)),
      zoomLabel,
      button('in', 'Zoom in', () => zoomBy(1.4)),
      button('fit', 'Fit the tables shown', () => fit()));
    stage.append(dots, ground, lines, world, info, controls, bar, mini, tip);
    host.replaceChildren(stage);

    // ---- boxes and lines

    // A box is made the first time its table is shown, and kept for when it comes back.
    const nodeOf = new Map();
    function boxOf(n) {
      if (n.el) return n.el;
      const hub = n.allOut.length + n.allIn.length >= 3;
      n.el = el('div', 'dg-node' + (n.rows === 0 ? ' empty' : '') + (String(n.kind).includes('view') ? ' is-view' : '') + (hub ? ' hub' : ''));
      n.el.dataset.key = n.key;
      n.el.addEventListener('pointerenter', () => hover(n, true));
      n.el.addEventListener('pointerleave', () => hover(n, false));
      // The tables hidden behind this one: on the left the ones pointing to
      // it, on the right the ones it points to, where the flow would put them.
      n.more = {};
      for (const side of ['in', 'out']) {
        const b = el('button', `dg-more ${side}`);
        b.type = 'button';
        b.addEventListener('click', () => showHidden(n, side, b));
        n.more[side] = b;
      }
      nodeOf.set(n.el, n);
      return n.el;
    }

    const hiddenOf = (n, side) => (side === 'in' ? n.allIn : n.allOut).filter(m => !model.byKey.has(m.key));

    // Each "+" says how many linked tables are not shown yet.
    function drawMore() {
      for (const n of model.nodes) {
        for (const side of ['in', 'out']) {
          const count = hiddenOf(n, side).length;
          const b = n.more[side];
          b.hidden = !count;
          if (!count) continue;
          b.textContent = `+${numbers.format(count)}`;
          b.title = side === 'in'
            ? (count === 1 ? `Show the table that points to ${label(n)}` : `Show the ${numbers.format(count)} tables that point to ${label(n)}`)
            : (count === 1 ? `Show the table ${label(n)} points to` : `Show the ${numbers.format(count)} tables ${label(n)} points to`);
        }
      }
    }

    function drawNode(n) {
      n.drawn = saved.detail;
      const head = el('header');
      head.append(el('i'), el('b', null, label(n)), el('small', null, n.rows == null ? '' : counted(n.rows, 'row')));
      const parts = [head];
      if (n.shown.length) {
        const cols = el('div', 'dg-cols');
        for (const c of n.shown) {
          const row = el('div', 'dg-col');
          row.append(el('span', null, c.name));
          if (n.pk.has(c.name)) row.append(el('em', null, 'PK'));
          else if (n.fkCols.has(c.name)) row.append(el('em', 'fk', 'FK'));
          if (saved.detail === 'all') row.append(el('small', null, c.type));
          cols.append(row);
        }
        parts.push(cols);
      }
      // Zoomed out, the name wraps after its underscores onto a few large lines.
      const far = el('span', 'dg-far');
      label(n).split('_').forEach((part, i, all) => {
        far.append(i < all.length - 1 ? part + '_' : part);
        if (i < all.length - 1) far.append(el('wbr'));
      });
      parts.push(far, n.more.in, n.more.out);
      n.el.classList.toggle('bare', !n.shown.length);
      n.el.replaceChildren(...parts);
      n.el.style.setProperty('--fit', fitOf(n).toFixed(3));
    }

    // How large the zoomed out name may grow, as a multiple of its 12px, and
    // still sit inside its box. The name is tried on one line, then broken
    // after its underscores onto two, three and more, each way as evenly as it
    // goes. Without this a long name on a short box spills over its neighbours
    // and hides under them.
    let pen = null;
    function fitOf(n) {
      if (!pen) {
        pen = document.createElement('canvas').getContext('2d');
        const style = getComputedStyle(n.el.querySelector('.dg-far'));
        pen.font = `${style.fontWeight} 100px ${style.fontFamily}`;
      }
      const words = label(n).split('_').map((w, i, all) => (i < all.length - 1 ? w + '_' : w));
      const m = words.length;
      const roomW = W - BORDER * 2 - 12;
      const roomH = n.h - BORDER * 2 - 6;
      // span[i][j]: how wide words i to j - 1 are on one line, at 12px.
      const span = words.map((_, i) => {
        const row = [];
        let text = '';
        for (let j = i + 1; j <= m; j++) row[j] = pen.measureText(text += words[j - 1]).width * 0.12;
        return row;
      });
      // widest[j]: the narrowest the widest line can be with the first j words on the lines so far.
      let widest = [0, ...Array(m).fill(Infinity)];
      let best = 0;
      for (let lines = 1; lines <= m; lines++) {
        const next = Array(m + 1).fill(Infinity);
        for (let j = 1; j <= m; j++) {
          for (let i = lines - 1; i < j; i++) next[j] = Math.min(next[j], Math.max(widest[i], span[i][j]));
        }
        widest = next;
        best = Math.max(best, Math.min(roomW / widest[m], roomH / (lines * 12 * 1.05)));
      }
      return best * 0.95;
    }

    // The first sizes were measured before the page's font may have arrived.
    if (document.fonts) {
      document.fonts.ready.then(() => {
        if (stopped) return;
        pen = null;
        // A box not on screen is measured again when it next shows.
        for (const n of full.nodes) if (n.el) n.drawn = null;
        for (const n of model.nodes) drawNode(n);
      });
    }

    // A line is lit while the pointer is on it or on one of its tables, hot
    // while one of its tables is in focus, and drawn in from the time in at.
    for (const l of full.links) {
      l.lit = false;
      l.hot = false;
      l.at = -Infinity;
    }
    let overLine = null;
    let searching = false;

    function hover(n, on) {
      for (const l of model.links) if (l.from === n || l.to === n) l.lit = on;
      kick();
    }

    // A line leaves the side of its box that faces the table it points at, and
    // ends in an arrow. It comes back as a cubic curve from p0 to p3.
    function geometry(l) {
      const a = l.from;
      const b = l.to;
      if (l.self) {
        const x = a.x + W;
        const y1 = a.y + rowY(a, l.cols[0]);
        const y2 = a.y + rowY(a, l.refCols[0]);
        const bend = 34 + Math.abs(y2 - y1) * 0.15;
        return { p: [x, y1, x + bend, y1, x + bend, y2, x + 1, y2], dir: -1 };
      }
      const dir = b.x + W / 2 >= a.x + W / 2 ? 1 : -1;
      const x1 = dir > 0 ? a.x + W : a.x;
      const y1 = a.y + rowY(a, l.cols[0]);
      const x2 = dir > 0 ? b.x : b.x + W;
      const y2 = b.y + rowY(b, l.refCols[0]);
      const pull = Math.max(46, Math.abs(x2 - x1) / 2);
      return { p: [x1, y1, x1 + pull * dir, y1, x2 - pull * dir, y2, x2 - 2 * dir, y2], dir };
    }

    // Each line's curve and arrow as paths, how long it is, and the box it stays inside.
    function shapeEdges() {
      for (const l of model.links) {
        const { p, dir } = geometry(l);
        const [x0, y0, x1, y1, x2, y2, x3, y3] = p;
        // The arrow's tip sits half a pixel past the curve's end, pointing the way the line runs.
        const tx = x3 + 0.5 * dir;
        l.curve = new Path2D(`M${x0} ${y0} C${x1} ${y1}, ${x2} ${y2}, ${x3} ${y3}`);
        l.arrow = new Path2D(`M${tx - 6.5 * dir} ${y3 - 4.5} L${tx} ${y3} L${tx - 6.5 * dir} ${y3 + 4.5}`);
        // Halfway between the straight line and the control polygon is close enough for drawing it in.
        const chord = Math.hypot(x3 - x0, y3 - y0);
        const hull = Math.hypot(x1 - x0, y1 - y0) + Math.hypot(x2 - x1, y2 - y1) + Math.hypot(x3 - x2, y3 - y2);
        l.len = (chord + hull) / 2 + 12;
        // A cubic curve never leaves the box around its four points.
        l.box = {
          x0: Math.min(x0, x1, x2, x3) - 10,
          y0: Math.min(y0, y1, y2, y3) - 10,
          x1: Math.max(x0, x1, x2, x3) + 10,
          y1: Math.max(y0, y1, y2, y3) + 10,
        };
      }
    }

    // What the camera sees, in the diagram's own pixels.
    function viewBox() {
      const v = size();
      return { x0: -cam.x / cam.k, y0: -cam.y / cam.k, x1: (v.w - cam.x) / cam.k, y1: (v.h - cam.y) / cam.k };
    }
    const meets = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

    // The lines' canvas, scaled so its pixels are the screen's and its
    // drawing is in the diagram's own.
    function pen2d() {
      const ratio = devicePixelRatio || 1;
      const c = lines.getContext('2d');
      c.setTransform(ratio * cam.k, 0, 0, ratio * cam.k, ratio * cam.x, ratio * cam.y);
      return c;
    }

    // A line keeps about the same width on screen at any zoom, and thins out
    // when zoomed very far out. The lit and hot lines go over the others.
    function drawEdges(now) {
      const ratio = devicePixelRatio || 1;
      const v = size();
      if (lines.width !== Math.round(v.w * ratio) || lines.height !== Math.round(v.h * ratio)) {
        lines.width = Math.round(v.w * ratio);
        lines.height = Math.round(v.h * ratio);
      }
      const c = lines.getContext('2d');
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(0, 0, lines.width, lines.height);
      if (!model.links.length) return;
      paints();
      pen2d();
      const view = viewBox();
      const px = 1 / cam.k;
      const thin = Math.min(1, 2.6 * cam.k);
      const moving = !still();
      c.lineCap = 'round';
      c.lineJoin = 'round';
      for (const top of [false, true]) {
        for (const l of model.links) {
          const lit = l.lit || l.hot || l === overLine;
          if (lit !== top || !meets(l.box, view)) continue;
          const t = clamp01((now - l.at) / 900);
          if (t <= 0) continue;
          c.globalAlpha = searching || (focused && !l.hot) ? 0.07 : 1;
          c.strokeStyle = lit ? colors.accent : colors.edge;
          c.lineWidth = (lit ? 2 : 1.5) * thin * px;
          if (t < 1) {
            // Drawing itself in, easing out, from the table holding the key.
            const e = 1 - Math.pow(1 - t, 3);
            c.setLineDash([l.len * e, l.len]);
            c.stroke(l.curve);
            c.setLineDash([]);
            continue;
          }
          c.stroke(l.curve);
          c.stroke(l.arrow);
          // Dots run along a focused table's keys, in the direction they point.
          if (l.hot && moving && !searching) {
            c.strokeStyle = colors.flow;
            c.globalAlpha = 0.95;
            c.lineWidth = 2.2 * thin * px;
            c.setLineDash([0.1, 11]);
            c.lineDashOffset = -((now % 700) / 700) * 11.1;
            c.stroke(l.curve);
            c.setLineDash([]);
            c.lineDashOffset = 0;
          }
        }
      }
      c.globalAlpha = 1;
    }

    // The line under a point on the stage, lit and hot ones first, or null.
    function edgeAt(sx, sy) {
      if (!model.links.length || !model.links[0].box) return null;
      const ratio = devicePixelRatio || 1;
      const c = pen2d();
      const reach = 6 / cam.k;
      c.lineWidth = reach * 2;
      const wx = (sx - cam.x) / cam.k;
      const wy = (sy - cam.y) / cam.k;
      const spot = { x0: wx - reach, y0: wy - reach, x1: wx + reach, y1: wy + reach };
      const order = [...model.links].sort((a, b) => (b.lit || b.hot) - (a.lit || a.hot));
      // A line that came in since the last frame has no shape yet.
      return order.find(l => l.box && meets(l.box, spot) && c.isPointInStroke(l.curve, sx * ratio, sy * ratio)) || null;
    }

    function pointAt(e) {
      if (drag || e.target.closest('.dg-node, .dg-hud, .dg-minimap')) {
        if (overLine) {
          overLine = null;
          tip.classList.remove('on');
          stage.classList.remove('on-line');
          kick();
        }
        return;
      }
      const r = stage.getBoundingClientRect();
      const l = edgeAt(e.clientX - r.left, e.clientY - r.top);
      if (l !== overLine) {
        overLine = l;
        stage.classList.toggle('on-line', !!l);
        tip.classList.toggle('on', !!l);
        if (l) tip.textContent = `${label(l.from)}.${l.cols.join(', ')} to ${label(l.to)}.${l.refCols.join(', ')}`;
        kick();
      }
      if (l) tip.style.translate = `${e.clientX - r.left + 14}px ${e.clientY - r.top + 14}px`;
    }

    function placeNodes() {
      for (const n of model.nodes) n.el.style.translate = `${n.x}px ${n.y}px`;
    }

    // The colours the canvases draw with follow the page's theme. They are
    // read again whenever the pointer comes back.
    let colors = null;
    function paints() {
      if (colors) return;
      const probe = el('i');
      stage.append(probe);
      const read = token => {
        probe.style.color = `var(${token})`;
        return getComputedStyle(probe).color;
      };
      colors = { accent: read('--accent'), ink: read('--ink'), edge: read('--edge'), flow: read('--on-accent') };
      probe.remove();
    }

    // ---- camera

    const cam = { x: 0, y: 0, k: 1 };
    const size = () => ({ w: Math.max(1, stage.clientWidth), h: Math.max(1, stage.clientHeight) });

    // Only what changed is written, so a frame where the camera stands still costs nothing here.
    const shown = { x: NaN, y: NaN, k: NaN, inv: NaN };
    function applyCamera() {
      if (cam.x !== shown.x || cam.y !== shown.y || cam.k !== shown.k) {
        const move = `translate(${cam.x}px, ${cam.y}px) scale(${cam.k})`;
        world.style.transform = move;
        ground.style.transform = move;
        const step = 22 * cam.k;
        dots.style.backgroundSize = `${step}px ${step}px`;
        dots.style.backgroundPosition = `${cam.x}px ${cam.y}px`;
        zoomLabel.textContent = Math.round(cam.k * 100) + '%';
        world.classList.toggle('far', cam.k < 0.5);
        world.classList.toggle('farther', cam.k < 0.3);
        Object.assign(shown, cam);
      }
      // Far out, a box turns into a tile with its name large enough to read.
      // Further out, only the tables with three keys or more keep a name.
      // The names are sized again only in steps of a tenth, because each time
      // the browser lays out every one of them.
      const inv = 1 / cam.k;
      if (!(Math.abs(Math.log(inv / shown.inv)) < 0.1)) {
        shown.inv = inv;
        world.style.setProperty('--inv', inv.toFixed(3));
        ground.style.setProperty('--inv', inv.toFixed(3));
      }
    }

    // The box around some tables, at where they are going while they move.
    function bounds(list) {
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (const n of list) {
        const x = n.tx ?? n.x;
        const y = n.ty ?? n.y;
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x + W);
        y1 = Math.max(y1, y + n.h);
      }
      return { x0, y0, x1, y1 };
    }

    // The camera that fits a box on screen, clear of the minimap on the right.
    function fitView(b, pad = 60, most = 1.1) {
      if (!Number.isFinite(b.x0)) return { cx: 0, cy: 0, k: 1 };
      const v = size();
      const right = 200;
      const k = Math.max(0.12, Math.min((v.w - pad - right) / Math.max(1, b.x1 - b.x0), (v.h - pad * 2) / Math.max(1, b.y1 - b.y0), most));
      return { cx: (b.x0 + b.x1) / 2 + (right - pad) / 2 / k, cy: (b.y0 + b.y1) / 2, k };
    }

    let flight = null;
    let zoomGoal = null;

    function flyTo({ cx, cy, k }, min = 500, max = 1500) {
      const v = size();
      zoomGoal = null;
      if (still()) {
        flight = null;
        cam.k = k;
        cam.x = v.w / 2 - cx * k;
        cam.y = v.h / 2 - cy * k;
        kick();
        return;
      }
      const path = zoomPath([(v.w / 2 - cam.x) / cam.k, (v.h / 2 - cam.y) / cam.k, v.w / cam.k], [cx, cy, v.w / k]);
      const duration = Math.min(max, Math.max(min, path.duration * 0.8));
      const start = performance.now();
      const me = flight = {};
      kick(now => {
        if (flight !== me) return false;
        const t = clamp01((now - start) / duration);
        const [ux, uy, w] = path(easeInOut(t));
        cam.k = v.w / w;
        cam.x = v.w / 2 - ux * cam.k;
        cam.y = v.h / 2 - uy * cam.k;
        return t < 1;
      });
    }

    const fit = () => flyTo(fitView(bounds(model.nodes)));
    const zoomBy = f => {
      const v = size();
      flyTo({ cx: (v.w / 2 - cam.x) / cam.k, cy: (v.h / 2 - cam.y) / cam.k, k: Math.min(2.2, Math.max(0.12, cam.k * f)) }, 260, 420);
    };

    // ---- one animation loop, running only while something moves

    const tasks = new Set();
    let frame = 0;
    let dirty = true;
    let stopped = false;
    const observer = new ResizeObserver(() => kick());
    observer.observe(stage);

    function kick(task) {
      if (stopped) return;
      if (task) tasks.add(task);
      if (!frame) frame = requestAnimationFrame(tick);
    }

    function tick(now) {
      frame = 0;
      if (!stage.isConnected) {
        stop();
        return;
      }
      for (const task of [...tasks]) if (!task(now)) tasks.delete(task);
      applyCamera();
      if (dirty) {
        placeNodes();
        shapeEdges();
        dirty = false;
      }
      drawEdges(now);
      drawMinimap();
      if (tasks.size) frame = requestAnimationFrame(tick);
    }

    function stop() {
      stopped = true;
      tasks.clear();
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      observer.disconnect();
    }

    // ---- the tables shown, and where they sit

    let moving = null;
    let groupEls = [];

    // Where a shown table is, or where it is going while it moves.
    const placeOf = n => ({ x: n.tx ?? n.x, y: n.ty ?? n.y });
    const places = () => new Map(model.nodes.filter(n => n.placed).map(n => [n, placeOf(n)]));
    const keysShown = () => model.nodes.map(n => n.key);

    // Shows exactly the tables of keys. A table that leaves takes its box
    // and its place with it. One that arrives gets a box, not placed yet.
    function showSet(keys) {
      model = viewOf(full, keys);
      setDetail(model, saved.detail);
      // A box taken away under the pointer never hears it leave.
      for (const l of full.links) l.lit = false;
      const keep = new Set(model.nodes);
      for (const n of full.nodes) {
        if (keep.has(n)) {
          // On the page first: the name's size is measured with the font the page gives it.
          if (!boxOf(n).isConnected) world.append(n.el);
          if (n.drawn !== saved.detail) drawNode(n);
        } else if (n.el && n.el.isConnected) {
          n.el.remove();
          n.placed = false;
          n.tx = n.ty = undefined;
        }
      }
      saved.tables = model.partial ? keysShown() : null;
      for (const k of Object.keys(saved.at)) if (!model.byKey.has(k)) delete saved.at[k];
      if (focused && !keep.has(focused)) focus(null, { fly: false });
      else markFocus();
      search(query);
      drawMore();
      drawInfo();
      drawBar();
      dirty = true;
      kick();
    }

    // Moves every shown table to its place in pos, in a wave from left to
    // right; a table missing from pos stays where it is. A table not placed
    // before comes out from origin, or fades in where it belongs when there
    // is none. jump puts every table in place at once.
    function moveTo(pos, { jump = false, origin = null } = {}) {
      jump = jump || still();
      const arriving = [];
      for (const n of model.nodes) {
        const p = pos.get(n) || placeOf(n);
        if (!n.placed) {
          n.x = origin && !jump ? origin.x : p.x;
          n.y = origin && !jump ? origin.y : p.y;
          n.placed = true;
          arriving.push(n);
        }
        n.held = false;
        n.fx = n.x;
        n.fy = n.y;
        n.tx = p.x;
        n.ty = p.y;
        saved.at[n.key] = [Math.round(p.x), Math.round(p.y)];
      }
      const span = Math.max(1, ...model.nodes.map(n => n.fx));
      const start = performance.now();
      const me = moving = {};
      kick(now => {
        if (moving !== me) return false;
        let busy = false;
        for (const n of model.nodes) {
          if (n.held || n.tx === undefined) continue;
          const t = jump ? 1 : clamp01((now - start - (n.fx / span) * 220) / 1050);
          const e = easeInOut(t);
          n.x = n.fx + (n.tx - n.fx) * e;
          n.y = n.fy + (n.ty - n.fy) * e;
          if (t < 1) busy = true;
        }
        dirty = true;
        if (!busy) for (const n of model.nodes) n.tx = n.ty = undefined;
        return busy;
      });
      if (arriving.length && !jump) reveal(arriving, !origin);
    }

    // Lays out the shown tables again with the chosen layout.
    function arrange({ jump = false, origin = null } = {}) {
      const { pos, groups } = layout(model, saved.layout, saved.detail);
      moveTo(pos, { jump, origin });
      drawGroups(groups, jump || still());
      saved.arranged = true;
    }

    // Places for the shown tables that have none: the place this view saved
    // for them, else beside the placed table they share most keys with, else
    // in rows below everything. Null when no table has a place to go by.
    function placeRest() {
      const pos = new Map();
      for (const n of model.nodes) {
        const p = saved.at[n.key];
        if (!n.placed && Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])) pos.set(n, { x: p[0], y: p[1] });
      }
      const known = new Map([...places(), ...pos]);
      const rest = model.nodes.filter(n => !n.placed && !pos.has(n));
      if (!rest.length) return pos;
      if (!known.size) return null;
      const beside = new Map();
      const loose = [];
      for (const n of rest) {
        const anchor = [...n.allOut, ...n.allIn].filter(m => known.has(m)).sort(byLinks)[0];
        if (!anchor) {
          loose.push(n);
          continue;
        }
        const side = anchor.allIn.includes(n) ? -1 : 1;
        const key = `${anchor.key}\n${side}`;
        if (!beside.has(key)) beside.set(key, { anchor, side, list: [] });
        beside.get(key).list.push(n);
      }
      for (const { anchor, side, list } of beside.values()) {
        for (const [m, p] of placeBeside(known, anchor, list, side)) {
          pos.set(m, p);
          known.set(m, p);
        }
      }
      if (loose.length) {
        const b = bounds([...known.keys()].map(n => ({ x: known.get(n).x, y: known.get(n).y, h: n.h })));
        const row = gridOf(loose, 6);
        for (const [n, p] of row.pos) pos.set(n, { x: b.x0 + p.x, y: b.y1 + 120 + p.y });
      }
      return pos;
    }

    // Shows more tables and leaves the shown ones where they are. The new
    // ones stand beside from when it is given, else beside what links them.
    function addTables(keys, from = null) {
      const add = keys.map(k => full.byKey.get(k)).filter(n => n && !model.byKey.has(n.key));
      if (!add.length) return add;
      const empty = !model.nodes.length;
      showSet([...keysShown(), ...add.map(n => n.key)]);
      if (empty) {
        arrange({ jump: true });
        reveal(model.nodes, true);
        flyTo(fitView(bounds(model.nodes)));
        changed();
        return add;
      }
      clearGroups();
      let pos;
      if (from && from.placed) {
        const known = places();
        pos = new Map();
        const into = add.filter(n => from.allIn.includes(n));
        const onto = add.filter(n => !from.allIn.includes(n));
        for (const [list, side] of [[into, -1], [onto, 1]]) {
          for (const [m, p] of placeBeside(known, from, list, side)) {
            pos.set(m, p);
            known.set(m, p);
          }
        }
      } else {
        pos = placeRest() || new Map();
      }
      moveTo(pos, { origin: from && from.placed ? placeOf(from) : null });
      saved.arranged = false;
      // Pulls back far enough to show what came in, and never zooms in to do it.
      flyTo(fitView(bounds(from ? [from, ...add] : add), 90, cam.k));
      changed();
      return add;
    }

    function hideTables(keys) {
      const gone = new Set(keys);
      showSet(keysShown().filter(k => !gone.has(k)));
      clearGroups();
      saved.arranged = false;
      changed();
    }

    // Starts again from one table and the tables linked to it.
    function showAround(key) {
      const n = full.byKey.get(key);
      if (!n) return;
      const origin = n.placed ? placeOf(n) : null;
      showSet(around(full, key));
      arrange({ origin });
      changed();
      focus(key);
    }

    // The tables linked to a shown one and not shown yet: those pointing to
    // it (in), those it points to (out), or both. Past PICK_OVER, the page
    // asks which.
    function showHidden(n, side, anchor = null) {
      const list = side === 'both'
        ? [...new Set([...hiddenOf(n, 'out'), ...hiddenOf(n, 'in')])]
        : hiddenOf(n, side);
      if (!list.length) return;
      list.sort(byLinks);
      const add = keys => {
        if (keys && keys.length && !stopped) addTables(keys, n);
      };
      if (list.length <= PICK_OVER || !opts.onPick) {
        add(list.map(m => m.key));
        return;
      }
      const title = side === 'in' ? `Tables that point to ${label(n)}` : side === 'out' ? `Tables ${label(n)} points to` : `Tables linked to ${label(n)}`;
      Promise.resolve(opts.onPick({ title, choices: list.map(m => ({ key: m.key, label: label(m), links: linkCount(m) })), anchor: anchor || n.el }))
        .then(add);
    }

    // Shows the shortest chain of keys between two tables, each new table
    // beside the one before it, and lights the chain up for a moment.
    function showPath(a, b) {
      const path = pathBetween(full, a, b);
      if (!path) return false;
      const add = path.filter(k => !model.byKey.has(k));
      if (add.length) {
        showSet([...keysShown(), ...add]);
        clearGroups();
        const known = places();
        const pos = new Map();
        for (let i = 1; i < path.length; i++) {
          const m = full.byKey.get(path[i]);
          if (known.has(m)) continue;
          const prev = full.byKey.get(path[i - 1]);
          for (const [x, p] of placeBeside(known, prev, [m], prev.allIn.includes(m) ? -1 : 1)) {
            pos.set(x, p);
            known.set(x, p);
          }
        }
        moveTo(pos);
        saved.arranged = false;
        changed();
      }
      const chain = path.map(k => model.byKey.get(k));
      const steps = new Set(chain.slice(1).map((m, i) => `${chain[i].key}\n${m.key}`));
      const onChain = l => steps.has(`${l.from.key}\n${l.to.key}`) || steps.has(`${l.to.key}\n${l.from.key}`);
      focus(null, { fly: false });
      for (const m of chain) m.el.classList.add('match');
      for (const l of model.links) if (onChain(l)) l.lit = true;
      flyTo(fitView(bounds(chain), 90, 1.1));
      setTimeout(() => {
        for (const m of chain) m.el.classList.remove('match');
        for (const l of model.links) if (onChain(l)) l.lit = false;
        kick();
      }, 3200);
      return path;
    }

    function clearGroups() {
      drawGroups([], true);
    }

    function drawGroups(groups, jump) {
      for (const old of groupEls) {
        old.classList.add('gone');
        setTimeout(() => old.remove(), 400);
      }
      groupEls = groups.map(g => {
        const box = el('div', 'dg-group' + (jump ? '' : ' gone'));
        box.style.translate = `${g.x}px ${g.y}px`;
        box.style.width = g.w + 'px';
        box.style.height = g.h + 'px';
        const name = el('b', null, g.label);
        name.append(el('small', null, g.note));
        box.append(name);
        ground.append(box);
        if (!jump) setTimeout(() => box.classList.remove('gone'), 650);
        return box;
      });
    }

    // Tables arrive in a wave from left to right, fading in when fade, and
    // each line draws itself in once both its tables are there.
    function reveal(list, fade) {
      if (still() || !list.length) return;
      const b = bounds(list);
      const wide = Math.max(1, b.x1 - b.x0);
      const tall = Math.max(1, b.y1 - b.y0);
      const at = new Map(list.map(n => [n, 120 + (((n.tx ?? n.x) - b.x0) / wide) * 900 + (((n.ty ?? n.y) - b.y0) / tall) * 200]));
      if (fade) {
        for (const n of list) {
          n.el.classList.add('pre');
          setTimeout(() => n.el.classList.remove('pre'), at.get(n));
        }
      }
      const now = performance.now();
      let last = now;
      for (const l of model.links) {
        if (!at.has(l.from) && !at.has(l.to)) continue;
        l.at = now + Math.max(at.get(l.from) || 0, at.get(l.to) || 0) + 260;
        last = Math.max(last, l.at + 900);
      }
      kick(t => t < last);
    }

    // The focused table's bar: open it, show what links to it, keep only
    // it and its neighbours, find a path from it, or hide it.
    function drawBar() {
      const n = focused;
      bar.classList.toggle('on', !!n);
      if (!n) {
        bar.replaceChildren();
        return;
      }
      const act = (text, title, run, cls = 'btn small') => {
        const b = el('button', cls, text);
        b.type = 'button';
        b.title = title;
        b.addEventListener('click', run);
        return b;
      };
      const hidden = new Set([...hiddenOf(n, 'in'), ...hiddenOf(n, 'out')]).size;
      const near = new Set([n, ...n.out, ...n.in]);
      bar.replaceChildren(...[
        el('b', null, label(n)),
        act('Open table', 'Open the rows of this table', () => opts.onOpen && opts.onOpen({ schema: n.schema, name: n.name })),
        hidden ? act(`Show ${counted(hidden, 'linked table')}`, 'Show the tables linked to this one that are hidden', e => showHidden(n, 'both', e.currentTarget)) : null,
        model.nodes.length > near.size ? act('Hide the rest', 'Keep only this table and the tables linked to it', () => hideTables(model.nodes.filter(m => !near.has(m)).map(m => m.key))) : null,
        opts.onPick && full.nodes.length > 1 ? act('Path to...', 'Show the chain of keys from this table to another', e => pickPath(n, e.currentTarget)) : null,
        act('Hide', 'Take this table off the diagram', () => hideTables([n.key]), 'btn small ghost'),
      ].filter(Boolean));
    }

    function pickPath(n, anchor) {
      const choices = full.nodes.filter(m => m !== n).sort((a, b) => (label(a) < label(b) ? -1 : 1))
        .map(m => ({ key: m.key, label: label(m), links: linkCount(m) }));
      Promise.resolve(opts.onPick({ title: `Path from ${label(n)} to another table`, choices, anchor, one: true })).then(keys => {
        if (!keys || !keys.length || stopped) return;
        if (!showPath(n.key, keys[0]) && opts.onNote) {
          opts.onNote(`No chain of up to 6 keys joins ${label(n)} and ${label(full.byKey.get(keys[0]))}.`);
        }
      });
    }

    // ---- focus and search

    let focused = null;

    function focus(key, { fly = true } = {}) {
      if (stopped) return;
      const n = key ? model.byKey.get(key) || null : null;
      focused = n;
      markFocus();
      const near = n ? new Set([n, ...n.out, ...n.in]) : null;
      if (n && fly) flyTo(fitView(bounds([...near]), 90, 1.15));
      drawBar();
      if (opts.onFocus) opts.onFocus(n ? n.key : null);
      // The dots along its lines keep moving for as long as the table is in focus.
      kick(n && !still() ? () => focused === n : undefined);
    }

    // The focused table, the tables linked to it and their lines stand out.
    // Done again when tables come or go, so a table added beside it is lit too.
    function markFocus() {
      const n = focused;
      const near = n ? new Set([n, ...n.out, ...n.in]) : null;
      stage.classList.toggle('focusing', !!n);
      for (const m of model.nodes) {
        m.el.classList.toggle('focus', m === n);
        m.el.classList.toggle('lit', !!near && near.has(m) && m !== n);
      }
      for (const l of full.links) l.hot = !!n && (l.from === n || l.to === n);
    }

    let query = '';

    function search(text) {
      query = String(text || '');
      const q = query.trim().toLowerCase();
      searching = !!q;
      stage.classList.toggle('searching', searching);
      kick();
      let found = 0;
      for (const n of model.nodes) {
        const hit = !!q && label(n).toLowerCase().includes(q);
        n.el.classList.toggle('match', hit);
        if (hit) found++;
      }
      return found;
    }

    // The best match among every table of the database: the exact name,
    // then a name starting with the text, then one holding it. A shown table
    // wins over a hidden one that matches as well.
    function bestMatch(text) {
      const q = String(text || '').trim().toLowerCase();
      if (!q) return null;
      const names = [...model.nodes, ...full.nodes.filter(n => !model.byKey.has(n.key))].map(n => [n, label(n).toLowerCase()]);
      const hit = names.find(([, t]) => t === q) || names.find(([, t]) => t.startsWith(q)) || names.find(([, t]) => t.includes(q));
      return hit ? hit[0] : null;
    }

    // Flies to the best match. A hidden table is shown first: beside what
    // links it, or with its neighbours when nothing is shown yet.
    function searchGo(text) {
      const n = bestMatch(text);
      if (!n) return false;
      search('');
      if (!model.nodes.length) showAround(n.key);
      else {
        addTables([n.key]);
        focus(n.key);
      }
      return true;
    }

    // ---- pointer

    let drag = null;
    // The stage captures the pointer, so a double-click lands on the stage. This says which box it was.
    let pressed = null;

    stage.addEventListener('pointerdown', e => {
      pressed = null;
      if (e.button !== 0 || e.target.closest('.dg-hud, .dg-minimap, .dg-more')) return;
      const box = e.target.closest('.dg-node');
      pressed = box ? nodeOf.get(box) : null;
      flight = null;
      zoomGoal = null;
      drag = { node: pressed, x: e.clientX, y: e.clientY, moved: false, vx: 0, vy: 0, at: performance.now() };
      stage.setPointerCapture(e.pointerId);
    });

    stage.addEventListener('pointermove', e => {
      if (!drag) {
        pointAt(e);
        return;
      }
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 4) return;
      if (!drag.moved) {
        drag.moved = true;
        if (drag.node) {
          // A layout move still under way leaves this table where it is dropped.
          drag.node.held = true;
          drag.node.el.classList.add('dragging');
        } else {
          stage.classList.add('panning');
        }
      }
      drag.x = e.clientX;
      drag.y = e.clientY;
      const now = performance.now();
      if (drag.node) {
        drag.node.x += dx / cam.k;
        drag.node.y += dy / cam.k;
        dirty = true;
      } else {
        cam.x += dx;
        cam.y += dy;
        const dt = Math.max(1, now - drag.at);
        drag.vx = (dx / dt) * 16;
        drag.vy = (dy / dt) * 16;
      }
      drag.at = now;
      kick();
    });

    const release = () => {
      const d = drag;
      drag = null;
      stage.classList.remove('panning');
      if (d && d.node) d.node.el.classList.remove('dragging');
      return d;
    };

    stage.addEventListener('pointercancel', release);

    stage.addEventListener('pointerup', () => {
      const d = release();
      if (!d) return;
      if (!d.moved) {
        if (d.node) focus(focused === d.node ? null : d.node.key);
        else if (focused) focus(null, { fly: false });
        return;
      }
      if (d.node) {
        saved.at[d.node.key] = [Math.round(d.node.x), Math.round(d.node.y)];
        saved.arranged = false;
        changed();
        return;
      }
      // A pan let go while moving glides to a stop.
      if (!still() && Math.hypot(d.vx, d.vy) > 1 && performance.now() - d.at < 60) {
        let vx = d.vx;
        let vy = d.vy;
        kick(() => {
          if (drag) return false;
          cam.x += vx;
          cam.y += vy;
          vx *= 0.92;
          vy *= 0.92;
          return Math.hypot(vx, vy) > 0.2;
        });
      }
    });

    stage.addEventListener('dblclick', e => {
      if (e.target.closest('.dg-hud, .dg-minimap, .dg-more')) return;
      if (pressed && opts.onOpen) opts.onOpen({ schema: pressed.schema, name: pressed.name });
    });

    // The wheel zooms around the pointer, eased toward where the turns add up to.
    stage.addEventListener('wheel', e => {
      e.preventDefault();
      flight = null;
      const r = stage.getBoundingClientRect();
      const sx = e.clientX - r.left;
      const sy = e.clientY - r.top;
      const from = zoomGoal ? zoomGoal.k : cam.k;
      const k = Math.min(2.2, Math.max(0.12, from * Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.0018))));
      const idle = !zoomGoal;
      zoomGoal = { k, sx, sy, wx: (sx - cam.x) / cam.k, wy: (sy - cam.y) / cam.k };
      if (still()) {
        cam.k = k;
        cam.x = sx - zoomGoal.wx * k;
        cam.y = sy - zoomGoal.wy * k;
        zoomGoal = null;
        kick();
        return;
      }
      if (idle) {
        kick(() => {
          if (!zoomGoal) return false;
          cam.k += (zoomGoal.k - cam.k) * 0.22;
          cam.x = zoomGoal.sx - zoomGoal.wx * cam.k;
          cam.y = zoomGoal.sy - zoomGoal.wy * cam.k;
          if (Math.abs(zoomGoal.k - cam.k) < 0.0005) {
            zoomGoal = null;
            return false;
          }
          return true;
        });
      }
    }, { passive: false });

    // ---- minimap

    let map = null;

    function drawMinimap() {
      const ratio = devicePixelRatio || 1;
      const w = mini.clientWidth;
      const h = mini.clientHeight;
      if (!w) return;
      if (mini.width !== Math.round(w * ratio)) {
        mini.width = Math.round(w * ratio);
        mini.height = Math.round(h * ratio);
      }
      paints();
      const c = mini.getContext('2d');
      c.setTransform(ratio, 0, 0, ratio, 0, 0);
      c.clearRect(0, 0, w, h);
      if (!model.nodes.length) return;
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (const n of model.nodes) {
        x0 = Math.min(x0, n.x);
        y0 = Math.min(y0, n.y);
        x1 = Math.max(x1, n.x + W);
        y1 = Math.max(y1, n.y + n.h);
      }
      const s = Math.min((w - 20) / Math.max(1, x1 - x0), (h - 20) / Math.max(1, y1 - y0));
      const ox = (w - (x1 - x0) * s) / 2 - x0 * s;
      const oy = (h - (y1 - y0) * s) / 2 - y0 * s;
      map = { s, ox, oy };
      const near = focused ? new Set([focused, ...focused.out, ...focused.in]) : null;
      for (const n of model.nodes) {
        const lit = near && near.has(n);
        c.fillStyle = lit ? colors.accent : colors.ink;
        c.globalAlpha = near ? (lit ? 0.95 : 0.12) : 0.34;
        c.fillRect(ox + n.x * s, oy + n.y * s, Math.max(2, W * s), Math.max(1.5, n.h * s));
      }
      const v = size();
      c.globalAlpha = 1;
      c.strokeStyle = colors.accent;
      c.lineWidth = 1.5;
      c.strokeRect(ox + (-cam.x / cam.k) * s, oy + (-cam.y / cam.k) * s, (v.w / cam.k) * s, (v.h / cam.k) * s);
    }

    stage.addEventListener('pointerleave', () => {
      if (!overLine) return;
      overLine = null;
      tip.classList.remove('on');
      stage.classList.remove('on-line');
      kick();
    });

    stage.addEventListener('pointerenter', () => {
      colors = null;
      kick();
    });

    mini.addEventListener('pointerdown', e => {
      e.stopPropagation();
      if (!map) return;
      const r = mini.getBoundingClientRect();
      flyTo({ cx: (e.clientX - r.left - map.ox) / map.s, cy: (e.clientY - r.top - map.oy) / map.s, k: cam.k }, 350, 700);
    });

    // ---- first draw

    function changed() {
      if (opts.onChange) opts.onChange(JSON.parse(JSON.stringify(saved)));
    }

    // The view's own places when it has them, else the layout's.
    showSet(keysShown());
    const placed = saved.arranged ? null : placeRest();
    if (placed) moveTo(placed, { jump: true });
    else if (model.nodes.length) arrange({ jump: true });
    if (dragged && typeof dragged === 'object') {
      const pos = new Map();
      for (const [k, p] of Object.entries(dragged)) {
        const n = model.byKey.get(k);
        if (n && Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])) pos.set(n, { x: p[0], y: p[1] });
      }
      if (pos.size) {
        moveTo(pos, { jump: true });
        saved.arranged = false;
      }
      changed();
    }
    reveal(model.nodes, true);
    const start = opts.focus ? model.byKey.get(opts.focus) || null : null;
    const v = size();
    if (model.nodes.length) {
      // Every table shown when they fit at a zoom where names can be read.
      // Otherwise the busiest one, with the minimap showing the rest.
      let first = fitView(bounds(model.nodes));
      if (first.k < 0.4) {
        const busiest = model.nodes.reduce((a, b) => (b.out.length + b.in.length > a.out.length + a.in.length ? b : a));
        first = { cx: busiest.tx + W / 2, cy: busiest.ty + busiest.h / 2, k: 0.4 };
      }
      // It opens close in and pulls back while the tables arrive.
      cam.k = start || still() ? first.k : first.k * 1.8;
      cam.x = v.w / 2 - first.cx * cam.k;
      cam.y = v.h / 2 - first.cy * cam.k;
      if (start) setTimeout(() => focus(start.key), 350);
      else if (!still()) setTimeout(() => flyTo(first, 1600, 1600), 120);
    } else {
      cam.x = v.w / 2;
      cam.y = v.h / 2;
    }
    kick();
    // A table asked for that is not shown yet joins the tables shown, or
    // opens with its neighbours when there are none.
    if (opts.focus && !start && full.byKey.has(opts.focus)) {
      setTimeout(() => {
        if (stopped) return;
        if (!model.nodes.length) {
          showAround(opts.focus);
          return;
        }
        addTables([opts.focus]);
        focus(opts.focus);
      }, 0);
    }

    const validAt = at => Object.fromEntries(Object.entries(at && typeof at === 'object' ? at : {})
      .filter(([k, p]) => full.byKey.has(k) && Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])));

    return {
      focus: key => focus(key || null),
      focused: () => (focused ? focused.key : null),
      fit,
      search,
      searchGo,
      // How many tables are shown, and how many the database has.
      count: () => ({ shown: model.nodes.length, total: full.nodes.length }),
      setLayout(name) {
        if (!LAYOUTS[name] || name === saved.layout) return;
        saved.layout = name;
        focus(null, { fly: false });
        arrange();
        fit();
        changed();
      },
      setDetail(detail) {
        if (!DETAILS.includes(detail) || detail === saved.detail) return;
        saved.detail = detail;
        showSet(keysShown());
        // Places the layout gave are worked out again; places of the view's own only move down out of the way.
        if (saved.arranged) {
          arrange();
          fit();
        } else {
          moveTo(settle(places()));
        }
        changed();
      },
      arrange() {
        focus(null, { fly: false });
        arrange();
        fit();
        changed();
      },
      showAround,
      showAll() {
        showSet(full.nodes.map(n => n.key));
        arrange();
        fit();
        changed();
      },
      clear() {
        showSet([]);
        clearGroups();
        changed();
      },
      // What a saved view keeps.
      view: () => ({ tables: keysShown(), at: { ...saved.at }, layout: saved.layout, detail: saved.detail }),
      // Shows a saved view: its tables at its places, at its detail.
      openView(view) {
        if (DETAILS.includes(view.detail)) saved.detail = view.detail;
        if (LAYOUTS[view.layout]) saved.layout = view.layout;
        const at = validAt(view.at);
        showSet((view.tables || []).filter(k => full.byKey.has(k)));
        saved.at = { ...saved.at, ...at };
        const pos = placeRest() || new Map();
        for (const n of model.nodes) if (n.placed && at[n.key]) pos.set(n, { x: at[n.key][0], y: at[n.key][1] });
        if (model.nodes.length && !pos.size && !model.nodes.some(n => n.placed)) arrange();
        else moveTo(pos);
        saved.arranged = false;
        clearGroups();
        focus(null, { fly: false });
        flyTo(fitView(bounds(model.nodes)));
        changed();
      },
      destroy() {
        stop();
        host.replaceChildren();
      },
    };
  }

  return { buildModel, viewOf, hubs, around, pathBetween, placeBeside, settle, layout, mount, SIZES: { W, HEAD, ROW, FOOT, BORDER } };
});
