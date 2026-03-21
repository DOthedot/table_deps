// ── SHARED COLOR PALETTE ──────────────────────────────────────
const SCHEMA_PALETTE = [
  '#58a6ff','#3fb950','#d29922','#f85149','#bc8cff',
  '#39d0d8','#f0883e','#db61a2','#85e89d','#ffea7f',
];
const _schemaColorCache = {};
let _paletteIdx = 0;

function schemaColor(schema) {
  if (!schema) return '#58a6ff';
  if (_schemaColorCache[schema]) return _schemaColorCache[schema];
  _schemaColorCache[schema] = SCHEMA_PALETTE[_paletteIdx % SCHEMA_PALETTE.length];
  _paletteIdx++;
  return _schemaColorCache[schema];
}
