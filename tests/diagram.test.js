// The layouts of assets/diagram.js. Node's own runner, no package. From the project folder:
//     node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildModel, layout, SIZES } = require('../assets/diagram.js');

const LAYOUTS = ['flow', 'families', 'constellation'];
const DETAILS = ['names', 'keys', 'all'];

// A table in the shape the diagram action answers with. fks maps a column to the table it points at.
function table(name, fks = {}) {
  const cols = ['id', ...Object.keys(fks)];
  return {
    schema: 'public',
    name,
    kind: 'table',
    columns: cols.map(c => ({ name: c, type: c === 'id' ? 'uuid' : 'text' })),
    pk: ['id'],
    fks: Object.entries(fks).map(([col, to]) => ({ name: `${name}_${col}_foreign`, schema: 'public', tbl: to, cols: [col], ref_cols: ['id'] })),
  };
}

// Chains, a hub that 24 tables point at, a table pointing at itself, two
// families that fold plurals, and two tables with no keys at all.
function schema() {
  const policies = Array.from({ length: 24 }, (_, i) => table(`policy_${String(i).padStart(2, '0')}`, { org_country_id: 'org_countries' }));
  return [
    table('countries'),
    table('org_countries', { country_id: 'countries' }),
    table('companies'),
    table('roles', { company_id: 'companies' }),
    table('company_roles', { company_id: 'companies', role_id: 'roles' }),
    table('approval_workflows', { company_id: 'companies', country_id: 'countries' }),
    table('approval_workflow_steps', { workflow_id: 'approval_workflows' }),
    table('departments', { parent_id: 'departments' }),
    table('config_versions', { org_country_id: 'org_countries' }),
    table('config_fields', { version_id: 'config_versions' }),
    table('audit_events'),
    table('migrations'),
    ...policies,
  ];
}

const named = (model, name) => model.nodes.find(n => n.name === name);

function overlaps(model, pos) {
  const found = [];
  const boxes = model.nodes.map(n => ({ n, ...pos.get(n) }));
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      if (a.x < b.x + SIZES.W && b.x < a.x + SIZES.W && a.y < b.y + b.n.h && b.y < a.y + a.n.h) found.push(`${a.n.name} and ${b.n.name}`);
    }
  }
  return found;
}

for (const name of LAYOUTS) {
  for (const detail of DETAILS) {
    test(`${name}, ${detail}: every table has a place and no two boxes overlap`, () => {
      const model = buildModel(schema());
      const { pos } = layout(model, name, detail);
      assert.equal(pos.size, model.nodes.length);
      for (const p of pos.values()) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
      assert.deepEqual(overlaps(model, pos), []);
    });
  }
}

test('a box is as tall as the columns it shows', () => {
  const model = buildModel(schema());
  const policy = named(model, 'policy_00');
  layout(model, 'flow', 'names');
  assert.equal(policy.h, SIZES.BORDER * 2 + SIZES.HEAD);
  layout(model, 'flow', 'keys');
  assert.equal(policy.h, SIZES.BORDER * 2 + SIZES.HEAD + 2 * SIZES.ROW + SIZES.FOOT);
});

test('flow: every key points right, across a gap', () => {
  const model = buildModel(schema());
  const { pos } = layout(model, 'flow', 'keys');
  for (const l of model.links.filter(link => !link.self)) {
    assert.ok(pos.get(l.from).x + SIZES.W < pos.get(l.to).x, `${l.from.name} should sit left of ${l.to.name}`);
  }
});

test('flow: tables with no keys wait in their own box below the rest', () => {
  const model = buildModel(schema());
  const { pos, groups } = layout(model, 'flow', 'keys');
  const alone = ['audit_events', 'migrations', 'departments'].map(name => named(model, name));
  const bottom = Math.max(...model.nodes.filter(n => !alone.includes(n)).map(n => pos.get(n).y + n.h));
  for (const n of alone) assert.ok(pos.get(n).y > bottom, `${n.name} should sit below the flow`);
  assert.deepEqual(groups.map(g => g.label), ['Stand-alone tables']);
});

