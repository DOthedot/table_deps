// Unit tests for the welcome guide's pure logic (static/js/tour.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const tour = require('../../table_deps/frontend_service/static/js/tour.js');

function memoryStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
}

test('auto-opens on a first visit to either landing page', () => {
  assert.equal(tour.shouldAutoOpen(memoryStorage(), ''), true);
  assert.equal(tour.shouldAutoOpen(memoryStorage(), '?p=kimball_retail'), true);
});

test('never auto-opens once seen', () => {
  assert.equal(tour.shouldAutoOpen(memoryStorage({ [tour.SEEN_KEY]: '1' }), ''), false);
});

test('stays closed on shared deep links so they open straight to the content', () => {
  assert.equal(tour.shouldAutoOpen(memoryStorage(), '?p=kimball_retail&t=fact.sales'), false);
  assert.equal(tour.shouldAutoOpen(memoryStorage(), '?p=kimball_retail&sel=dim.date'), false);
});

test('markSeen persists, and storage failures never throw', () => {
  const s = memoryStorage();
  tour.markSeen(s);
  assert.equal(tour.shouldAutoOpen(s, ''), false);
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('quota'); } };
  assert.doesNotThrow(() => tour.markSeen(broken));
  assert.equal(tour.shouldAutoOpen(broken, ''), true); // can't remember → still welcome them
  assert.equal(tour.shouldAutoOpen(null, ''), true);
});
