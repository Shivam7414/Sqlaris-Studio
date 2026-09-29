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
  const ALONE = 'Stand-alone tables';

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
    return { nodes, links, byKey, detail: null };
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
      groups.push({ label: ALONE, note: 'no keys in or out', x: -28, y: top - 28, w: rest.w + 56, h: rest.h + 56 });
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
    if (rest.some(isAlone)) blocks.push({ label: ALONE, list: rest.filter(isAlone) });

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

  // Draws the diagram into host, which must be on the page already, and
  // returns the handle the page drives it with. opts:
  //   rows        row counts by "schema.name", from the tables action
  //   saved       { layout, detail, positions } this browser remembered
  //   homeSchema  the schema whose tables go by their bare name
  //   focus       a table key to open with in focus
  //   onOpen(t)   a table was double-clicked, as { schema, name }
  //   onFocus(k)  the table in focus changed, or null
  //   onChange(s) the layout, the detail or a dragged position changed: the new saved
  function mount(host, tables, opts = {}) {
    const model = buildModel(tables, opts.rows || {});
    const saved = { layout: 'flow', detail: 'keys', positions: {}, ...(opts.saved || {}) };
    if (!LAYOUTS[saved.layout]) saved.layout = 'flow';
    if (!DETAILS.includes(saved.detail)) saved.detail = 'keys';
    const label = n => (n.schema === opts.homeSchema ? n.name : n.key);

    // ---- the stage

    const stage = el('div', 'dg-stage');
    const dots = el('div', 'dg-dots');
    const world = el('div', 'dg-world');
    const svg = svgEl('svg', 'dg-edges');
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
    const alone = model.nodes.filter(isAlone).length;
    const info = el('div', 'dg-hud dg-hud-tl');
    info.append(...[
      el('span', 'dg-chip', counted(model.nodes.length, 'table')),
      el('span', 'dg-chip', model.links.length ? counted(model.links.length, 'foreign key') : 'No foreign keys in this database'),
      alone && model.links.length ? el('span', 'dg-chip', `${numbers.format(alone)} stand-alone`) : null,
    ].filter(Boolean));
    const controls = el('div', 'dg-hud dg-hud-tr');
    controls.append(
      button('out', 'Zoom out', () => zoomBy(1 / 1.4)),
      zoomLabel,
      button('in', 'Zoom in', () => zoomBy(1.4)),
      button('fit', 'Fit every table', () => fit()));
    world.append(svg);
    stage.append(dots, world, info, controls, mini, tip);
    host.replaceChildren(stage);

    // ---- boxes and lines

    const nodeOf = new Map();
    for (const n of model.nodes) {
      const hub = n.out.length + n.in.length >= 3;
      n.el = el('div', 'dg-node' + (n.rows === 0 ? ' empty' : '') + (String(n.kind).includes('view') ? ' is-view' : '') + (hub ? ' hub' : ''));
      n.el.dataset.key = n.key;
      n.el.addEventListener('pointerenter', () => hover(n, true));
      n.el.addEventListener('pointerleave', () => hover(n, false));
      nodeOf.set(n.el, n);
      world.append(n.el);
    }

    function drawNode(n) {
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
          if (model.detail === 'all') row.append(el('small', null, c.type));
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
      parts.push(far);
      n.el.classList.toggle('bare', !n.shown.length);
      n.el.replaceChildren(...parts);
    }

    for (const l of model.links) {
      l.g = svgEl('g', 'dg-edge');
      l.hit = svgEl('path', 'hit');
      l.base = svgEl('path', 'base');
      l.base.setAttribute('pathLength', '1');
      l.flow = svgEl('path', 'flow');
      l.g.append(l.hit, l.base, l.flow);
      svg.append(l.g);
      l.hit.addEventListener('pointerenter', () => {
        tip.textContent = `${label(l.from)}.${l.cols.join(', ')} to ${label(l.to)}.${l.refCols.join(', ')}`;
        tip.classList.add('on');
      });
      l.hit.addEventListener('pointermove', e => {
        const r = stage.getBoundingClientRect();
        tip.style.translate = `${e.clientX - r.left + 14}px ${e.clientY - r.top + 14}px`;
      });
      l.hit.addEventListener('pointerleave', () => tip.classList.remove('on'));
    }

    function hover(n, on) {
      for (const l of model.links) if (l.from === n || l.to === n) l.g.classList.toggle('near', on);
    }

    // A line leaves the side of its box that faces the table it points at, and ends in an arrow.
    function geometry(l) {
      const a = l.from;
      const b = l.to;
      if (l.self) {
        const x = a.x + W;
        const y1 = a.y + rowY(a, l.cols[0]);
        const y2 = a.y + rowY(a, l.refCols[0]);
        const bend = 34 + Math.abs(y2 - y1) * 0.15;
        return {
          curve: `M${x} ${y1} C${x + bend} ${y1}, ${x + bend} ${y2}, ${x + 1} ${y2}`,
          arrow: `M${x + 7} ${y2 - 4.5} L${x + 1} ${y2} L${x + 7} ${y2 + 4.5}`,
        };
      }
      const dir = b.x + W / 2 >= a.x + W / 2 ? 1 : -1;
      const x1 = dir > 0 ? a.x + W : a.x;
      const y1 = a.y + rowY(a, l.cols[0]);
      const x2 = dir > 0 ? b.x : b.x + W;
      const y2 = b.y + rowY(b, l.refCols[0]);
      const pull = Math.max(46, Math.abs(x2 - x1) / 2);
      return {
        curve: `M${x1} ${y1} C${x1 + pull * dir} ${y1}, ${x2 - pull * dir} ${y2}, ${x2 - 2 * dir} ${y2}`,
        arrow: `M${x2 - 8 * dir} ${y2 - 4.5} L${x2 - 1.5 * dir} ${y2} L${x2 - 8 * dir} ${y2 + 4.5}`,
      };
    }

    function drawEdges() {
      for (const l of model.links) {
        const { curve, arrow } = geometry(l);
        l.hit.setAttribute('d', curve);
        l.flow.setAttribute('d', curve);
        l.base.setAttribute('d', `${curve} ${arrow}`);
      }
    }

    function placeNodes() {
      for (const n of model.nodes) n.el.style.translate = `${n.x}px ${n.y}px`;
    }

    // ---- camera

    const cam = { x: 0, y: 0, k: 1 };
    const size = () => ({ w: Math.max(1, stage.clientWidth), h: Math.max(1, stage.clientHeight) });

    function applyCamera() {
      world.style.transform = `translate(${cam.x}px, ${cam.y}px) scale(${cam.k})`;
      const step = 22 * cam.k;
      dots.style.backgroundSize = `${step}px ${step}px`;
      dots.style.backgroundPosition = `${cam.x}px ${cam.y}px`;
      zoomLabel.textContent = Math.round(cam.k * 100) + '%';
      // Far out, a box turns into a tile with its name large enough to read.
      // Further out, only the tables with three keys or more keep a name.
      world.style.setProperty('--inv', (1 / cam.k).toFixed(3));
      world.classList.toggle('far', cam.k < 0.5);
      world.classList.toggle('farther', cam.k < 0.3);
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
        drawEdges();
        dirty = false;
      }
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

    // ---- layouts

    let drawnDetail = null;
    let moving = null;
    let groupEls = [];

    // Works out the layout and moves every table to its place in a wave from
    // left to right. A table this browser dragged keeps its own place. first
    // puts them there at once.
    function arrange({ first = false } = {}) {
      const { pos, groups } = layout(model, saved.layout, saved.detail);
      if (drawnDetail !== saved.detail) {
        model.nodes.forEach(drawNode);
        drawnDetail = saved.detail;
      }
      const own = saved.positions[saved.layout] || {};
      for (const n of model.nodes) {
        const p = own[n.key] ? { x: own[n.key][0], y: own[n.key][1] } : pos.get(n);
        n.held = false;
        n.fx = n.x;
        n.fy = n.y;
        n.tx = p.x;
        n.ty = p.y;
      }
      const jump = first || still();
      const span = Math.max(1, ...model.nodes.map(n => n.fx));
      const start = performance.now();
      const me = moving = {};
      kick(now => {
        if (moving !== me) return false;
        let busy = false;
        for (const n of model.nodes) {
          if (n.held) continue;
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
      drawGroups(groups, jump);
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
        world.insertBefore(box, svg);
        if (!jump) setTimeout(() => box.classList.remove('gone'), 650);
        return box;
      });
    }

    // The tables arrive in a wave from left to right, and each line draws
    // itself in once both its tables are there.
    function reveal() {
      if (still()) {
        for (const l of model.links) l.g.classList.add('drawn');
        return;
      }
      const b = bounds(model.nodes);
      const wide = Math.max(1, b.x1 - b.x0);
      const tall = Math.max(1, b.y1 - b.y0);
      const at = new Map(model.nodes.map(n => [n, 120 + ((n.tx - b.x0) / wide) * 900 + ((n.ty - b.y0) / tall) * 200]));
      for (const n of model.nodes) {
        n.el.classList.add('pre');
        setTimeout(() => n.el.classList.remove('pre'), at.get(n));
      }
      for (const l of model.links) setTimeout(() => l.g.classList.add('drawn'), Math.max(at.get(l.from), at.get(l.to)) + 260);
    }

    // ---- focus and search

    let focused = null;

    function focus(key, { fly = true } = {}) {
      if (stopped) return;
      const n = key ? model.byKey.get(key) || null : null;
      focused = n;
      const near = n ? new Set([n, ...n.out, ...n.in]) : null;
      world.classList.toggle('focusing', !!n);
      for (const m of model.nodes) {
        m.el.classList.toggle('focus', m === n);
        m.el.classList.toggle('lit', !!near && near.has(m) && m !== n);
      }
      for (const l of model.links) {
        const hot = !!n && (l.from === n || l.to === n);
        l.g.classList.toggle('hot', hot);
        // A focused table's lines are drawn over the others.
        if (hot) svg.append(l.g);
      }
      if (n && fly) flyTo(fitView(bounds([...near]), 90, 1.15));
      if (opts.onFocus) opts.onFocus(n ? n.key : null);
      kick();
    }

    function search(text) {
      const q = String(text || '').trim().toLowerCase();
      world.classList.toggle('searching', !!q);
      let found = 0;
      for (const n of model.nodes) {
        const hit = !!q && label(n).toLowerCase().includes(q);
        n.el.classList.toggle('match', hit);
        if (hit) found++;
      }
      return found;
    }

    // Flies to the best match: the exact name, then a name starting with the text, then one holding it.
    function searchGo(text) {
      const q = String(text || '').trim().toLowerCase();
      if (!q) return false;
      const names = model.nodes.map(n => [n, label(n).toLowerCase()]);
      const hit = names.find(([, t]) => t === q) || names.find(([, t]) => t.startsWith(q)) || names.find(([, t]) => t.includes(q));
      if (!hit) return false;
      search('');
      focus(hit[0].key);
      return true;
    }

    // ---- pointer

    let drag = null;
    // The stage captures the pointer, so a double-click lands on the stage. This says which box it was.
    let pressed = null;

    stage.addEventListener('pointerdown', e => {
      pressed = null;
      if (e.button !== 0 || e.target.closest('.dg-hud, .dg-minimap')) return;
      const box = e.target.closest('.dg-node');
      pressed = box ? nodeOf.get(box) : null;
      flight = null;
      zoomGoal = null;
      drag = { node: pressed, x: e.clientX, y: e.clientY, moved: false, vx: 0, vy: 0, at: performance.now() };
      stage.setPointerCapture(e.pointerId);
    });

    stage.addEventListener('pointermove', e => {
      if (!drag) return;
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
        (saved.positions[saved.layout] ||= {})[d.node.key] = [Math.round(d.node.x), Math.round(d.node.y)];
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
      if (e.target.closest('.dg-hud, .dg-minimap')) return;
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

    let colors = null;
    let map = null;

    function drawMinimap() {
      const ratio = devicePixelRatio || 1;
      const w = mini.clientWidth;
      const h = mini.clientHeight;
      if (!w || !model.nodes.length) return;
      if (mini.width !== Math.round(w * ratio)) {
        mini.width = Math.round(w * ratio);
        mini.height = Math.round(h * ratio);
      }
      // The colours follow the page's theme. They are read again whenever the pointer comes back.
      if (!colors) {
        const probe = el('i');
        stage.append(probe);
        probe.style.color = 'var(--accent)';
        const accent = getComputedStyle(probe).color;
        probe.style.color = 'var(--ink)';
        const ink = getComputedStyle(probe).color;
        probe.remove();
        colors = { accent, ink };
      }
      const c = mini.getContext('2d');
      c.setTransform(ratio, 0, 0, ratio, 0, 0);
      c.clearRect(0, 0, w, h);
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

    arrange({ first: true });
    reveal();
    const start = opts.focus ? model.byKey.get(opts.focus) || null : null;
    // The whole database when it fits at a zoom where names can be read.
    // Otherwise the busiest table, with the minimap showing the rest.
    let first = fitView(bounds(model.nodes));
    if (first.k < 0.4) {
      const busiest = model.nodes.reduce((a, b) => (b.out.length + b.in.length > a.out.length + a.in.length ? b : a));
      first = { cx: busiest.tx + W / 2, cy: busiest.ty + busiest.h / 2, k: 0.4 };
    }
    const v = size();
    // It opens close in and pulls back while the tables arrive.
    cam.k = start || still() ? first.k : first.k * 1.8;
    cam.x = v.w / 2 - first.cx * cam.k;
    cam.y = v.h / 2 - first.cy * cam.k;
    kick();
    if (start) setTimeout(() => focus(start.key), 350);
    else if (!still()) setTimeout(() => flyTo(first, 1600, 1600), 120);

    return {
      focus: key => focus(key || null),
      focused: () => (focused ? focused.key : null),
      fit,
      search,
      searchGo,
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
        arrange();
        fit();
        changed();
      },
      resetPositions() {
        delete saved.positions[saved.layout];
        arrange();
        changed();
      },
      moved: () => Object.keys(saved.positions[saved.layout] || {}).length > 0,
      destroy() {
        stop();
        host.replaceChildren();
      },
    };
  }

  return { buildModel, layout, mount, SIZES: { W, HEAD, ROW, FOOT, BORDER } };
});