test('flow: a rank too tall for the screen wraps into lanes', () => {
  const model = buildModel(schema());
  const { pos } = layout(model, 'flow', 'keys');
  const lanes = new Set(model.nodes.filter(n => n.name.startsWith('policy_')).map(n => pos.get(n).x));
  assert.ok(lanes.size > 1);
});

test('families: plurals fold, and a table alone in its family joins the one it shares most keys with', () => {
  const model = buildModel(schema());
  const { pos, groups } = layout(model, 'families', 'keys');
  const groupOf = name => {
    const n = named(model, name);
    const p = pos.get(n);
    return groups.find(g => p.x >= g.x && p.x + SIZES.W <= g.x + g.w && p.y >= g.y && p.y + n.h <= g.y + g.h).label;
  };
  assert.equal(groupOf('companies'), 'company');
  assert.equal(groupOf('company_roles'), 'company');
  assert.equal(groupOf('roles'), 'company');
  assert.equal(groupOf('config_fields'), groupOf('config_versions'));
  assert.equal(groupOf('audit_events'), 'Stand-alone tables');
});

test('the same tables always give the same picture', () => {
  for (const name of LAYOUTS) {
    const a = layout(buildModel(schema()), name, 'keys').pos;
    const b = layout(buildModel(schema()), name, 'keys').pos;
    assert.deepEqual([...a.values()], [...b.values()]);
  }
});

test('a foreign key over two columns is one line, from its first column', () => {
  const model = buildModel([
    { schema: 'public', name: 'org_countries', kind: 'table', columns: [{ name: 'org_id', type: 'uuid' }, { name: 'country_code', type: 'char(2)' }], pk: ['org_id', 'country_code'], fks: [] },
    {
      schema: 'public',
      name: 'shifts',
      kind: 'table',
      columns: [{ name: 'id', type: 'uuid' }, { name: 'org_id', type: 'uuid' }, { name: 'country_code', type: 'char(2)' }],
      pk: ['id'],
      fks: [{ name: 'shifts_org_country_foreign', schema: 'public', tbl: 'org_countries', cols: ['org_id', 'country_code'], ref_cols: ['org_id', 'country_code'] }],
    },
  ]);
  assert.equal(model.links.length, 1);
  assert.deepEqual(model.links[0].cols, ['org_id', 'country_code']);
  assert.deepEqual([...named(model, 'shifts').fkCols], ['org_id', 'country_code']);
});

test('a key to a table outside the answer is left out, and a loop of keys does not hang', () => {
  const model = buildModel([table('a', { b_id: 'b' }), table('b', { a_id: 'a' }), table('c', { gone_id: 'missing' })]);
  assert.equal(model.links.length, 2);
  for (const name of LAYOUTS) assert.equal(layout(model, name, 'keys').pos.size, 3);
});

test('row counts come from the tables action, by schema and name', () => {
  const model = buildModel(schema(), { 'public.countries': 50 });
  assert.equal(named(model, 'countries').rows, 50);
  assert.equal(named(model, 'companies').rows, null);
});

test('an empty database lays out to nothing', () => {
  const model = buildModel([]);
  for (const name of LAYOUTS) assert.equal(layout(model, name, 'keys').pos.size, 0);
});

test('a database of 400 tables lays out in under two seconds', () => {
  const id = i => `t${String(i).padStart(3, '0')}`;
  const model = buildModel(Array.from({ length: 400 }, (_, i) => table(id(i), i ? { parent_id: id(Math.floor(i / 3)) } : {})));
  for (const name of LAYOUTS) {
    const start = process.hrtime.bigint();
    layout(model, name, 'keys');
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    assert.ok(ms < 2000, `${name} took ${Math.round(ms)} ms`);
  }
});
