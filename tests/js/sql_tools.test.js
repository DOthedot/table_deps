// Unit tests for the SQL editor's pure logic (static/js/sql_tools.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../../table_deps/frontend_service/static/js/sql_tools.js');

const rules = sql => T.lint(sql).map(p => p.rule);

test('tokenize is lossless and classifies comments, strings, numbers, words', () => {
  const sql = "SELECT a, 'x -- y' AS s -- note\nFROM t WHERE n = 1.5";
  const toks = T.tokenize(sql);
  assert.equal(toks.map(t => t.t).join(''), sql);
  assert.deepEqual(toks.filter(t => t.k === 'com').map(t => t.t), ['-- note']);
  assert.deepEqual(toks.filter(t => t.k === 'str').map(t => t.t), ["'x -- y'"]);
  assert.deepEqual(toks.filter(t => t.k === 'num').map(t => t.t), ['1.5']);
});

test('tableRefs: FROM/JOIN/comma lists, CTEs excluded, lowercased, deduped', () => {
  const sql = `WITH seg AS (SELECT id FROM Dim.Customer)
    SELECT * FROM fact.sales f JOIN seg s ON s.id = f.id
    LEFT JOIN dim.date d ON d.k = f.k, raw.extra x
    JOIN fact.sales f2 ON f2.id = f.id`;
  const r = T.tableRefs(sql);
  assert.deepEqual(r.tables, ['dim.customer', 'fact.sales', 'dim.date', 'raw.extra']);
  assert.deepEqual(r.ctes, ['seg']);
  assert.equal(r.joins, 3);
});

test('clean SQL has no problems', () => {
  assert.deepEqual(T.lint(`SELECT a.id, b.name
FROM a
JOIN b ON b.id = a.id
CROSS JOIN c
LEFT JOIN d USING (id)
WHERE a.x = 'from, x'`), []);
});

test('unbalanced-parens: unclosed and stray', () => {
  assert.deepEqual(rules('SELECT count(a FROM t'), ['unbalanced-parens']);
  const [p] = T.lint('SELECT a)\nFROM t');
  assert.equal(p.rule, 'unbalanced-parens');
  assert.equal(p.sev, 'error');
  assert.equal(p.line, 1);
});

test('trailing-comma before FROM, with a fix that removes it', () => {
  const sql = 'SELECT a,\n  b,\nFROM t';
  const [p] = T.lint(sql);
  assert.equal(p.rule, 'trailing-comma');
  assert.equal(p.line, 2);
  assert.equal(T.applyFix(sql, p), 'SELECT a,\n  b\nFROM t');
});

test('join-without-on: flagged unless CROSS or USING/ON present', () => {
  assert.deepEqual(rules('SELECT 1 FROM a LEFT JOIN b WHERE a.x = 1'), ['join-without-on']);
  assert.deepEqual(rules('SELECT 1 FROM a JOIN b\nJOIN c ON c.id = a.id'), ['join-without-on']);
  assert.deepEqual(rules('SELECT 1 FROM a CROSS JOIN b'), []);
});

test('join-without-on looks past subqueries: ON after ") alias" counts, nested JOINs are checked', () => {
  assert.deepEqual(rules(`SELECT 1 FROM a LEFT JOIN (
  SELECT id FROM b WHERE active = true
) e ON e.id = a.id`), []);
  assert.deepEqual(rules('SELECT 1 FROM a JOIN (SELECT id FROM b JOIN c WHERE 1 = 1) e ON e.id = a.id'), ['join-without-on']);
});

test('select-star flags * columns but not count(*)', () => {
  assert.deepEqual(rules('SELECT * FROM a'), ['select-star']);
  assert.deepEqual(rules('SELECT a.id, * FROM a'), ['select-star']);
  assert.deepEqual(rules('SELECT count(*) FROM a'), []);
});

test('implicit-join flags FROM a, b', () => {
  assert.deepEqual(rules('SELECT 1 FROM a x, b y WHERE x.id = y.id'), ['implicit-join']);
});

test('keyword-case: mixed is info with a format fix; consistent is fine', () => {
  const [p] = T.lint('SELECT a from t');
  assert.equal(p.rule, 'keyword-case');
  assert.equal(p.sev, 'info');
  assert.equal(p.fix, 'format');
  assert.deepEqual(rules('select a from t'), []);
});

test('keyword-case ignores identifiers that look like keywords (hub.order, t.from)', () => {
  assert.deepEqual(rules('SELECT o.id FROM hub.order o JOIN link.order_customer l ON l.id = o.id'), []);
});

test('comments and strings are never linted', () => {
  assert.deepEqual(rules("-- SELECT * FROM a, b\nSELECT a FROM t WHERE s = 'x, FROM (('"), []);
});

test('problems sort by severity, then line', () => {
  const sevs = T.lint('select *\nFROM a LEFT JOIN b').map(p => p.sev);
  assert.deepEqual(sevs, ['error', 'warning', 'info']);
});

test('formatBasic: clause per line, upper keywords, tight calls, strings kept', () => {
  const out = T.formatBasic("select a, sum(b) as s from t join u on t.id = u.id where x = 'from y' group by a");
  assert.equal(out, [
    'SELECT',
    '    a,',
    '    sum(b) AS s',
    'FROM t',
    'JOIN u',
    '    ON t.id = u.id',
    "WHERE x = 'from y'",
    'GROUP BY a',
  ].join('\n'));
});

test('formatBasic is idempotent and keeps comments', () => {
  const sql = '-- top\nwith c as (select id from a) select c.id from c left join b on b.id = c.id';
  const once = T.formatBasic(sql);
  assert.equal(T.formatBasic(once), once);
  assert.ok(once.startsWith('-- top\nWITH c AS ('));
});

test('highlight escapes HTML and marks keywords, tables and problems', () => {
  const sql = 'SELECT a FROM dim.x WHERE b < 1';
  const html = T.highlight(sql, [], s => (s === 'dim' ? '#58a6ff' : '#999'));
  assert.ok(html.includes('&lt;'));
  assert.ok(!html.includes('< 1'));
  assert.ok(html.includes('<span class="t-kw">SELECT</span>'));
  assert.ok(html.includes('class="t-tbl" style="--c:#58a6ff"'));
  const withProblem = T.highlight('SELECT * FROM a', T.lint('SELECT * FROM a'), () => '#999');
  assert.ok(withProblem.includes('class="sq warning"'));
});
