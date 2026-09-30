// Sqlaris Studio: a small local browser for PostgreSQL and MySQL databases.
// Plain JavaScript, no build step. The page state lives in the address bar,
// so Back, Forward and bookmarks all work.
(() => {
  'use strict';

  // ------------------------------------------------------------------ helpers

  const $ = (sel, root = document) => root.querySelector(sel);

  // Builds an element. Text always goes in as text, never as HTML, so a value
  // in the database can never turn into markup on this page.
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null) continue;
      if (['value', 'checked', 'disabled', 'spellcheck'].includes(k)) el[k] = v;
      else if (v === false) continue;
      else if (k === 'class') el.className = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : String(v));
    }
    return addKids(el, kids);
  }

  // Children may be nested arrays, and null or false for "nothing here".
  function addKids(el, kids) {
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false || kid === '') continue;
      el.append(kid instanceof Node ? kid : String(kid));
    }
    return el;
  }

  // Replaces an element's children, with the same rules as h().
  function put(el, ...kids) {
    el.replaceChildren();
    return addKids(el, kids);
  }

  const ICONS = {
    blank: '',
    database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
    table: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M9 10v10"/>',
    view: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    eyeOff: '<path d="M3 3l18 18"/><path d="M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    filter: '<path d="M3 5h18l-7 8v6l-4-2v-4z"/>',
    columns: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M15 4v16"/>',
    download: '<path d="M12 4v11m0 0-4-4m4 4 4-4M5 20h14"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
    monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
    colours: '<path d="M12 3a9 9 0 1 0 0 18c1.1 0 2-.9 2-2 0-.5-.2-.9-.5-1.3-.3-.4-.5-.8-.5-1.3 0-1.1.9-2 2-2h2.4A4.6 4.6 0 0 0 22 9.8C22 6 17.5 3 12 3z"/><circle cx="7.5" cy="10.5" r="1.1"/><circle cx="12" cy="7.5" r="1.1"/><circle cx="16.5" cy="10.5" r="1.1"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9m-3 3 3 3m-6 0 2 2"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
    expand: '<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13 7 4 4"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
    play: '<path d="M7 4v16l13-8z"/>',
    left: '<path d="m15 6-6 6 6 6"/>',
    right: '<path d="m9 6 6 6-6 6"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    up: '<path d="m6 15 6-6 6 6"/>',
    code: '<path d="m8 8-5 4 5 4M16 8l5 4-5 4M14 4l-4 16"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    warn: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h.01"/>',
    check: '<path d="m5 12 5 5L20 7"/>',
    history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    structure: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><path d="M6.5 10v4a3 3 0 0 0 3 3H14"/>',
    diagram: '<rect x="2.5" y="4" width="7" height="5.5" rx="1.5"/><rect x="14.5" y="4" width="7" height="5.5" rx="1.5"/><rect x="14.5" y="14.5" width="7" height="5.5" rx="1.5"/><path d="M9.5 6.75h5M18 9.5v5"/>',
    gauge: '<path d="M12 14l4-4"/><path d="M3.3 17a9 9 0 1 1 17.4 0"/>',
    chart: '<path d="M4 20V11M10 20V5M16 20v-6M2 20h20"/>',
    keyboard: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
    logout: '<path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4"/><path d="m10 17 5-5-5-5M15 12H4"/>',
    upload: '<path d="M12 20V9m0 0-4 4m4-4 4 4M5 4h14"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    tool: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9z"/>',
    pulse: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
    pause: '<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  };

  function icon(name, cls = '') {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', ('i ' + cls).trim());
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = ICONS[name] || '';
    return svg;
  }

  const numberFormat = new Intl.NumberFormat();
  const compactFormat = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
  const fmtN = n => (n == null ? '' : numberFormat.format(n));
  const fmtCompact = n => (n == null ? '' : n < 10000 ? numberFormat.format(n) : compactFormat.format(n));
  const plural = (n, word) => `${fmtN(n)} ${word}${n === 1 ? '' : 's'}`;

  function fmtBytes(bytes) {
    if (bytes == null) return '';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let v = Number(bytes);
    let i = 0;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return (i ? v.toFixed(v < 10 ? 1 : 0) : v) + ' ' + units[i];
  }

  function timeAgo(ms) {
    const s = Math.round((Date.now() - ms) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + ' min ago';
    if (s < 86400) return Math.floor(s / 3600) + ' h ago';
    return new Date(ms).toLocaleDateString();
  }

  // How long something has run: "850 ms", "12 s", "4 min", "3 h".
  function fmtDuration(ms) {
    if (ms == null) return '';
    if (ms < 1000) return ms + ' ms';
    if (ms < 60000) return Math.round(ms / 1000) + ' s';
    if (ms < 3600000) return Math.round(ms / 60000) + ' min';
    return Math.round(ms / 3600000) + ' h';
  }

  const fmtPct = v => (v == null ? '' : (v * 100).toFixed(v >= 0.999 || v < 0.1 ? 1 : 2).replace(/\.0+$/, '') + '%');
  // A rate per second: one decimal while it is small.
  const fmtRate = v => (v == null ? '' : v < 10 ? String(Math.round(v * 10) / 10) : fmtCompact(Math.round(v)));

  function debounce(fn, ms) {
    let timer;
    return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
  }

  // With reduced motion asked for, things arrive in place instead of moving there.
  const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n || lo));
  const short = (s, n = 28) => (s.length > n ? s.slice(0, n) + '...' : s);
  // The server sorts every column type into a category, whatever the
  // database calls it: number, text, bool, date, datetime, time, interval,
  // json, uuid, binary, array or other.
  const isJson = c => c.category === 'json';
  const isBool = c => c.category === 'bool';
  const monoType = c => ['uuid', 'json', 'binary', 'date', 'datetime', 'time'].includes(c.category);

  function prettyJson(v) {
    try { return JSON.stringify(JSON.parse(v), null, 2); } catch { return v; }
  }

  // Dates and times get a picker. The database writes "2026-09-26 13:36:05.91+00";
  // flatpickr shows "2026-09-26 13:36:05", and the browser's own picker, used
  // when flatpickr is not loaded, wants "2026-09-26T13:36:05". Every time here
  // is UTC, the zone the viewer's session runs in.
  const pickerKind = c => ({ date: 'date', datetime: 'datetime-local', time: 'time' })[c.category] || null;
  const dateSep = () => (window.flatpickr ? ' ' : 'T');

  function toPicker(kind, v) {
    if (!v) return '';
    if (kind === 'date') return v.slice(0, 10);
    if (kind === 'time') return v.slice(0, 8);
    return v.slice(0, 19).replace(' ', dateSep());
  }

  function fromPicker(kind, c, v) {
    if (!v) return null;
    let s = kind === 'datetime-local' ? v.replace('T', ' ') : v;
    if (kind !== 'date' && /\d\d:\d\d$/.test(s) && !/:\d\d:\d\d$/.test(s)) s += ':00';
    return kind !== 'date' && (c.type || '').includes('with time zone') ? s + '+00' : s;
  }

  function nowFor(kind) {
    const iso = new Date().toISOString();
    return kind === 'date' ? iso.slice(0, 10) : kind === 'time' ? iso.slice(11, 19) : iso.slice(0, 19).replace('T', dateSep());
  }

  // Tom Select and flatpickr put their dropdowns in <body>, where they outlive
  // the box they belong to when a view redraws. They go when their box has.
  const widgets = new Set();
  document.addEventListener('mousedown', () => {
    for (const w of widgets) {
      if (!w.box.isConnected) {
        w.destroy();
        widgets.delete(w);
      }
    }
  }, true);

  // The list narrows on every key, not after a pause, so Enter always takes
  // the first match of what was typed.
  const SELECT_OPTIONS = { maxOptions: null, allowEmptyOption: true, dropdownParent: 'body', refreshThrottle: 0 };

  // A select with many choices becomes a dropdown you can type into, through
  // Tom Select when it is loaded. The <select> stays underneath, so code reads
  // select.value and hears its change event as before. It is dressed once the
  // caller has put it on the page.
  function searchable(select, opts = {}) {
    if (!window.TomSelect) return select;
    queueMicrotask(() => {
      if (!select.isConnected || select.tomselect) return;
      const ts = new TomSelect(select, { ...SELECT_OPTIONS, ...opts });
      widgets.add({ box: ts.wrapper, destroy: () => ts.destroy() });
    });
    return select;
  }

  // A date, datetime or time box: flatpickr's calendar when it is loaded, the
  // browser's own picker otherwise. onPick hears each value picked or typed.
  function dateBox(kind, value, onPick, opts = {}) {
    const input = h('input', { class: 'input', value: toPicker(kind, value || ''), spellcheck: false });
    if (!window.flatpickr) {
      input.type = kind;
      if (kind !== 'date') input.step = 1;
      if (onPick) input.addEventListener('change', () => onPick(input.value));
      return {
        input,
        set: v => { input.value = v; if (onPick) onPick(v); },
        open: () => { try { input.showPicker(); } catch { /* only right after a click */ } },
        destroy: () => {},
      };
    }
    const fp = flatpickr(input, {
      allowInput: true,
      disableMobile: true,
      time_24hr: true,
      enableTime: kind !== 'date',
      enableSeconds: kind !== 'date',
      noCalendar: kind === 'time',
      dateFormat: kind === 'date' ? 'Y-m-d' : kind === 'time' ? 'H:i:S' : 'Y-m-d H:i:S',
      onChange: (dates, text) => { if (onPick) onPick(text); },
      ...opts,
    });
    let gone = false;
    const destroy = () => { if (!gone) { gone = true; fp.destroy(); } };
    widgets.add({ box: input, destroy });
    return { input, fp, calendar: fp.calendarContainer, set: v => fp.setDate(v, true), open: () => fp.open(), destroy };
  }

  // ------------------------------------------------------------------ motion

  // One highlight that glides to the item it marks: behind the open table,
  // under the active tab, behind the picked choice of a switch. instant puts
  // it there without the glide, for a list that was just rebuilt.
  function slideTo(ink, target, axis, instant = false) {
    if (!target) {
      ink.style.opacity = '0';
      return;
    }
    if (instant) ink.classList.add('instant');
    ink.style.opacity = '1';
    if (axis === 'x') {
      ink.style.width = target.offsetWidth + 'px';
      ink.style.transform = `translateX(${target.offsetLeft}px)`;
    } else {
      ink.style.height = target.offsetHeight + 'px';
      ink.style.transform = `translateY(${target.offsetTop}px)`;
    }
    if (instant) {
      void ink.offsetWidth;
      ink.classList.remove('instant');
    }
  }

  // A switch of a few choices, with a highlight that slides to the one picked.
  // A choice is [value, label, title]; the label may be an icon, and then the
  // title names it. onPick hears the value and the button pressed.
  function segmented(choices, value, onPick, cls = '') {
    const ink = h('span', { class: 'segmented-ink', 'aria-hidden': 'true' });
    const el = h('div', { class: ('segmented ' + cls).trim(), role: 'radiogroup' }, ink, choices.map(([v, label, title]) => h('button', {
      type: 'button',
      role: 'radio',
      class: v === value ? 'on' : null,
      title: title || null,
      'aria-label': title || null,
      'aria-checked': String(v === value),
      dataset: { v },
      onclick: e => {
        const b = e.currentTarget;
        if (b.classList.contains('on')) return;
        el.querySelectorAll('button').forEach(x => {
          x.classList.toggle('on', x === b);
          x.setAttribute('aria-checked', String(x === b));
        });
        slideTo(ink, b, 'x');
        onPick(b.dataset.v, b);
      },
    }, label)));
    // Measured once it is on the page, and again when the fonts have set the widths.
    const place = () => slideTo(ink, el.querySelector('.on'), 'x', true);
    requestAnimationFrame(place);
    if (document.fonts) document.fonts.ready.then(place);
    return el;
  }

  // A number that counts up to its value as it appears.
  function countUp(el, to, format) {
    if (reducedMotion() || !(to > 0)) {
      el.textContent = format(to);
      return;
    }
    const start = performance.now();
    const step = now => {
      const t = Math.min(1, (now - start) / 600);
      el.textContent = format(t < 1 ? Math.round(to * (1 - Math.pow(1 - t, 4))) : to);
      if (t < 1) requestAnimationFrame(step);
    };
    el.textContent = format(0);
    requestAnimationFrame(step);
  }

  // A big number with its label. Given a format, a number counts up to its value.
  function stat(label, value, format = null, tip = null) {
    const b = h('b');
    if (format && typeof value === 'number') countUp(b, value, format);
    else b.textContent = value == null ? '' : format ? format(value) : value;
    return h('div', { class: 'stat', title: tip }, b, h('span', null, label));
  }

  // Grey shapes in the form of what is loading, with a light running over them.
  // kind is list (the sidebar), grid (rows) or cards (a view of cards).
  function skeleton(kind, label) {
    const widths = [72, 58, 84, 64, 90, 52, 76, 68, 60, 80];
    return h('div', { class: 'skeleton ' + kind, role: 'status', 'aria-label': label },
      widths.slice(0, kind === 'cards' ? 3 : kind === 'list' ? 10 : 8).map(w => h('span', { style: `--w:${w}%` })));
  }

  // Takes an element off the page once its closing animation has run. Until
  // then it ignores the pointer, and the key handlers pass it by.
  function leave(el, ms = 160) {
    if (reducedMotion()) {
      el.remove();
      return;
    }
    el.classList.add('leaving');
    setTimeout(() => el.remove(), ms);
  }

  // A faint light in the database colour follows the pointer over a card.
  document.addEventListener('pointermove', e => {
    const card = e.target.closest ? e.target.closest('.card') : null;
    if (!card) return;
    const r = card.getBoundingClientRect();
    card.style.setProperty('--mx', `${e.clientX - r.left}px`);
    card.style.setProperty('--my', `${e.clientY - r.top}px`);
  }, { passive: true });

  // ----------------------------------------------------------------- tooltips

  // Every title="" shows as a tooltip in the page's own style, a moment after
  // the pointer rests on it, or at once when the keyboard reaches it.
  const tip = h('div', { class: 'tooltip', role: 'tooltip' });
  let tipFor = null;
  let tipTimer = 0;

  function hideTip() {
    clearTimeout(tipTimer);
    tip.remove();
    tipFor = null;
  }

  function showTip(el) {
    if (!el.isConnected || !el.dataset.tip) return;
    tip.textContent = el.dataset.tip;
    document.body.append(tip);
    const r = el.getBoundingClientRect();
    const above = r.top - tip.offsetHeight - 8;
    tip.style.left = clamp(r.left + r.width / 2 - tip.offsetWidth / 2, 8, innerWidth - tip.offsetWidth - 8) + 'px';
    tip.style.top = (above > 8 ? above : r.bottom + 8) + 'px';
  }

  function tipTarget(e) {
    const el = e.target.closest ? e.target.closest('[title], [data-tip]') : null;
    if (el === tipFor) return;
    hideTip();
    if (!el) return;
    // The text moves out of title, or the browser would show its own tooltip too.
    if (el.hasAttribute('title')) {
      el.dataset.tip = el.getAttribute('title');
      el.removeAttribute('title');
    }
    tipFor = el;
    tipTimer = setTimeout(() => showTip(el), e.type === 'focusin' ? 0 : 450);
  }

  document.addEventListener('mouseover', tipTarget);
  document.addEventListener('focusin', e => { if (e.target.matches(':focus-visible')) tipTarget(e); });
  document.addEventListener('mouseout', e => { if (!e.relatedTarget) hideTip(); });
  ['mousedown', 'keydown', 'scroll', 'focusout'].forEach(type => document.addEventListener(type, hideTip, true));

  // A list of the allowed values, with the current one kept even if the list no longer has it.
  function optionsSelect(c, value, withNull) {
    const values = [...c.options];
    if (value != null && value !== '' && !values.includes(value)) values.unshift(value);
    const select = h('select', { class: 'input' },
      values.map(v => h('option', { value: v }, v)),
      withNull ? h('option', { value: NULL_OPTION }, 'NULL') : null);
    select.value = value == null ? (withNull ? NULL_OPTION : values[0]) : value;
    return select;
  }

  // Rows of the table a foreign key points at, found by name as the person types.
  function lookupList(fk, input, onPick) {
    const list = h('div', { class: 'lookup' });
    const initial = input.value;
    let items = [];
    let active = -1;
    let seq = 0;
    const draw = () => put(list, items.length
      ? items.map((it, i) => h('button', {
        type: 'button',
        class: 'lookup-item' + (i === active ? ' active' : ''),
        onmousedown: e => e.preventDefault(),
        onclick: () => onPick(it.value),
      }, h('span', { class: 'grow' }, it.label || it.value), it.label ? h('small', { class: 'mono' }, short(it.value, 14)) : null))
      : h('div', { class: 'lookup-empty' }, `Nothing in ${fk.table} matches.`));
    const load = debounce(async () => {
      const mine = ++seq;
      try {
        const q = input.value === initial ? '' : input.value;
        const r = await api('lookup', { db: S.db, table: { schema: fk.schema, name: fk.table }, col: fk.col, q });
        if (mine !== seq) return;
        items = r.items;
        active = -1;
        draw();
      } catch (e) {
        put(list, h('div', { class: 'lookup-empty' }, e.message));
      }
    }, 200);
    input.addEventListener('input', load);
    input.addEventListener('keydown', e => {
      if (!items.length) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopImmediatePropagation();
        active = clamp(active + (e.key === 'ArrowDown' ? 1 : -1), 0, items.length - 1);
        draw();
      } else if (e.key === 'Enter' && active >= 0) {
        e.preventDefault();
        e.stopImmediatePropagation();
        onPick(items[active].value);
      }
    });
    load();
    return list;
  }

  function isTyping(e) {
    const t = e.target;
    return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  }

  // Every shortcut that can be changed, on the keys people know from VS Code
  // and Excel. The shortcuts list (?) changes them for this browser. Ctrl also
  // answers to Cmd on a Mac.
  const KEYS = {
    palette: { keys: ['Ctrl+P', 'Ctrl+K'], what: 'Jump to a table, a database or an action' },
    filterTables: { keys: ['/'], what: 'Filter the table list' },
    search: { keys: ['Ctrl+F'], what: 'Search the rows, or the tables of the diagram' },
    edit: { keys: ['Enter', 'F2'], what: 'Edit the cell' },
    openRow: { keys: ['Shift+Enter'], what: 'Open the row details' },
    copy: { keys: ['Ctrl+C'], what: 'Copy the cell, or the selected rows' },
    setNull: { keys: ['Delete'], what: 'Set the cell to NULL' },
    selectRow: { keys: ['Space'], what: 'Select the row, with Shift every row up to it' },
    selectAll: { keys: ['Ctrl+A'], what: 'Select every row on the page' },
    save: { keys: ['Ctrl+S', 'Ctrl+Enter'], what: 'Save the row form' },
    run: { keys: ['Ctrl+Enter', 'F5'], what: 'Run the SQL, or only the part selected' },
    suggest: { keys: ['Ctrl+Space'], what: 'Suggest a table or column in SQL' },
    comment: { keys: ['Ctrl+/'], what: 'Comment out the SQL line, or back' },
    fit: { keys: ['F'], what: 'Fit the diagram to the screen' },
    help: { keys: ['?', 'F1'], what: 'This list' },
  };
  for (const k of Object.values(KEYS)) k.defaults = k.keys;

  const KEY_NAMES = { space: ' ', esc: 'escape', del: 'delete', up: 'arrowup', down: 'arrowdown', left: 'arrowleft', right: 'arrowright' };

  // True when the key pressed is one of the action's keys.
  function pressed(e, action) {
    return KEYS[action].keys.some(combo => {
      const parts = combo.toLowerCase().split('+');
      const key = parts.pop() || '+';
      const want = KEY_NAMES[key] || key;
      if (e.key.toLowerCase() !== want) return false;
      if ((e.ctrlKey || e.metaKey) !== parts.includes('ctrl') || e.altKey !== parts.includes('alt')) return false;
      // A sign like ? takes Shift to type, so Shift only counts for letters and named keys.
      return want.length === 1 && !/[a-z]/.test(want) ? true : e.shiftKey === parts.includes('shift');
    });
  }

  // The key pressed, written the way KEYS writes it: "Ctrl+Shift+P".
  function comboOf(e) {
    const sign = e.key.length === 1 && !/[a-z]/i.test(e.key);
    const key = e.key === ' ' ? 'Space' : e.key.length === 1 ? e.key.toUpperCase() : e.key;
    return [(e.ctrlKey || e.metaKey) && 'Ctrl', e.altKey && 'Alt', e.shiftKey && !sign && 'Shift', key].filter(Boolean).join('+');
  }

  // A key as the page shows it, "Ctrl P". An action shows its first key.
  const comboLabel = combo => combo.replace(/\+(?=.)/g, ' ');
  const keyLabel = action => comboLabel(KEYS[action].keys[0]);
  const withKey = (text, action) => `${text} (${keyLabel(action)})`;

  // A key label that follows a change made in the shortcuts list.
  const kbdFor = action => h('kbd', { dataset: { key: action } }, keyLabel(action));
  const refreshKeyLabels = () => document.querySelectorAll('kbd[data-key]').forEach(el => { el.textContent = keyLabel(el.dataset.key); });

  // Per-browser memory: theme, page size, hidden columns, widths, SQL history.
  const store = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem('dbv:' + key);
        return v == null ? fallback : JSON.parse(v);
      } catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem('dbv:' + key, JSON.stringify(value)); } catch { /* private window */ }
    },
  };

  // The shortcuts this browser changed. The rest keep their default.
  for (const [name, keys] of Object.entries(store.get('shortcuts', {}))) {
    if (KEYS[name] && Array.isArray(keys) && keys.length) KEYS[name].keys = keys;
  }

  // ---------------------------------------------------------------------- api

  let busy = 0;
  function setBusy(delta) {
    busy += delta;
    document.body.classList.toggle('busy', busy > 0);
  }

  // quiet leaves the progress bar alone, for the requests the Activity tab repeats every few seconds.
  async function api(action, body = {}, raw = false, quiet = false) {
    if (!quiet) setBusy(1);
    try {
      const res = await fetch('api.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Sqlaris': '1' },
        body: JSON.stringify({ action, ...body }),
      });
      if (res.status === 401) {
        // Signed out, or the password in .env changed. The page reloads onto the sign-in form.
        location.reload();
        throw new Error('You are signed out. Sign in again.');
      }
      if (raw && res.ok) return res;
      let data;
      try { data = await res.json(); } catch { data = { error: `The server answered with HTTP ${res.status}.` }; }
      if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
      return data;
    } finally {
      if (!quiet) setBusy(-1);
    }
  }

  // -------------------------------------------------------------------- state

  const S = {
    groups: [],
    layout: null,
    db: null,
    tables: null,
    info: null,
    table: null,
    tab: 'overview',
    page: 1,
    perPage: store.get('perPage', 50),
    sort: null,
    search: '',
    filters: [],
    data: null,
    grid: null,
    sideFilter: '',
    drawer: null,
    // The table in focus on the Diagram tab, as "schema.name".
    focus: null,
  };
  const UI = {};

  // From config.php: which columns "Hide audit columns" hides, and the warning above an edit form.
  const SETTINGS = { audit_columns: [], edit_warning: null };

  // The colour a database is given in config.php, so the one on screen is
  // never mistaken for another.
  const dbColor = d => (d && d.color) || '#5b4ef0';
  const dbKind = d => (d.note ? `${d.note} database` : `${d.system} database`);

  const allDbs = () => S.groups.flatMap(g => g.items);
  const dbById = id => allDbs().find(d => d.id === id);
  const isMysql = () => (dbById(S.db) || {}).driver === 'mysql';
  const tableKey = t => (t ? `${t.schema}.${t.name}` : '');
  const sameTable = (a, b) => !!a && !!b && a.schema === b.schema && a.name === b.name;
  // A table in the database's usual schema ("public", or the database itself on MySQL) goes by its bare name.
  const homeSchema = () => (S.info ? S.info.schema : 'public');
  const nameIn = (schema, name) => (schema === homeSchema() ? name : `${schema}.${name}`);
  const tableLabel = t => nameIn(t.schema, t.name);
  const isView = t => t.kind.includes('view');
  const quoteIdent = s => (isMysql() ? '`' + s.replace(/`/g, '``') + '`' : '"' + s.replace(/"/g, '""') + '"');
  const qualified = t => (t.schema === homeSchema() ? quoteIdent(t.name) : quoteIdent(t.schema) + '.' + quoteIdent(t.name));

  function parseTableKey(key) {
    const i = key.indexOf('.');
    return i < 0 ? { schema: homeSchema(), name: key } : { schema: key.slice(0, i), name: key.slice(i + 1) };
  }

  const fresh = { page: 1, sort: null, search: '', filters: [], focus: null };

  function stateToHash(s) {
    const p = new URLSearchParams();
    if (s.db) p.set('db', s.db);
    if (s.table) p.set('t', tableKey(s.table));
    if (s.tab && s.tab !== (s.table ? 'data' : 'overview')) p.set('tab', s.tab);
    if (s.page > 1) p.set('p', s.page);
    if (s.sort) p.set('s', `${s.sort.col}:${s.sort.dir}`);
    if (s.search) p.set('q', s.search);
    if (s.filters && s.filters.length) p.set('f', JSON.stringify(s.filters));
    if (s.tab === 'diagram' && s.focus) p.set('focus', s.focus);
    return '#' + p.toString();
  }

  function hashToState() {
    const p = new URLSearchParams(location.hash.slice(1));
    let filters = [];
    try {
      filters = JSON.parse(p.get('f') || '[]');
      if (!Array.isArray(filters)) filters = [];
    } catch { filters = []; }
    let sort = null;
    const s = p.get('s');
    if (s && s.includes(':')) {
      const i = s.lastIndexOf(':');
      sort = { col: s.slice(0, i), dir: s.slice(i + 1) === 'desc' ? 'desc' : 'asc' };
    }
    return {
      db: p.get('db'),
      table: p.get('t') ? parseTableKey(p.get('t')) : null,
      tab: p.get('tab'),
      page: Math.max(1, parseInt(p.get('p') || '1', 10) || 1),
      sort,
      search: p.get('q') || '',
      filters: filters.filter(f => f && typeof f.col === 'string'),
      focus: p.get('focus'),
    };
  }

  function syncHash(replace) {
    const hash = stateToHash(S);
    if (hash !== location.hash) history[replace ? 'replaceState' : 'pushState'](null, '', hash);
  }

  // Moves to another place: a database, a table, a tab. Goes through the
  // address bar, so the move lands in the browser history.
  function go(patch) {
    const hash = stateToHash({ ...S, ...patch });
    if (hash !== location.hash) history.pushState(null, '', hash);
    return route();
  }

  const openTable = (table, extra = {}) => go({ table, tab: 'data', ...fresh, ...extra });
  const openDb = id => go({ db: id, table: null, tab: 'overview', ...fresh });

  // A change inside the data view (search, filter, sort, page) reloads the rows
  // without rebuilding the toolbar, so the box being typed in keeps its focus.
  function refine(patch, replace = true) {
    Object.assign(S, patch);
    syncHash(replace);
    loadRows();
  }

  // The last tables opened in each database, for the jump list.
  function rememberTable(t) {
    const key = 'recent:' + S.db;
    const list = store.get(key, []).filter(k => k !== tableKey(t));
    store.set(key, [tableKey(t), ...list].slice(0, 8));
  }

  let routeSeq = 0;
  async function route() {
    const seq = ++routeSeq;
    const st = hashToState();
    const ids = allDbs().map(d => d.id);
    const last = store.get('lastDb', null);
    const db = ids.includes(st.db) ? st.db : ids.includes(last) ? last : ids[0];

    if (db !== S.db) {
      const switching = S.db != null;
      S.db = db;
      S.tables = null;
      S.info = null;
      S.table = null;
      S.data = null;
      store.set('lastDb', db);
      forceCloseDrawer();
      // The old database's rows must not stay clickable while the new one loads.
      put(UI.view, skeleton('grid', 'Loading tables'));
      renderShell();
      if (switching) announceDb();
      await loadTables();
      if (seq !== routeSeq) return;
    }

    const table = st.table && S.tables && S.tables.some(t => sameTable(t, st.table)) ? st.table : null;
    if (!sameTable(table, S.table)) {
      S.data = null;
      forceCloseDrawer();
      if (table) rememberTable(table);
    }
    S.table = table;
    S.tab = table
      ? (['data', 'structure', 'sql'].includes(st.tab) ? st.tab : 'data')
      : (['diagram', 'sql', 'health', 'activity'].includes(st.tab) ? st.tab : 'overview');
    Object.assign(S, { page: st.page, sort: st.sort, search: st.search, filters: st.filters, focus: st.focus });

    syncHash(true);
    renderShell();
    renderView();
  }

  async function loadTables() {
    // The list may have changed, so the diagram reads the catalog again next time.
    delete diagramCache[S.db];
    renderTableList();
    try {
      const res = await api('tables', { db: S.db });
      S.tables = res.tables;
      S.info = res.info;
    } catch (e) {
      S.tables = [];
      S.info = null;
      toast(e.message, 'error');
    }
    renderTableList();
  }

  // The list of databases, with your layout of it. Read again after one is made or dropped.
  async function loadDatabases() {
    const res = await api('databases');
    S.groups = res.groups;
    S.layout = { ...emptyLayout(), ...res.layout };
    Object.assign(SETTINGS, res.settings);
    for (const g of S.groups) g.items.forEach(d => { d.group = g.label; });
  }

  async function signOut() {
    try { await api('logout'); } catch { /* signed out already */ }
    location.reload();
  }

  async function refresh() {
    await loadTables();
    renderShell();
    renderView();
  }

  function bumpCount(delta) {
    const t = S.tables && S.tables.find(x => sameTable(x, S.table));
    if (t && t.rows != null) {
      t.rows += delta;
      renderTableList();
    }
  }

  // --------------------------------------------------------------- the shell

  function buildSkeleton() {
    // The glow behind the page, in the colour of the database on screen.
    document.body.prepend(h('div', { class: 'aurora', 'aria-hidden': 'true' }));
    UI.server = h('span', { class: 'server' });
    UI.dbButton = h('button', { class: 'db-button', title: 'Pick a database', onclick: e => openDbMenu(e.currentTarget) });
    UI.sideFilter = h('input', {
      class: 'input',
      type: 'search',
      placeholder: 'Filter tables',
      oninput: e => { S.sideFilter = e.target.value; renderTableList(); },
      onkeydown: e => {
        if (e.key === 'Enter') { const first = UI.tableList.querySelector('a'); if (first) first.click(); }
        if (e.key === 'Escape') { e.target.value = ''; S.sideFilter = ''; renderTableList(); e.target.blur(); e.stopPropagation(); }
      },
    });
    UI.tableList = h('nav', { class: 'table-list' });
    UI.tablePill = h('span', { class: 'table-pill', 'aria-hidden': 'true' });
    UI.sideFoot = h('div', { class: 'side-foot' });
    UI.crumbs = h('div', { class: 'crumbs' });
    UI.tabs = h('div', { class: 'tabs', role: 'tablist' });
    UI.tabInk = h('span', { class: 'tab-ink', 'aria-hidden': 'true' });
    UI.themeBox = h('div', { class: 'theme-switch' });
    UI.tintBtn = h('button', { class: 'btn ghost icon-only', title: 'Page colours', onclick: e => openTints(e.currentTarget) }, icon('colours'));
    UI.view = h('section', { class: 'view' });
    UI.drawer = h('aside', { class: 'drawer' });
    UI.toasts = h('div', { class: 'toasts', 'aria-live': 'polite' });

    put($('#app'),
      h('div', { class: 'progress' }),
      h('aside', { class: 'side' },
        h('div', { class: 'brand' }, icon('database'), h('span', null, 'Sqlaris Studio'), UI.server),
        UI.dbButton,
        h('label', { class: 'side-search' }, icon('search'), UI.sideFilter, kbdFor('filterTables')),
        UI.tableList,
        UI.sideFoot),
      h('main', { class: 'main' },
        h('header', { class: 'top' },
          UI.crumbs,
          UI.tabs,
          h('div', { class: 'top-actions' },
            h('button', { class: 'btn ghost', title: 'Jump to a table or a database', onclick: openPalette },
              icon('search'), h('span', null, 'Jump to'), kbdFor('palette')),
            h('button', { class: 'btn ghost icon-only', title: withKey('Keyboard shortcuts', 'help'), onclick: showShortcuts }, icon('keyboard')),
            UI.themeBox,
            UI.tintBtn,
            h('button', { class: 'btn ghost icon-only', title: 'Reload counts and rows', onclick: refresh }, icon('refresh')),
            h('button', { class: 'btn ghost icon-only', title: `Sign out (${document.body.dataset.user || ''})`, onclick: signOut }, icon('logout')))),
        UI.view),
      UI.drawer,
      UI.toasts);
  }

  // The first colour of a page load is set at once. After that a change
  // flows across the page, because --db is a registered colour in app.css.
  function setDbColor(color) {
    const root = document.documentElement;
    if (!UI.colored) {
      UI.colored = true;
      root.classList.add('still');
      requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('still')));
    }
    root.style.setProperty('--db', color);
  }

  // Switching database: a light sweeps the database button and a toast names
  // the database now open, while the colour flows to its own.
  function announceDb() {
    const db = dbById(S.db);
    if (!db) return;
    UI.dbButton.classList.remove('sweep');
    void UI.dbButton.offsetWidth;
    UI.dbButton.classList.add('sweep');
    toast(`Now on ${db.name}`, 'db');
  }

  function renderShell() {
    const db = dbById(S.db);
    setDbColor(dbColor(db));
    UI.server.textContent = db ? db.where : '';
    put(UI.dbButton,
      icon('database'),
      h('span', { class: 'db-text' },
        h('b', null, db ? db.name : 'Pick a database'),
        h('small', null, db ? dbKind(db) : '')),
      icon('down', 'chev'));

    renderTableList();

    const home = { db: S.db, table: null, tab: 'overview', ...fresh };
    // A new table name lifts into place; the same one stays still.
    const crumb = S.table ? tableLabel(S.table) : '';
    const newCrumb = crumb !== UI.crumb;
    UI.crumb = crumb;
    put(UI.crumbs,
      h('a', { href: stateToHash(home), onclick: e => { e.preventDefault(); go(home); } }, db ? db.name : ''),
      S.table ? [h('span', { class: 'sep' }, '/'), h('span', { class: 'current' + (newCrumb ? ' enter' : '') }, crumb)] : null);

    const tabs = S.table
      ? [['data', 'Data', 'list'], ['structure', 'Structure', 'structure'], ['sql', 'SQL', 'code']]
      : [['overview', 'Tables', 'table'], ['diagram', 'Diagram', 'diagram'], ['health', 'Health', 'gauge'], ['activity', 'Activity', 'pulse'], ['sql', 'SQL', 'code']];
    // The highlight glides between tabs, and jumps when the set of tabs changes.
    const tabSet = tabs.map(([id]) => id).join();
    put(UI.tabs, UI.tabInk, tabs.map(([id, label, ic]) =>
      h('button', { class: 'tab' + (S.tab === id ? ' active' : ''), role: 'tab', onclick: () => go({ tab: id }) }, icon(ic), label)));
    slideTo(UI.tabInk, UI.tabs.querySelector('.tab.active'), 'x', tabSet !== UI.tabSet);
    UI.tabSet = tabSet;

    renderThemeButton();
  }

  function renderTableList() {
    if (!S.tables) {
      put(UI.tableList, skeleton('list', 'Loading tables'));
      UI.sideFoot.textContent = '';
      return;
    }
    const q = S.sideFilter.trim().toLowerCase();
    const items = S.tables.filter(t => !q || tableLabel(t).toLowerCase().includes(q));
    put(UI.tableList, UI.tablePill, items.map(t => {
      const target = { db: S.db, table: t, tab: 'data', ...fresh };
      return h('a', {
        href: stateToHash(target),
        class: 'table-item' + (sameTable(t, S.table) ? ' active' : '') + (t.rows === 0 ? ' is-empty' : ''),
        title: t.comment || tableLabel(t),
        onclick: e => {
          if (e.ctrlKey || e.metaKey || e.shiftKey) return;
          e.preventDefault();
          openTable(t);
        },
        oncontextmenu: e => tableMenu(e, t),
      },
      icon(isView(t) ? 'view' : 'table'),
      h('span', { class: 'name' }, tableLabel(t)),
      h('span', { class: 'count', title: t.exact ? '' : 'Estimate' }, fmtCompact(t.rows)));
    }), items.length ? null : h('div', { class: 'side-empty' }, q ? 'No table matches.' : 'This database has no tables.'));
    // The highlight glides to the open table, and jumps when the list is another database's.
    const active = UI.tableList.querySelector('.active');
    slideTo(UI.tablePill, active, 'y', UI.pillDb !== S.db);
    UI.pillDb = S.db;
    if (active) active.scrollIntoView({ block: 'nearest' });

    const rows = S.tables.reduce((sum, t) => sum + (t.rows || 0), 0);
    UI.sideFoot.textContent = `${fmtN(S.tables.length)} tables, ${fmtN(rows)} rows` + (S.info ? `, ${fmtBytes(S.info.size)}` : '');
  }

  function renderView() {
    if (diagram && S.tab !== 'diagram') {
      diagram.destroy();
      diagram = null;
    }
    if (S.tab === 'overview') return renderOverview();
    if (S.tab === 'diagram') return renderDiagram();
    if (S.tab === 'data') return renderData();
    if (S.tab === 'structure') return renderStructure();
    if (S.tab === 'sql') return renderSql();
    if (S.tab === 'health') return renderHealth();
    if (S.tab === 'activity') return renderActivity();
  }

  // ------------------------------------------------------------ small pieces

  let popover = null;

  function openPopoverAt(rect, content, { width, alignRight = false, anchor = null, focus = true } = {}) {
    closePopover();
    const el = h('div', { class: 'popover' }, content);
    if (width) el.style.minWidth = width + 'px';
    document.body.append(el);
    const left = alignRight ? rect.right - el.offsetWidth : rect.left;
    el.style.left = clamp(left, 8, innerWidth - el.offsetWidth - 8) + 'px';
    // Below the anchor if it fits, else above it.
    const below = rect.bottom + 6;
    const above = rect.top - el.offsetHeight - 6;
    const top = below + el.offsetHeight > innerHeight - 8 && above > 8 ? above : Math.min(below, innerHeight - el.offsetHeight - 8);
    el.style.top = Math.max(8, top) + 'px';
    // It grows out of the corner nearest its button.
    el.style.transformOrigin = `${alignRight ? 'right' : 'left'} ${top < rect.top ? 'bottom' : 'top'}`;
    const outside = e => { if (!el.contains(e.target) && !(anchor && anchor.contains(e.target))) closePopover(); };
    const onScroll = e => { if (!el.contains(e.target)) closePopover(); };
    setTimeout(() => {
      document.addEventListener('mousedown', outside);
      document.addEventListener('scroll', onScroll, true);
    }, 0);
    if (anchor) anchor.setAttribute('aria-expanded', 'true');
    popover = {
      el,
      anchor,
      off: () => {
        document.removeEventListener('mousedown', outside);
        document.removeEventListener('scroll', onScroll, true);
      },
    };
    if (focus) {
      const input = el.querySelector('input');
      if (input) input.focus();
    }
    return el;
  }

  // A second click on the button that opened the popover closes it.
  function openPopover(anchor, content, opts = {}) {
    if (popover && popover.anchor === anchor) return closePopover();
    openPopoverAt(anchor.getBoundingClientRect(), content, { ...opts, anchor });
  }

  function closePopover() {
    if (!popover) return;
    if (popover.anchor) popover.anchor.setAttribute('aria-expanded', 'false');
    popover.off();
    leave(popover.el);
    popover = null;
  }

  // A list of actions. An item is { label, icon, kbd, hint, run, danger, disabled },
  // 'sep' for a line, { title } for a heading, or null to leave it out.
  function menuList(items) {
    const list = [];
    for (const it of items.flat(Infinity)) {
      if (!it) continue;
      if (it === 'sep') {
        if (list.length && list[list.length - 1] !== 'sep') list.push('sep');
        continue;
      }
      list.push(it);
    }
    while (list[list.length - 1] === 'sep') list.pop();
    return h('div', { class: 'menu context-menu', role: 'menu' }, list.map(it => {
      if (it === 'sep') return h('div', { class: 'menu-sep' });
      if (it.title) return h('div', { class: 'menu-title' }, it.title);
      return h('button', {
        class: 'menu-item' + (it.danger ? ' danger' : ''),
        role: 'menuitem',
        title: it.hint || null,
        disabled: !!it.disabled,
        onclick: () => { closePopover(); it.run(); },
      }, icon(it.icon || 'blank'), h('span', { class: 'grow' }, it.label), it.kbd ? h('kbd', null, it.kbd) : null);
    }));
  }

  function openMenuAt(e, items) {
    e.preventDefault();
    openPopoverAt({ left: e.clientX, right: e.clientX, top: e.clientY, bottom: e.clientY }, menuList(items), { focus: false });
  }

  // kind is info, ok, error, or db for "you are on this database now". The
  // line along the bottom runs down while the toast stays.
  function toast(message, kind = 'info', action = null) {
    const life = kind === 'error' ? 8000 : action ? 7000 : 2600;
    const el = h('div', { class: 'toast ' + kind, role: kind === 'error' ? 'alert' : 'status', style: `--life:${life}ms` },
      kind === 'db' ? h('i', { class: 'toast-dot' }) : icon(kind === 'error' ? 'warn' : kind === 'ok' ? 'check' : 'info'),
      h('span', null, message),
      action ? h('button', { onclick: () => { el.remove(); action.run(); } }, action.label) : null,
      h('i', { class: 'toast-life' }));
    UI.toasts.append(el);
    setTimeout(() => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 260);
    }, life);
  }

  const errorBox = message => h('div', { class: 'callout error' }, icon('warn'), h('pre', null, message));

  function copyText(text, message) {
    navigator.clipboard.writeText(text).then(() => toast(message, 'ok'), () => toast('Copy did not work in this browser.', 'error'));
  }

  function download(name, text, type) {
    const url = URL.createObjectURL(text instanceof Blob ? text : new Blob([text], { type }));
    const link = h('a', { href: url, download: name });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function confirmBox({ title, body, confirm = 'OK', danger = false }) {
    return new Promise(resolve => {
      const done = value => {
        leave(overlay);
        document.removeEventListener('keydown', onKey, true);
        resolve(value);
      };
      const onKey = e => {
        if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); done(false); }
      };
      const ok = h('button', { class: 'btn ' + (danger ? 'danger solid' : 'primary'), onclick: () => done(true) }, confirm);
      const overlay = h('div', { class: 'overlay', onmousedown: e => { if (e.target === overlay) done(false); } },
        h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' },
          h('h3', null, title),
          h('p', null, body),
          h('div', { class: 'modal-actions' }, h('button', { class: 'btn', onclick: () => done(false) }, 'Cancel'), ok)));
      document.body.append(overlay);
      document.addEventListener('keydown', onKey, true);
      ok.focus();
    });
  }

  function openModal({ title, body, actions = [], wide = false, onClose = null }) {
    const close = () => {
      leave(overlay);
      document.removeEventListener('keydown', onKey, true);
      if (onClose) onClose();
    };
    const onKey = e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    };
    const overlay = h('div', { class: 'overlay', onmousedown: e => { if (e.target === overlay) close(); } },
      h('div', { class: 'modal' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true' },
        h('div', { class: 'modal-head' },
          h('h3', null, title),
          h('button', { class: 'btn ghost icon-only', title: 'Close (Esc)', onclick: close }, icon('x'))),
        h('div', { class: 'modal-body' }, body),
        actions.length ? h('div', { class: 'modal-actions' }, actions) : null));
    document.body.append(overlay);
    document.addEventListener('keydown', onKey, true);
    return { close, el: overlay };
  }

  // One line of text, such as a name. Gives the text, or null when cancelled.
  function askText({ title, value = '', confirm = 'Save' }) {
    return new Promise(resolve => {
      let answer = null;
      const input = h('input', { class: 'input', value, maxlength: 60, spellcheck: false });
      const form = h('form', {
        onsubmit: e => {
          e.preventDefault();
          if (!input.value.trim()) return;
          answer = input.value.trim();
          modal.close();
        },
      }, input);
      const modal = openModal({
        title,
        body: form,
        actions: [
          h('button', { class: 'btn', onclick: () => modal.close() }, 'Cancel'),
          h('button', { class: 'btn primary', onclick: () => form.requestSubmit() }, confirm),
        ],
        onClose: () => resolve(answer),
      });
      input.focus();
      input.select();
    });
  }

  // ------------------------------------------------------------------- theme

  // Midnight, the dark theme, is where a browser starts.
  const THEMES = ['dark', 'light', 'system'];

  function applyTheme() {
    const theme = store.get('theme', 'dark');
    if (theme === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    renderThemeButton();
  }

  // New page colours grow out of the button that asked for them, as a circle,
  // where the browser has view transitions. from is that button, or null for
  // the top right corner.
  function recolour(apply, from = null) {
    if (!document.startViewTransition || reducedMotion()) {
      apply();
      return;
    }
    if (from) {
      const r = from.getBoundingClientRect();
      document.documentElement.style.setProperty('--tx', `${r.left + r.width / 2}px`);
      document.documentElement.style.setProperty('--ty', `${r.top + r.height / 2}px`);
    }
    document.startViewTransition(apply);
  }

  function setTheme(theme, from = null) {
    store.set('theme', theme);
    recolour(applyTheme, from);
  }

  function cycleTheme() {
    const now = store.get('theme', 'dark');
    const next = THEMES[(THEMES.indexOf(now) + 1) % THEMES.length];
    setTheme(next, UI.themeBox.querySelector(`[data-v="${next}"]`));
    toast(next === 'system' ? 'Theme follows Windows.' : `Theme: ${next}.`);
  }

  // The switch in the top bar. It is built again only when the theme changed
  // from somewhere else, such as the jump palette, so a click keeps its glide.
  function renderThemeButton() {
    if (!UI.themeBox) return;
    const theme = store.get('theme', 'dark');
    const on = UI.themeBox.querySelector('button.on');
    if (on && on.dataset.v === theme) return;
    put(UI.themeBox, segmented([
      ['dark', icon('moon'), 'Dark'],
      ['light', icon('sun'), 'Light'],
      ['system', icon('monitor'), 'Follow Windows'],
    ], theme, (v, button) => setTheme(v, button), 'icons'));
  }

  // The page colours. Database, the default, paints the page in the colour of
  // the database on screen. Each other set paints it in its own colour, from
  // one tint in app.css, and the database keeps its marks: its button, its
  // label and the line along the top.
  const TINTS = [['database', 'Database'], ['midnight', 'Midnight'], ['graphite', 'Graphite'], ['ocean', 'Ocean'], ['forest', 'Forest'], ['plum', 'Plum'], ['sand', 'Sand']];

  function applyTint() {
    const tint = store.get('tint', 'database');
    if (tint === 'database' || !TINTS.some(([id]) => id === tint)) delete document.documentElement.dataset.tint;
    else document.documentElement.dataset.tint = tint;
  }

  // The picker stays open, so the sets can be tried one after another.
  function openTints(anchor) {
    const current = store.get('tint', 'database');
    const grid = h('div', { class: 'tint-grid' }, TINTS.map(([id, label]) => h('button', {
      type: 'button',
      class: 'tint-choice' + (id === current ? ' on' : ''),
      'aria-pressed': String(id === current),
      dataset: { tint: id },
      onclick: e => {
        const b = e.currentTarget;
        grid.querySelectorAll('.tint-choice').forEach(x => {
          x.classList.toggle('on', x === b);
          x.setAttribute('aria-pressed', String(x === b));
        });
        store.set('tint', id);
        recolour(applyTint, b);
      },
    }, h('span', { class: 'tint-swatch' }), label)));
    openPopover(anchor, h('div', { class: 'menu tint-menu' },
      h('div', { class: 'menu-title' }, 'Page colours'),
      h('p', { class: 'muted small' }, 'Database paints the page in the colour of the database you are in. With any other, the database button and the line along the top keep that colour.'),
      grid), { alignRight: true });
  }

  // ------------------------------------------------------------ database menu

  // Your own arrangement of the list, kept in layout.json by the server. A
  // group of your own has a key starting "u:", a group from config.php "c:"
  // and its label, and the hidden databases sit in the group "hidden".
  const emptyLayout = () => ({ groups: [], order: [], hidden: [], folded: {} });

  // The list as you arranged it: your groups and the groups config.php gives,
  // in your order, then the hidden databases. A config group whose databases
  // all moved away is left out.
  function viewGroups() {
    const L = S.layout;
    const byId = new Map(allDbs().map(d => [d.id, d]));
    const pick = ids => ids.map(id => byId.get(id)).filter(Boolean);
    const taken = new Set([...L.groups.flatMap(g => g.items), ...L.hidden]);
    const place = key => { const i = L.order.indexOf(key); return i < 0 ? Infinity : i; };
    const groups = [
      ...L.groups.map(g => ({ key: g.id, label: g.label, mine: true, items: pick(g.items) })),
      ...S.groups
        .map(g => ({ key: 'c:' + g.label, label: g.label, collapsed: g.collapsed, error: g.error, items: g.items.filter(d => !taken.has(d.id)) }))
        .filter(g => g.items.length || g.error),
    ].sort((a, b) => place(a.key) - place(b.key) || 0);
    const hidden = pick(L.hidden);
    if (hidden.length) groups.push({ key: 'hidden', label: 'Hidden', collapsed: true, hidden: true, items: hidden });
    return groups;
  }

  const groupKeys = () => viewGroups().filter(g => !g.hidden).map(g => g.key);
  const isHidden = d => S.layout.hidden.includes(d.id);

  // Moves an entry onto another's place: dragged down it lands below the
  // target, dragged up or in from elsewhere it lands above. No target is the end.
  function moveInList(list, item, target) {
    if (item === target) return list;
    const from = list.indexOf(item);
    const to = list.indexOf(target);
    const rest = list.filter(x => x !== item);
    if (to < 0) return [...rest, item];
    rest.splice(rest.indexOf(target) + (from >= 0 && from < to ? 1 : 0), 0, item);
    return rest;
  }

  // Puts a database in one of your groups or in "hidden". Any other key sends
  // it back to the group config.php gives it.
  function placeDb(L, d, key, target = null) {
    const into = key === 'hidden' ? L.hidden : (L.groups.find(g => g.id === key) || {}).items;
    L.groups.forEach(g => { if (g.items !== into) g.items = g.items.filter(id => id !== d.id); });
    if (into !== L.hidden) L.hidden = L.hidden.filter(id => id !== d.id);
    if (into) into.splice(0, into.length, ...moveInList(into, d.id, target));
  }

  // The change shows at once, and the saves go one after another so the last
  // one wins. A message offers Undo.
  let layoutSaving = Promise.resolve();
  let dbMenu = null;

  function changeLayout(change, message = null) {
    const before = S.layout;
    const next = structuredClone(before);
    change(next);
    S.layout = next;
    if (dbMenu && dbMenu.el.isConnected) dbMenu.draw();
    layoutSaving = layoutSaving
      .then(() => api('layout', { layout: next }))
      .then(() => {
        if (message) toast(message, 'ok', { label: 'Undo', run: () => changeLayout(L => Object.assign(L, structuredClone(before))) });
      }, e => {
        S.layout = before;
        if (dbMenu && dbMenu.el.isConnected) dbMenu.draw();
        toast(e.message, 'error');
      });
  }

  function reopenDbMenu() {
    closePopover();
    openDbMenu(UI.dbButton);
  }

  async function newGroup(d = null) {
    closePopover();
    const label = await askText({ title: d ? `New group for ${d.name}` : 'New group', confirm: 'Create' });
    if (label) {
      const id = 'u:' + Date.now().toString(36);
      const keys = groupKeys();
      changeLayout(L => {
        L.groups.push({ id, label, items: [] });
        L.order = [id, ...keys];
        if (d) placeDb(L, d, id);
      });
    }
    reopenDbMenu();
  }

  async function renameGroup(g) {
    const label = await askText({ title: 'Rename group', value: g.label });
    if (label && label !== g.label) changeLayout(L => { L.groups.find(x => x.id === g.key).label = label; });
    reopenDbMenu();
  }

  async function resetLayout() {
    closePopover();
    const ok = await confirmBox({
      title: 'Reset your layout?',
      body: 'Your own groups go, hidden databases come back, and every database returns to the group config.php gives it.',
      confirm: 'Reset',
    });
    if (ok) changeLayout(L => Object.assign(L, emptyLayout()), 'Layout reset.');
    reopenDbMenu();
  }

  // A menu action that changes the layout, then shows the list again.
  const andReopen = run => () => { run(); reopenDbMenu(); };

  function dbItemMenu(e, d, g) {
    const others = viewGroups().filter(x => x.mine && x.key !== g.key);
    openMenuAt(e, [
      { title: d.name },
      { label: 'Open', icon: 'database', run: () => openDb(d.id) },
      'sep',
      others.map(x => ({ label: `Move to ${x.label}`, icon: 'arrow', run: andReopen(() => changeLayout(L => placeDb(L, d, x.key))) })),
      { label: 'Move to a new group', icon: 'plus', run: () => newGroup(d) },
      g.mine ? { label: `Back to ${d.group}`, icon: 'left', run: andReopen(() => changeLayout(L => placeDb(L, d, null))) } : null,
      g.hidden
        ? { label: 'Show again', icon: 'view', run: andReopen(() => changeLayout(L => placeDb(L, d, null))) }
        : { label: 'Hide', icon: 'eyeOff', run: andReopen(() => changeLayout(L => placeDb(L, d, 'hidden'))) },
      'sep',
      { label: 'Copy name', icon: 'copy', run: () => copyText(d.name, 'Database name copied.') },
    ]);
  }

  function groupMenu(e, g) {
    const keys = groupKeys();
    const i = keys.indexOf(g.key);
    const moveTo = target => andReopen(() => changeLayout(L => { L.order = moveInList(keys, g.key, target); }));
    openMenuAt(e, [
      { title: g.label },
      g.hidden
        ? { label: 'Show them all again', icon: 'view', run: andReopen(() => changeLayout(L => { L.hidden = []; })) }
        : [
          g.mine ? { label: 'Rename', icon: 'edit', run: () => renameGroup(g) } : null,
          { label: 'Move up', icon: 'up', disabled: i <= 0, run: moveTo(keys[i - 1]) },
          { label: 'Move down', icon: 'down', disabled: i >= keys.length - 1, run: moveTo(keys[i + 1]) },
        ],
      'sep',
      { label: 'New group', icon: 'plus', run: () => newGroup() },
      g.mine ? ['sep', {
        label: 'Delete group',
        icon: 'trash',
        danger: true,
        run: andReopen(() => changeLayout(L => {
          L.groups = L.groups.filter(x => x.id !== g.key);
          L.order = L.order.filter(key => key !== g.key);
        }, `${g.label} deleted. Its databases went back to their own groups.`)),
      }] : null,
    ]);
  }

  function openDbMenu(anchor) {
    let q = '';
    let drag = null;
    let marked = null;
    const mark = el => {
      if (marked) marked.classList.remove('drop-here');
      marked = el;
      if (el) el.classList.add('drop-here');
    };
    const list = h('div', { class: 'db-groups' });
    const foot = h('div', { class: 'db-menu-foot' });
    const search = h('input', {
      class: 'input',
      type: 'search',
      placeholder: 'Find a database',
      spellcheck: false,
      oninput: e => { q = e.target.value.trim().toLowerCase(); draw(); },
      onkeydown: e => {
        if (e.key !== 'Enter') return;
        const first = list.querySelector('.menu-item');
        if (first) first.click();
      },
    });

    const startDrag = (e, what) => {
      drag = what;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', what.db ? what.db.name : what.key);
    };

    // Where a drop would land in group g: on a database of your own group or
    // of "hidden", which places it there, or else on the group's heading.
    // A database only goes back to its own config group, never another one.
    const dropTarget = (e, g, head) => {
      if (!drag) return null;
      if (drag.db ? !(g.mine || g.hidden || g.key === 'c:' + drag.db.group) : g.hidden || g.key === drag.key) return null;
      const item = e.target.closest('.menu-item');
      return drag.db && item && (g.mine || g.hidden) ? item : head;
    };

    const drop = (e, g, head) => {
      const el = dropTarget(e, g, head);
      mark(null);
      if (!el) return;
      e.preventDefault();
      const what = drag;
      drag = null;
      if (what.db) changeLayout(L => placeDb(L, what.db, g.key, el === head ? null : el.dataset.id));
      else {
        const keys = groupKeys();
        changeLayout(L => { L.order = moveInList(keys, what.key, g.key); });
      }
    };

    const drawGroup = g => {
      const folded = !q && (S.layout.folded[g.key] ?? !!g.collapsed);
      const head = h('button', {
        class: 'menu-head',
        draggable: g.hidden ? null : 'true',
        title: g.hidden ? null : 'Drag to move the group. Right-click for more.',
        onclick: () => changeLayout(L => { L.folded[g.key] = !folded; }),
        oncontextmenu: e => groupMenu(e, g),
        ondragstart: e => startDrag(e, { key: g.key }),
      }, icon(folded ? 'right' : 'down'), g.label, h('span', { class: 'count' }, g.items.length));
      return h('div', {
        class: 'menu-group' + (g.hidden ? ' is-hidden' : ''),
        ondragover: e => {
          const el = dropTarget(e, g, head);
          if (el) e.preventDefault();
          mark(el);
        },
        ondrop: e => drop(e, g, head),
      },
      head,
      folded ? null : [
        g.error ? h('div', { class: 'menu-error' }, icon('warn'), h('span', null, g.error)) : null,
        g.mine && !g.items.length ? h('div', { class: 'menu-empty' }, 'Drag a database here, or right-click one.') : null,
        g.items.map(d => h('button', {
          class: 'menu-item' + (d.id === S.db ? ' active' : ''),
          draggable: 'true',
          dataset: { id: d.id },
          onclick: () => { closePopover(); openDb(d.id); },
          oncontextmenu: e => dbItemMenu(e, d, g),
          ondragstart: e => startDrag(e, { db: d }),
        },
        h('span', { class: 'dot', style: `background:${dbColor(d)}` }),
        h('span', { class: 'grow' }, d.name),
        d.note ? h('span', { class: 'tag' }, d.note) : null)),
      ]);
    };

    const draw = () => {
      const match = d => `${d.name} ${d.note || ''}`.toLowerCase().includes(q);
      const groups = viewGroups()
        .map(g => (q ? { ...g, items: g.items.filter(match) } : g))
        .filter(g => !q || g.items.length);
      const L = S.layout;
      const changed = L.groups.length || L.hidden.length || L.order.length || Object.keys(L.folded).length;
      put(list, groups.map(drawGroup), groups.length ? null : h('div', { class: 'menu-empty' }, 'No database matches.'));
      put(foot,
        h('button', { class: 'btn small', onclick: () => newGroup() }, icon('plus'), 'New group'),
        changed ? h('button', { class: 'btn small ghost', title: 'Put every database back where config.php puts it', onclick: resetLayout }, 'Reset') : null);
    };

    const menu = h('div', {
      class: 'menu db-menu',
      ondragend: () => { drag = null; mark(null); },
    }, h('div', { class: 'db-menu-search' }, search), list, foot);
    dbMenu = { el: menu, draw };
    draw();
    openPopover(anchor, menu, { width: anchor.offsetWidth });
  }

  function queryTable(t) {
    store.set('sql:' + S.db, `select *\nfrom ${qualified(t)}\nlimit 100;`);
    openTable(t, { tab: 'sql' });
  }

  // The right-click menu of a table, and the "more" button on its row in the overview.
  const tableMenuItems = t => [
    { title: tableLabel(t) },
    { label: 'Open data', icon: 'list', run: () => openTable(t) },
    { label: 'Open structure', icon: 'structure', run: () => openTable(t, { tab: 'structure' }) },
    { label: 'Show in diagram', icon: 'diagram', run: () => showInDiagram(t) },
    { label: 'Query it in SQL', icon: 'code', run: () => queryTable(t) },
    'sep',
    { label: 'Copy table name', icon: 'copy', run: () => copyText(t.name, 'Table name copied.') },
    'sep',
    tableOps(t),
  ];

  function tableMenu(e, t) {
    openMenuAt(e, tableMenuItems(t));
  }

  const isRealTable = t => t.kind === 'table' || t.kind === 'partitioned table';

  // Vacuum, analyze, optimize: whatever this database system offers, for one table or, with null, for all.
  const maintenanceItems = t => ((S.info && S.info.maintenance) || []).map(m => ({
    label: t ? m.label : `${m.label} every table`,
    icon: 'tool',
    hint: m.hint,
    run: () => maintain(t, m),
  }));

  function tableOps(t) {
    const word = isView(t) ? 'view' : 'table';
    return [
      isRealTable(t) || t.kind === 'materialized view' ? maintenanceItems(t) : null,
      'sep',
      isRealTable(t) ? { label: 'Copy table', icon: 'copy', hint: 'A new table with the same columns, indexes and rows', run: () => copyTable(t) } : null,
      { label: `Rename ${word}`, icon: 'edit', run: () => renameTable(t) },
      'sep',
      isRealTable(t) ? { label: 'Empty this table', icon: 'trash', danger: true, run: () => emptyTable(t) } : null,
      { label: `Drop this ${word}`, icon: 'trash', danger: true, run: () => dropTable(t) },
    ];
  }

  function dbOps() {
    return [
      maintenanceItems(null),
      'sep',
      { label: 'New database', icon: 'plus', run: () => newDatabase(false) },
      { label: 'Copy this database', icon: 'copy', hint: 'A new database with every table and row of this one, for a snapshot before a test', run: () => newDatabase(true) },
      'sep',
      { label: 'Drop this database', icon: 'trash', danger: true, run: dropDatabase },
    ];
  }

  const opsButton = items => h('button', { class: 'btn', title: 'Upkeep, copy, rename and drop', onclick: e => openPopover(e.currentTarget, menuList(items())) },
    icon('tool'), 'Operations', icon('down', 'chev'));

  // ---------------------------------------------------------------- overview

  function renderOverview() {
    const db = dbById(S.db);
    if (!S.tables) {
      put(UI.view, skeleton('grid', 'Loading tables'));
      return;
    }
    let sort = store.get('overviewSort', { key: 'name', dir: 1 });
    let hideEmpty = store.get('hideEmpty', false);
    let q = '';
    let arriving = !reducedMotion();
    const tbody = h('tbody');
    const thead = h('thead');
    const columns = [['name', 'Table'], ['rows', 'Rows'], ['bytes', 'Size'], ['comment', 'Comment']];

    const draw = () => {
      put(thead, h('tr', null, columns.map(([key, label]) =>
        h('th', {
          class: 'sortable' + (sort.key === key ? ' sorted' : ''),
          onclick: () => {
            sort = { key, dir: sort.key === key ? -sort.dir : (key === 'name' || key === 'comment' ? 1 : -1) };
            store.set('overviewSort', sort);
            draw();
          },
        }, h('div', { class: 'th' }, label, sort.key === key ? icon(sort.dir > 0 ? 'up' : 'down', 'sort') : null))),
        h('th', null, h('div', { class: 'th' }, 'Actions'))));
      const list = S.tables
        .filter(t => (!q || tableLabel(t).toLowerCase().includes(q) || (t.comment || '').toLowerCase().includes(q)) && (!hideEmpty || t.rows))
        .sort((a, b) => {
          const x = a[sort.key] ?? '';
          const y = b[sort.key] ?? '';
          return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * sort.dir;
        });
      // The rows come in one after another the first time, not on every key typed in the search.
      put(tbody, list.map((t, i) => h('tr', {
        class: 'clickable' + (arriving && i < 24 ? ' enter' : ''),
        style: arriving && i < 24 ? `--i:${i}` : null,
        onclick: () => openTable(t),
        oncontextmenu: e => tableMenu(e, t),
      },
        h('td', null, h('span', { class: 'th-name' }, icon(isView(t) ? 'view' : 'table'), h('b', null, tableLabel(t)))),
        h('td', { class: 'num' }, t.rows == null ? '' : fmtN(t.rows), t.rows ? meter(t.rows) : null),
        h('td', { class: 'num' }, fmtBytes(t.bytes)),
        h('td', { class: 'comment' }, t.comment || ''),
        h('td', null, rowButtons(t)))),
      list.length ? null : h('tr', null, h('td', { colspan: 5, class: 'empty' }, 'No table matches.')));
      arriving = false;
    };

    // A click on a button does its own job, not the row's "open the data".
    // tone is accent, ok, warn, danger or neutral, one of the colour pairs in app.css.
    const rowButton = (label, name, title, run, tone) => h('button', {
      class: 'btn ' + tone,
      title,
      onclick: e => { e.stopPropagation(); run(e); },
    }, icon(name), label);
    const rowButtons = t => h('div', { class: 'row-actions' },
      rowButton('Browse', 'list', 'Open the rows', () => openTable(t), 'accent'),
      rowButton('Structure', 'structure', 'Columns, indexes, keys and triggers', () => openTable(t, { tab: 'structure' }), 'ok'),
      rowButton('SQL', 'code', 'Query it in SQL', () => queryTable(t), 'accent'),
      isRealTable(t) ? rowButton('Empty', 'x', 'Delete every row and keep the table', () => emptyTable(t), 'warn') : null,
      rowButton('Drop', 'trash', `Drop this ${isView(t) ? 'view' : 'table'}`, () => dropTable(t), 'danger'),
      h('button', {
        class: 'btn neutral icon-only',
        title: 'Upkeep, copy, rename and more',
        onclick: e => { e.stopPropagation(); openPopover(e.currentTarget, menuList(tableMenuItems(t))); },
      }, icon('tool')));

    const totalRows = S.tables.reduce((sum, t) => sum + (t.rows || 0), 0);
    const mostRows = Math.max(1, ...S.tables.map(t => t.rows || 0));
    // A square root keeps small tables visible next to one very large one.
    const meter = rows => h('span', { class: 'meter', style: `width:${Math.max(3, Math.round(Math.sqrt(rows / mostRows) * 90))}px` });

    put(UI.view, h('div', { class: 'overview' },
      h('div', { class: 'ov-head' },
        h('div', null,
          h('div', { class: 'ov-kind' }, h('span', { class: 'dot' }), dbKind(db)),
          h('h1', null, db.name),
          h('div', { class: 'ov-sub' }, db.group, h('span', { class: 'faint' }, db.where))),
        h('div', { class: 'stats' },
          stat('Tables', S.tables.length, fmtN),
          stat('Rows', totalRows, fmtN),
          stat('On disk', S.info ? Number(S.info.size) : null, fmtBytes),
          stat('Server', S.info ? S.info.version.replace('PostgreSQL ', 'PG ') : ''))),
      h('div', { class: 'toolbar' },
        h('label', { class: 'search' }, icon('search'),
          h('input', { class: 'input', type: 'search', placeholder: 'Find a table or a comment', oninput: e => { q = e.target.value.trim().toLowerCase(); draw(); } })),
        h('label', { class: 'check' },
          h('input', { type: 'checkbox', checked: hideEmpty, onchange: e => { hideEmpty = e.target.checked; store.set('hideEmpty', hideEmpty); draw(); } }),
          h('span', null, 'Hide empty tables')),
        h('div', { class: 'spacer' }),
        opsButton(dbOps),
        h('button', { class: 'btn', onclick: () => go({ tab: 'sql' }) }, icon('code'), 'Open SQL')),
      h('div', { class: 'grid-wrap' }, h('table', { class: 'grid overview-table' }, thead, tbody))));
    draw();
  }

  // ----------------------------------------------------------------- formats

  // MySQL also reads a backslash inside quotes as an escape, so it is doubled there.
  function sqlLiteral(v, c) {
    if (v == null) return 'NULL';
    if (c && isBool(c)) return v === 'true' ? 'true' : 'false';
    const text = isMysql() ? String(v).replace(/\\/g, '\\\\') : String(v);
    return "'" + text.replace(/'/g, "''") + "'";
  }
  const csvCell = v => (v == null ? '' : /[",\r\n]/.test(v) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v));

  // Rows as text. cols are column objects whose .i is the value's place in the row.
  function formatRows(format, cols, rows, table) {
    if (format === 'tsv') {
      const clean = v => (v == null ? '' : String(v).replace(/[\t\r\n]+/g, ' '));
      return [cols.map(c => c.name), ...rows.map(r => cols.map(c => clean(r[c.i])))].map(line => line.join('\t')).join('\n');
    }
    if (format === 'csv') {
      return [cols.map(c => csvCell(c.name)), ...rows.map(r => cols.map(c => csvCell(r[c.i])))].map(line => line.join(',')).join('\r\n') + '\r\n';
    }
    if (format === 'json') {
      return JSON.stringify(rows.map(r => Object.fromEntries(cols.map(c => [c.name, r[c.i]]))), null, 2);
    }
    const writable = cols.filter(c => !c.readonly);
    const head = `insert into ${qualified(table)} (${writable.map(c => quoteIdent(c.name)).join(', ')}) values (`;
    return rows.map(r => head + writable.map(c => sqlLiteral(r[c.i], c)).join(', ') + ');').join('\n');
  }

  const FORMATS = {
    tsv: { label: 'for Excel', icon: 'table' },
    csv: { label: 'as CSV', icon: 'list', ext: 'csv', type: 'text/csv' },
    json: { label: 'as JSON', icon: 'code', ext: 'json', type: 'application/json' },
    sql: { label: 'as SQL INSERT', icon: 'database', ext: 'sql', type: 'text/plain' },
  };

  // Copy or download actions for some rows. Excel and CSV take the columns on
  // screen; JSON and SQL take every column, so the rows can go back in.
  function rowActions(mode, rows, shown, all, table) {
    const what = rows.length === 1 ? 'row' : plural(rows.length, 'row');
    const formats = mode === 'copy' ? ['tsv', 'csv', 'json', 'sql'] : ['csv', 'json', 'sql'];
    return formats.filter(f => f !== 'sql' || table).map(f => {
      const cols = f === 'tsv' || f === 'csv' ? shown : all;
      const text = () => (f === 'csv' && mode === 'download' ? '﻿' : '') + formatRows(f, cols, rows, table);
      return {
        label: `${mode === 'copy' ? 'Copy' : 'Download'} ${what} ${FORMATS[f].label}`,
        icon: FORMATS[f].icon,
        run: mode === 'copy'
          ? () => copyText(text(), f === 'tsv' ? 'Copied. Paste it into Excel or Google Sheets.' : `Copied ${FORMATS[f].label}.`)
          : () => download(`${table ? table.name : 'query'}.${FORMATS[f].ext}`, text(), FORMATS[f].type),
      };
    });
  }

  // Ctrl+C in a grid: the selected rows if more than one, else the cell.
  function copyFromGrid(g) {
    const picked = [...g.selected].sort((a, b) => a - b);
    if (picked.length > 1) {
      copyText(formatRows('tsv', g.cols, picked.map(i => g.rows[i])), `${plural(picked.length, 'row')} copied. Paste them into Excel or Google Sheets.`);
    } else if (g.active) {
      const c = g.cols[g.active.ci];
      const v = g.rows[g.active.ri][c.i];
      copyText(v ?? '', v == null ? 'Copied an empty value (NULL).' : `${c.name} copied.`);
    }
  }

  // -------------------------------------------------------------------- data

  const OPS = [
    ['contains', 'contains'], ['not_contains', 'does not contain'],
    ['eq', 'equals'], ['neq', 'does not equal'],
    ['starts', 'starts with'], ['ends', 'ends with'],
    ['gt', 'greater than'], ['gte', 'at least'], ['lt', 'less than'], ['lte', 'at most'],
    ['in', 'is one of'], ['null', 'is NULL'], ['notnull', 'is not NULL'],
  ];

  function renderData() {
    const key = S.db + '|' + tableKey(S.table);
    if (UI.dataKey !== key || UI.view.firstChild !== UI.dataRoot) buildDataView(key);
    UI.searchInput.value = S.search;
    renderFilters();
    loadRows();
  }

  function buildDataView(key) {
    UI.dataKey = key;
    UI.searchInput = h('input', {
      class: 'input',
      type: 'search',
      placeholder: 'Search every column',
      oninput: debounce(e => refine({ search: e.target.value.trim(), page: 1 }), 350),
    });
    UI.filterBar = h('div', { class: 'filter-bar' });
    UI.selectBar = h('div', { class: 'select-bar', hidden: true });
    UI.grid = h('div', { class: 'grid-wrap' });
    UI.pager = h('div', { class: 'pager' });
    UI.colBtn = h('button', { class: 'btn', onclick: e => openColumnMenu(e.currentTarget) }, icon('columns'), h('span', null, 'Columns'));
    UI.addBtn = h('button', { class: 'btn primary', hidden: true, onclick: () => openNewRow() }, icon('plus'), 'Add row');
    UI.importBtn = h('button', { class: 'btn', hidden: true, title: 'Add rows from a CSV file or from Excel', onclick: openImport }, icon('upload'), 'Import');
    UI.dataRoot = h('div', { class: 'data-view' },
      h('div', { class: 'toolbar' },
        h('label', { class: 'search' }, icon('search'), UI.searchInput),
        h('button', { class: 'btn', onclick: () => addFilter() }, icon('filter'), 'Filter'),
        UI.colBtn,
        h('div', { class: 'spacer' }),
        h('button', { class: 'btn', title: 'Download every row that matches', onclick: e => openExportMenu(e.currentTarget) },
          icon('download'), 'Export', icon('down', 'chev')),
        UI.importBtn,
        UI.addBtn),
      UI.filterBar,
      UI.selectBar,
      UI.grid,
      UI.pager);
    put(UI.view, UI.dataRoot);
  }

  let rowsSeq = 0;
  async function loadRows() {
    const seq = ++rowsSeq;
    const table = S.table;
    UI.grid.classList.add('loading');
    forceCloseDrawer();
    try {
      const res = await api('rows', {
        db: S.db, table, page: S.page, perPage: S.perPage, sort: S.sort, search: S.search, filters: S.filters,
      });
      if (seq !== rowsSeq) return;
      S.data = res;
      // A filter can leave the current page past the end. Step back to the last page.
      if (!res.rows.length && res.total > 0 && S.page > 1) {
        refine({ page: Math.ceil(res.total / S.perPage) });
        return;
      }
      renderGrid(true);
      renderPager();
      if (!UI.filterBar.contains(document.activeElement)) renderFilters();
    } catch (e) {
      if (seq !== rowsSeq) return;
      S.data = null;
      S.grid = null;
      put(UI.grid, h('div', { class: 'pad' }, errorBox(e.message)));
      put(UI.pager);
      renderSelectBar();
    } finally {
      if (seq === rowsSeq) UI.grid.classList.remove('loading');
    }
  }

  const hiddenKey = () => `hidden:${S.db}:${tableKey(S.table)}`;
  const hiddenCols = () => new Set(store.get(hiddenKey(), []));
  const allColumns = meta => meta.columns.map((c, i) => ({ ...c, i }));

  function fkMap(meta) {
    const map = new Map();
    for (const fk of meta.fks || []) {
      if (fk.cols.length === 1) map.set(fk.cols[0], { schema: fk.schema, table: fk.tbl, col: fk.ref_cols[0] });
    }
    return map;
  }

  const fkTarget = (fk, value) => ({ db: S.db, table: { schema: fk.schema, name: fk.table }, tab: 'data', ...fresh, filters: [{ col: fk.col, op: 'eq', value }] });
  const followFk = (fk, value) => go(fkTarget(fk, value));

  // arriving is true when the rows were just loaded, so they come in one after another.
  function renderGrid(arriving = false) {
    const { table: meta, rows, page, perPage } = S.data;
    UI.addBtn.hidden = !meta.editable;
    UI.importBtn.hidden = !meta.editable;
    const hidden = hiddenCols();
    UI.colBtn.classList.toggle('on', hidden.size > 0);
    UI.colBtn.lastChild.textContent = hidden.size ? `Columns (${hidden.size} hidden)` : 'Columns';
    const filtered = S.search || S.filters.length;
    S.grid = createGrid(UI.grid, {
      cols: allColumns(meta).filter(c => !hidden.has(c.name)),
      rows,
      start: (page - 1) * perPage,
      pk: new Set(meta.pk),
      fk: fkMap(meta),
      sort: S.sort,
      onSort: col => refine({ sort: nextSort(col), page: 1 }),
      highlight: S.search,
      widthsKey: `widths:${S.db}:${tableKey(S.table)}`,
      selectable: true,
      onOpen: openRow,
      onEdit: editCell,
      onClear: clearCell,
      onPaste: pasteCells,
      onCellMenu: cellMenu,
      onHeaderMenu: headerMenu,
      onSelection: renderSelectBar,
      onActiveRow: ri => {
        // With the row panel open, moving through the grid moves the panel too.
        const d = S.drawer;
        if (d && d.mode === 'view' && d.source === 'table' && d.index !== ri) {
          d.index = ri;
          d.row = rows[ri];
          renderDrawer();
        }
      },
      onCopy: copyFromGrid,
      cascade: arriving,
      empty: filtered ? 'No rows match the search and filters.' : 'This table is empty.',
    });
    renderSelectBar();
  }

  function nextSort(col) {
    const s = S.sort;
    if (!s || s.col !== col) return { col, dir: 'asc' };
    return s.dir === 'asc' ? { col, dir: 'desc' } : null;
  }

  function renderSelectBar() {
    const g = S.grid;
    const picked = g ? [...g.selected].sort((a, b) => a - b) : [];
    UI.selectBar.hidden = picked.length === 0;
    if (!picked.length) {
      put(UI.selectBar);
      return;
    }
    const meta = S.data.table;
    const rows = picked.map(i => S.data.rows[i]);
    put(UI.selectBar,
      h('b', null, `${plural(picked.length, 'row')} selected`),
      h('button', { class: 'btn small', onclick: e => openPopover(e.currentTarget, menuList(rowActions('copy', rows, g.cols, allColumns(meta), S.table))) },
        icon('copy'), 'Copy', icon('down', 'chev')),
      h('button', { class: 'btn small', onclick: e => openPopover(e.currentTarget, menuList(rowActions('download', rows, g.cols, allColumns(meta), S.table))) },
        icon('download'), 'Download', icon('down', 'chev')),
      meta.editable ? h('button', { class: 'btn small', onclick: () => bulkSet(picked) }, icon('edit'), 'Set a value') : null,
      meta.editable ? h('button', { class: 'btn small danger', onclick: () => deleteRows(picked) }, icon('trash'), 'Delete') : null,
      h('div', { class: 'spacer' }),
      h('button', { class: 'btn ghost small', onclick: () => g.clearSelection() }, 'Clear selection'));
  }

  function renderPager() {
    const { total, page, perPage, rows, ms, table: meta } = S.data;
    const pages = Math.max(1, Math.ceil(total / perPage));
    const from = total ? (page - 1) * perPage + 1 : 0;
    const to = (page - 1) * perPage + rows.length;
    const perPageSelect = h('select', {
      class: 'input',
      onchange: e => {
        S.perPage = Number(e.target.value);
        store.set('perPage', S.perPage);
        refine({ page: 1 });
      },
    }, [25, 50, 100, 250, 500, 1000].map(n => h('option', { value: n }, n)));
    perPageSelect.value = String(perPage);

    put(UI.pager,
      h('span', { class: 'muted' }, total ? `Rows ${fmtN(from)} to ${fmtN(to)} of ${fmtN(total)}` : 'No rows'),
      h('span', { class: 'faint' }, `${ms} ms`),
      rows.length ? h('span', { class: 'faint hint' }, meta.editable ? 'Double-click a cell to edit it. Right-click for more.' : 'Right-click a cell for more.') : null,
      h('div', { class: 'spacer' }),
      h('label', { class: 'per-page muted' }, 'Per page', perPageSelect),
      h('button', { class: 'btn icon-only', title: 'Previous page', disabled: page <= 1, onclick: () => refine({ page: page - 1 }, false) }, icon('left')),
      h('span', { class: 'muted' }, 'Page'),
      h('input', {
        class: 'input page-input', type: 'number', min: 1, max: pages, value: String(page),
        onchange: e => refine({ page: clamp(Number(e.target.value), 1, pages) }, false),
      }),
      h('span', { class: 'muted' }, `of ${fmtN(pages)}`),
      h('button', { class: 'btn icon-only', title: 'Next page', disabled: page >= pages, onclick: () => refine({ page: page + 1 }, false) }, icon('right')));
  }

  function addFilter(col) {
    const cols = S.data && S.data.table.columns;
    if (!cols) return;
    S.filters = [...S.filters, { col: col || cols[0].name, op: 'contains', value: '' }];
    renderFilters();
    const inputs = UI.filterBar.querySelectorAll('input');
    if (inputs.length) inputs[inputs.length - 1].focus();
  }

  // A filter from a right-click: applies straight away.
  function addQuickFilter(col, op, value = '') {
    S.filters = [...S.filters.filter(f => !(f.col === col && f.op === op && f.value === value)), { col, op, value }];
    renderFilters();
    refine({ page: 1 }, false);
  }

  function renderFilters() {
    // Until the rows arrive, the filters only know their own columns.
    const cols = S.data && sameTable(S.data.table, S.table) ? S.data.table.columns : S.filters.map(f => ({ name: f.col }));
    const apply = () => refine({ page: 1 });

    put(UI.filterBar, S.filters.map(f => {
      const colSelect = searchable(h('select', { class: 'input', onchange: e => { f.col = e.target.value; renderFilters(); apply(); } },
        [...new Set(cols.map(c => c.name))].map(name => h('option', { value: name }, name))));
      colSelect.value = f.col;
      const opSelect = h('select', { class: 'input', onchange: e => { f.op = e.target.value; renderFilters(); apply(); } },
        OPS.map(([v, label]) => h('option', { value: v }, label)));
      opSelect.value = f.op;
      return h('div', { class: 'filter' },
        colSelect,
        opSelect,
        filterValue(f, cols.find(c => c.name === f.col), apply),
        h('button', {
          class: 'btn ghost icon-only tiny', title: 'Remove this filter',
          onclick: () => { S.filters = S.filters.filter(x => x !== f); renderFilters(); apply(); },
        }, icon('x')));
    }), S.filters.length > 1
      ? h('button', { class: 'btn ghost small', onclick: () => { S.filters = []; renderFilters(); apply(); } }, 'Clear all')
      : null);
  }

  // The value box of a filter: a list for a column with allowed values, a
  // picker for a date, plain text otherwise.
  function filterValue(f, col, apply) {
    if (f.op === 'null' || f.op === 'notnull') return null;
    const exact = ['eq', 'neq'].includes(f.op);
    const kind = col && col.type ? pickerKind(col) : null;
    if (col && col.options && exact) {
      const select = searchable(optionsSelect(col, f.value || null, false));
      if (!f.value) f.value = select.value;
      select.addEventListener('change', e => { f.value = e.target.value; apply(); });
      return select;
    }
    if (kind && (exact || ['gt', 'gte', 'lt', 'lte'].includes(f.op))) {
      return dateBox(kind, f.value, v => { f.value = v; apply(); }).input;
    }
    return h('input', {
      class: 'input',
      placeholder: f.op === 'in' ? 'a, b, c' : 'value',
      value: f.value || '',
      oninput: debounce(e => { f.value = e.target.value; apply(); }, 400),
    });
  }

  function hideColumn(name) {
    const hidden = hiddenCols();
    hidden.add(name);
    store.set(hiddenKey(), [...hidden]);
    renderGrid();
  }

  function openColumnMenu(anchor) {
    const meta = S.data && S.data.table;
    if (!meta) return;
    const hidden = hiddenCols();
    const list = h('div', { class: 'col-list' });
    const find = h('input', { class: 'input', type: 'search', placeholder: 'Find a column', oninput: () => draw() });
    const save = () => { store.set(hiddenKey(), [...hidden]); renderGrid(); draw(); };
    const draw = () => {
      const q = find.value.trim().toLowerCase();
      put(list, meta.columns.filter(c => c.name.toLowerCase().includes(q)).map(c => h('label', { class: 'check' },
        h('input', { type: 'checkbox', checked: !hidden.has(c.name), onchange: e => { if (e.target.checked) hidden.delete(c.name); else hidden.add(c.name); save(); } }),
        h('span', null, c.name),
        h('small', null, c.type))));
    };
    draw();
    openPopover(anchor, h('div', { class: 'menu col-menu' },
      find,
      h('div', { class: 'menu-actions' },
        h('button', { class: 'btn small', onclick: () => { hidden.clear(); save(); } }, 'Show all'),
        h('button', { class: 'btn small', onclick: () => { SETTINGS.audit_columns.forEach(n => { if (meta.columns.some(c => c.name === n)) hidden.add(n); }); save(); } }, 'Hide audit columns'),
        h('button', { class: 'btn small', title: 'Forget the column widths you dragged', onclick: () => { store.set(`widths:${S.db}:${tableKey(S.table)}`, {}); renderGrid(); } }, 'Reset widths')),
      list));
  }

  function openExportMenu(anchor) {
    const total = S.data ? S.data.total : 0;
    openPopover(anchor, menuList([
      { title: `Every matching row, ${plural(total, 'row')}` },
      { label: 'CSV, opens in Excel', icon: 'list', run: () => exportAll('csv') },
      { label: 'JSON', icon: 'code', run: () => exportAll('json') },
      { label: 'SQL INSERT statements', icon: 'database', run: () => exportAll('sql') },
    ]), { alignRight: true });
  }

  async function exportAll(format) {
    const meta = S.data && S.data.table;
    if (!meta) return;
    const hidden = hiddenCols();
    try {
      const res = await api('export', {
        db: S.db, table: S.table, sort: S.sort, search: S.search, filters: S.filters, format,
        columns: meta.columns.map(c => c.name).filter(n => !hidden.has(n)),
      }, true);
      download(`${dbById(S.db).name}-${S.table.name}.${FORMATS[format].ext}`, await res.blob());
      toast('Download started.', 'ok');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  // How often each value of a column appears, over the rows that match.
  async function showValues(colName) {
    const col = S.data.table.columns.find(c => c.name === colName);
    const body = h('div', { class: 'values' }, h('div', { class: 'muted' }, 'Counting...'));
    const modal = openModal({ title: `Values in ${colName}`, body, wide: true });
    try {
      const r = await api('values', { db: S.db, table: S.table, col: colName, search: S.search, filters: S.filters });
      const s = r.stats;
      const most = Math.max(1, ...r.values.map(v => v.n));
      const share = n => (s.total ? Math.round((n / s.total) * 1000) / 10 : 0) + '%';
      put(body,
        h('div', { class: 'stats' },
          stat('Rows', fmtN(s.total)),
          stat('Different values', fmtN(s.distinct_values)),
          stat('NULL', fmtN(s.total - s.filled)),
          s.low != null ? stat('Lowest', short(s.low, 24)) : null,
          s.high != null ? stat('Highest', short(s.high, 24)) : null),
        h('p', { class: 'muted small' }, (S.search || S.filters.length ? 'Counted over the rows that match your search and filters. ' : '') + 'Click a value to show only its rows.'),
        h('div', { class: 'value-list' }, r.values.map(v => h('button', {
          class: 'value-row',
          onclick: () => { modal.close(); addQuickFilter(colName, v.value == null ? 'null' : 'eq', v.value ?? ''); },
        },
        h('span', { class: 'bar', style: `width:${(v.n / most) * 100}%` }),
        h('span', { class: 'value-text' + (monoType(col) ? ' mono' : '') }, v.value == null ? h('span', { class: 'null' }, 'NULL') : v.value),
        h('span', { class: 'value-count' }, fmtN(v.n), h('span', { class: 'faint' }, share(v.n)))))),
        r.values.length >= 100 ? h('p', { class: 'muted small' }, 'Showing the 100 most common values.') : null);
    } catch (e) {
      put(body, errorBox(e.message));
    }
  }

  // One value written into the same column of every selected row.
  function bulkSet(indexes) {
    const meta = S.data.table;
    const rows = S.data.rows;
    const choices = meta.columns.filter(c => !c.readonly);
    const colSelect = searchable(h('select', { class: 'input' }, choices.map(c => h('option', { value: c.name }, `${c.name}  (${c.type})`))));
    const current = S.grid && S.grid.active ? S.grid.cols[S.grid.active.ci] : null;
    if (current && !current.readonly) colSelect.value = current.name;
    const value = h('textarea', { class: 'input mono', rows: 3, placeholder: 'The new value', spellcheck: false });
    const nullBox = h('input', { type: 'checkbox', onchange: e => { value.disabled = e.target.checked; } });
    const apply = h('button', { class: 'btn primary' }, icon('check'), `Set on ${plural(indexes.length, 'row')}`);
    const modal = openModal({
      title: `Set a value on ${plural(indexes.length, 'row')}`,
      body: h('div', { class: 'form-stack' },
        h('label', null, h('span', null, 'Column'), colSelect),
        h('label', null, h('span', null, 'New value'), value),
        h('label', { class: 'check' }, nullBox, h('span', null, 'Set it to NULL instead')),
        h('div', { class: 'callout warn' }, icon('warn'), h('div', null, 'Every selected row gets this value in one go, or none does if one of them fails. The app\'s own rules do not run.'))),
      actions: [h('button', { class: 'btn', onclick: () => modal.close() }, 'Cancel'), apply],
    });
    value.focus();
    apply.addEventListener('click', async () => {
      const col = meta.columns.find(c => c.name === colSelect.value);
      const v = nullBox.checked ? null : value.value;
      if (v !== null && isJson(col)) {
        try { JSON.parse(v); } catch { toast(`${col.name} needs valid JSON.`, 'error'); return; }
      }
      apply.disabled = true;
      try {
        const res = await api('update', { db: S.db, table: S.table, keys: indexes.map(i => keyOf(meta, rows[i])), changes: { [col.name]: v } });
        indexes.forEach((ri, k) => { rows[ri] = res.rows[k]; });
        if (S.data && S.data.rows === rows) indexes.forEach(ri => S.grid.updateRow(ri));
        modal.close();
        toast(`${col.name} set on ${plural(res.rows.length, 'row')}.`, 'ok');
      } catch (e) {
        toast(e.message, 'error');
        apply.disabled = false;
      }
    });
  }

  const deleteRows = indexes => deleteKeys(indexes.map(i => keyOf(S.data.table, S.data.rows[i])), indexes);

  // Rows just deleted fold away before the list reloads.
  function foldRows(indexes) {
    if (!indexes || !S.grid || reducedMotion()) return Promise.resolve();
    for (const i of indexes) if (S.grid.trs[i]) S.grid.trs[i].classList.add('folding');
    return new Promise(done => setTimeout(done, 280));
  }

  // indexes are the rows on screen, when the keys came from the grid.
  async function deleteKeys(keys, indexes = null) {
    const n = keys.length;
    const ok = await confirmBox({
      title: n === 1 ? 'Delete this row?' : `Delete ${plural(n, 'row')}?`,
      body: `${n === 1 ? 'It is' : 'They are'} removed from ${tableLabel(S.table)} for good. Rows in other tables that point here either stop the delete or are deleted too, depending on their foreign key.`,
      confirm: n === 1 ? 'Delete row' : `Delete ${plural(n, 'row')}`,
      danger: true,
    });
    if (!ok) return;
    try {
      await api('delete', { db: S.db, table: S.table, keys });
      forceCloseDrawer();
      await foldRows(indexes);
      bumpCount(-n);
      toast(n === 1 ? 'Row deleted.' : `${plural(n, 'row')} deleted.`, 'ok');
      await loadRows();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  // ------------------------------------------------------- import and empty

  // CSV, or tab separated as Excel and Sheets copy it. Quotes may hold commas
  // and line breaks, and "" inside quotes is one quote.
  function parseDelimited(text, delim) {
    const rows = [];
    let row = [];
    let cell = '';
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (quoted) {
        if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
        else if (ch === '"') quoted = false;
        else cell += ch;
      } else if (ch === '"' && cell === '') {
        quoted = true;
      } else if (ch === delim) {
        row.push(cell);
        cell = '';
      } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cell);
        rows.push(row);
        row = [];
        cell = '';
      } else {
        cell += ch;
      }
    }
    if (cell !== '' || row.length) {
      row.push(cell);
      rows.push(row);
    }
    return rows.filter(r => r.length > 1 || r[0] !== '');
  }

  function openImport() {
    const meta = S.data && S.data.table;
    if (!meta || !meta.editable) return;
    const table = S.table;
    const writable = meta.columns.filter(c => !c.readonly);
    const body = h('div', { class: 'form-stack' });
    const submit = h('button', { class: 'btn primary', disabled: true }, icon('upload'), 'Import');
    const modal = openModal({
      title: `Import rows into ${tableLabel(table)}`,
      body,
      wide: true,
      actions: [h('button', { class: 'btn', onclick: () => modal.close() }, 'Cancel'), submit],
    });

    const fileInput = h('input', { type: 'file', accept: '.csv,.tsv,.txt,text/csv', hidden: true, onchange: async e => { const file = e.target.files[0]; if (file) read(await file.text(), file.name); } });
    const paste = h('textarea', { class: 'input mono', rows: 6, spellcheck: false, placeholder: 'Or paste rows here, copied from Excel, Google Sheets or a CSV file. The first line names the columns.' });
    const drop = h('div', {
      class: 'drop',
      ondragover: e => { e.preventDefault(); drop.classList.add('over'); },
      ondragleave: () => drop.classList.remove('over'),
      ondrop: async e => {
        e.preventDefault();
        drop.classList.remove('over');
        const file = e.dataTransfer.files[0];
        if (file) read(await file.text(), file.name);
      },
    }, icon('upload'), h('div', null, h('b', null, 'Drop a CSV file here'), ' or ', h('button', { class: 'link-button', type: 'button', onclick: () => fileInput.click() }, 'choose one')), fileInput);
    put(body, drop, paste, h('div', null, h('button', { class: 'btn', type: 'button', onclick: () => read(paste.value, 'the pasted rows') }, 'Use the pasted rows')));

    function read(text, source) {
      text = text.replace(/^﻿/, '');
      const firstLine = text.split(/\r?\n/, 1)[0];
      const delim = firstLine.includes('\t') ? '\t' : firstLine.split(';').length > firstLine.split(',').length ? ';' : ',';
      const all = parseDelimited(text, delim);
      if (all.length < 2) {
        toast('The file needs a line of column names and at least one row.', 'error');
        return;
      }
      match(all[0].map(s => s.trim()), all.slice(1), source);
    }

    function match(header, rows, source) {
      const byName = new Map(writable.map(c => [c.name.toLowerCase(), c.name]));
      const status = h('div');
      const emptyNull = h('input', { type: 'checkbox', checked: true });
      const upsert = h('input', { type: 'checkbox' });
      const selects = header.map(name => {
        const select = searchable(h('select', { class: 'input', onchange: check }, h('option', { value: '' }, 'Leave out'), writable.map(c => h('option', { value: c.name }, c.name))));
        select.value = byName.get(name.toLowerCase()) || '';
        return select;
      });
      const sample = i => short(rows.slice(0, 4).map(r => r[i] ?? '').filter(Boolean).join(', '), 56);

      put(body,
        h('p', { class: 'muted', style: 'margin:0' }, `${plural(rows.length, 'row')} read from ${source}. Pick the table column each file column goes into; matching names are picked already.`),
        h('div', { class: 'import-map' }, h('table', { class: 'dense' },
          h('thead', null, h('tr', null, h('th', null, 'In the file'), h('th', null, 'Goes into'), h('th', null, 'First values'))),
          h('tbody', null, header.map((name, i) => h('tr', null,
            h('td', { class: 'name-cell' }, name || `Column ${i + 1}`),
            h('td', null, selects[i]),
            h('td', { class: 'muted' }, sample(i))))))),
        h('label', { class: 'check' }, emptyNull, h('span', null, 'Empty cells become NULL')),
        h('label', { class: 'check' }, upsert, h('span', null, `When a row's ${meta.pk.join(', ')} is already in the table, update that row`)),
        status);

      function check() {
        const chosen = selects.map(s => s.value).filter(Boolean);
        const twice = chosen.length !== new Set(chosen).size;
        upsert.disabled = !meta.pk.every(k => chosen.includes(k));
        if (upsert.disabled) upsert.checked = false;
        submit.disabled = !chosen.length || twice;
        put(submit, icon('upload'), `Import ${plural(rows.length, 'row')}`);
        put(status, twice ? h('div', { class: 'callout warn' }, icon('warn'), h('div', null, 'Two file columns go into the same table column.')) : null);
      }
      check();

      submit.onclick = async () => {
        const pairs = selects.map((s, i) => [s.value, i]).filter(([name]) => name);
        submit.disabled = true;
        try {
          const res = await api('import', {
            db: S.db,
            table,
            columns: pairs.map(([name]) => name),
            rows: rows.map(r => pairs.map(([, i]) => (r[i] === undefined || (r[i] === '' && emptyNull.checked) ? null : r[i]))),
            upsert: upsert.checked,
          });
          modal.close();
          const skipped = res.rows - res.count;
          toast(`Imported ${plural(res.count, 'row')}.` + (skipped ? ` ${plural(skipped, 'row')} left as they were.` : ''), 'ok');
          await refresh();
        } catch (e) {
          put(status, errorBox(e.message));
          submit.disabled = false;
        }
      };
    }
  }

  // A step that cannot be undone. Its button wakes up only once the name is
  // typed, so it is never done by one stray click. run gets the typed name.
  function confirmByName({ title, text, name, button, extra = null, run }) {
    const input = h('input', { class: 'input mono', placeholder: name, spellcheck: false });
    const ok = h('button', { class: 'btn danger solid', disabled: true }, icon('trash'), button);
    input.addEventListener('input', () => { ok.disabled = input.value !== name; });
    const modal = openModal({
      title,
      body: h('div', { class: 'form-stack' }, h('p', { class: 'muted', style: 'margin:0' }, text), input, extra),
      actions: [h('button', { class: 'btn', onclick: () => modal.close() }, 'Cancel'), ok],
    });
    input.focus();
    ok.addEventListener('click', async () => {
      ok.disabled = true;
      try {
        await run(input.value);
        modal.close();
      } catch (e) {
        toast(e.message, 'error');
        ok.disabled = false;
      }
    });
  }

  const tableRef = t => ({ schema: t.schema, name: t.name });

  function emptyTable(t) {
    const cascade = h('input', { type: 'checkbox' });
    confirmByName({
      title: `Empty ${tableLabel(t)}?`,
      text: `Every row of ${t.name} is deleted at once, for good. Type the table name to confirm.`,
      name: t.name,
      button: 'Empty the table',
      // MySQL has no cascade for this, so it only offers the table itself.
      extra: isMysql() ? null : h('label', { class: 'check' }, cascade, h('span', null, 'Also empty every table that points to it (cascade)')),
      run: async confirm => {
        await api('truncate', { db: S.db, table: tableRef(t), confirm, cascade: cascade.checked });
        toast(`${t.name} is empty.`, 'ok');
        await refresh();
      },
    });
  }

  // After a table is dropped or renamed: the list again, and away from a table that is gone.
  async function afterTableChange(open = null) {
    await loadTables();
    if (open) return openTable(open, { tab: S.tab });
    if (S.table && !S.tables.some(x => sameTable(x, S.table))) return go({ table: null, tab: 'overview', ...fresh });
    renderShell();
    renderView();
  }

  function dropTable(t) {
    const word = isView(t) ? 'view' : 'table';
    const cascade = h('input', { type: 'checkbox' });
    const rows = t.rows ? `, with its ${plural(t.rows, 'row')},` : '';
    confirmByName({
      title: `Drop ${tableLabel(t)}?`,
      text: `The ${word} ${t.name}${rows} goes for good. Type its name to confirm.`,
      name: t.name,
      button: `Drop the ${word}`,
      extra: isMysql() ? null : h('label', { class: 'check' }, cascade, h('span', null, 'Also drop the views built on it and the foreign keys that point to it (cascade)')),
      run: async confirm => {
        await api('drop_table', { db: S.db, table: tableRef(t), confirm, cascade: cascade.checked });
        toast(`${t.name} is gone.`, 'ok');
        await afterTableChange();
      },
    });
  }

  async function renameTable(t) {
    const to = await askText({ title: `Rename ${tableLabel(t)}`, value: t.name, confirm: 'Rename' });
    if (!to || to === t.name) return;
    try {
      await api('rename_table', { db: S.db, table: tableRef(t), to });
      toast(`${t.name} is now ${to}.`, 'ok');
      await afterTableChange(sameTable(t, S.table) ? { schema: t.schema, name: to } : null);
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  // A form with one name box and a submit, for the copies and the new database.
  function nameForm({ title, value, placeholder = '', button, buttonIcon, body = [], submit }) {
    const input = h('input', { class: 'input mono', value, placeholder, maxlength: 63, spellcheck: false });
    const ok = h('button', { class: 'btn primary', onclick: () => form.requestSubmit() }, icon(buttonIcon), button);
    const form = h('form', {
      class: 'form-stack',
      onsubmit: async e => {
        e.preventDefault();
        if (!input.value.trim() || ok.disabled) return;
        ok.disabled = true;
        try {
          await submit(input.value.trim(), modal);
        } catch (err) {
          toast(err.message, 'error');
          ok.disabled = false;
        }
      },
    }, h('label', null, 'Name', input), body);
    const modal = openModal({ title, body: form, actions: [h('button', { class: 'btn', onclick: () => modal.close() }, 'Cancel'), ok] });
    input.focus();
    input.select();
  }

  function copyTable(t) {
    const rows = h('input', { type: 'checkbox', checked: true });
    nameForm({
      title: `Copy ${tableLabel(t)}`,
      value: `${t.name}_copy`,
      button: 'Copy',
      buttonIcon: 'copy',
      body: [
        h('label', { class: 'check' }, rows, h('span', null, 'Copy the rows too')),
        h('p', { class: 'muted small', style: 'margin:0' }, 'The columns, defaults, indexes and checks come along. Foreign keys and triggers do not.'),
      ],
      submit: async (to, modal) => {
        const r = await api('copy_table', { db: S.db, table: tableRef(t), to, rows: rows.checked });
        modal.close();
        toast(`${r.name} is a copy of ${t.name}.`, 'ok');
        await loadTables();
        openTable({ schema: t.schema, name: r.name });
      },
    });
  }

  function newDatabase(copy) {
    const db = dbById(S.db);
    const note = !copy ? `An empty database on ${db.where}.`
      : isMysql() ? 'MySQL copies each table with its indexes and rows. Foreign keys, views, triggers and routines stay behind.'
        : `PostgreSQL copies only a database nobody is using, so every open connection to ${db.name} is closed first. The app connects again on its next request.`;
    nameForm({
      title: copy ? `Copy ${db.name}` : 'New database',
      value: copy ? `${db.name}_copy` : '',
      placeholder: 'new_database',
      button: copy ? 'Copy' : 'Create',
      buttonIcon: copy ? 'copy' : 'plus',
      body: h('p', { class: 'muted small', style: 'margin:0' }, note),
      submit: async (name, modal) => {
        const r = await api('create_database', { db: S.db, name, copy });
        modal.close();
        toast([`${name} is ready.`, ...r.notes].join(' '), 'ok');
        await loadDatabases();
        openDb(r.id);
      },
    });
  }

  function dropDatabase() {
    const db = dbById(S.db);
    const rows = (S.tables || []).reduce((sum, t) => sum + (t.rows || 0), 0);
    confirmByName({
      title: `Drop ${db.name}?`,
      text: `The whole database goes for good: ${plural((S.tables || []).length, 'table')} and ${plural(rows, 'row')}.`
        + (isMysql() ? '' : ' Every open connection to it is closed first.') + ' Type its name to confirm.',
      name: db.name,
      button: 'Drop the database',
      run: async confirm => {
        await api('drop_database', { db: db.id, confirm });
        toast(`${db.name} is gone.`, 'ok');
        await loadDatabases();
        await openDb(null);
      },
    });
  }

  // Vacuum, analyze, optimize and the rest. The ones that lock the table ask first.
  async function maintain(t, m) {
    const where = t ? tableLabel(t) : `every table of ${dbById(S.db).name}`;
    if (m.locks && !(await confirmBox({ title: `${m.label} ${where}?`, body: m.hint, confirm: m.label }))) return;
    try {
      const r = await api('maintain', { db: S.db, table: t ? tableRef(t) : null, op: m.op });
      const problems = r.messages.filter(x => x.type === 'error' || x.type === 'warning');
      const size = r.before !== r.after ? ` Its size went from ${fmtBytes(r.before)} to ${fmtBytes(r.after)}.` : '';
      if (problems.length) {
        openModal({
          title: `${m.label}: what the database said`,
          body: dense(['Table', 'Kind', 'Message'], r.messages.map(x => h('tr', null,
            h('td', { class: 'name-cell' }, x.table), h('td', null, h('span', { class: 'tag' + (x.type === 'error' ? ' danger' : x.type === 'warning' ? ' warn' : '') }, x.type)), h('td', null, x.text)))),
          wide: true,
        });
      } else {
        toast(`${m.label} is done on ${where} in ${fmtDuration(r.ms)}.${size}`, 'ok');
      }
      await refresh();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  // Puts SQL in the database's SQL tab and opens it.
  function openInSql(sql) {
    store.set('sql:' + S.db, sql);
    go({ table: null, tab: 'sql', ...fresh });
  }

  // --------------------------------------------------------------- the grid

  // A table of rows with a current cell, row selection, resizable columns and
  // keyboard control. It knows nothing about saving: it calls back for that.
  let gridSeq = 0;
  function createGrid(container, o) {
    const id = 'grid-' + (++gridSeq);
    const cols = o.cols;
    const fk = o.fk || new Map();
    const pk = o.pk || new Set();
    const lead = o.selectable ? 2 : 1;
    const g = { cols, rows: o.rows, selected: new Set(), active: null, activeTd: null, last: null, trs: [] };
    const widths = o.widthsKey ? store.get(o.widthsKey, {}) : {};
    const style = h('style');
    let resizedAt = 0;

    // Column widths live in one small stylesheet, so a drag touches one rule, not every cell.
    const writeWidths = () => {
      style.textContent = cols.map((c, ci) => (widths[c.name]
        ? `.${id} tr > :nth-child(${ci + lead + 1}) { width: ${widths[c.name]}px; min-width: ${widths[c.name]}px; max-width: ${widths[c.name]}px; }`
        : '')).join('\n');
    };
    const saveWidths = () => {
      writeWidths();
      if (o.widthsKey) store.set(o.widthsKey, widths);
    };

    function startResize(e, c, th) {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startW = th.getBoundingClientRect().width;
      document.body.classList.add('resizing');
      const move = ev => {
        widths[c.name] = Math.round(Math.max(50, startW + ev.clientX - startX));
        writeWidths();
      };
      const up = () => {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        document.body.classList.remove('resizing');
        resizedAt = Date.now();
        saveWidths();
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    }

    const allBox = o.selectable ? h('input', {
      type: 'checkbox',
      title: withKey('Select every row on this page', 'selectAll'),
      onchange: e => {
        if (e.target.checked) g.rows.forEach((_, i) => g.selected.add(i));
        else g.selected.clear();
        sync();
      },
    }) : null;

    const headers = cols.map(c => {
      const dir = o.sort && o.sort.col === c.name ? o.sort.dir : null;
      const th = h('th', {
        class: (o.onSort ? 'sortable ' : '') + (dir ? 'sorted' : ''),
        title: [c.name, c.type, c.comment].filter(Boolean).join('\n') + (o.onSort ? '\n\nClick to sort. Right-click for more.' : ''),
        onclick: o.onSort ? () => { if (Date.now() - resizedAt > 250) o.onSort(c.name); } : null,
        oncontextmenu: o.onHeaderMenu ? e => o.onHeaderMenu(e, c, g) : null,
      },
      h('div', { class: 'th' },
        h('span', { class: 'th-name' }, pk.has(c.name) ? icon('key', 'pk') : null, fk.has(c.name) ? icon('link', 'fk') : null, c.name),
        dir ? icon(dir === 'asc' ? 'up' : 'down', 'sort') : null),
      c.type ? h('div', { class: 'th-type' }, c.type) : null,
      h('span', {
        class: 'resize',
        title: 'Drag to resize. Double-click to reset.',
        onmousedown: e => startResize(e, c, th),
        onclick: e => e.stopPropagation(),
        ondblclick: e => { e.stopPropagation(); delete widths[c.name]; saveWidths(); },
      }));
      return th;
    });

    function rowEl(ri) {
      const row = g.rows[ri];
      const on = g.selected.has(ri);
      return h('tr', { class: on ? 'picked' : null, dataset: { i: ri } },
        o.selectable ? h('td', { class: 'pick' }, h('input', { type: 'checkbox', checked: on, tabindex: -1 })) : null,
        h('td', { class: 'rownum' + (o.onOpen ? ' openable' : ''), title: o.onOpen ? withKey('Open this row', 'openRow') : null },
          h('span', { class: 'n' }, (o.start || 0) + ri + 1), o.onOpen ? icon('expand', 'open') : null),
        cols.map((c, ci) => {
          const v = row[c.i];
          return h('td', {
            class: cellClass(c),
            dataset: { c: ci },
            title: v != null && v.length > 40 ? v.slice(0, 1000) : null,
          }, cellView(v, c, fk.get(c.name), o.highlight));
        }));
    }

    function setActive(ri, ci, scroll = false) {
      if (g.activeTd) g.activeTd.classList.remove('active');
      g.active = ri == null ? null : { ri, ci };
      g.activeTd = ri == null ? null : g.trs[ri].children[ci + lead];
      if (g.activeTd) {
        g.activeTd.classList.add('active');
        if (scroll) g.activeTd.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
    }

    function sync() {
      g.trs.forEach((tr, i) => {
        const on = g.selected.has(i);
        tr.classList.toggle('picked', on);
        if (o.selectable) tr.firstChild.firstChild.checked = on;
      });
      if (allBox) {
        allBox.checked = g.rows.length > 0 && g.selected.size === g.rows.length;
        allBox.indeterminate = g.selected.size > 0 && !allBox.checked;
      }
      if (o.onSelection) o.onSelection(g.selected);
    }

    // Shift picks every row between the last one picked and this one.
    function pick(ri, on, range) {
      const from = range && g.last != null ? Math.min(g.last, ri) : ri;
      const to = range && g.last != null ? Math.max(g.last, ri) : ri;
      for (let i = from; i <= to; i++) {
        if (on) g.selected.add(i);
        else g.selected.delete(i);
      }
      g.last = ri;
      sync();
    }

    g.trs = g.rows.map((_, ri) => rowEl(ri));
    // Rows just loaded come in one after another. A saved cell never does this.
    if (o.cascade && !reducedMotion()) {
      g.trs.slice(0, 24).forEach((tr, i) => {
        tr.classList.add('enter');
        tr.style.setProperty('--i', i);
      });
    }
    const tbody = h('tbody', null, g.trs);

    const cellAt = e => {
      const td = e.target.closest('td');
      const tr = td && td.parentElement;
      if (!tr || tr.parentElement !== tbody) return null;
      return { td, ri: Number(tr.dataset.i), ci: td.dataset.c != null ? Number(td.dataset.c) : null };
    };

    tbody.addEventListener('mousedown', e => {
      // Keep the keyboard on the grid, not on a row's checkbox. Shift+click
      // picks rows, so it must not also select the text in between.
      if (e.target.matches('td.pick input') || (o.selectable && e.shiftKey && !e.target.closest('td.editing'))) {
        e.preventDefault();
        container.focus({ preventScroll: true });
      }
    });

    tbody.addEventListener('click', e => {
      const at = cellAt(e);
      if (!at) return;
      if (at.td.classList.contains('pick')) {
        const box = at.td.firstChild;
        if (e.target !== box) box.checked = !box.checked;
        pick(at.ri, box.checked, e.shiftKey);
        return;
      }
      if (at.td.classList.contains('rownum')) {
        if (o.onOpen) o.onOpen(at.ri);
        return;
      }
      if (e.target.closest('a') || at.ci == null || at.td.classList.contains('editing')) return;
      // As in a file list: Shift+click picks every row from the current one to
      // this one, Ctrl+click adds or drops this row.
      if (o.selectable && e.shiftKey) {
        if (g.last == null && g.active) g.last = g.active.ri;
        pick(at.ri, true, true);
      } else if (o.selectable && (e.ctrlKey || e.metaKey)) {
        pick(at.ri, !g.selected.has(at.ri), false);
      }
      setActive(at.ri, at.ci);
      if (o.onActiveRow) o.onActiveRow(at.ri);
    });

    tbody.addEventListener('dblclick', e => {
      const at = cellAt(e);
      if (!at || at.ci == null || e.target.closest('a')) return;
      const selection = window.getSelection();
      if (selection) selection.removeAllRanges();
      if (o.onEdit) o.onEdit(at.ri, at.ci);
      else if (o.onOpen) o.onOpen(at.ri);
    });

    tbody.addEventListener('contextmenu', e => {
      const at = cellAt(e);
      if (!at || !o.onCellMenu) return;
      const ci = at.ci ?? 0;
      if (cols.length) setActive(at.ri, ci);
      o.onCellMenu(e, at.ri, ci, g);
    });

    // The page sends keys here too while nothing has focus, so the grid
    // answers without a click on a cell first.
    function onKey(e) {
      // An open menu takes Esc first; the page-wide handler closes it.
      if (popover && e.key === 'Escape') return;
      const key = e.key;
      const mod = e.ctrlKey || e.metaKey;
      const handled = () => { e.preventDefault(); e.stopPropagation(); };
      if (pressed(e, 'selectAll') && o.selectable) {
        handled();
        g.rows.forEach((_, i) => g.selected.add(i));
        sync();
        return;
      }
      if (pressed(e, 'copy')) {
        handled();
        if (o.onCopy) o.onCopy(g);
        return;
      }

      // Arrows, Tab, Home, End and the page keys move as they do in Excel.
      // Ctrl+Home and Ctrl+End go to the first and the last cell.
      const a = g.active;
      const ri = a ? a.ri : 0;
      const ci = a ? a.ci : 0;
      const lastRow = g.rows.length - 1;
      const lastCol = cols.length - 1;
      const page = Math.max(1, Math.floor(container.clientHeight / ((g.trs[0] && g.trs[0].offsetHeight) || 36)) - 1);
      const moves = {
        ArrowDown: [ri + 1, ci],
        ArrowUp: [ri - 1, ci],
        ArrowLeft: [ri, ci - 1],
        ArrowRight: [ri, ci + 1],
        Tab: [ri, ci + (e.shiftKey ? -1 : 1)],
        PageDown: [ri + page, ci],
        PageUp: [ri - page, ci],
        Home: mod ? [0, 0] : [ri, 0],
        End: mod ? [lastRow, lastCol] : [ri, lastCol],
      };
      const jump = key === 'Home' || key === 'End';
      if (moves[key] && !e.altKey && (!mod || jump)) {
        if (!g.rows.length || !cols.length) return;
        handled();
        // The first key on a grid with no current cell lands on the first cell.
        const [r, c] = a || jump ? moves[key].map((n, i) => clamp(n, 0, i ? lastCol : lastRow)) : [0, 0];
        setActive(r, c, true);
        if (o.onActiveRow) o.onActiveRow(r);
        return;
      }
      if (key === 'Escape') {
        if (g.selected.size) { handled(); g.clearSelection(); }
        else if (a && !S.drawer) { handled(); setActive(null); }
        return;
      }
      if (!a) return;
      if (pressed(e, 'openRow')) {
        handled();
        if (o.onOpen) o.onOpen(a.ri);
      } else if (pressed(e, 'edit')) {
        handled();
        if (o.onEdit) o.onEdit(a.ri, a.ci);
        else if (o.onOpen) o.onOpen(a.ri);
      } else if (pressed(e, 'selectRow') && o.selectable) {
        handled();
        pick(a.ri, !g.selected.has(a.ri), e.shiftKey);
      } else if (pressed(e, 'setNull') && o.onClear) {
        handled();
        o.onClear(a.ri, a.ci);
      }
    }

    function onPaste(e) {
      if (!g.active || !o.onPaste) return;
      e.preventDefault();
      o.onPaste(g.active.ri, g.active.ci, e.clipboardData.getData('text/plain'));
    }

    container.tabIndex = 0;
    container.onkeydown = e => { if (e.target === container) onKey(e); };
    container.onpaste = e => { if (e.target === container) onPaste(e); };

    g.updateRow = ri => {
      const tr = rowEl(ri);
      g.trs[ri].replaceWith(tr);
      g.trs[ri] = tr;
      if (g.active && g.active.ri === ri) setActive(ri, g.active.ci);
      tr.classList.add('flash');
      setTimeout(() => tr.classList.remove('flash'), 1000);
    };
    g.cell = (ri, ci) => g.trs[ri] && g.trs[ri].children[ci + lead];
    g.setActive = setActive;
    g.clearSelection = () => { g.selected.clear(); sync(); };
    g.focus = () => container.focus({ preventScroll: true });
    g.key = onKey;
    g.paste = onPaste;
    g.shown = () => container.isConnected;

    writeWidths();
    put(container,
      style,
      h('table', { class: `grid ${id}` + (o.selectable ? ' has-pick' : '') },
        h('thead', null, h('tr', null,
          o.selectable ? h('th', { class: 'pick' }, allBox) : null,
          h('th', { class: 'rownum' }, '#'),
          headers)),
        tbody),
      g.rows.length ? null : h('div', { class: 'empty' }, o.empty || 'No rows.'));
    return g;
  }

  function cellClass(c) {
    return [c.category === 'number' ? 'num' : '', monoType(c) ? 'mono' : ''].join(' ').trim() || null;
  }

  // The search term, marked wherever it appears in a value.
  function marked(text, q) {
    if (!q) return text;
    const lower = text.toLowerCase();
    const needle = q.toLowerCase();
    let at = lower.indexOf(needle);
    if (at < 0) return text;
    const out = [];
    let from = 0;
    while (at >= 0 && out.length < 60) {
      out.push(text.slice(from, at), h('mark', null, text.slice(at, at + needle.length)));
      from = at + needle.length;
      at = lower.indexOf(needle, from);
    }
    out.push(text.slice(from));
    return out;
  }

  function cellView(v, c, fk, highlight) {
    if (v == null) return h('span', { class: 'null' }, 'NULL');
    if (isBool(c)) return h('span', { class: 'bool ' + (v === 'true' ? 'yes' : 'no') }, v);
    const text = marked(v.length > 300 ? v.slice(0, 300) + '...' : v, highlight);
    if (fk) {
      return h('a', {
        class: 'fk-link',
        href: stateToHash(fkTarget(fk, v)),
        title: `Open the ${fk.table} row where ${fk.col} = ${v}`,
        onclick: e => { if (e.ctrlKey || e.metaKey) return; e.preventDefault(); followFk(fk, v); },
      }, text);
    }
    return text;
  }

  // ---------------------------------------------------- editing in the grid

  const NULL_OPTION = '\u0000null';

  // Double-click or Enter on a cell. Enter or leaving the cell saves, Esc cancels.
  function editCell(ri, ci) {
    if (!S.data) return;
    const g = S.grid;
    const meta = S.data.table;
    const col = g.cols[ci];
    if (!meta.editable) {
      openRow(ri);
      return;
    }
    if (col.readonly) {
      toast(`${col.name} is filled by the database, so it cannot be edited.`);
      return;
    }
    const td = g.cell(ri, ci);
    if (!td || td.querySelector('.cell-editor')) return;
    g.setActive(ri, ci);

    const rows = S.data.rows;
    const old = rows[ri][col.i];
    const json = isJson(col);
    const kind = pickerKind(col);
    const fk = fkMap(meta).get(col.name);
    const shown = old == null ? '' : json ? prettyJson(old) : old;
    const big = !kind && !col.options && !fk && (json || col.category === 'array' || shown.length > 50 || shown.includes('\n'));
    const keep = e => e.preventDefault();

    let input;
    let box = null;
    if (col.options) {
      input = optionsSelect(col, old, col.nullable);
    } else if (isBool(col)) {
      input = h('select', null,
        h('option', { value: 'true' }, 'true'),
        h('option', { value: 'false' }, 'false'),
        col.nullable ? h('option', { value: NULL_OPTION }, 'NULL') : null);
      input.value = old == null ? (col.nullable ? NULL_OPTION : 'false') : old;
    } else if (kind) {
      // Picking a day saves a date straight away. A date with a time waits for Enter.
      box = dateBox(kind, old, () => { if (kind === 'date') commit(read()); });
      input = box.input;
    } else if (big) {
      input = h('textarea', { value: shown, spellcheck: false, rows: Math.min(12, Math.max(4, shown.split('\n').length + 1)) });
    } else {
      input = h('input', { value: shown, spellcheck: false });
    }
    input.classList.remove('input');
    input.classList.add('cell-input');
    if (big || monoType(col)) input.classList.add('mono');

    const read = () => {
      if (input.value === NULL_OPTION) return null;
      return kind ? fromPicker(kind, col, input.value) : input.value;
    };
    const first = read();
    let done = false;
    let ts = null;

    const bar = h('div', { class: 'cell-editor-bar' },
      kind ? h('button', { class: 'btn small', type: 'button', onmousedown: keep, onclick: () => box.set(nowFor(kind)) },
        icon('calendar'), kind === 'date' ? 'Today' : 'Now (UTC)') : null,
      json ? h('button', { class: 'btn small', type: 'button', onmousedown: keep, onclick: () => { input.value = prettyJson(input.value); } }, 'Format JSON') : null,
      col.nullable && !isBool(col) && !col.options
        ? h('button', { class: 'btn small', type: 'button', onmousedown: keep, onclick: () => commit(null) }, 'Set NULL')
        : null,
      h('span', { class: 'faint' }, big ? 'Ctrl+Enter saves, Esc cancels' : 'Enter saves, Esc cancels'));
    const editor = h('div', { class: 'cell-editor' + (big ? ' big' : '') + (fk ? ' with-lookup' : '') }, input, bar,
      fk ? lookupList(fk, input, value => { input.value = value; commit(value); }) : null);

    // The calendar and the dropdown live in <body>, but they are part of the editor.
    const inside = el => editor.contains(el) || (!!box && !!box.calendar && box.calendar.contains(el)) || (!!ts && ts.dropdown.contains(el));
    if (box && box.calendar) {
      // A click on a day keeps the focus in the box, so it does not count as leaving the cell.
      // The year box and the month list need the click to work.
      box.calendar.addEventListener('mousedown', e => { if (!e.target.closest('input, select')) e.preventDefault(); });
      // The calendar opens under the bar, so Now and Set NULL stay in reach.
      box.fp.set('positionElement', bar);
    }

    const close = () => {
      if (done) return;
      done = true;
      const hadFocus = inside(document.activeElement);
      if (ts) ts.destroy();
      if (box) box.destroy();
      editor.remove();
      td.classList.remove('editing');
      if (hadFocus || document.activeElement === document.body) g.focus();
    };

    function commit(value) {
      if (done) return;
      if (value !== null && json) {
        try { JSON.parse(value); } catch {
          toast(`${col.name} needs valid JSON.`, 'error');
          input.focus();
          return;
        }
      }
      // An empty box on a NULL cell stays NULL; it does not become an empty string.
      const unchanged = value === first || (value === null && old === null);
      close();
      if (!unchanged) saveCell(ri, col, value, old, rows);
    }

    function onKey(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close();
      } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || (!big && !e.shiftKey))) {
        e.preventDefault();
        e.stopPropagation();
        commit(read());
      } else if (e.key === 'Tab') {
        e.preventDefault();
        e.stopPropagation();
        commit(read());
        g.setActive(ri, clamp(ci + (e.shiftKey ? -1 : 1), 0, g.cols.length - 1), true);
      }
    }

    // Clicking somewhere else saves, the way a spreadsheet does. Switching to
    // another window does not.
    const onBlur = () => setTimeout(() => {
      if (!done && document.hasFocus() && !inside(document.activeElement)) commit(read());
    }, 0);
    input.addEventListener('keydown', onKey);
    input.addEventListener('blur', onBlur);
    // The focus can sit in the year box or the month list, and leaving those saves too.
    if (box && box.calendar) box.calendar.addEventListener('focusout', onBlur);

    td.classList.add('editing');
    td.append(editor);

    if (col.options && window.TomSelect) {
      // The list opens at once and filters as you type. Picking a value saves it.
      ts = new TomSelect(input, { ...SELECT_OPTIONS, openOnFocus: true });
      ts.on('change', () => commit(read()));
      ts.on('blur', onBlur);
      ts.control_input.addEventListener('keydown', onKey);
      ts.focus();
      return;
    }

    input.focus();
    // The calendar opens straight away. The text is selected, so typing replaces it.
    if (box) box.open();
    if (input.select) input.select();
  }

  // Delete on a cell: NULL, with Undo in the toast like any other edit.
  function clearCell(ri, ci) {
    if (!S.data || !S.data.table.editable) return;
    const col = S.grid.cols[ci];
    const old = S.data.rows[ri][col.i];
    if (col.readonly || old == null) return;
    if (!col.nullable) {
      toast(`${col.name} cannot be NULL.`);
      return;
    }
    saveCell(ri, col, null, old, S.data.rows);
  }

  // An empty pasted value means NULL, except in a text column that must have a value.
  const pastedValue = (col, v) => (v === '' && col.nullable && col.category !== 'text' ? null : v);

  // Ctrl+V on a cell. One value goes into that cell. A block copied from
  // Excel or Sheets fills the cells to the right and below, in one transaction.
  async function pasteCells(ri, ci, text) {
    if (!S.data) return;
    const meta = S.data.table;
    if (!meta.editable) {
      toast('This table has no primary key, so it cannot be edited here.');
      return;
    }
    const g = S.grid;
    const rows = S.data.rows;
    const lines = text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n').map(line => line.split('\t'));

    if (lines.length === 1 && lines[0].length === 1) {
      const col = g.cols[ci];
      if (col.readonly) {
        toast(`${col.name} is filled by the database, so it cannot be edited.`);
        return;
      }
      const value = pastedValue(col, lines[0][0]);
      if (value !== rows[ri][col.i]) saveCell(ri, col, value, rows[ri][col.i], rows);
      return;
    }

    const items = [];
    let cells = 0;
    let left = 0;
    lines.forEach((line, dr) => {
      const r = ri + dr;
      if (r >= rows.length) {
        left += line.length;
        return;
      }
      const changes = {};
      line.forEach((value, dc) => {
        const col = g.cols[ci + dc];
        if (!col || col.readonly) {
          left++;
          return;
        }
        changes[col.name] = pastedValue(col, value);
        cells++;
      });
      if (Object.keys(changes).length) items.push({ ri: r, key: keyOf(meta, rows[r]), changes });
    });
    if (!items.length) return;

    const ok = await confirmBox({
      title: `Paste into ${plural(cells, 'cell')}?`,
      body: `${plural(items.length, 'row')} change, starting at ${g.cols[ci].name} in row ${ri + 1}.`
        + (left ? ` ${plural(left, 'value')} would land past the page or in a column the database fills, so they are left out.` : ''),
      confirm: 'Paste',
    });
    if (!ok) return;
    try {
      const res = await api('update_each', { db: S.db, table: S.table, items: items.map(({ key, changes }) => ({ key, changes })) });
      items.forEach((it, k) => {
        rows[it.ri] = res.rows[k];
        if (S.data && S.data.rows === rows) S.grid.updateRow(it.ri);
      });
      toast(`Pasted into ${plural(cells, 'cell')}.`, 'ok');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function saveCell(ri, col, value, old, rows) {
    const meta = S.data.table;
    const g = S.grid;
    const ci = g.cols.findIndex(c => c.name === col.name);
    const td = ci >= 0 ? g.cell(ri, ci) : null;
    if (td) td.classList.add('saving');
    try {
      const res = await api('update', { db: S.db, table: S.table, keys: [keyOf(meta, rows[ri])], changes: { [col.name]: value } });
      rows[ri] = res.rows[0];
      if (S.data && S.data.rows === rows) {
        S.grid.updateRow(ri);
        const d = S.drawer;
        if (d && d.source === 'table' && d.index === ri && d.mode === 'view') {
          d.row = rows[ri];
          renderDrawer();
        }
      }
      toast(`${col.name} saved.`, 'ok', { label: 'Undo', run: () => saveCell(ri, col, old, value, rows) });
    } catch (e) {
      if (td) td.classList.remove('saving');
      toast(e.message, 'error');
    }
  }

  // ----------------------------------------------------------- right-click

  function cellMenu(e, ri, ci, g) {
    if (!S.data) return;
    const meta = S.data.table;
    const rows = S.data.rows;
    const col = g.cols[ci];
    if (!col) return;
    const row = rows[ri];
    const v = row[col.i];
    const many = g.selected.size > 1 && g.selected.has(ri) ? [...g.selected].sort((a, b) => a - b) : null;
    const fk = fkMap(meta).get(col.name);
    const target = many || [ri];

    openMenuAt(e, [
      { title: many ? `${plural(many.length, 'row')} selected` : `${col.name}: ${v == null ? 'NULL' : short(v)}` },
      { label: 'Copy value', icon: 'copy', kbd: keyLabel('copy'), run: () => copyText(v ?? '', 'Value copied.') },
      rowActions('copy', target.map(i => rows[i]), g.cols, allColumns(meta), S.table).filter(a => !a.label.includes('CSV')),
      'sep',
      v == null
        ? { label: `Show only rows where ${col.name} is NULL`, icon: 'filter', run: () => addQuickFilter(col.name, 'null') }
        : [
          { label: `Show only rows with this ${col.name}`, icon: 'filter', run: () => addQuickFilter(col.name, 'eq', v) },
          { label: `Hide rows with this ${col.name}`, icon: 'eyeOff', run: () => addQuickFilter(col.name, 'neq', v) },
        ],
      { label: `See every value of ${col.name}`, icon: 'chart', run: () => showValues(col.name) },
      fk && v != null ? { label: `Open the linked ${fk.table} row`, icon: 'arrow', run: () => followFk(fk, v) } : null,
      'sep',
      meta.editable && !many ? { label: 'Edit this cell', icon: 'edit', kbd: keyLabel('edit'), disabled: col.readonly, run: () => editCell(ri, ci) } : null,
      meta.editable && !many && col.nullable && !col.readonly && v != null
        ? { label: 'Set to NULL', icon: 'x', run: () => saveCell(ri, col, null, v, rows) }
        : null,
      meta.editable && many ? { label: `Set a value on ${plural(many.length, 'row')}`, icon: 'edit', run: () => bulkSet(many) } : null,
      many ? null : { label: 'Open row details', icon: 'expand', kbd: keyLabel('openRow'), run: () => openRow(ri) },
      meta.editable && !many ? { label: 'Duplicate row', icon: 'copy', run: () => openNewRow(rowObject(meta.columns, row)) } : null,
      meta.editable ? { label: many ? `Delete ${plural(many.length, 'row')}` : 'Delete row', icon: 'trash', danger: true, run: () => deleteRows(target) } : null,
    ]);
  }

  function headerMenu(e, c) {
    const dir = S.sort && S.sort.col === c.name ? S.sort.dir : null;
    openMenuAt(e, [
      { title: `${c.name}  ${c.type}` },
      { label: 'Sort A to Z, low to high', icon: 'up', disabled: dir === 'asc', run: () => refine({ sort: { col: c.name, dir: 'asc' }, page: 1 }) },
      { label: 'Sort Z to A, high to low', icon: 'down', disabled: dir === 'desc', run: () => refine({ sort: { col: c.name, dir: 'desc' }, page: 1 }) },
      dir ? { label: 'Clear the sort', icon: 'x', run: () => refine({ sort: null, page: 1 }) } : null,
      'sep',
      { label: `Filter by ${c.name}`, icon: 'filter', run: () => addFilter(c.name) },
      { label: `See every value of ${c.name}`, icon: 'chart', run: () => showValues(c.name) },
      'sep',
      { label: 'Hide this column', icon: 'eyeOff', run: () => hideColumn(c.name) },
      { label: 'Copy column name', icon: 'copy', run: () => copyText(c.name, 'Column name copied.') },
    ]);
  }

  // ------------------------------------------------------------------ drawer

  // S.drawer = { mode: 'view' | 'edit' | 'new', source: 'table' | 'sql', meta,
  //              row, index, rows, fields, initial, prefill }

  const rowObject = (cols, row) => Object.fromEntries(cols.map((c, i) => [c.name, row[i]]));
  const keyOf = (meta, row) => Object.fromEntries(meta.pk.map(k => [k, row[meta.columns.findIndex(c => c.name === k)]]));

  function openRow(index) {
    if (!S.data) return;
    const { table: meta, rows } = S.data;
    S.drawer = { mode: 'view', source: 'table', meta, index, row: rows[index], rows };
    renderDrawer();
  }

  function openNewRow(prefill = null) {
    if (!S.data || !S.data.table.editable) return;
    S.drawer = { mode: 'new', source: 'table', meta: S.data.table, prefill };
    renderDrawer();
  }

  function markSelected(index) {
    for (const tr of UI.view.querySelectorAll('table.grid > tbody > tr')) {
      tr.classList.toggle('selected', index != null && tr.dataset.i === String(index));
    }
  }

  function forceCloseDrawer() {
    if (!S.drawer) return;
    S.drawer = null;
    UI.drawer.classList.remove('open');
    markSelected(null);
  }

  async function requestCloseDrawer() {
    const d = S.drawer;
    if (d && d.fields && isDirty(d)) {
      const ok = await confirmBox({ title: 'Throw away your changes?', body: 'The changes in this form have not been saved.', confirm: 'Throw away', danger: true });
      if (!ok) return;
    }
    forceCloseDrawer();
  }

  function stepRow(delta) {
    const d = S.drawer;
    if (!d || d.mode !== 'view' || d.index == null) return;
    const next = d.index + delta;
    if (next < 0 || next >= d.rows.length) return;
    d.index = next;
    d.row = d.rows[next];
    renderDrawer();
    const tr = UI.view.querySelector(`table.grid > tbody > tr[data-i="${next}"]`);
    if (tr) tr.scrollIntoView({ block: 'nearest' });
  }

  function renderDrawer() {
    const d = S.drawer;
    if (!d) return;
    UI.drawer.classList.add('open');
    markSelected(d.index);
    if (d.mode === 'view') drawerView(d);
    else drawerForm(d);
  }

  function drawerView(d) {
    const { meta, row } = d;
    const fk = d.source === 'table' ? fkMap(meta) : new Map();
    const pk = new Set(meta.pk || []);
    const obj = rowObject(meta.columns, row);
    const title = d.source === 'table' ? tableLabel(S.table) : 'Query result';
    const sub = meta.pk && meta.pk.length ? meta.pk.map(k => obj[k]).join(', ') : d.index != null ? `Row ${d.index + 1}` : '';

    put(UI.drawer,
      h('header', { class: 'drawer-head' },
        h('div', { class: 'drawer-title' }, h('b', null, title), h('small', { class: 'mono' }, sub)),
        d.index != null ? [
          h('button', { class: 'btn ghost icon-only', title: 'Previous row (Up arrow)', disabled: d.index <= 0, onclick: () => stepRow(-1) }, icon('up')),
          h('button', { class: 'btn ghost icon-only', title: 'Next row (Down arrow)', disabled: d.index >= d.rows.length - 1, onclick: () => stepRow(1) }, icon('down')),
        ] : null,
        h('button', { class: 'btn ghost icon-only', title: 'Close (Esc)', onclick: requestCloseDrawer }, icon('x'))),
      h('div', { class: 'drawer-actions' },
        meta.editable ? [
          h('button', { class: 'btn', onclick: () => { d.mode = 'edit'; d.fields = null; renderDrawer(); } }, icon('edit'), 'Edit'),
          h('button', { class: 'btn', title: 'A new row with these values', onclick: () => openNewRow(obj) }, icon('copy'), 'Duplicate'),
          h('button', { class: 'btn danger', onclick: () => deleteKeys([keyOf(meta, row)], d.source === 'table' && d.index != null ? [d.index] : null) }, icon('trash'), 'Delete'),
        ] : null,
        h('button', { class: 'btn', onclick: () => copyText(JSON.stringify(obj, null, 2), 'Row copied as JSON.') }, icon('copy'), 'Copy JSON')),
      h('div', { class: 'drawer-body' },
        meta.columns.map((c, i) => fieldView(c, row[i], pk.has(c.name), fk.get(c.name))),
        d.source === 'table' && meta.refs && meta.refs.length ? refsSection(d, obj) : null));
  }

  function fieldView(c, v, isPk, fk) {
    let body;
    if (v == null) body = h('span', { class: 'null' }, 'NULL');
    else if (isJson(c)) body = h('pre', { class: 'code' }, prettyJson(v));
    else if (isBool(c)) body = h('span', { class: 'bool ' + (v === 'true' ? 'yes' : 'no') }, v);
    else body = h('div', { class: 'value' + (monoType(c) ? ' mono' : '') }, v);

    return h('div', { class: 'field' },
      h('div', { class: 'field-head' },
        h('span', { class: 'field-name' }, c.name),
        isPk ? h('span', { class: 'badge' }, 'PK') : null,
        fk ? h('span', { class: 'badge fk' }, 'FK') : null,
        h('span', { class: 'field-type' }, c.type || ''),
        v != null ? h('button', { class: 'btn ghost icon-only tiny copy', title: 'Copy value', onclick: () => copyText(v, `${c.name} copied.`) }, icon('copy')) : null),
      body,
      fk && v != null
        ? h('a', { class: 'fk-open', href: stateToHash(fkTarget(fk, v)), onclick: e => { e.preventDefault(); followFk(fk, v); } }, icon('arrow'), `Open in ${fk.table}`)
        : null,
      c.comment ? h('div', { class: 'field-note' }, c.comment) : null);
  }

  function refsSection(d, obj) {
    const title = h('div', { class: 'section-title' }, 'Rows that point here');
    const box = h('div', { class: 'refs' }, title, h('div', { class: 'muted small' }, 'Counting...'));
    api('refs', { db: S.db, table: S.table, row: obj }).then(({ refs }) => {
      if (S.drawer !== d || d.mode !== 'view') return;
      refs.sort((a, b) => (b.count || 0) - (a.count || 0) || a.tbl.localeCompare(b.tbl));
      put(box, title, refs.map(r => {
        const target = r.cols.length === 1 && r.count
          ? { db: S.db, table: { schema: r.schema, name: r.tbl }, tab: 'data', ...fresh, filters: [{ col: r.cols[0], op: 'eq', value: obj[r.ref_cols[0]] }] }
          : null;
        return h(target ? 'a' : 'div', {
          class: 'ref' + (r.count ? '' : ' zero'),
          href: target ? stateToHash(target) : null,
          onclick: target ? e => { e.preventDefault(); go(target); } : null,
        },
        icon('table'),
        h('span', { class: 'grow' }, h('b', null, nameIn(r.schema, r.tbl)), h('span', { class: 'muted' }, '.' + r.cols.join(', '))),
        h('span', { class: 'count' }, r.count == null ? '' : fmtN(r.count)));
      }));
    }).catch(e => put(box, title, errorBox(e.message)));
    return box;
  }

  // A field in the form is in one of three modes: a typed value, NULL, or
  // (for a new row) left to the column's default.
  function initFields(d) {
    const { meta } = d;
    const isNew = d.mode === 'new';
    const orig = isNew ? {} : rowObject(meta.columns, d.row);
    d.fields = {};
    for (const c of meta.columns) {
      let f;
      if (isNew) {
        const pre = d.prefill && Object.hasOwn(d.prefill, c.name) ? d.prefill[c.name] : undefined;
        const copyable = pre !== undefined && !c.readonly && !meta.pk.includes(c.name) && !SETTINGS.audit_columns.includes(c.name);
        if (copyable) f = pre === null ? { mode: 'null', value: '' } : { mode: 'value', value: pre };
        else if (c.default != null || c.readonly) f = { mode: 'default', value: '' };
        else if (c.nullable) f = { mode: 'null', value: '' };
        else f = { mode: 'value', value: isBool(c) ? 'false' : '' };
      } else {
        const v = orig[c.name];
        f = v == null ? { mode: 'null', value: '' } : { mode: 'value', value: isJson(c) ? prettyJson(v) : v };
      }
      d.fields[c.name] = f;
    }
    d.initial = JSON.parse(JSON.stringify(d.fields));
  }

  const fieldChanged = (f, i) => f.mode !== i.mode || (f.mode === 'value' && f.value !== i.value);

  function isDirty(d) {
    return Object.keys(d.fields).some(name => fieldChanged(d.fields[name], d.initial[name]));
  }

  function drawerForm(d) {
    if (!d.fields) initFields(d);
    const isNew = d.mode === 'new';
    const saveBtn = h('button', { class: 'btn primary', onclick: () => saveForm(d, saveBtn) }, icon('check'), isNew ? 'Add row' : 'Save changes');
    // The save key presses this button from anywhere on the page, see the keys section.
    UI.saveBtn = saveBtn;

    put(UI.drawer,
      h('header', { class: 'drawer-head' },
        h('div', { class: 'drawer-title' },
          h('b', null, isNew ? 'New row' : 'Edit row'),
          h('small', null, tableLabel(S.table))),
        h('button', { class: 'btn ghost icon-only', title: 'Close (Esc)', onclick: requestCloseDrawer }, icon('x'))),
      h('div', { class: 'drawer-body' },
        SETTINGS.edit_warning ? h('div', { class: 'callout warn' }, icon('warn'), h('div', null, SETTINGS.edit_warning)) : null,
        d.meta.columns.map(c => fieldEditor(c, d.fields[c.name], d.initial[c.name], isNew, fkMap(d.meta).get(c.name)))),
      h('footer', { class: 'drawer-foot' },
        h('span', { class: 'faint small', style: 'margin-right:auto;align-self:center' }, `${keyLabel('save')} saves`),
        h('button', { class: 'btn', onclick: () => cancelForm(d) }, 'Cancel'),
        saveBtn));

    const first = UI.drawer.querySelector('.drawer-body .input:not(:disabled)');
    if (first) first.focus();
  }

  function fieldEditor(c, f, initial, isNew, fk) {
    const wrap = h('div', { class: 'field edit' });
    const mark = () => wrap.classList.toggle('changed', !isNew && fieldChanged(f, initial));

    const modes = [['value', 'Value']];
    if (c.nullable) modes.push(['null', 'NULL']);
    if (isNew && (c.default != null || c.nullable)) modes.push(['default', 'Default']);

    const draw = () => {
      const enabled = f.mode === 'value' && !c.readonly;
      const shown = f.mode === 'value' ? f.value : '';
      const placeholder = f.mode === 'null' ? 'NULL'
        : f.mode === 'default' ? `Default: ${c.default ?? 'NULL'}`
          : c.readonly ? 'Filled by the database' : '';
      const kind = pickerKind(c);
      let input;
      let extra = null;
      if (c.options && enabled) {
        input = searchable(optionsSelect(c, f.value === '' ? null : f.value, false));
        input.addEventListener('change', e => { f.value = e.target.value; mark(); });
        f.value = input.value;
      } else if (isBool(c) && enabled) {
        input = h('select', { class: 'input', onchange: e => { f.value = e.target.value; mark(); } },
          h('option', { value: 'true' }, 'true'), h('option', { value: 'false' }, 'false'));
        input.value = f.value === 'true' ? 'true' : 'false';
        f.value = input.value;
      } else if (kind && enabled) {
        const box = dateBox(kind, shown, v => { f.value = fromPicker(kind, c, v) ?? ''; mark(); });
        input = box.input;
        extra = h('button', { class: 'btn ghost small', type: 'button', onclick: () => box.set(nowFor(kind)) },
          icon('calendar'), kind === 'date' ? 'Today' : 'Now (UTC)');
      } else if (isJson(c) || c.category === 'array' || (c.category === 'text' && (shown.length > 60 || shown.includes('\n')))) {
        input = h('textarea', {
          class: 'input' + (monoType(c) ? ' mono' : ''),
          rows: Math.min(14, Math.max(2, shown.split('\n').length)),
          disabled: !enabled, value: shown, placeholder, spellcheck: false,
          oninput: e => { f.value = e.target.value; mark(); },
        });
        if (isJson(c) && enabled) {
          extra = h('button', {
            class: 'btn ghost small', type: 'button',
            onclick: () => { input.value = prettyJson(input.value); input.dispatchEvent(new Event('input')); },
          }, 'Format JSON');
        }
      } else {
        input = h('input', {
          class: 'input' + (monoType(c) ? ' mono' : ''),
          disabled: !enabled, value: shown, placeholder, spellcheck: false,
          oninput: e => { f.value = e.target.value; mark(); },
        });
      }
      const lookup = fk && enabled
        ? lookupList(fk, input, value => { input.value = value; f.value = value; mark(); })
        : null;

      put(wrap,
        h('div', { class: 'field-head' },
          h('span', { class: 'field-name' }, c.name),
          !c.nullable && !c.readonly && c.default == null ? h('span', { class: 'req', title: 'Required' }, '*') : null,
          h('span', { class: 'field-type' }, c.type),
          extra,
          c.readonly
            ? h('span', { class: 'badge plain', style: 'margin-left:auto' }, 'auto')
            : modes.length > 1
              ? h('div', { class: 'seg' }, modes.map(([m, label]) => h('button', {
                type: 'button',
                class: f.mode === m ? 'on' : '',
                onclick: () => {
                  f.mode = m;
                  if (m === 'value' && isBool(c) && f.value !== 'true') f.value = 'false';
                  draw();
                  mark();
                  if (m === 'value') { const el = wrap.querySelector('.input'); if (el) el.focus(); }
                },
              }, label)))
              : null),
        input,
        lookup,
        c.comment ? h('div', { class: 'field-note' }, c.comment) : null);
    };

    draw();
    mark();
    return wrap;
  }

  async function cancelForm(d) {
    if (isDirty(d)) {
      const ok = await confirmBox({ title: 'Throw away your changes?', body: 'The changes in this form have not been saved.', confirm: 'Throw away', danger: true });
      if (!ok) return;
    }
    if (d.mode === 'edit') {
      d.mode = 'view';
      d.fields = null;
      renderDrawer();
    } else {
      forceCloseDrawer();
    }
  }

  async function saveForm(d, btn) {
    const { meta } = d;
    const isNew = d.mode === 'new';
    const out = {};
    for (const c of meta.columns) {
      const f = d.fields[c.name];
      if (c.readonly || f.mode === 'default') continue;
      if (!isNew && !fieldChanged(f, d.initial[c.name])) continue;
      if (f.mode === 'null') { out[c.name] = null; continue; }
      if (isJson(c)) {
        try { JSON.parse(f.value); } catch {
          toast(`${c.name} is not valid JSON.`, 'error');
          return;
        }
      }
      out[c.name] = f.value;
    }
    if (!isNew && !Object.keys(out).length) {
      toast('Nothing has changed.');
      return;
    }

    btn.disabled = true;
    try {
      if (isNew) {
        const { row } = await api('insert', { db: S.db, table: S.table, values: out });
        bumpCount(1);
        await loadRows();
        if (!row) {
          // The database filled the key itself and cannot say what it became, so the row is found in the list instead.
          forceCloseDrawer();
          toast('Row added.', 'ok');
          return;
        }
        const pkIdx = meta.pk.map(k => meta.columns.findIndex(c => c.name === k));
        const index = S.data ? S.data.rows.findIndex(r => pkIdx.every(i => r[i] === row[i])) : -1;
        S.drawer = index >= 0
          ? { mode: 'view', source: 'table', meta, index, row: S.data.rows[index], rows: S.data.rows }
          : { mode: 'view', source: 'table', meta, index: null, row, rows: [] };
        renderDrawer();
        toast('Row added.', 'ok');
      } else {
        const res = await api('update', { db: S.db, table: S.table, keys: [keyOf(meta, d.row)], changes: out });
        const row = res.rows[0];
        if (d.index != null && S.data && S.data.rows === d.rows) {
          S.data.rows[d.index] = row;
          S.grid.updateRow(d.index);
        }
        d.row = row;
        d.mode = 'view';
        d.fields = null;
        renderDrawer();
        toast('Saved.', 'ok');
      }
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      btn.disabled = false;
    }
  }

  // --------------------------------------------------------------- structure


  async function renderStructure() {
    const key = S.db + '|' + tableKey(S.table);
    put(UI.view, skeleton('cards', 'Reading the structure'));
    try {
      const s = await api('structure', { db: S.db, table: S.table });
      if (S.tab !== 'structure' || key !== S.db + '|' + tableKey(S.table)) return;
      put(UI.view, structureView(s));
    } catch (e) {
      put(UI.view, h('div', { class: 'pad' }, errorBox(e.message)));
    }
  }

  // action is an optional button on the right of the card's heading.
  function card(title, count, body, action = null) {
    return h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h3', null, title), count != null ? h('span', { class: 'tag' }, count) : null, action ? [h('div', { class: 'spacer' }), action] : null),
      body);
  }

  function dense(headers, rows) {
    return h('table', { class: 'dense' },
      h('thead', null, h('tr', null, headers.map(x => h('th', null, x)))),
      h('tbody', null, rows));
  }

  // The table in the middle with its columns, the tables that point to it on
  // the left and the tables it points to on the right, joined column to column.
  function relationsCard(t) {
    const here = { schema: t.schema, name: t.name };
    const incoming = new Map();
    const outgoing = new Map();
    const group = (map, r, cols) => {
      const key = `${r.schema}.${r.tbl}`;
      if (!map.has(key)) map.set(key, { schema: r.schema, name: r.tbl, links: [] });
      cols.forEach((col, i) => map.get(key).links.push({ col, other: (map === incoming ? r.ref_cols : r.cols)[i] }));
    };
    t.refs.filter(r => !sameTable({ schema: r.schema, name: r.tbl }, here)).forEach(r => group(incoming, r, r.cols));
    t.fks.forEach(r => group(outgoing, r, r.ref_cols));

    if (!incoming.size && !outgoing.size) {
      return card('Relations', null, h('div', { class: 'card-body muted' }, 'No other table points to this one, and it points to none.'), diagramButton(t));
    }

    const count = n => {
      const found = S.tables && S.tables.find(x => sameTable(x, n));
      return found && found.rows != null ? plural(found.rows, 'row') : '';
    };
    const pk = new Set(t.pk);
    const fk = fkMap(t);
    const links = [];
    const node = (n, side, i) => {
      const el = h('button', {
        type: 'button',
        class: 'erd-node ' + side,
        style: `--i:${i + 1}`,
        title: `Open the structure of ${n.name}`,
        onclick: () => openTable({ schema: n.schema, name: n.name }, { tab: 'structure' }),
        onmouseenter: () => hot(el, true),
        onmouseleave: () => hot(el, false),
      },
      h('div', { class: 'erd-head' }, icon('table'), h('b', null, nameIn(n.schema, n.name)), h('small', null, count(n))),
      [...new Set(n.links.map(l => l.col))].map(col => h('div', { class: 'erd-col', dataset: { col } }, col)));
      n.links.forEach(l => links.push({ node: el, side, col: l.col, other: l.other }));
      return el;
    };

    const center = h('div', { class: 'erd-node center' },
      h('div', { class: 'erd-head' }, icon('table'), h('b', null, tableLabel(t)), h('small', null, count(here))),
      t.columns.map(c => h('div', { class: 'erd-col' + (pk.has(c.name) ? ' is-pk' : '') + (fk.has(c.name) ? ' is-fk' : ''), dataset: { col: c.name } },
        h('span', { class: 'grow' }, c.name),
        pk.has(c.name) ? h('span', { class: 'badge' }, 'PK') : fk.has(c.name) ? h('span', { class: 'badge fk' }, 'FK') : null)));

    const left = h('div', { class: 'erd-side left' }, [...incoming.values()].map((n, i) => node(n, 'left', i)));
    const right = h('div', { class: 'erd-side right' }, [...outgoing.values()].map((n, i) => node(n, 'right', i)));
    const SVG = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('class', 'erd-lines');
    const canvas = h('div', { class: 'erd' }, svg, left, center, right);
    const paths = [];
    // The lines draw themselves in when the card first appears, not on each redraw after a resize.
    const born = performance.now();

    function hot(el, on) {
      el.classList.toggle('hot', on);
      paths.forEach(p => { if (p.node === el) p.path.classList.toggle('hot', on); });
    }

    // Lines are drawn after layout, from the edge of one column's row to the other's, and again on resize.
    function draw() {
      if (!canvas.isConnected) {
        observer.disconnect();
        return;
      }
      const base = canvas.getBoundingClientRect();
      const edge = (el, onRight) => {
        const r = el.getBoundingClientRect();
        return [(onRight ? r.right : r.left) - base.left, r.top + r.height / 2 - base.top];
      };
      svg.setAttribute('width', canvas.scrollWidth);
      svg.setAttribute('height', canvas.scrollHeight);
      paths.length = 0;
      const drawn = links.map(l => {
        const theirs = l.node.querySelector(`[data-col="${CSS.escape(l.col)}"]`);
        const ours = center.querySelector(`[data-col="${CSS.escape(l.other)}"]`) || center.firstChild;
        // Arrows run from the column holding the key to the column it points at.
        const [x1, y1] = l.side === 'left' ? edge(theirs, true) : edge(ours, true);
        const [x2, y2] = l.side === 'left' ? edge(ours, false) : edge(theirs, false);
        const dx = Math.max(30, (x2 - x1) / 2);
        const path = document.createElementNS(SVG, 'path');
        path.setAttribute('d', `M${x1} ${y1} C${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2 - 6} ${y2}`);
        path.setAttribute('marker-end', 'url(#erd-arrow)');
        if (performance.now() - born < 600) {
          path.setAttribute('pathLength', '1');
          path.setAttribute('class', 'draw-in');
        }
        paths.push({ node: l.node, path });
        return path;
      });
      svg.innerHTML = '<defs><marker id="erd-arrow" viewBox="0 0 8 8" refX="1" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L8 4 L0 8 z"/></marker></defs>';
      drawn.forEach(p => svg.append(p));
    }
    const observer = new ResizeObserver(() => draw());
    observer.observe(canvas);

    return card('Relations', null, h('div', null,
      h('div', { class: 'erd-legend muted small' },
        incoming.size ? `Left: ${plural(incoming.size, 'table')} that point here.` : '',
        outgoing.size ? ` Right: ${plural(outgoing.size, 'table')} this one points to.` : '',
        ' Click a table to open it.'),
      h('div', { class: 'erd-scroll' }, canvas)), diagramButton(t));
  }

  // A number from the database's own counters, as the Upkeep card shows it.
  function upkeepValue(u) {
    if (u.type === 'time') return u.value == null ? 'never' : timeAgo(u.value);
    if (u.value == null) return '';
    return u.type === 'number' ? fmtN(u.value) : u.type === 'bytes' ? fmtBytes(u.value) : String(u.value);
  }

  // The choices in the type box. Any other type the database knows can be typed in.
  const COLUMN_TYPES = {
    pgsql: ['integer', 'bigint', 'smallint', 'numeric(10,2)', 'real', 'double precision', 'boolean', 'text', 'varchar(255)', 'char(2)',
      'date', 'timestamp', 'timestamptz', 'time', 'interval', 'uuid', 'jsonb', 'json', 'bytea', 'text[]', 'integer[]'],
    mysql: ['int', 'bigint', 'smallint', 'tinyint(1)', 'decimal(10,2)', 'double', 'varchar(255)', 'char(36)', 'text', 'mediumtext', 'longtext',
      'date', 'datetime', 'timestamp', 'time', 'json', 'blob', "enum('a','b')"],
  };

  // Adds a column to t, or changes c. The SQL it would run shows as you type,
  // and Save stays off until that SQL matches what is in the form, so Save
  // runs exactly what is on screen.
  function columnForm(t, c) {
    const kinds = [['none', 'None'], ['text', 'Text'], ['sql', 'SQL']];
    const hints = {
      none: 'No default. A new row without a value gets NULL, or is refused when NULL is not allowed.',
      text: 'Written as a value. The quotes are added for you.',
      sql: "An SQL expression, such as 0, now() or 'draft' with its quotes.",
    };
    let mode = c && c.default_sql != null ? 'sql' : 'none';
    let asked = 0;

    const name = h('input', { class: 'input mono', value: c ? c.name : '', maxlength: 63, spellcheck: false, placeholder: 'column_name', oninput: () => changed() });
    // The whole list opens on focus and filters as you type. A type not in it,
    // such as varchar(80) or an enum type, is taken as typed.
    const types = [...new Set([...(c ? [c.type] : []), ...COLUMN_TYPES[isMysql() ? 'mysql' : 'pgsql']])];
    const type = searchable(h('select', { class: 'input mono', onchange: () => changed() },
      c ? null : h('option', { value: '' }, 'Pick or type a type'),
      types.map(x => h('option', { value: x, selected: c && x === c.type }, x))),
    { create: true, createOnBlur: true, persist: false, openOnFocus: true, allowEmptyOption: false, placeholder: 'Pick or type a type' });
    const nullable = h('input', { type: 'checkbox', checked: c ? c.nullable : true, onchange: () => changed() });
    const value = h('input', { class: 'input mono', value: c && c.default_sql != null ? c.default_sql : '', spellcheck: false, oninput: () => changed() });
    const comment = h('input', { class: 'input', value: c ? c.comment || '' : '', oninput: () => changed() });
    const hint = h('p', { class: 'muted small', style: 'margin:0' });
    const retype = h('div');
    const preview = h('div');
    const save = h('button', { class: 'btn primary', disabled: true, onclick: () => form.requestSubmit() }, icon('check'), c ? 'Save changes' : 'Add column');

    const spec = () => ({ name: name.value.trim(), type: type.value.trim(), nullable: nullable.checked, default: { mode, value: value.value }, comment: comment.value });
    const request = run => ({ db: S.db, table: tableRef(t), column: c ? c.name : null, spec: spec(), run });

    const check = debounce(async () => {
      const n = ++asked;
      try {
        const r = await api('save_column', request(false), false, true);
        if (n !== asked) return;
        put(preview, r.sql.length
          ? h('pre', { class: 'code' }, r.sql.join(';\n') + ';')
          : h('p', { class: 'muted', style: 'margin:0' }, 'Nothing to change yet.'));
        save.disabled = !r.sql.length;
      } catch (e) {
        if (n === asked) put(preview, errorBox(e.message));
      }
    }, 250);

    function changed() {
      save.disabled = true;
      value.hidden = mode === 'none';
      hint.textContent = hints[mode];
      put(retype, c && type.value.trim() !== c.type
        ? h('div', { class: 'callout warn' }, icon('warn'), h('div', null, 'Every value is converted to the new type. If one cannot be, nothing changes.'))
        : null);
      check();
    }

    const form = h('form', {
      class: 'form-stack',
      onsubmit: async e => {
        e.preventDefault();
        if (save.disabled) return;
        save.disabled = true;
        try {
          await api('save_column', request(true));
          modal.close();
          toast(c ? `${c.name} changed.` : `${spec().name} added.`, 'ok');
          await afterColumnChange();
        } catch (err) {
          put(preview, errorBox(err.message));
        }
      },
    },
    h('div', { class: 'form-pair' }, h('label', null, 'Name', name), h('label', null, 'Type', type)),
    retype,
    h('label', { class: 'check' }, nullable, h('span', null, 'Allows NULL')),
    h('div', { class: 'form-stack tight' },
      h('span', { class: 'field-label' }, 'Default'),
      segmented(kinds, mode, v => { mode = v; changed(); if (v !== 'none') value.focus(); }),
      value,
      hint),
    h('label', null, 'Comment', comment),
    h('div', { class: 'form-stack tight' }, h('span', { class: 'field-label' }, 'SQL that runs'), preview));

    const modal = openModal({
      title: c ? `Change ${c.name}` : `Add a column to ${tableLabel(t)}`,
      body: form,
      wide: true,
      actions: [h('button', { class: 'btn', onclick: () => modal.close() }, 'Cancel'), save],
    });
    changed();
    name.focus();
  }

  function dropColumn(t, c) {
    const cascade = h('input', { type: 'checkbox' });
    confirmByName({
      title: `Drop ${c.name}?`,
      text: `The column ${c.name} of ${t.name} goes for good, with every value in it. Type its name to confirm.`,
      name: c.name,
      button: 'Drop the column',
      extra: isMysql() ? null : h('label', { class: 'check' }, cascade, h('span', null, 'Also drop the views and constraints that use it (cascade)')),
      run: async confirm => {
        await api('drop_column', { db: S.db, table: tableRef(t), column: c.name, confirm, cascade: cascade.checked });
        toast(`${c.name} is gone.`, 'ok');
        await afterColumnChange();
      },
    });
  }

  // The SQL editor's suggestions and the diagram read the columns again, and the sizes may have moved.
  async function afterColumnChange() {
    delete schemaCache[S.db];
    await refresh();
  }

  function structureView(s) {
    const t = s.table;
    const fk = fkMap(t);
    const pk = new Set(t.pk);
    const info = S.tables.find(x => sameTable(x, t));
    // PostgreSQL counts the reads of each index. MySQL does not say.
    const counted = s.indexes.some(ix => ix.scans != null);
    // A view takes its columns from its query, so only a table's can change here.
    const alterable = isRealTable(t);

    return h('div', { class: 'structure' },
      h('div', { class: 'card' }, h('div', { class: 'card-body' },
        h('div', { style: 'display:flex;gap:24px;align-items:flex-end;flex-wrap:wrap' },
          h('div', null,
            h('h2', { style: 'font-size:18px' }, tableLabel(t)),
            h('div', { class: 'muted' }, t.kind, t.editable ? '' : ', read only here'),
            t.comment ? h('div', { style: 'margin-top:6px;max-width:720px' }, t.comment) : null),
          h('div', { class: 'stats' },
            stat('Rows', info ? info.rows : null, fmtN),
            stat('Columns', t.columns.length, fmtN),
            stat('Data', Number(s.sizes.data), fmtBytes),
            stat('Indexes', Number(s.sizes.indexes), fmtBytes),
            stat('Total', Number(s.sizes.total), fmtBytes)),
          opsButton(() => tableOps(info || t))))),

      s.upkeep && s.upkeep.length ? card('Upkeep', null, h('div', { class: 'card-body' },
        h('div', { class: 'stats upkeep' }, s.upkeep.map(u => stat(u.label, upkeepValue(u)))))) : null,

      relationsCard(t),

      card('Columns', t.columns.length, dense(['Name', 'Type', 'Null', 'Default', 'Points to', 'Comment', alterable ? '' : null].filter(x => x != null),
        t.columns.map(c => {
          const ref = fk.get(c.name);
          return h('tr', null,
            h('td', { class: 'name-cell' }, c.name, pk.has(c.name) ? h('span', { class: 'badge' }, 'PK') : null, c.readonly ? h('span', { class: 'badge plain' }, 'auto') : null),
            h('td', null, h('span', { class: 'mono' }, c.type),
              c.options ? h('div', { class: 'options' }, c.options.map(o => h('span', { class: 'tag' }, o))) : null),
            h('td', null, c.nullable ? h('span', { class: 'muted' }, 'yes') : h('b', null, 'no')),
            h('td', { class: 'mono' }, c.default || ''),
            h('td', null, ref ? h('a', { href: '#', onclick: e => { e.preventDefault(); openTable({ schema: ref.schema, name: ref.table }); } }, `${ref.table}.${ref.col}`) : ''),
            h('td', { class: 'muted' }, c.comment || ''),
            alterable ? h('td', null, h('div', { class: 'row-actions' },
              h('button', { class: 'btn accent icon-only', title: `Change ${c.name}`, onclick: () => columnForm(t, c) }, icon('edit')),
              h('button', { class: 'btn danger icon-only', title: `Drop ${c.name}`, onclick: () => dropColumn(t, c) }, icon('trash')))) : null);
        })), alterable ? h('button', { class: 'btn', onclick: () => columnForm(t, null) }, icon('plus'), 'Add column') : null),

      s.view ? card('View definition', null, h('div', { class: 'card-body' }, h('pre', { class: 'code' }, s.view))) : null,

      card('Indexes', s.indexes.length, s.indexes.length
        ? dense(['Name', 'Definition', 'Size', counted ? 'Reads' : null].filter(Boolean), s.indexes.map(ix => h('tr', null,
          h('td', { class: 'name-cell' }, ix.name, ix.is_primary ? h('span', { class: 'badge' }, 'PK') : ix.is_unique ? h('span', { class: 'badge fk' }, 'unique') : null),
          h('td', { class: 'mono' }, ix.definition),
          h('td', { class: 'num muted' }, fmtBytes(ix.bytes)),
          counted ? h('td', { class: 'num muted', title: 'Times a query read through this index since the counts were reset' }, fmtN(ix.scans)) : null)))
        : h('div', { class: 'card-body muted' }, 'No indexes.')),

      card('Constraints', s.constraints.length, s.constraints.length
        ? dense(['Name', 'Kind', 'Definition'], s.constraints.map(c => h('tr', null,
          h('td', { class: 'name-cell' }, c.name),
          h('td', null, h('span', { class: 'tag' }, c.kind)),
          h('td', { class: 'mono' }, c.definition))))
        : h('div', { class: 'card-body muted' }, 'No constraints.')),

      s.triggers.length ? card('Triggers', s.triggers.length, dense(['Name', 'Definition'], s.triggers.map(tr => h('tr', null,
        h('td', { class: 'name-cell' }, tr.name),
        h('td', { class: 'mono' }, tr.definition))))) : null,

      t.refs.length ? card('Tables that point here', t.refs.length, dense(['Table', 'Column', 'To', 'Foreign key'], t.refs.map(r => h('tr', null,
        h('td', { class: 'name-cell' }, h('a', { href: '#', onclick: e => { e.preventDefault(); openTable({ schema: r.schema, name: r.tbl }); } }, nameIn(r.schema, r.tbl))),
        h('td', { class: 'mono' }, r.cols.join(', ')),
        h('td', { class: 'mono' }, r.ref_cols.join(', ')),
        h('td', { class: 'mono muted' }, r.name))))) : null);
  }

  // ----------------------------------------------------------------- diagram

  // The catalog of each database and the views of it you saved, read once
  // and read again after the list of tables changes.
  const diagramCache = {};
  const loadDiagram = () => (diagramCache[S.db] ??= api('diagram', { db: S.db }).catch(e => {
    delete diagramCache[S.db];
    throw e;
  }));

  // A saved or deleted view changes the list the cached answer holds.
  const cacheViews = (db, views) => {
    if (diagramCache[db]) diagramCache[db] = diagramCache[db].then(answer => ({ ...answer, views }));
  };

  // View names are the same when they differ only in the case of A to Z, as the server sees them.
  const viewName = name => name.replace(/[A-Z]/g, c => c.toLowerCase());

  // A database with more tables than this opens on the start panel. Nobody
  // reads a few hundred boxes at once, and drawing them all is slow too.
  const DIAGRAM_WHOLE = 40;

  // The diagram on screen, from assets/diagram.js, or null.
  let diagram = null;

  const showInDiagram = t => go({ table: null, tab: 'diagram', ...fresh, focus: tableKey(t) });
  const diagramButton = t => h('button', {
    class: 'btn small',
    title: 'The diagram, with this table and the tables linked to it',
    onclick: () => showInDiagram(t),
  }, icon('diagram'), 'Show in diagram');

  // Asks which tables to show, from a list too long to show all at once. one
  // asks for a single table. Gives the keys picked.
  function pickTables({ title, choices, anchor, one = false }) {
    return new Promise(resolve => {
      const picked = new Set();
      const list = h('div', { class: 'col-list' });
      const done = keys => {
        closePopover();
        resolve(keys);
      };
      const find = h('input', {
        class: 'input',
        type: 'search',
        placeholder: 'Find a table',
        spellcheck: false,
        oninput: () => draw(),
        onkeydown: e => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          const first = matches()[0];
          if (first && one) done([first.key]);
        },
      });
      const matches = () => {
        const q = find.value.trim().toLowerCase();
        return choices.filter(c => c.label.toLowerCase().includes(q));
      };
      const showPicked = h('button', { class: 'btn small primary', disabled: true, onclick: () => done([...picked]) }, 'Show checked');
      const check = c => h('label', { class: 'check' },
        h('input', {
          type: 'checkbox',
          checked: picked.has(c.key),
          onchange: e => {
            if (e.target.checked) picked.add(c.key);
            else picked.delete(c.key);
            showPicked.disabled = !picked.size;
            showPicked.textContent = picked.size ? `Show ${plural(picked.size, 'table')}` : 'Show checked';
          },
        }),
        h('span', { class: 'mono' }, c.label),
        h('small', null, plural(c.links, 'link')));
      const choose = c => h('button', { class: 'menu-item', onclick: () => done([c.key]) },
        h('span', { class: 'grow mono' }, c.label), h('small', { class: 'faint' }, plural(c.links, 'link')));
      const draw = () => {
        const shown = matches().slice(0, 300);
        put(list, shown.length ? shown.map(one ? choose : check) : h('div', { class: 'menu-error' }, 'No table matches.'));
      };
      draw();
      openPopover(anchor, h('div', { class: 'menu col-menu' },
        h('div', { class: 'menu-title' }, title),
        find,
        one ? null : h('div', { class: 'menu-actions' },
          showPicked,
          h('button', { class: 'btn small', onclick: () => done(choices.map(c => c.key)) }, `Show all ${fmtN(choices.length)}`)),
        list));
    });
  }

  async function renderDiagram() {
    const db = S.db;
    const saveKey = 'diagram:' + db;
    // What this browser remembers: the diagram's own state, and the name of
    // the saved view it came from, if any.
    const remembered = store.get(saveKey, null);
    let views = [];
    let current = remembered && remembered.view ? remembered.view : null;
    let last = remembered || {};
    const remember = state => {
      last = state;
      store.set(saveKey, { ...state, view: current });
    };

    const search = h('input', {
      class: 'input',
      type: 'search',
      placeholder: 'Find a table, then Enter',
      spellcheck: false,
      oninput: e => { if (diagram) diagram.search(e.target.value); },
      onkeydown: e => {
        if (e.key === 'Enter' && diagram) {
          e.preventDefault();
          if (diagram.searchGo(search.value)) {
            search.value = '';
            search.blur();
          } else {
            toast('No table matches.', 'error');
          }
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          search.value = '';
          if (diagram) diagram.search('');
          search.blur();
        }
      },
    });
    UI.diagramSearch = search;

    // The layout and detail switches, drawn again when a saved view brings its own.
    const switches = h('div', { class: 'toolbar-group' });
    const drawSwitches = () => put(switches,
      segmented([['flow', 'Flow'], ['families', 'Families'], ['constellation', 'Constellation']], last.layout || 'flow',
        v => { if (diagram) diagram.setLayout(v); }),
      h('span', { class: 'toolbar-label' }, 'Detail'),
      segmented([['names', 'Names'], ['keys', 'Keys'], ['all', 'All columns']], last.detail || 'keys',
        v => { if (diagram) diagram.setDetail(v); }));
    drawSwitches();

    const viewsButton = h('button', {
      class: 'btn',
      title: 'Open, save or delete a view: a set of tables and where they sit',
      onclick: e => openViewsMenu(e.currentTarget),
    }, icon('list'), h('span', null, 'Views'), icon('down'));
    const drawViewsButton = () => { viewsButton.querySelector('span').textContent = current || 'Views'; };
    drawViewsButton();
    const arrange = h('button', {
      class: 'btn ghost',
      title: 'Lay out the tables shown again with the chosen layout',
      onclick: () => { if (diagram) diagram.arrange(); },
    }, icon('refresh'), 'Arrange again');
    const host = h('div', { class: 'diagram-host' }, skeleton('cards', 'Reading every table'));

    put(UI.view, h('div', { class: 'diagram-view' },
      h('div', { class: 'toolbar' },
        switches,
        h('label', { class: 'search' }, icon('search'), search),
        h('div', { class: 'spacer' }),
        arrange,
        viewsButton),
      host));

    let start = null;
    let tables = [];

    const closeStart = () => {
      if (start) start.remove();
      start = null;
    };

    const openView = view => {
      current = view.name;
      closeStart();
      diagram.openView(view);
      drawSwitches();
      drawViewsButton();
    };

    // Saves the tables on screen under a name, over a view of the same name after asking.
    async function saveView(name) {
      if (!diagram || !diagram.count().shown) return;
      const same = views.find(v => viewName(v.name) === viewName(name));
      if (same && same.name !== current && !await confirmBox({
        title: `Replace the view ${same.name}?`,
        body: 'A view with this name is saved already. Saving puts the tables on screen in its place.',
        confirm: 'Replace view',
      })) return;
      try {
        const r = await api('save_view', { db, view: { name, ...diagram.view() } });
        views = r.views;
        cacheViews(db, views);
        current = (views.find(v => viewName(v.name) === viewName(name)) || { name }).name;
        remember(last);
        drawViewsButton();
        toast(`Saved the view ${current}.`, 'ok');
      } catch (e) {
        toast(e.message, 'error');
      }
    }

    async function deleteView(name) {
      if (!await confirmBox({
        title: `Delete the view ${name}?`,
        body: 'Only the saved view goes. The tables and the diagram on screen stay as they are.',
        confirm: 'Delete view',
        danger: true,
      })) return;
      try {
        views = (await api('delete_view', { db, name })).views;
        cacheViews(db, views);
        if (current === name) current = null;
        remember(last);
        drawViewsButton();
        if (start) drawStart();
        toast(`Deleted the view ${name}.`, 'ok');
      } catch (e) {
        toast(e.message, 'error');
      }
    }

    function openViewsMenu(anchor) {
      if (!diagram) return;
      const { shown, total } = diagram.count();
      openPopover(anchor, menuList([
        { title: views.length ? 'Saved views' : 'No saved views yet' },
        views.map(v => ({
          label: v.name,
          icon: v.name === current ? 'check' : 'blank',
          kbd: fmtN(v.tables.length),
          hint: `Open this view of ${plural(v.tables.length, 'table')}`,
          run: () => openView(v),
        })),
        'sep',
        current && shown ? { label: `Save ${current}`, icon: 'download', hint: 'Save the tables on screen, and where they sit, over this view', run: () => saveView(current) } : null,
        shown ? {
          label: 'Save as a new view...',
          icon: 'plus',
          hint: 'Save the tables on screen, and where they sit, under a name',
          run: async () => {
            const name = await askText({ title: 'Save as a new view', value: '', confirm: 'Save view' });
            if (name) saveView(name);
          },
        } : null,
        current ? { label: `Delete ${current}`, icon: 'trash', danger: true, run: () => deleteView(current) } : null,
        'sep',
        shown < total ? { label: `Show all ${plural(total, 'table')}`, icon: 'diagram', run: () => { current = null; drawViewsButton(); diagram.showAll(); } } : null,
        shown ? { label: 'Start over', icon: 'x', hint: 'Clear the diagram and pick a table to start from', run: () => { current = null; drawViewsButton(); diagram.clear(); } } : null,
      ]), { alignRight: true });
    }

    // With nothing shown, a panel to start from: find a table, pick one that
    // many others point to, or open a saved view.
    function drawStart() {
      const model = DbvDiagram.buildModel(tables);
      const label = n => nameIn(n.schema, n.name);
      const results = h('div', { class: 'menu dg-start-list' });
      const pick = key => {
        closeStart();
        current = null;
        drawViewsButton();
        diagram.showAround(key);
      };
      const row = n => h('button', { class: 'menu-item', title: `Show ${label(n)} and the tables linked to it`, onclick: () => pick(n.key) },
        icon(String(n.kind).includes('view') ? 'view' : 'table'),
        h('span', { class: 'grow mono' }, label(n)),
        h('small', { class: 'faint' }, n.allIn.length === 1 ? '1 table points here' : n.allIn.length ? `${fmtN(n.allIn.length)} tables point here` : plural(n.allOut.length, 'link')));
      const find = h('input', {
        class: 'input',
        type: 'search',
        placeholder: 'Find a table',
        spellcheck: false,
        oninput: () => draw(),
        onkeydown: e => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          const first = results.querySelector('.menu-item');
          if (first) first.click();
        },
      });
      const draw = () => {
        const q = find.value.trim().toLowerCase();
        if (!q) {
          put(results, h('div', { class: 'menu-title' }, 'Most linked'), DbvDiagram.hubs(model, 8).map(row));
          return;
        }
        const named = model.nodes.map(n => [n, label(n).toLowerCase()]);
        const hits = [
          ...named.filter(([, t]) => t.startsWith(q)),
          ...named.filter(([, t]) => !t.startsWith(q) && t.includes(q)),
        ].slice(0, 12).map(([n]) => n);
        put(results, hits.length ? hits.map(row) : h('div', { class: 'menu-error' }, 'No table matches.'));
      };
      draw();
      const panel = h('div', { class: 'dg-start' },
        h('h3', null, 'Start from a table'),
        h('p', { class: 'muted' }, (model.nodes.length > DIAGRAM_WHOLE ? `${plural(model.nodes.length, 'table')} are too many to read in one picture. ` : '')
          + 'Pick a table, and it shows with the tables linked to it. A + on a table then shows the ones still hidden.'),
        h('label', { class: 'search' }, icon('search'), find),
        results,
        views.length ? h('div', { class: 'menu' },
          h('div', { class: 'menu-title' }, 'Saved views'),
          views.map(v => h('button', { class: 'menu-item', title: `Open this view of ${plural(v.tables.length, 'table')}`, onclick: () => openView(v) },
            icon('list'), h('span', { class: 'grow' }, v.name), h('small', { class: 'faint' }, plural(v.tables.length, 'table'))))) : null,
        h('div', { class: 'dg-start-foot' },
          h('button', {
            class: 'btn ghost',
            title: 'Show every table in the diagram',
            onclick: () => {
              closeStart();
              current = null;
              drawViewsButton();
              diagram.showAll();
            },
          }, `Show all ${plural(model.nodes.length, 'table')}`)));
      if (start) start.replaceWith(panel);
      else host.append(panel);
      start = panel;
      requestAnimationFrame(() => find.focus());
    }

    try {
      const answer = await loadDiagram();
      if (S.tab !== 'diagram' || S.db !== db || !host.isConnected) return;
      tables = answer.tables;
      views = answer.views || [];
      if (!tables.length) {
        put(host, h('div', { class: 'empty' }, 'This database has no tables.'));
        return;
      }
      // Until this browser has a diagram of its own here, a large database starts empty.
      const saved = { ...last };
      if (!('tables' in saved)) saved.tables = tables.length > DIAGRAM_WHOLE ? [] : null;
      if (current && !views.some(v => v.name === current)) current = null;
      drawViewsButton();
      if (diagram) diagram.destroy();
      diagram = DbvDiagram.mount(host, tables, {
        rows: Object.fromEntries((S.tables || []).map(t => [tableKey(t), t.rows])),
        saved,
        homeSchema: homeSchema(),
        focus: S.focus,
        onOpen: t => openTable(t),
        onFocus: key => {
          if (S.tab === 'diagram' && S.focus !== key) {
            S.focus = key;
            syncHash(true);
          }
        },
        onChange: state => {
          remember(state);
          if (!diagram) return;
          if (!state.tables || state.tables.length) closeStart();
          else if (!start) drawStart();
        },
        onPick: pickTables,
        onNote: text => toast(text),
      });
      // A table asked for by the address opens the diagram, unless it is gone.
      if (!diagram.count().shown && !(S.focus && tables.some(t => tableKey(t) === S.focus))) drawStart();
    } catch (e) {
      put(host, h('div', { class: 'pad' }, errorBox(e.message)));
    }
  }

  // ------------------------------------------------------------------ charts

  const SVG_NS = 'http://www.w3.org/2000/svg';

  function svgEl(tag, attrs = {}) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
    return el;
  }

  // A round top for an axis: 1, 2, 2.5 or 5 times a power of ten, at least max.
  function niceMax(max) {
    if (!(max > 0)) return 1;
    const pow = 10 ** Math.floor(Math.log10(max));
    return [1, 2, 2.5, 5, 10].map(m => m * pow).find(v => v >= max);
  }

  // Each series is { label, cls }, where cls ("s1", "s2", "s3") is its colour.
  // With more than one series, a legend names them.
  const chartLegend = (series, values = null) => h('div', { class: 'chart-legend' }, series.map((s, i) =>
    h('span', null, h('i', { class: 'swatch ' + s.cls }), s.label, values ? h('b', null, values[i]) : null)));

  // Horizontal bars, one row per table, split into the series. Resting on a
  // row gives every number, and a click opens the table.
  function barChart(series, rows, format) {
    const total = r => r.values.reduce((a, b) => a + b, 0);
    const most = Math.max(1, ...rows.map(total));
    return h('div', { class: 'bars' },
      series.length > 1 ? chartLegend(series) : null,
      rows.map(r => h('button', {
        type: 'button',
        class: 'bar-row',
        title: [r.label, ...series.map((s, i) => `${s.label}: ${format(r.values[i])}`), series.length > 1 ? `Total: ${format(total(r))}` : null].filter(Boolean).join('\n'),
        onclick: r.run,
      },
      h('span', { class: 'bar-label' }, r.label),
      h('span', { class: 'bar-track' },
        h('span', { class: 'bar', style: `width:${Math.max(0.5, (total(r) / most) * 100)}%` },
          series.map((s, i) => (r.values[i] ? h('span', { class: 'bar-seg ' + s.cls, style: `flex-grow:${r.values[i]}` }) : null)))),
      h('span', { class: 'bar-value' }, format(total(r))))));
  }

  // A line chart over a window of time, drawn again on each update, with a
  // crosshair and the numbers of the moment under the pointer. update() takes
  // points of { at, values }, one value per series, null for a gap.
  function lineChart(title, series, format, { span = 120000, low = () => 0 } = {}) {
    const H = 150;
    const PAD = { l: 46, r: 12, t: 10, b: 22 };
    const svg = svgEl('svg', { class: 'chart-svg', height: H });
    const tipBox = h('div', { class: 'chart-tip', hidden: true });
    const plot = h('div', { class: 'chart-plot' }, svg, tipBox);
    const legend = h('div');
    const now = h('span', { class: 'chart-now' });
    const el = h('div', { class: 'card chart-card' },
      h('div', { class: 'card-head' }, h('h3', null, title), h('div', { class: 'spacer' }), now),
      h('div', { class: 'chart-body' }, legend, plot));
    let points = [];
    let hover = null;

    function draw() {
      const w = plot.clientWidth;
      if (!w) return;
      svg.setAttribute('width', w);
      const end = points.length ? points[points.length - 1].at : Date.now();
      const start = end - span;
      const values = points.flatMap(p => p.values).filter(v => v != null);
      const lo = values.length ? low(values) : 0;
      const hi = Math.max(lo + 1, niceMax(Math.max(...values, 0)));
      const x = at => PAD.l + ((at - start) / span) * (w - PAD.l - PAD.r);
      const y = v => H - PAD.b - ((v - lo) / (hi - lo)) * (H - PAD.t - PAD.b);
      const kids = [];

      // The middle line goes when it would read the same as an end, as 0.5 connections does.
      const ticks = [lo, (lo + hi) / 2, hi].filter((v, i, all) => i !== 1 || (format(v) !== format(all[0]) && format(v) !== format(all[2])));
      for (const v of ticks) {
        kids.push(svgEl('line', { class: 'chart-grid', x1: PAD.l, x2: w - PAD.r, y1: y(v), y2: y(v) }));
        const label = svgEl('text', { class: 'chart-axis', x: PAD.l - 8, y: y(v) + 4, 'text-anchor': 'end' });
        label.textContent = format(v);
        kids.push(label);
      }
      [[PAD.l, 'start', `${Math.round(span / 60000)} min ago`], [w - PAD.r, 'end', 'now']].forEach(([at, anchor, text]) => {
        const label = svgEl('text', { class: 'chart-axis', x: at, y: H - 4, 'text-anchor': anchor });
        label.textContent = text;
        kids.push(label);
      });

      series.forEach((s, si) => {
        let d = '';
        let pen = false;
        for (const p of points) {
          const v = p.values[si];
          if (v == null) { pen = false; continue; }
          d += `${pen ? 'L' : 'M'}${x(p.at).toFixed(1)} ${y(v).toFixed(1)}`;
          pen = true;
        }
        if (d) kids.push(svgEl('path', { class: 'chart-line ' + s.cls, d }));
      });

      // The newest point gets a dot, or the one under the pointer and a line down to the axis.
      const at = hover ?? points.length - 1;
      const p = points[at];
      if (p) {
        if (hover != null) kids.push(svgEl('line', { class: 'chart-cross', x1: x(p.at), x2: x(p.at), y1: PAD.t, y2: H - PAD.b }));
        series.forEach((s, si) => {
          if (p.values[si] != null) kids.push(svgEl('circle', { class: 'chart-dot ' + s.cls, cx: x(p.at), cy: y(p.values[si]), r: 4 }));
        });
      }
      svg.replaceChildren(...kids);

      const last = points[points.length - 1];
      const shown = last ? last.values.map(v => (v == null ? '' : format(v))) : null;
      if (series.length > 1) put(legend, chartLegend(series, shown));
      now.textContent = series.length === 1 && shown ? shown[0] : '';

      if (hover != null && p) {
        put(tipBox,
          h('div', { class: 'muted' }, new Date(p.at).toLocaleTimeString()),
          series.map((s, si) => h('div', null, h('i', { class: 'swatch ' + s.cls }), `${s.label}: `, h('b', null, p.values[si] == null ? 'none' : format(p.values[si])))));
        tipBox.hidden = false;
        const left = x(p.at) + 12;
        tipBox.style.left = (left + tipBox.offsetWidth > w ? x(p.at) - tipBox.offsetWidth - 12 : left) + 'px';
      } else {
        tipBox.hidden = true;
      }
    }

    plot.addEventListener('mousemove', e => {
      if (!points.length) return;
      const px = e.clientX - plot.getBoundingClientRect().left;
      const end = points[points.length - 1].at;
      const w = plot.clientWidth;
      const at = end - span + ((px - PAD.l) / (w - PAD.l - PAD.r)) * span;
      let best = 0;
      points.forEach((q, i) => { if (Math.abs(q.at - at) < Math.abs(points[best].at - at)) best = i; });
      if (best !== hover) { hover = best; draw(); }
    });
    plot.addEventListener('mouseleave', () => { hover = null; draw(); });

    return { el, update(next) { points = next; if (hover != null && hover >= points.length) hover = null; draw(); } };
  }

  // ------------------------------------------------------------------ health

  async function renderHealth() {
    const key = S.db;
    put(UI.view, skeleton('cards', 'Reading the health of the database'));
    try {
      const r = await api('health', { db: S.db });
      if (S.tab !== 'health' || S.db !== key) return;
      put(UI.view, healthView(r));
    } catch (e) {
      put(UI.view, h('div', { class: 'pad' }, errorBox(e.message)));
    }
  }

  // The columns of the Health tab's table. Each system sends only the ones it counts.
  const HEALTH_COLUMNS = [
    { key: 'live', label: 'Rows', format: fmtN },
    { key: 'dead', label: 'Dead rows', format: fmtN },
    { key: 'full_scans', label: 'Whole-table reads', format: fmtN },
    { key: 'index_scans', label: 'Index reads', format: fmtN },
    { key: 'writes', label: 'Rows written', format: fmtN },
    { key: 'vacuumed', label: 'Last vacuum', format: v => (v == null ? 'never' : timeAgo(v)) },
    { key: 'analyzed', label: 'Last analyze', format: v => (v == null ? 'never' : timeAgo(v)) },
    { key: 'engine', label: 'Engine', format: v => v || '' },
    { key: 'free', label: 'Space to give back', format: fmtBytes },
    { key: 'updated', label: 'Last written', format: v => (v == null ? '' : timeAgo(v)) },
    { key: 'size', label: 'Size', format: fmtBytes },
  ];

  function healthView(r) {
    const db = dbById(S.db);
    const tables = r.tables.map(t => ({ ...t, size: t.data + t.indexes + (t.other || 0) }));
    const open = (t, tab = 'structure') => () => openTable(tableRef(t), { tab });
    const warnings = r.findings.filter(f => f.level === 'warn').length;
    const since = r.summary.since ? `Counted since ${new Date(r.summary.since).toLocaleString()}` : 'Counted since the server started';

    const sized = tables.filter(t => t.size > 0);
    const spaceSeries = [
      { key: 'data', label: 'Rows', cls: 's1' },
      { key: 'indexes', label: 'Indexes', cls: 's2' },
      sized.some(t => t.other) ? { key: 'other', label: 'Long values and maps', cls: 's3' } : null,
    ].filter(Boolean);

    const scans = t => (t.full_scans || 0) + (t.index_scans || 0);
    const read = tables.filter(t => scans(t) > 0).sort((a, b) => scans(b) - scans(a));
    const readSeries = [{ key: 'index_scans', label: 'Through an index', cls: 's1' }, { key: 'full_scans', label: 'Whole table', cls: 's2' }];
    const rowsOf = (list, series) => list.slice(0, 12).map(t => ({ label: nameIn(t.schema, t.name), values: series.map(s => t[s.key] || 0), run: open(t) }));
    const more = n => (n > 12 ? h('div', { class: 'muted small chart-more' }, `${plural(n - 12, 'more table')} in the table below.`) : null);

    return h('div', { class: 'health' },
      h('div', { class: 'ov-head' },
        h('div', null,
          h('div', { class: 'ov-kind' }, h('span', { class: 'dot' }), dbKind(db)),
          h('h1', null, 'Health'),
          h('div', { class: 'ov-sub' }, since, r.scope === 'server' ? ', for the whole server' : '', '.')),
        h('div', { class: 'stats' },
          stat('On disk', r.summary.size == null ? null : Number(r.summary.size), fmtBytes),
          stat('Read from memory', fmtPct(r.summary.cache_hit), null, 'How often a read found its data in memory instead of on disk. Above 99% is healthy.'),
          stat('Warnings', warnings, fmtN),
          stat('Tips', r.findings.length - warnings, fmtN)),
        opsButton(dbOps)),
      h('div', { class: 'structure' },
        findingsCard(r.findings),
        h('div', { class: 'chart-pair' },
          card('Where the space goes', null, h('div', { class: 'card-body' },
            sized.length ? [barChart(spaceSeries, rowsOf(sized, spaceSeries), fmtBytes), more(sized.length)] : h('div', { class: 'muted' }, 'No table takes any space yet.'))),
          read.length ? card('How the tables are read', null, h('div', { class: 'card-body' },
            h('p', { class: 'muted small chart-note' }, 'A big table read whole many times wants an index on the columns it is searched by.'),
            barChart(readSeries, rowsOf(read, readSeries), fmtCompact), more(read.length))) : null),
        healthTable(tables)));
  }

  function findingsCard(findings) {
    if (!findings.length) {
      return card('Findings', 0, h('div', { class: 'card-body muted' }, 'Nothing to fix. Every check came back clean.'));
    }
    const groups = new Map();
    for (const f of findings) {
      if (!groups.has(f.group)) groups.set(f.group, []);
      groups.get(f.group).push(f);
    }
    const warnFirst = [...groups].sort((a, b) => (a[1][0].level === 'warn' ? 0 : 1) - (b[1][0].level === 'warn' ? 0 : 1));
    return card('Findings', findings.length, h('div', null, warnFirst.map(([group, list]) => findingGroup(group, list))));
  }

  // One kind of finding. The first five show, and the rest open on a click.
  function findingGroup(group, list) {
    const warn = list[0].level === 'warn';
    const sql = list.map(f => f.sql).filter(Boolean).join('\n');
    const body = h('div');
    let all = false;
    const draw = () => put(body,
      (all ? list : list.slice(0, 5)).map(findingRow),
      list.length > 5 ? h('button', { class: 'btn ghost small finding-more', onclick: () => { all = !all; draw(); } },
        all ? 'Show fewer' : `Show all ${fmtN(list.length)}`) : null);
    draw();
    return h('div', { class: 'finding-group' },
      h('div', { class: 'finding-head' },
        h('span', { class: 'tag' + (warn ? ' warn' : '') }, icon(warn ? 'warn' : 'info'), warn ? 'Warning' : 'Tip'),
        h('h4', null, group),
        h('span', { class: 'muted small' }, fmtN(list.length)),
        h('div', { class: 'spacer' }),
        sql ? [
          h('button', { class: 'btn small', title: 'Copy the SQL that fixes every one of these', onclick: () => copyText(sql, 'SQL copied.') }, icon('copy'), 'Copy SQL'),
          h('button', { class: 'btn small', title: 'Put that SQL in the SQL tab, to read it and run it', onclick: () => openInSql(sql) }, icon('code'), 'Open in SQL'),
        ] : null),
      body);
  }

  function findingRow(f) {
    const t = (S.tables || []).find(x => sameTable(x, f.table));
    const m = f.op && ((S.info && S.info.maintenance) || []).find(x => x.op === f.op);
    return h('div', { class: 'finding' },
      h('div', { class: 'finding-text' }, h('b', null, f.title), h('div', { class: 'muted small' }, f.detail)),
      f.sql ? h('button', { class: 'btn ghost small', title: f.sql, onclick: () => copyText(f.sql, 'SQL copied.') }, icon('copy'), 'SQL') : null,
      t && m ? h('button', { class: 'btn small', title: m.hint, onclick: () => maintain(t, m) }, icon('tool'), m.label) : null,
      t ? h('button', { class: 'btn ghost small', onclick: () => openTable(tableRef(t), { tab: 'structure' }) }, 'Open') : null);
  }

  // Every number of the charts, as a table you can sort.
  function healthTable(tables) {
    const columns = HEALTH_COLUMNS.filter(c => tables.some(t => c.key in t && (t[c.key] != null || c.key === 'vacuumed' || c.key === 'analyzed')));
    let sort = { key: 'size', dir: -1 };
    const thead = h('thead');
    const tbody = h('tbody');
    const draw = () => {
      put(thead, h('tr', null, [{ key: 'name', label: 'Table' }, ...columns].map(c => h('th', {
        class: 'sortable' + (sort.key === c.key ? ' sorted' : ''),
        onclick: () => { sort = { key: c.key, dir: sort.key === c.key ? -sort.dir : c.key === 'name' ? 1 : -1 }; draw(); },
      }, h('div', { class: 'th' }, c.label, sort.key === c.key ? icon(sort.dir > 0 ? 'up' : 'down', 'sort') : null)))));
      const list = [...tables].sort((a, b) => {
        const x = a[sort.key] ?? -Infinity;
        const y = b[sort.key] ?? -Infinity;
        if (x === y) return 0;
        return (typeof x === 'string' || typeof y === 'string' ? String(x).localeCompare(String(y)) : x - y) * sort.dir;
      });
      put(tbody, list.map(t => h('tr', { class: 'clickable', onclick: () => openTable(tableRef(t), { tab: 'structure' }) },
        h('td', null, h('b', null, nameIn(t.schema, t.name))),
        columns.map(c => h('td', { class: typeof t[c.key] === 'number' ? 'num' : null }, c.format(t[c.key]))))));
    };
    draw();
    return card('Tables', tables.length, h('div', { class: 'health-table' }, h('table', { class: 'grid' }, thead, tbody)));
  }

  // ---------------------------------------------------------------- activity

  // Live numbers, read every two seconds while the tab is open and the page in sight.
  function renderActivity() {
    const db = S.db;
    const EVERY = 2000;
    const samples = [];
    let paused = false;
    let timer = 0;

    // A rate from two readings of a running total. A total that went down was reset, and gives nothing.
    const rate = (a, b, key) => {
      const v = (b.totals[key] - a.totals[key]) / ((b.at - a.at) / 1000);
      return v >= 0 ? v : null;
    };
    const hit = (a, b) => {
      const hits = b.totals.cache_hits - a.totals.cache_hits;
      const reads = hits + b.totals.cache_misses - a.totals.cache_misses;
      return reads > 0 && hits >= 0 ? (hits / reads) * 100 : null;
    };
    const charts = [
      [lineChart('Connections', [{ label: 'Open', cls: 's1' }, { label: 'Running a query', cls: 's2' }], v => fmtN(Math.round(v))),
        (a, b) => [b.totals.connections, b.totals.running]],
      [lineChart('Queries per second', [{ label: 'Queries', cls: 's1' }], fmtRate), (a, b) => [rate(a, b, 'queries')]],
      [lineChart('Rows per second', [{ label: 'Read', cls: 's1' }, { label: 'Written', cls: 's2' }], fmtRate),
        (a, b) => [rate(a, b, 'rows_read'), rate(a, b, 'rows_written')]],
      // Close to 100% all the time, so the axis starts near the lowest value.
      [lineChart('Reads found in memory', [{ label: 'In memory', cls: 's1' }], v => `${Math.round(v * 10) / 10}%`, { low: vs => Math.max(0, Math.floor(Math.min(...vs) / 10) * 10 - 10) }),
        (a, b) => [hit(a, b)]],
    ];

    const pauseBtn = h('button', { class: 'btn', onclick: () => { paused = !paused; drawPause(); } });
    const drawPause = () => put(pauseBtn, icon(paused ? 'play' : 'pause'), paused ? 'Go on' : 'Pause');
    drawPause();
    const status = h('div');
    const sessionsBox = h('div');
    const scope = h('span');
    const root = h('div', { class: 'activity' },
      h('div', { class: 'toolbar' },
        h('span', { class: 'live-dot' }), h('b', null, 'Live'), scope,
        h('div', { class: 'spacer' }), pauseBtn),
      status,
      h('div', { class: 'structure' },
        h('div', { class: 'chart-grid-2' }, charts.map(([c]) => c.el)),
        card('Sessions', null, sessionsBox)));
    put(UI.view, root);

    function drawCharts() {
      for (const [chart, pick] of charts) {
        const points = [];
        for (let i = 1; i < samples.length; i++) points.push({ at: samples[i].at, values: pick(samples[i - 1], samples[i]) });
        chart.update(points);
      }
    }

    function drawSessions(sessions) {
      // Not while the pointer is on the list, so a button never moves away from a click.
      if (sessionsBox.matches(':hover')) return;
      if (!sessions.length) {
        put(sessionsBox, h('div', { class: 'card-body muted' }, 'Nobody else is connected to this database.'));
        return;
      }
      put(sessionsBox, dense(['Session', 'State', 'For', 'Who', 'Waiting on', 'Query', ''], sessions.map(s => h('tr', null,
        h('td', { class: 'mono' }, s.id),
        h('td', null, h('span', { class: 'tag' + (s.state === 'active' ? ' ok' : s.state && s.state.includes('transaction') ? ' warn' : '') }, s.state || '')),
        h('td', { class: 'num' }, fmtDuration(s.ms)),
        h('td', null, [s.user, s.app].filter(Boolean).join(', '), s.client ? h('div', { class: 'faint small mono' }, s.client) : null),
        h('td', { class: 'muted small' }, s.wait || ''),
        h('td', { class: 'mono session-query', title: s.query || '' }, s.query || ''),
        h('td', { class: 'session-actions' },
          s.state === 'active' ? h('button', { class: 'btn small', title: 'Stop the query this session is running. The session stays open.', onclick: () => stopSession(s, false) }, icon('stop'), 'Stop query') : null,
          h('button', { class: 'btn small danger', title: 'Close the connection', onclick: () => stopSession(s, true) }, icon('x'), 'End'))))));
    }

    async function stopSession(s, kill) {
      if (kill && !(await confirmBox({
        title: `End session ${s.id}?`,
        body: 'Its connection closes, and a transaction it has open is rolled back.',
        confirm: 'End the session',
        danger: true,
      }))) return;
      try {
        await api('stop', { db, id: s.id, kill });
        toast(kill ? `Session ${s.id} ended.` : `The query of session ${s.id} was stopped.`, 'ok');
      } catch (e) {
        toast(e.message, 'error');
      }
    }

    async function poll() {
      if (!root.isConnected || S.db !== db || S.tab !== 'activity') return;
      if (!paused && document.visibilityState === 'visible') {
        try {
          const r = await api('activity', { db }, false, true);
          if (!root.isConnected) return;
          samples.push({ at: r.at, totals: r.totals });
          while (samples.length > 61) samples.shift();
          scope.textContent = r.scope === 'server' ? 'The numbers are for the whole server. The sessions are those using this database.' : 'The numbers and sessions are for this database.';
          put(status);
          drawCharts();
          drawSessions(r.sessions);
        } catch (e) {
          put(status, h('div', { class: 'pad' }, errorBox(e.message)));
        }
      }
      clearTimeout(timer);
      timer = setTimeout(poll, EVERY);
    }

    poll();
  }

  // --------------------------------------------------------------------- sql

  const schemaCache = {};
  const loadSchema = () => (schemaCache[S.db] ??= api('schema', { db: S.db }).then(r => r.tables).catch(() => []));

  // The SQL box: CodeMirror when it is loaded, with colours, line numbers,
  // bracket matching and suggestions of this database's tables and columns;
  // a plain textarea otherwise. Both answer to the same few calls.
  function sqlEditor(value, onChange, onRun) {
    const ta = h('textarea', {
      class: 'sql-editor',
      spellcheck: false,
      placeholder: `select * from users limit 50;\n\n${keyLabel('run')} runs the query, or only the part you selected.`,
      value,
    });

    if (!window.CodeMirror) {
      ta.addEventListener('input', () => onChange(ta.value));
      ta.addEventListener('keydown', e => {
        if (pressed(e, 'run')) {
          e.preventDefault();
          onRun();
        } else if (e.key === 'Tab' && !e.shiftKey && !e.ctrlKey) {
          e.preventDefault();
          ta.setRangeText('  ', ta.selectionStart, ta.selectionEnd, 'end');
          onChange(ta.value);
        }
      });
      return {
        el: ta,
        start: () => ta.focus(),
        get: () => ta.value,
        selected: () => ta.value.slice(ta.selectionStart, ta.selectionEnd),
        set: v => { ta.value = v; onChange(v); ta.focus(); },
      };
    }

    const el = h('div', { class: 'sql-editor-wrap' }, ta);
    let cm = null;
    const toEnd = () => { cm.focus(); cm.setCursor(cm.lineCount(), 0); };

    return {
      el,
      // CodeMirror measures the page, so it starts once the box is on it.
      start() {
        cm = CodeMirror.fromTextArea(ta, {
          mode: isMysql() ? 'text/x-mariadb' : 'text/x-pgsql',
          lineNumbers: true,
          lineWrapping: true,
          matchBrackets: true,
          autoCloseBrackets: true,
          styleActiveLine: true,
          indentUnit: 2,
          tabSize: 2,
          extraKeys: {
            Tab: c => (c.somethingSelected() ? c.indentSelection('add') : c.replaceSelection('  ')),
          },
          hintOptions: { completeSingle: false },
        });
        // The shortcuts can change while the editor is open, so each key is checked as it comes.
        cm.on('keydown', (c, e) => {
          const command = pressed(e, 'run') ? onRun : pressed(e, 'suggest') ? () => c.showHint() : pressed(e, 'comment') ? () => c.toggleComment() : null;
          if (!command) return;
          e.preventDefault();
          command();
        });
        cm.on('change', () => onChange(cm.getValue()));
        // Suggestions open by themselves after two letters of a name, or after "table." for its columns.
        cm.on('inputRead', (c, change) => {
          if (c.state.completionActive || change.origin !== '+input') return;
          if (change.text[0] === '.' || /^[A-Za-z_]\w+$/.test(c.getTokenAt(c.getCursor()).string)) c.showHint();
        });
        loadSchema().then(list => {
          const tables = {};
          for (const t of list) tables[t.schema === homeSchema() ? t.name : `${t.schema}.${t.name}`] = t.columns;
          cm.setOption('hintOptions', { completeSingle: false, tables });
        });
        // The box can be dragged taller; CodeMirror redraws to fill it.
        new ResizeObserver(() => cm.refresh()).observe(el);
        toEnd();
      },
      get: () => cm.getValue(),
      selected: () => cm.getSelection(),
      set: v => { cm.setValue(v); toEnd(); },
    };
  }

  function pushHistory(sql) {
    const list = store.get('history', []).filter(x => !(x.sql === sql && x.db === S.db));
    list.unshift({ sql, db: S.db, at: Date.now() });
    store.set('history', list.slice(0, 50));
  }

  function renderSql() {
    const key = 'sql:' + S.db;
    const starter = S.table ? `select *\nfrom ${qualified(S.table)}\nlimit 100;` : '';
    const saveText = debounce(value => store.set(key, value), 300);
    const editor = sqlEditor(store.get(key, starter), saveText, () => run(false));
    const writes = h('input', { type: 'checkbox', onchange: e => toggle.classList.toggle('on', e.target.checked) });
    const toggle = h('label', { class: 'switch', title: 'Off: the query runs read only and the database refuses any change. On: changes are kept.' },
      writes, h('span', { class: 'track' }), 'Allow changes');
    const result = h('div', { class: 'sql-result' },
      h('div', { class: 'empty' }, `Rows show up here. ${keyLabel('run')} runs the query, or only the part you selected.`));

    async function run(explain) {
      const part = editor.selected();
      const sql = (part.trim() ? part : editor.get()).trim();
      if (!sql) return;
      pushHistory(sql);
      result.classList.add('loading');
      try {
        const r = await api('sql', { db: S.db, sql, explain, write: writes.checked && !explain });
        renderSqlResult(result, r);
        if (r.committed || r.ended) loadTables();
      } catch (e) {
        put(result, errorBox(e.message));
      } finally {
        result.classList.remove('loading');
      }
    }

    const historyBtn = h('button', { class: 'btn', onclick: () => openHistory(historyBtn, editor) }, icon('history'), 'History');

    put(UI.view, h('div', { class: 'sql-view' },
      editor.el,
      h('div', { class: 'toolbar' },
        h('button', { class: 'btn primary', onclick: () => run(false) }, icon('play'), 'Run', kbdFor('run')),
        h('button', { class: 'btn', title: 'Show how the database runs it. Always read only.', onclick: () => run(true) }, icon('gauge'), 'Explain'),
        toggle,
        h('div', { class: 'spacer' }),
        S.table ? h('button', {
          class: 'btn', title: `Put a select from ${S.table.name} in the editor`,
          onclick: () => editor.set(starter),
        }, icon('table'), `From ${S.table.name}`) : null,
        historyBtn),
      result));
    editor.start();
  }

  function renderSqlResult(box, r) {
    const count = r.rows.length;
    const status = h('div', { class: 'sql-status' },
      r.columns.length
        ? h('span', null, plural(count, 'row'), r.more ? h('span', { class: 'muted' }, ` (only the first ${fmtN(count)} are shown)`) : null)
        : h('span', null, `Done. Rows affected: ${fmtN(r.affected)}`),
      h('span', { class: 'faint' }, `${r.ms} ms`),
      r.ended
        ? h('span', {
          class: 'tag warn',
          title: 'The script ran its own COMMIT or ROLLBACK, or a statement that commits by itself, such as CREATE TABLE on MySQL. The script decided what was kept.',
        }, 'the script ended the transaction')
        : r.committed ? h('span', { class: 'tag danger' }, 'changes kept') : h('span', { class: 'tag' }, 'read only'),
      r.columns.length && !r.plan ? h('span', { class: 'faint hint' }, 'Right-click a cell to copy.') : null);

    if (!r.columns.length) {
      put(box, status);
      return;
    }
    // PostgreSQL's plan is one column of text lines. MySQL's is a table, shown as one.
    if (r.columns.length === 1 && r.columns[0].name === 'QUERY PLAN') {
      put(box, status, h('pre', { class: 'plan' }, r.rows.map(x => x[0]).join('\n')));
      return;
    }
    const cols = r.columns.map((c, i) => ({ name: c.name, i, category: c.numeric ? 'number' : '' }));
    const meta = { columns: cols, pk: [], fks: [], refs: [], editable: false };
    const wrap = h('div', { class: 'grid-wrap' });
    const open = i => {
      S.drawer = { mode: 'view', source: 'sql', meta, index: i, row: r.rows[i], rows: r.rows };
      renderDrawer();
    };
    put(box, status, wrap);
    createGrid(wrap, {
      cols,
      rows: r.rows,
      selectable: true,
      onOpen: open,
      cascade: true,
      onCopy: copyFromGrid,
      onCellMenu: (e, ri, ci, g) => {
        const c = g.cols[ci];
        const v = r.rows[ri][c.i];
        const many = g.selected.size > 1 && g.selected.has(ri) ? [...g.selected].sort((a, b) => a - b) : [ri];
        openMenuAt(e, [
          { title: many.length > 1 ? `${plural(many.length, 'row')} selected` : `${c.name}: ${v == null ? 'NULL' : short(v)}` },
          { label: 'Copy value', icon: 'copy', kbd: keyLabel('copy'), run: () => copyText(v ?? '', 'Value copied.') },
          rowActions('copy', many.map(i => r.rows[i]), g.cols, g.cols, null),
          'sep',
          rowActions('download', many.map(i => r.rows[i]), g.cols, g.cols, null),
          many.length > 1 ? null : ['sep', { label: 'Open row details', icon: 'expand', kbd: keyLabel('openRow'), run: () => open(ri) }],
        ]);
      },
      empty: 'The query returned no rows.',
    });
  }

  function openHistory(anchor, editor) {
    const list = store.get('history', []);
    const names = Object.fromEntries(allDbs().map(d => [d.id, d.name]));
    openPopover(anchor, h('div', { class: 'menu history-menu' },
      list.length ? list.map(x => h('button', {
        class: 'history-item',
        title: x.sql,
        onclick: () => { closePopover(); editor.set(x.sql); },
      }, h('code', null, x.sql.replace(/\s+/g, ' ')), h('small', null, `${names[x.db] || x.db}, ${timeAgo(x.at)}`)))
        : h('div', { class: 'empty' }, 'Queries you run show up here.')), { alignRight: true });
  }

  // ----------------------------------------------------------------- palette

  function fuzzy(q, s) {
    if (!q) return 0;
    const at = s.indexOf(q);
    if (at >= 0) return 1000 - at * 3 - (s.length - q.length);
    let from = 0;
    let prev = -2;
    let score = 0;
    for (const ch of q) {
      const found = s.indexOf(ch, from);
      if (found < 0) return -1;
      score += found === prev + 1 ? 6 : 1;
      prev = found;
      from = found + 1;
    }
    return score - s.length * 0.1;
  }

  function openPalette() {
    closePopover();
    if ($('.palette-overlay:not(.leaving)')) return;
    const input = h('input', { class: 'palette-input', placeholder: 'Jump to a table, a database or an action', spellcheck: false });
    const list = h('div', { class: 'palette-list' });
    let items = [];
    let active = 0;

    const everything = () => {
      const recent = store.get('recent:' + S.db, []);
      const tables = (S.tables || []).map(t => {
        const r = recent.indexOf(tableKey(t));
        return {
          kind: r >= 0 ? 'Recent' : 'Table',
          label: tableLabel(t),
          hint: t.rows != null ? plural(t.rows, 'row') : '',
          icon: isView(t) ? 'view' : 'table',
          rank: r >= 0 ? 8 - r : 0,
          run: () => openTable(t),
        };
      }).sort((a, b) => b.rank - a.rank);
      return [
        ...tables,
        ...allDbs().filter(d => !isHidden(d)).map(d => ({ kind: 'Database', label: d.name, hint: d.group, icon: 'database', run: () => openDb(d.id) })),
        { kind: 'Action', label: 'Diagram of this database', icon: 'diagram', run: () => go({ table: null, tab: 'diagram', ...fresh }) },
        { kind: 'Action', label: 'Open the SQL tab', icon: 'code', run: () => go({ tab: 'sql' }) },
        { kind: 'Action', label: 'Health of this database', icon: 'gauge', run: () => go({ table: null, tab: 'health', ...fresh }) },
        { kind: 'Action', label: 'Live activity', icon: 'pulse', run: () => go({ table: null, tab: 'activity', ...fresh }) },
        ...dbOps().flat().filter(it => it && it.label).map(it => ({ kind: 'Action', label: it.label, icon: it.icon, run: it.run })),
        { kind: 'Action', label: 'Keyboard shortcuts', icon: 'keyboard', run: showShortcuts },
        { kind: 'Action', label: 'Change the theme', icon: 'sun', run: cycleTheme },
        { kind: 'Action', label: 'Page colours', icon: 'colours', run: () => openTints(UI.tintBtn) },
        { kind: 'Action', label: 'Reload counts and rows', icon: 'refresh', run: refresh },
      ];
    };

    const mark = () => [...list.children].forEach((el, i) => el.classList.toggle('active', i === active));
    const close = () => leave(overlay);
    const pick = i => { const it = items[i]; close(); if (it) it.run(); };
    const draw = () => {
      const q = input.value.trim().toLowerCase();
      items = everything()
        .map((it, order) => ({ it, order, score: fuzzy(q, it.label.toLowerCase()) }))
        .filter(x => x.score >= 0 || !q)
        .sort((a, b) => b.score - a.score || a.order - b.order)
        .slice(0, 80)
        .map(x => x.it);
      active = Math.min(active, Math.max(0, items.length - 1));
      put(list, items.map((it, i) => h('button', {
        class: 'palette-item',
        onmousemove: () => { if (active !== i) { active = i; mark(); } },
        onclick: () => pick(i),
      }, icon(it.icon), h('span', { class: 'grow' }, it.label), it.hint ? h('span', { class: 'muted small' }, it.hint) : null, h('span', { class: 'tag' }, it.kind))),
      items.length ? null : h('div', { class: 'empty' }, 'Nothing matches.'));
      mark();
    };

    input.addEventListener('input', () => { active = 0; draw(); });
    input.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        active = clamp(active + (e.key === 'ArrowDown' ? 1 : -1), 0, Math.max(0, items.length - 1));
        mark();
        const el = list.children[active];
        if (el) el.scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter') {
        e.preventDefault();
        pick(active);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    });

    const overlay = h('div', { class: 'overlay palette-overlay', onmousedown: e => { if (e.target === overlay) close(); } },
      h('div', { class: 'palette', role: 'dialog', 'aria-label': 'Jump to' }, h('div', { class: 'palette-search' }, icon('search'), input), list));
    document.body.append(overlay);
    draw();
    input.focus();
  }

  // The keys that move around the grid. They stay as they are, so no shortcut may take them.
  const MOVE_KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab', 'Home', 'End', 'PageUp', 'PageDown'];

  // The list of shortcuts. Click one and press the new keys; this browser keeps them.
  function showShortcuts() {
    const hint = 'Click a shortcut to change it, then press the new keys. This browser remembers your choice.';
    const note = h('p', { class: 'muted small shortcuts-note' }, hint);
    const tbody = h('tbody');
    const fixed = [
      [['Arrows', 'Tab'], 'Move between cells'],
      [['Home', 'End'], 'The first or last cell of the row'],
      [['Ctrl+Home', 'Ctrl+End'], 'The first or last cell of the page'],
      [['Page Up', 'Page Down'], 'One screen up or down'],
      [['Double-click'], 'Edit the cell'],
      [['Ctrl+V'], 'Paste into the cell, or a block from Excel'],
      [['Shift click'], 'Select every row up to this one'],
      [['Ctrl click'], 'Add or drop one row'],
      [['Right-click'], 'More for a cell, a column or a table'],
      [['Esc'], 'Cancel, clear the selection, close'],
    ];
    let recording = null;

    const changed = k => k.keys.join() !== k.defaults.join();
    const save = () => {
      store.set('shortcuts', Object.fromEntries(Object.entries(KEYS).filter(([, k]) => changed(k)).map(([name, k]) => [name, k.keys])));
      refreshKeyLabels();
    };
    const keys = list => list.map(c => h('kbd', null, comboLabel(c)));

    const draw = () => put(tbody,
      Object.entries(KEYS).map(([name, k]) => h('tr', null,
        h('td', null, h('button', {
          class: 'key-pick' + (recording === name ? ' recording' : ''),
          title: 'Change this shortcut',
          onclick: () => { recording = name; note.textContent = 'Press the new keys. Esc cancels.'; draw(); },
        }, recording === name ? 'Press the keys' : keys(k.keys))),
        h('td', null, k.what),
        h('td', null, changed(k) ? h('button', { class: 'btn ghost small', onclick: () => { k.keys = k.defaults; save(); note.textContent = hint; draw(); } }, 'Reset') : null))),
      h('tr', null, h('th', { colspan: 3 }, 'Always the same')),
      fixed.map(([list, what]) => h('tr', null, h('td', null, keys(list)), h('td', { colspan: 2 }, what))));

    // Runs before the dialog's own keys, so Esc here cancels the change instead of closing the list.
    const onRecord = e => {
      if (!recording || ['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
      e.preventDefault();
      e.stopPropagation();
      const k = KEYS[recording];
      recording = null;
      const combo = comboOf(e);
      if (e.key === 'Escape') {
        note.textContent = hint;
      } else if (MOVE_KEYS.includes(combo)) {
        note.textContent = `${comboLabel(combo)} moves between cells, so it stays as it is. Pick another key.`;
      } else {
        k.keys = [combo];
        save();
        const others = Object.values(KEYS).filter(o => o !== k && o.keys.some(c => c.toLowerCase() === combo.toLowerCase()));
        note.textContent = others.length
          ? `Saved. ${comboLabel(combo)} also does this: ${others.map(o => o.what).join('; ')}.`
          : `Saved. ${comboLabel(combo)} now does this: ${k.what}.`;
      }
      draw();
    };

    const resetAll = () => {
      for (const k of Object.values(KEYS)) k.keys = k.defaults;
      save();
      recording = null;
      note.textContent = 'Every shortcut is back to its default.';
      draw();
    };

    draw();
    openModal({
      title: 'Keyboard shortcuts',
      body: h('table', { class: 'dense shortcuts' }, tbody),
      // The note sits by the buttons, where it stays in sight however far the list is scrolled.
      actions: [note, h('button', { class: 'btn', onclick: resetAll }, 'Reset all')],
      wide: true,
      onClose: () => window.removeEventListener('keydown', onRecord, true),
    });
    window.addEventListener('keydown', onRecord, true);
  }

  // -------------------------------------------------------------------- keys

  document.addEventListener('keydown', e => {
    if (pressed(e, 'palette')) {
      e.preventDefault();
      openPalette();
      return;
    }
    // A dialog, the SQL editor or a dropdown that already used the key keeps it.
    if ($('.overlay:not(.leaving)') || e.defaultPrevented) return;
    if (e.key === 'Escape') {
      if (popover) closePopover();
      else if (S.drawer) requestCloseDrawer();
      else if (diagram && diagram.focused() && !isTyping(e)) diagram.focus(null);
      // In the SQL box, Esc only closes the suggestions.
      else if (isTyping(e) && !e.target.closest('.CodeMirror')) e.target.blur();
      return;
    }
    // Save works from any field of the row form, and wherever the focus went after it.
    if (pressed(e, 'save') && S.drawer && S.drawer.mode !== 'view' && UI.saveBtn && UI.saveBtn.isConnected) {
      e.preventDefault();
      UI.saveBtn.click();
      return;
    }
    if (pressed(e, 'search') && UI.diagramSearch && UI.diagramSearch.isConnected) {
      e.preventDefault();
      UI.diagramSearch.focus();
      UI.diagramSearch.select();
      return;
    }
    if (pressed(e, 'search') && UI.searchInput && UI.searchInput.isConnected && !e.target.closest('.CodeMirror')) {
      e.preventDefault();
      UI.searchInput.focus();
      UI.searchInput.select();
      return;
    }
    // Nothing has focus after a click on empty space or a closed panel. The
    // grid takes the key then, unless text on the page is selected for copying.
    if (e.target === document.body && S.grid && S.grid.shown() && !String(getSelection())) {
      S.grid.key(e);
      if (e.defaultPrevented) {
        S.grid.focus();
        return;
      }
    }
    if (isTyping(e)) return;
    if (pressed(e, 'filterTables')) {
      e.preventDefault();
      UI.sideFilter.focus();
      UI.sideFilter.select();
    } else if (pressed(e, 'help')) {
      e.preventDefault();
      showShortcuts();
    } else if (pressed(e, 'fit') && diagram) {
      e.preventDefault();
      diagram.fit();
    } else if (e.ctrlKey || e.metaKey || e.altKey) {
      return;
    } else if (S.drawer && S.drawer.mode === 'view' && (e.key === 'ArrowDown' || e.key === 'j')) {
      e.preventDefault();
      stepRow(1);
    } else if (S.drawer && S.drawer.mode === 'view' && (e.key === 'ArrowUp' || e.key === 'k')) {
      e.preventDefault();
      stepRow(-1);
    }
  });

  document.addEventListener('paste', e => {
    if (e.target === document.body && S.grid && S.grid.shown()) S.grid.paste(e);
  });

  // -------------------------------------------------------------------- boot

  async function boot() {
    buildSkeleton();
    applyTheme();
    applyTint();
    // The tab highlight was measured before the fonts arrived. Measure it again once they have.
    if (document.fonts) document.fonts.ready.then(() => slideTo(UI.tabInk, UI.tabs.querySelector('.tab.active'), 'x', true));
    put(UI.tableList, h('div', { class: 'side-empty' }, 'Connecting...'));
    try {
      await loadDatabases();
      if (!allDbs().length) throw new Error(S.groups.map(g => `${g.label}: ${g.error || 'no databases'}`).join('\n') || 'No database server is set up. Fill in PGSQL_HOST or MYSQL_HOST in .env.');
    } catch (e) {
      put(UI.tableList);
      put(UI.view, h('div', { class: 'pad' },
        h('h2', { style: 'margin-bottom:12px' }, 'Could not reach a database'),
        errorBox(e.message),
        h('p', { class: 'muted' }, 'Check that the database server is running and that .env has the right host, port and login.')));
      return;
    }
    window.addEventListener('popstate', route);
    await route();
  }

  boot();
})();
