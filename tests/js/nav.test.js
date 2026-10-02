// Unit tests for the pure navigation module (static/js/nav.js).
// Run: node --test tests/js/   (wired into `make verify` as test-js)
const test = require('node:test');
const assert = require('node:assert/strict');
const nav = require('../../table_deps/frontend_service/static/js/nav.js');

// Small project: raw.a → stg.b → mart.c, plus raw.d → mart.c
// edges point reader → read-from, as in project.js / project_scanner.py
function fixture() {
  const mk = (id, refs, level) => ({
    id, label: id, schema: id.split('.')[0], table: id.split('.')[1], file: `${id}.sql`,
    all_refs: refs, internal_refs: refs, external_refs: [], degree: 0,
    sql_content: `select * from ${refs.join(', ') || 'ext.src'}`,
    _level: level, x: 10, y: 20, vx: 0.1, columns: ['x'], columnSources: [null],
  });
  const nodes = [mk('mart.c', ['stg.b', 'raw.d'], 2), mk('raw.a', [], 0), mk('stg.b', ['raw.a'], 1), mk('raw.d', [], 0)];
  const edges = [
    { source: 'mart.c', target: 'stg.b' }, { source: 'mart.c', target: 'raw.d' },
    { source: 'stg.b', target: 'raw.a' },
  ];
  return { nodes, edges };
}

function memoryStorage() {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
  };
}

test('snapshot keeps data fields, drops simulation/derived state, records level', () => {
  const { nodes, edges } = fixture();
  const snap = nav.snapshot('demo', nodes, edges);
  assert.equal(snap.project_name, 'demo');
  const c = snap.nodes.find(n => n.id === 'mart.c');
  assert.deepEqual(c.internal_refs, ['stg.b', 'raw.d']);
  assert.equal(c.level, 2);
  for (const k of ['x', 'y', 'vx', '_level', 'columns', 'columnSources']) assert.ok(!(k in c), k);
  assert.deepEqual(snap.edges[0], { source: 'mart.c', target: 'stg.b' });
});

test('snapshot accepts d3-resolved edge objects', () => {
  const { nodes } = fixture();
  const snap = nav.snapshot('demo', nodes, [{ source: { id: 'stg.b' }, target: { id: 'raw.a' } }]);
  assert.deepEqual(snap.edges, [{ source: 'stg.b', target: 'raw.a' }]);
});

test('save/load round-trips; load filters by project name', () => {
  const s = memoryStorage();
  const { nodes, edges } = fixture();
  assert.equal(nav.saveSnapshot(s, nav.snapshot('demo', nodes, edges)), true);
  assert.equal(nav.loadSnapshot(s).project_name, 'demo');
  assert.equal(nav.loadSnapshot(s, 'demo').nodes.length, 4);
  assert.equal(nav.loadSnapshot(s, 'other'), null);
  nav.clearSnapshot(s);
  assert.equal(nav.loadSnapshot(s), null);
});

test('storage failures never throw', () => {
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('quota'); }, removeItem() { throw new Error('x'); } };
  assert.equal(nav.saveSnapshot(broken, { project_name: 'x', nodes: [], edges: [] }), false);
  assert.equal(nav.loadSnapshot(broken), null);
  assert.doesNotThrow(() => nav.clearSnapshot(broken));
  assert.equal(nav.loadSnapshot(null), null);
  const garbage = memoryStorage(); garbage.setItem(nav.STORE_KEY, '{not json');
  assert.equal(nav.loadSnapshot(garbage), null);
});

test('urls: project and query views, encoded, round-trip through parseParams', () => {
  assert.equal(nav.projectUrl('demo'), '/project?p=demo');
  assert.equal(nav.projectUrl('demo', 'mart.c'), '/project?p=demo&sel=mart.c');
  assert.equal(nav.projectUrl(null), '/project');
  assert.equal(nav.queryUrl('demo', 'mart.c'), '/?p=demo&t=mart.c');
  assert.equal(nav.queryUrl(), '/');
  assert.equal(nav.queryUrl('my proj', 'a&b'), '/?p=my+proj&t=a%26b');
  assert.deepEqual(nav.parseParams('?p=my+proj&t=a%26b'), { p: 'my proj', t: 'a&b', sel: null });
  assert.deepEqual(nav.parseParams(''), { p: null, t: null, sel: null });
});

test('context: reads-from, used-by, and prev/next in level order (no wrap)', () => {
  const { nodes, edges } = fixture();
  const snap = nav.snapshot('demo', nodes, edges);
  assert.deepEqual(nav.ordered(snap), ['raw.a', 'raw.d', 'stg.b', 'mart.c']);

  const b = nav.context(snap, 'stg.b');
  assert.equal(b.node.id, 'stg.b');
  assert.deepEqual(b.readsFrom, ['raw.a']);
  assert.deepEqual(b.usedBy, ['mart.c']);
  assert.equal(b.prev, 'raw.d');
  assert.equal(b.next, 'mart.c');

  const first = nav.context(snap, 'raw.a');
  assert.equal(first.prev, null);
  assert.deepEqual(first.usedBy, ['stg.b']);
  assert.equal(nav.context(snap, 'mart.c').next, null);
  assert.equal(nav.context(snap, 'nope'), null);
});

test('resolveQueryTarget: selected node wins, then last opened file, else scratch', () => {
  assert.equal(nav.resolveQueryTarget({ selected: 'stg.b', lastFile: 'mart.c' }), 'stg.b');
  assert.equal(nav.resolveQueryTarget({ selected: null, lastFile: 'mart.c' }), 'mart.c');
  assert.equal(nav.resolveQueryTarget({ selected: null, lastFile: null }), null);
});

test('search: case-insensitive, table-name prefix ranks first, level order breaks ties', () => {
  const { nodes, edges } = fixture();
  const snap = nav.snapshot('demo', nodes, edges);
  assert.deepEqual(nav.search(snap, 'B'), ['stg.b']);
  assert.deepEqual(nav.search(snap, 'raw'), ['raw.a', 'raw.d']);
  assert.deepEqual(nav.search(snap, ''), ['raw.a', 'raw.d', 'stg.b', 'mart.c']);
  // 'a' prefixes raw.a's table name; it is merely contained in raw.d and mart.c
  assert.deepEqual(nav.search(snap, 'a'), ['raw.a', 'raw.d', 'mart.c']);
  assert.deepEqual(nav.search(snap, 'zzz'), []);
});
