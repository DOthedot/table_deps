'use strict';

// ═══════════════════════════════════════════════════
// SQL PARSING  (sql_parser.js provides SQL_KEYWORDS + FROM_JOIN_RE)
//              (colors.js provides schemaColor)
// ═══════════════════════════════════════════════════

// ── helpers shared by extractColumnsWithSources ──────────────────────────

// Extract balanced-paren body starting at openIdx, return end index
function _extractBody(sql, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < sql.length; i++) {
    if (sql[i] === '(') depth++;
    else if (sql[i] === ')' && --depth === 0) return i;
  }
  return sql.length;
}

// Split a SELECT clause string on top-level commas
function _splitSelectItems(clause) {
  const items = []; let cur = '', d = 0;
  for (const ch of clause) {
    if      (ch === '(') { d++; cur += ch; }
    else if (ch === ')') { d--; cur += ch; }
    else if (ch === ',' && d === 0) { items.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  if (cur.trim()) items.push(cur.trim());
  return items;
}

// Parse a SQL body (SELECT…FROM) and return [{col, source}].
// cteSources: Map<cteName, Map<colName, {table,col}>> for CTE tracing.
// projectTables: Set of known project node ids — stops CTE tracing at these.
function _parseSelectCols(sql, cteSources, projectTables) {
  // alias → real table
  const aliasMap = new Map();
  for (const m of sql.matchAll(/\b(?:FROM|JOIN)\s+([\w.`"[\]]+)\s+(?:AS\s+)?(\w+)\b/gi)) {
    const tname = m[1].replace(/[`"[\]]/g, '').toLowerCase();
    const alias = m[2].toLowerCase();
    if (!SQL_KEYWORDS.has(alias) && alias !== tname) aliasMap.set(alias, tname);
  }

  // single-FROM fallback (no JOINs at depth 0)
  let singleFrom = null;
  { let dep = 0, hasJoin = false;
    for (let i = 0; i < sql.length; i++) {
      if (sql[i] === '(') { dep++; continue; }
      if (sql[i] === ')') { dep--; continue; }
      if (dep === 0 && sql.slice(i, i + 4).toUpperCase() === 'JOIN') { hasJoin = true; break; }
    }
    if (!hasJoin) { const fm = sql.match(/\bFROM\s+([\w.`"[\]]+)/i);
      if (fm) singleFrom = fm[1].replace(/[`"[\]]/g, '').toLowerCase(); }
  }

  // find SELECT…FROM at depth 0
  let selectStart = -1, fromIdx = -1, dep = 0;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === '(') { dep++; continue; }
    if (ch === ')') { dep--; continue; }
    if (dep !== 0) continue;
    const before = i === 0 || /\W/.test(sql[i - 1]);
    if (selectStart === -1 && sql.slice(i, i+6).toUpperCase() === 'SELECT' && before && /\s/.test(sql[i+6]||' ')) { selectStart = i+6; continue; }
    if (selectStart !== -1 && sql.slice(i, i+4).toUpperCase() === 'FROM'   && before && /\W/.test(sql[i+4]||' ')) { fromIdx = i; break; }
  }
  if (selectStart < 0 || fromIdx < 0) return [];

  const results = [];
  for (const part of _splitSelectItems(sql.slice(selectStart, fromIdx))) {
    if (!part) continue;
    const base = part.replace(/\bAS\s+\w+\s*$/i, '').trim();

    let colName = null;
    const asM = part.match(/\bAS\s+([`"\[]?\w+[`"\]]?)\s*$/i);
    if (asM) colName = asM[1].replace(/[`"[\]]/g, '').toLowerCase();

    let source = null;
    const qualM = base.match(/\b(\w+)\.(\w+)\s*$/);
    if (qualM) {
      const alias = qualM[1].toLowerCase();
      const srcCol = qualM[2].toLowerCase();
      if (!colName) colName = srcCol;
      const rawTable = aliasMap.get(alias) || alias;
      source = _resolveViaCTE({ table: rawTable, col: srcCol }, cteSources, projectTables);
    }

    if (!colName) {
      const plainM = part.match(/([`"\[]?\w+[`"\]]?)\s*$/);
      if (plainM) { const n = plainM[1].replace(/[`"[\]]/g,'').toLowerCase(); if (n!=='*'&&!SQL_KEYWORDS.has(n)) colName=n; }
    }
    if (!colName) continue;

    if (!source && singleFrom) source = _resolveViaCTE({ table: singleFrom, col: colName }, cteSources, projectTables);
    results.push({ col: colName, source });
  }
  return results;
}

// Follow CTE chain until we land on a real (non-CTE) table, max 6 hops.
// Stops early when src.table matches a known project node (exact or unqualified name).
function _resolveViaCTE(src, cteSources, projectTables, depth = 0) {
  if (!src || depth > 6) return src;
  // Stop if this table is a known project node — it's the direct dependency the user cares about
  if (projectTables) {
    const unqual = src.table.split('.').pop();
    if (projectTables.has(src.table) ||
        [...projectTables].some(id => id.split('.').pop() === unqual)) return src;
  }
  const cteMap = cteSources.get(src.table);
  if (!cteMap) return src;
  const inner = cteMap.get(src.col);
  return inner ? _resolveViaCTE(inner, cteSources, projectTables, depth + 1) : src;
}

// ── main export ──────────────────────────────────────────────────────────

// Returns [{col, source: {table, col} | null}], columns[] and columnSources[] always parallel.
// projectIds: Set of known project node ids — CTE tracing stops at these.
function extractColumnsWithSources(sql, projectIds) {
  if (!sql || !sql.trim()) return [];
  sql = sql.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ')
           .replace(/'(?:[^'\\]|\\.)*'/g, "''");

  // Build CTE source map so we can trace through CTEs to real tables
  const cteSources = new Map(); // cteName → Map(colName → {table, col})
  for (const m of sql.matchAll(/\b(\w+)\s+AS\s*\(/gi)) {
    const cteName = m[1].toLowerCase();
    if (SQL_KEYWORDS.has(cteName)) continue;
    const openIdx = m.index + m[0].length - 1;
    const endIdx  = _extractBody(sql, openIdx);
    const body    = sql.slice(openIdx + 1, endIdx);
    const inner   = _parseSelectCols(body, cteSources, projectIds);
    const cteMap  = new Map();
    for (const { col, source } of inner) if (source) cteMap.set(col, source);
    cteSources.set(cteName, cteMap);
  }

  return _parseSelectCols(sql, cteSources, projectIds);
}

function extractTables(sql) {
  if (!sql || !sql.trim()) return [];
  sql = sql.replace(/--[^\n]*/g, ' ');
  sql = sql.replace(/\/\*[\s\S]*?\*\//g, ' ');
  sql = sql.replace(/'(?:[^'\\]|\\.)*'/g, "''");
  const cteNames = new Set();
  for (const m of sql.matchAll(/\b(\w+)\s+AS\s*\(/gi)) {
    const n = m[1].replace(/[`"[\]]/g, '').toLowerCase();
    if (!SQL_KEYWORDS.has(n)) cteNames.add(n);
  }
  const tables = new Set();
  for (const m of sql.matchAll(FROM_JOIN_RE())) {
    const name = m[3].replace(/[`"[\]]/g, '').toLowerCase();
    if (SQL_KEYWORDS.has(name) || /^\d+$/.test(name) || cteNames.has(name)) continue;
    tables.add(name);
  }
  return Array.from(tables);
}

// ═══════════════════════════════════════════════════
// GRAPH BUILDING FROM FILES
// ═══════════════════════════════════════════════════

function buildGraphFromFiles(files) {
  const nodes = new Map();
  const fileRefs = new Map();

  for (const { name, content } of files) {
    const stem = name.replace(/\.sql$/i, '').toLowerCase();
    if (!stem.includes('.')) continue;
    const schema = stem.split('.')[0];
    const table  = stem.split('.').slice(1).join('_');
    nodes.set(stem, { id: stem, label: stem, schema, table, file: name,
                      all_refs: [], internal_refs: [], external_refs: [], degree: 0,
                      sql_content: content,
                      ...(() => { const r = extractColumnsWithSources(content, new Set(nodes.keys())); return { columns: r.map(c => c.col), columnSources: r.map(c => c.source) }; })() });
    fileRefs.set(stem, extractTables(content));
  }

  const projectIds = new Set(nodes.keys());
  // Warm color cache in schema order for stable colors
  [...new Set([...projectIds].map(id => id.split('.')[0]))].sort().forEach(s => schemaColor(s));

  const edges = [];
  const seenEdges = new Set();

  for (const [sourceId, refs] of fileRefs) {
    const node = nodes.get(sourceId);
    const addedInt = new Set(), addedExt = new Set();

    for (const ref of refs) {
      const rl = ref.toLowerCase();
      let targetId = projectIds.has(rl) ? rl
        : [...projectIds].find(t => t.split('.').pop() === rl.split('.').pop()) || null;

      if (targetId && targetId !== sourceId) {
        if (!addedInt.has(targetId)) {
          addedInt.add(targetId);
          node.internal_refs.push(targetId);
          node.all_refs.push(targetId);
        }
        const key = `${sourceId}\u2192${targetId}`;
        if (!seenEdges.has(key)) {
          seenEdges.add(key);
          edges.push({ source: sourceId, target: targetId });
          nodes.get(sourceId).degree++;
          nodes.get(targetId).degree++;
        }
      } else if (!projectIds.has(rl) && !addedExt.has(rl)) {
        addedExt.add(rl);
        node.external_refs.push(ref);
        node.all_refs.push(ref);
      }
    }
  }

  return { nodes: [...nodes.values()], edges };
}

// ═══════════════════════════════════════════════════
// TOPOLOGICAL LEVELS
// ═══════════════════════════════════════════════════

function computeLevels(nodes, edges) {
  const ids = nodes.map(n => n.id);
  const depsOf  = new Map(ids.map(id => [id, []]));
  const rdepsOf = new Map(ids.map(id => [id, []]));

  for (const e of edges) {
    depsOf.get(e.source)?.push(e.target);
    rdepsOf.get(e.target)?.push(e.source);
  }

  const remaining = new Map(ids.map(id => [id, (depsOf.get(id) || []).length]));
  const level     = new Map();
  const queue     = ids.filter(id => remaining.get(id) === 0);
  queue.forEach(id => level.set(id, 0));

  let qi = 0;
  while (qi < queue.length) {
    const curr = queue[qi++];
    for (const rdep of (rdepsOf.get(curr) || [])) {
      const candidate = (level.get(curr) || 0) + 1;
      if (!level.has(rdep) || level.get(rdep) < candidate) level.set(rdep, candidate);
      remaining.set(rdep, remaining.get(rdep) - 1);
      if (remaining.get(rdep) === 0) queue.push(rdep);
    }
  }
  ids.forEach(id => { if (!level.has(id)) level.set(id, 0); });
  return level;
}

// ═══════════════════════════════════════════════════
// BOX GEOMETRY
// ═══════════════════════════════════════════════════

const HDR_H = 36, ROW_H = 19, PAD_V = 9, PAD_H = 14;
const MIN_W = 195, MAX_W = 270;
const H_GAP = 90, V_GAP = 28, CANVAS_PAD = 50;

function boxW(node) {
  const cols = node.columns || [];
  const longest = Math.max(node.label.length, ...(cols.length ? cols.map(c => c.length) : [0]));
  return Math.min(MAX_W, Math.max(MIN_W, Math.min(longest, 30) * 6.9 + PAD_H * 2));
}

function boxH(node) {
  const cols = node.columns || [];
  return HDR_H + (cols.length > 0
    ? PAD_V + Math.min(cols.length, 12) * ROW_H + PAD_V
    : PAD_V);
}

// ═══════════════════════════════════════════════════
// LAYOUT  — computes _cx, _cy (center of each box)
// ═══════════════════════════════════════════════════

function assignPositions(nodes, edges) {
  const levelMap = computeLevels(nodes, edges);
  nodes.forEach(n => { n._level = levelMap.get(n.id) || 0; n._w = boxW(n); n._h = boxH(n); });

  // Group by level
  const byLevel = new Map();
  nodes.forEach(n => {
    if (!byLevel.has(n._level)) byLevel.set(n._level, []);
    byLevel.get(n._level).push(n);
  });

  const maxLevel = Math.max(...levelMap.values(), 0);

  // Barycenter sort within each level to reduce crossings
  const depsOf = new Map(nodes.map(n => [n.id, []]));
  edges.forEach(e => depsOf.get(e.source)?.push(e.target));

  for (let l = 0; l <= maxLevel; l++) {
    const grp = byLevel.get(l) || [];
    if (l === 0) {
      grp.sort((a, b) => a.id.localeCompare(b.id));
    } else {
      const posOf = new Map();
      nodes.filter(n => n._level < l && n._cy !== undefined).forEach(n => posOf.set(n.id, n._cy));
      grp.forEach(n => {
        const ys = depsOf.get(n.id).map(d => posOf.get(d)).filter(v => v != null);
        n._bary = ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : 0;
      });
      grp.sort((a, b) => a._bary - b._bary);
    }
  }

  // Column widths
  const colW = Array.from({ length: maxLevel + 1 }, (_, l) => {
    const grp = byLevel.get(l) || [];
    return grp.length ? Math.max(...grp.map(n => n._w)) : 0;
  });

  // Column x-positions
  const colX = [];
  let x = CANVAS_PAD;
  for (let l = 0; l <= maxLevel; l++) { colX[l] = x; x += colW[l] + H_GAP; }
  const totalW = x - H_GAP + CANVAS_PAD;

  // Max column height for centering
  let maxColH = 0;
  for (let l = 0; l <= maxLevel; l++) {
    const grp = byLevel.get(l) || [];
    const h = grp.reduce((s, n) => s + n._h, 0) + V_GAP * Math.max(0, grp.length - 1);
    maxColH = Math.max(maxColH, h);
  }
  const totalH = maxColH + CANVAS_PAD * 2;

  // Assign _cx, _cy; also store canonical positions for reset
  for (let l = 0; l <= maxLevel; l++) {
    const grp = byLevel.get(l) || [];
    const colH = grp.reduce((s, n) => s + n._h, 0) + V_GAP * Math.max(0, grp.length - 1);
    let yStart = CANVAS_PAD + (maxColH - colH) / 2;
    grp.forEach(n => {
      n._cx = colX[l] + colW[l] / 2;
      n._cy = yStart + n._h / 2;
      n._ox = n._cx;  // original x for reset
      n._oy = n._cy;  // original y for reset
      yStart += n._h + V_GAP;
    });
  }

  return { totalW, totalH, maxLevel };
}

// ═══════════════════════════════════════════════════
// D3 RENDERING  +  DRAG
// ═══════════════════════════════════════════════════

const svgEl     = document.getElementById('graph');
const svgD3     = d3.select(svgEl);
const tooltip   = document.getElementById('tooltip');
const container = document.getElementById('graph-container');

let gMain, zoomBeh, currentSim = null, currentData = null, hlId = null, _firstLoad = true;
let _nodeSel = null, _edgeSel = null, _depsOf = null, _rdepsOf = null;
let _nodeById = null, _colRowEls = new Map(); // nodeId → Map(colName → {hitRect, text, color})

function renderGraph(data) {
  _firstLoad = true;
  currentData = data;
  const { nodes, edges } = data;
  const { totalW, totalH } = assignPositions(nodes, edges);

  svgD3.selectAll('*').remove();
  svgD3.attr('viewBox', [0, 0, totalW, totalH]);

  // ── Zoom / pan ──────────────────────────────────
  zoomBeh = d3.zoom()
    .filter(event => !event.button && !event.target.closest?.('.box-node'))
    .scaleExtent([0.05, 6])
    .on('zoom', e => gMain.attr('transform', e.transform));
  svgD3.call(zoomBeh);

  // Arrow marker
  svgD3.append('defs').append('marker')
    .attr('id', 'arr').attr('viewBox', '0 -5 10 10')
    .attr('refX', 10).attr('refY', 0)
    .attr('markerWidth', 6).attr('markerHeight', 6)
    .attr('orient', 'auto')
    .append('path').attr('d', 'M0,-5L10,0L0,5')
    .attr('fill', '#94a3b8').attr('opacity', 0.8);

  gMain = svgD3.append('g');

  // Build lookup maps
  const nodeById = new Map(nodes.map(n => [n.id, n]));
  const depsOf   = new Map(nodes.map(n => [n.id, []]));
  const rdepsOf  = new Map(nodes.map(n => [n.id, []]));
  edges.forEach(e => {
    depsOf.get(e.source)?.push(e.target);
    rdepsOf.get(e.target)?.push(e.source);
  });

  // ── EDGES ──────────────────────────────────────
  const edgeSel = gMain.append('g').attr('class', 'edges')
    .selectAll('path').data(edges).join('path')
    .attr('class', 'edge')
    .attr('marker-end', 'url(#arr)')
    .attr('d', d => bezierPath(nodeById.get(d.source), nodeById.get(d.target)));

  // ── NODES ──────────────────────────────────────
  const nodeSel = gMain.append('g').attr('class', 'nodes')
    .selectAll('g').data(nodes).join('g')
    .attr('class', 'box-node')
    .attr('transform', d => `translate(${d._cx},${d._cy})`)
    .attr('data-id', d => d.id)
    .on('mouseenter', (ev, d) => {
      if (d3.select(ev.currentTarget).classed('grabbing')) return;
      showTooltip(ev, d, depsOf, rdepsOf);
      applyHighlight(d.id, nodeSel, edgeSel, depsOf, rdepsOf);
    })
    .on('mousemove', positionTooltip)
    .on('mouseleave', () => {
      tooltip.style.display = 'none';
      clearHighlight(nodeSel, edgeSel);
    })
    .on('click', (event, d) => {
      if (event.detail >= 2) {
        openNodeInVisualizer(d);
        return;
      }
      hlId = (hlId === d.id) ? null : d.id;
      syncListHighlight(hlId);
    });

  _nodeSel = nodeSel; _edgeSel = edgeSel; _depsOf = depsOf; _rdepsOf = rdepsOf;
  _nodeById = nodeById; _colRowEls = new Map();

  // Draw box content into each <g>
  nodeSel.each(function(d) { renderBox(d3.select(this), d); });

  // ── FORCE SIMULATION ───────────────────────────
  nodes.forEach(d => { d.x = d._cx; d.y = d._cy; });

  if (currentSim) currentSim.stop();
  currentSim = d3.forceSimulation(nodes)
    .force('x',       d3.forceX(d => d._ox).strength(0.8))
    .force('y',       d3.forceY(d => d._oy).strength(0.5))
    .force('repel',   d3.forceManyBody().strength(-160).distanceMax(350))
    .force('collide', d3.forceCollide(d => Math.hypot(d._w, d._h) / 2 + 6).strength(0.8))
    .alphaDecay(0.055)
    .velocityDecay(0.45)
    .on('tick', () => {
      nodes.forEach(d => { d._cx = d.x; d._cy = d.y; });
      nodeSel.attr('transform', d => `translate(${d._cx},${d._cy})`);
      edgeSel.attr('d', e => bezierPath(nodeById.get(e.source), nodeById.get(e.target)));
    })
    .on('end', () => { if (_firstLoad) { _firstLoad = false; fitToView(); } });

  // ── DRAG ──────────────────────────────────────
  const drag = d3.drag()
    .on('start', function(event, d) {
      event.sourceEvent.stopPropagation();
      if (!event.active) currentSim.alphaTarget(0.3).restart();
      d.fx = d.x; d.fy = d.y;
      d3.select(this).raise().classed('grabbing', true);
      tooltip.style.display = 'none';
    })
    .on('drag', function(event, d) {
      const t = d3.zoomTransform(svgEl);
      d.fx += event.dx / t.k;
      d.fy += event.dy / t.k;
    })
    .on('end', function(event, d) {
      d.fx = null; d.fy = null;
      if (!event.active) currentSim.alphaTarget(0);
      currentSim.alpha(0.5).restart();
      d3.select(this).classed('grabbing', false);
    });

  nodeSel.call(drag);

  document.getElementById('empty-state').style.display = 'none';
}

// ── Open node SQL in visualizer ────────────────────
function openNodeInVisualizer(node) {
  const sql = node.sql_content;
  if (!sql || !sql.trim()) {
    alert(`No SQL content available for ${node.id}`);
    return;
  }
  localStorage.setItem('table_deps_viz_sql', sql);
  window.open('/', '_blank');
}

// ── Box rendering ─────────────────────────────────

function renderBox(sel, node) {
  const w = node._w, h = node._h;
  const x = -w / 2, y = -h / 2;
  const color = schemaColor(node.schema);

  // Background rect
  sel.append('rect').attr('class', 'node-bg')
    .attr('x', x).attr('y', y).attr('width', w).attr('height', h)
    .attr('rx', 8)
    .attr('fill', color + '15')
    .attr('stroke', color).attr('stroke-width', 1.5);

  // Header band
  sel.append('rect')
    .attr('x', x).attr('y', y).attr('width', w).attr('height', HDR_H)
    .attr('rx', 8).attr('fill', color + '2e');
  sel.append('rect')  // clip bottom corners of header
    .attr('x', x).attr('y', y + HDR_H - 8).attr('width', w).attr('height', 8)
    .attr('fill', color + '2e');

  // Schema label (dimmed)
  const schema = node.label.split('.')[0];
  const tname  = node.label.split('.').slice(1).join('.');
  const schW   = schema.length * 6.5;

  sel.append('text')
    .attr('x', x + PAD_H - 2).attr('y', y + HDR_H / 2)
    .attr('dominant-baseline', 'middle')
    .attr('fill', color + 'aa')
    .attr('font-size', '10px').attr('font-weight', '600')
    .attr('font-family', "'SF Mono','Fira Code',monospace")
    .text(schema + '.');

  sel.append('text')
    .attr('x', x + PAD_H - 2 + schW).attr('y', y + HDR_H / 2)
    .attr('dominant-baseline', 'middle')
    .attr('fill', color)
    .attr('font-size', '11px').attr('font-weight', '700')
    .attr('font-family', "'SF Mono','Fira Code',monospace")
    .text(tname.length > 22 ? tname.slice(0, 20) + '\u2026' : tname);

  // Divider
  sel.append('line')
    .attr('x1', x + 10).attr('y1', y + HDR_H)
    .attr('x2', x + w - 10).attr('y2', y + HDR_H)
    .attr('stroke', color + '44').attr('stroke-width', 1);

  // Column rows
  const cols        = node.columns || [];
  const sources     = node.columnSources || [];
  const showCols    = cols.slice(0, 12);
  const extra       = cols.length - 12;

  showCols.forEach((col, i) => {
    const ry  = y + HDR_H + PAD_V + (i + 0.5) * ROW_H;
    const src = sources[i] || null;   // source table id for this column

    // Wrap in a <g> so we can intercept hover on the row
    const rowG = sel.append('g').style('cursor', src ? 'crosshair' : 'default');

    const rowHitRect = rowG.append('rect')
      .attr('x', x).attr('y', ry - ROW_H / 2).attr('width', w).attr('height', ROW_H)
      .attr('rx', 3).attr('fill', 'transparent');

    rowG.append('circle').attr('cx', x + 12).attr('cy', ry).attr('r', 3).attr('fill', color);

    const rowText = rowG.append('text')
      .attr('x', x + 21).attr('y', ry)
      .attr('dominant-baseline', 'middle')
      .attr('fill', '#4d5562')
      .attr('font-size', '9.5px')
      .attr('font-family', "'SF Mono',monospace")
      .text(col.length > 31 ? col.slice(0, 29) + '\u2026' : col);

    // Register this row so other nodes can highlight it
    if (!_colRowEls.has(node.id)) _colRowEls.set(node.id, new Map());
    _colRowEls.get(node.id).set(col, { hitRect: rowHitRect, text: rowText, color });

    if (src) {
      rowG
        .on('mouseenter', ev => {
          ev.stopPropagation();
          rowHitRect.attr('fill', color + '22');
          rowText.attr('fill', color);

          // Resolve source table to a node id and highlight its column row
          const srcTable = src.table;
          const srcCol   = src.col;
          const srcNodeId = _nodeById?.has(srcTable) ? srcTable
            : [...(_nodeById?.keys() || [])].find(k => k.split('.').pop() === srcTable.split('.').pop()) || null;
          if (srcNodeId) {
            const srcRow = _colRowEls.get(srcNodeId)?.get(srcCol);
            if (srcRow) {
              srcRow.hitRect.attr('fill', srcRow.color + '22');
              srcRow.text.attr('fill', srcRow.color);
            }
            applyColumnHighlight(node.id, srcNodeId);
          }
          showColTooltip(ev, col, srcTable);
        })
        .on('mousemove', ev => { ev.stopPropagation(); positionTooltip(ev); })
        .on('mouseleave', ev => {
          ev.stopPropagation();
          rowHitRect.attr('fill', 'transparent');
          rowText.attr('fill', '#4d5562');

          // Restore source column row
          const srcTable = src.table;
          const srcCol   = src.col;
          const srcNodeId = _nodeById?.has(srcTable) ? srcTable
            : [...(_nodeById?.keys() || [])].find(k => k.split('.').pop() === srcTable.split('.').pop()) || null;
          if (srcNodeId) {
            const srcRow = _colRowEls.get(srcNodeId)?.get(srcCol);
            if (srcRow) {
              srcRow.hitRect.attr('fill', 'transparent');
              srcRow.text.attr('fill', '#4d5562');
            }
          }
          // If the mouse moved to another element still inside this node box,
          // re-apply node-level highlight instead of clearing everything
          if (sel.node().contains(ev.relatedTarget)) {
            showTooltip(ev, node, _depsOf, _rdepsOf);
            applyHighlight(node.id, _nodeSel, _edgeSel, _depsOf, _rdepsOf);
          } else {
            tooltip.style.display = 'none';
            clearHighlight(_nodeSel, _edgeSel);
          }
        });
    }
  });

  if (extra > 0) {
    const ry = y + HDR_H + PAD_V + (showCols.length + 0.5) * ROW_H;
    sel.append('text')
      .attr('x', x + 12).attr('y', ry)
      .attr('dominant-baseline', 'middle')
      .attr('fill', '#888888').attr('font-size', '9px')
      .text(`\u2026 and ${extra} more`);
  }
}

// ── Edge path: cubic bezier, flows left → right ───

function bezierPath(src, tgt) {
  if (!src || !tgt) return '';
  const sx = tgt._cx + tgt._w / 2;
  const sy = tgt._cy;
  const tx = src._cx - src._w / 2;
  const ty = src._cy;
  const cp = Math.abs(tx - sx) * 0.42;
  return `M ${sx} ${sy} C ${sx + cp} ${sy} ${tx - cp} ${ty} ${tx} ${ty}`;
}

// ═══════════════════════════════════════════════════
// TOOLTIP
// ═══════════════════════════════════════════════════

function showTooltip(ev, d, depsOf, rdepsOf) {
  document.getElementById('tt-name').textContent = d.label;
  document.getElementById('tt-file').textContent = '\ud83d\udcc4 ' + d.file;
  document.getElementById('tt-in').textContent   = (depsOf.get(d.id)  || []).length;
  document.getElementById('tt-out').textContent  = (rdepsOf.get(d.id) || []).length;
  document.getElementById('tt-ext').textContent  = (d.external_refs || []).length;
  document.getElementById('tt-lv').textContent   = d._level ?? '\u2014';
  tooltip.style.display = 'block';
  positionTooltip(ev);
}

function positionTooltip(ev) {
  if (!ev?.clientX) return;
  const r  = container.getBoundingClientRect();
  let px   = ev.clientX - r.left + 14;
  let py   = ev.clientY - r.top  + 14;
  if (px + 220 > container.clientWidth)  px -= 240;
  if (py + 140 > container.clientHeight) py -= 155;
  tooltip.style.left = px + 'px';
  tooltip.style.top  = py + 'px';
}

// ═══════════════════════════════════════════════════
// HIGHLIGHT  (hover traces deps + dependents)
// ═══════════════════════════════════════════════════

function applyHighlight(id, nodeSel, edgeSel, depsOf, rdepsOf) {
  const connected = new Set([id]);
  (depsOf.get(id)  || []).forEach(d => connected.add(d));
  (rdepsOf.get(id) || []).forEach(d => connected.add(d));

  nodeSel
    .classed('faded', d => !connected.has(d.id))
    .classed('hl',    d => d.id === id);

  edgeSel
    .classed('faded', e => !(connected.has(e.source) && connected.has(e.target)))
    .classed('hl',    e => e.source === id || e.target === id);
}

function clearHighlight(nodeSel, edgeSel) {
  nodeSel.classed('faded', false).classed('hl', false);
  edgeSel.classed('faded', false).classed('hl', false);
}

// Highlight just the current node + one specific source table + the edge between them
function applyColumnHighlight(currentId, sourceId) {
  if (!_nodeSel || !_edgeSel) return;
  const lit = new Set([currentId, sourceId]);
  _nodeSel
    .classed('faded', d => !lit.has(d.id))
    .classed('hl',    d => d.id === sourceId);
  _edgeSel
    .classed('faded', e => !(lit.has(e.source) && lit.has(e.target)))
    .classed('hl',    e => (e.source === currentId && e.target === sourceId) ||
                           (e.source === sourceId  && e.target === currentId));
}

// Tooltip showing which source table a column came from
function showColTooltip(ev, col, sourceTable) {
  document.getElementById('tt-name').textContent   = col;
  document.getElementById('tt-file').textContent   = '\u2190 from:  ' + sourceTable;
  document.getElementById('tt-in').textContent     = '\u2014';
  document.getElementById('tt-out').textContent    = '\u2014';
  document.getElementById('tt-ext').textContent    = '\u2014';
  document.getElementById('tt-lv').textContent     = '\u2014';
  tooltip.style.display = 'block';
  positionTooltip(ev);
}

// ═══════════════════════════════════════════════════
// ZOOM CONTROLS
// ═══════════════════════════════════════════════════

function fitToView(scaleMult) {
  if (!gMain || !zoomBeh || !currentData) return;
  const nodes = currentData.nodes;
  if (!nodes.length) return;
  const pad = 48;
  const minX = Math.min(...nodes.map(n => n._cx - n._w / 2)) - pad;
  const maxX = Math.max(...nodes.map(n => n._cx + n._w / 2)) + pad;
  const minY = Math.min(...nodes.map(n => n._cy - n._h / 2)) - pad;
  const maxY = Math.max(...nodes.map(n => n._cy + n._h / 2)) + pad;
  const bw = maxX - minX, bh = maxY - minY;
  if (bw === 0 || bh === 0) return;
  const { clientWidth: w, clientHeight: h } = container;
  const scale = Math.max(Math.min(w / bw, h / bh, 2), 0.25) * (scaleMult || 1);
  const tx = w / 2 - scale * (minX + bw / 2);
  const ty = h / 2 - scale * (minY + bh / 2);
  svgD3.transition().duration(400)
    .call(zoomBeh.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));
}

document.getElementById('zoom-in').addEventListener('click', () =>
  svgD3.transition().duration(250).call(zoomBeh.scaleBy, 1.4));
document.getElementById('zoom-out').addEventListener('click', () =>
  svgD3.transition().duration(250).call(zoomBeh.scaleBy, 0.7));
document.getElementById('zoom-fit').addEventListener('click', () => {
  fitToView();
});
document.getElementById('reset-layout').addEventListener('click', () => {
  if (!currentData || !currentSim) return;
  currentData.nodes.forEach(n => {
    n.x = n._ox; n.y = n._oy;
    n.vx = 0;    n.vy = 0;
    n.fx = null; n.fy = null;
  });
  currentSim.alpha(0.5).restart();
  setTimeout(() => fitToView(2), 400);
});

// ═══════════════════════════════════════════════════
// SIDEBAR
// ═══════════════════════════════════════════════════

function updateSidebar(data, projectName) {
  const { nodes, edges } = data;
  const maxLevel = Math.max(...nodes.map(n => n._level || 0), 0);

  document.getElementById('stats-section').style.display  = '';
  document.getElementById('tables-section').style.display = '';
  document.getElementById('st-tables').textContent = nodes.length;
  document.getElementById('st-edges').textContent  = edges.length;
  document.getElementById('st-levels').textContent = maxLevel + 1;

  const badge = document.getElementById('project-badge');
  badge.textContent = '\ud83d\udcc1 ' + projectName;
  badge.style.display = '';

  // Table list sorted by level then alphabetically
  const ul = document.getElementById('table-list');
  ul.innerHTML = '';
  [...nodes].sort((a, b) => (a._level || 0) - (b._level || 0) || a.id.localeCompare(b.id))
    .forEach(node => {
      const color = schemaColor(node.schema);
      const li = document.createElement('li');
      li.dataset.id = node.id;
      li.style.borderLeftColor = color;
      li.innerHTML = `
        <span class="dot" style="background:${color}"></span>
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10.5px">${node.label}</span>
        <span class="lv-badge">L${node._level || 0}</span>`;
      li.addEventListener('click', (ev) => {
        if (ev.detail >= 2) { openNodeInVisualizer(node); return; }
        hlId = hlId === node.id ? null : node.id;
        syncListHighlight(hlId);
        svgD3.selectAll('.box-node').filter(d => d.id === node.id)
          .select('.node-bg')
          .transition().duration(100).attr('stroke-width', 4)
          .transition().duration(250).attr('stroke-width', 1.5);
      });
      ul.appendChild(li);
    });

  // Schema legend
  const legendEl = document.getElementById('schema-legend');
  legendEl.innerHTML = '';
  [...new Set(nodes.map(n => n.schema))].sort().forEach(s => {
    const row = document.createElement('div');
    row.className = 'legend-row';
    row.innerHTML = `<div class="legend-swatch" style="background:${schemaColor(s)}"></div>${s}`;
    legendEl.appendChild(row);
  });
}

function syncListHighlight(id) {
  document.querySelectorAll('#table-list li').forEach(li =>
    li.classList.toggle('hl', li.dataset.id === id));
}

// ═══════════════════════════════════════════════════
// COLUMN ENRICHMENT
// Nodes loaded from the server or the example payload have sql_content
// but no columns/columnSources — compute them here.
// ═══════════════════════════════════════════════════

function enrichNodesWithColumns(nodes) {
  const projectIds = new Set(nodes.map(n => n.id));
  for (const node of nodes) {
    if (!node.columns && node.sql_content) {
      const r = extractColumnsWithSources(node.sql_content, projectIds);
      node.columns       = r.map(c => c.col);
      node.columnSources = r.map(c => c.source);
    }
  }
}

// ═══════════════════════════════════════════════════
// PROCESS GRAPH DATA
// ═══════════════════════════════════════════════════

function processGraphData(data, projectName) {
  enrichNodesWithColumns(data.nodes);
  const dz = document.getElementById('drop-zone');
  dz.classList.add('loaded');
  dz.querySelector('.dz-icon').textContent  = '\u2705';
  dz.querySelector('.dz-label').textContent = projectName;
  dz.querySelector('.dz-hint').textContent  = `${data.nodes.length} tables \u00b7 ${data.edges.length} deps`;
  [...new Set(data.nodes.map(n => n.schema))].sort().forEach(s => schemaColor(s));
  renderGraph(data);
  updateSidebar(data, projectName);
}

// ═══════════════════════════════════════════════════
// LOAD GRAPH  — accepts pre-processed server data
// ═══════════════════════════════════════════════════

function loadGraph(data) {
  // data from /api/scan already has pre-processed nodes (all_refs, internal_refs, external_refs, schema)
  enrichNodesWithColumns(data.nodes);
  // Warm color cache in stable schema order
  [...new Set(data.nodes.map(n => n.schema))].sort().forEach(s => schemaColor(s));
  renderGraph({ nodes: data.nodes, edges: data.edges });
  updateSidebar({ nodes: data.nodes, edges: data.edges }, data.project_name || 'project');
  // Also update the drop-zone UI to reflect loaded state
  const dz = document.getElementById('drop-zone');
  dz.classList.add('loaded');
  dz.querySelector('.dz-icon').textContent  = '\u2705';
  dz.querySelector('.dz-label').textContent = data.project_name || 'project';
  dz.querySelector('.dz-hint').textContent  = `${data.nodes.length} tables \u00b7 ${data.edges.length} deps`;
}

// ═══════════════════════════════════════════════════
// SERVER LOAD  — try /api/scan first
// ═══════════════════════════════════════════════════

async function loadFromServer() {
  try {
    const resp = await fetch('/api/scan');
    if (!resp.ok) return false;
    const data = await resp.json();
    if (!data.nodes || !data.nodes.length) return false;
    loadGraph(data);
    return true;
  } catch (e) {
    return false;
  }
}

// ═══════════════════════════════════════════════════
// FILE SYSTEM ACCESS API
// ═══════════════════════════════════════════════════

async function openFolderPicker() {
  if (!('showDirectoryPicker' in window)) {
    document.getElementById('compat-warn').style.display = '';
    return;
  }
  try {
    const dirHandle = await window.showDirectoryPicker({ mode: 'read' });
    const files = [];
    for await (const [name, handle] of dirHandle) {
      if (handle.kind === 'file' && name.toLowerCase().endsWith('.sql')) {
        const f = await handle.getFile();
        files.push({ name, content: await f.text() });
      }
    }
    if (!files.length) { alert('No .sql files found.'); return; }
    processGraphData(buildGraphFromFiles(files), dirHandle.name);
  } catch (err) {
    if (err.name !== 'AbortError') console.error(err);
  }
}

document.getElementById('open-btn').addEventListener('click', openFolderPicker);
document.getElementById('drop-zone').addEventListener('click', openFolderPicker);

// ── Example button ───────────────────────────────

document.getElementById('example-btn').addEventListener('click', () => {
  processGraphData(buildGraphFromFiles(KIMBALL_EXAMPLE_FILES), 'kimball_retail');

});

// Drag-and-drop folder
const dz = document.getElementById('drop-zone');
dz.addEventListener('dragover', ev => { ev.preventDefault(); dz.classList.add('over'); });
dz.addEventListener('dragleave', ()  => dz.classList.remove('over'));
dz.addEventListener('drop', async ev => {
  ev.preventDefault(); dz.classList.remove('over');
  const items = Array.from(ev.dataTransfer.items || []);
  const files = []; let dirName = 'project';
  for (const item of items) {
    if (item.kind !== 'file') continue;
    const entry = item.webkitGetAsEntry?.();
    if (entry?.isDirectory) { dirName = entry.name; await readDirEntry(entry, files); }
    else { const f = item.getAsFile(); if (f?.name.toLowerCase().endsWith('.sql')) files.push({ name: f.name, content: await f.text() }); }
  }
  if (files.length) processGraphData(buildGraphFromFiles(files), dirName);
});

async function readDirEntry(dirEntry, acc) {
  return new Promise(resolve => {
    dirEntry.createReader().readEntries(async entries => {
      for (const e of entries) {
        if (e.isFile && e.name.toLowerCase().endsWith('.sql')) {
          await new Promise(res => e.file(f => {
            const r = new FileReader();
            r.onload = ev => { acc.push({ name: f.name, content: ev.target.result }); res(); };
            r.readAsText(f);
          }));
        }
      }
      resolve();
    });
  });
}

// ═══════════════════════════════════════════════════
// CLEAR
// ═══════════════════════════════════════════════════

document.getElementById('clear-btn').addEventListener('click', () => {
  currentData = null; hlId = null;
  svgD3.selectAll('*').remove();
  ['stats-section','tables-section'].forEach(id => document.getElementById(id).style.display = 'none');
  document.getElementById('project-badge').style.display = 'none';
  const dz = document.getElementById('drop-zone');
  dz.classList.remove('loaded');
  dz.querySelector('.dz-icon').textContent  = '\ud83d\udcc2';
  dz.querySelector('.dz-label').textContent = 'Open Project Folder';
  dz.querySelector('.dz-hint').textContent  = 'Click to browse or drop a folder';
  document.getElementById('empty-state').style.display = 'flex';
  // Reset color cache
  Object.keys(_schemaColorCache).forEach(k => delete _schemaColorCache[k]);
  _paletteIdx = 0;
});

// ═══════════════════════════════════════════════════
// INIT — try server first, fall back to empty state
// ═══════════════════════════════════════════════════

window.addEventListener('load', async () => {
  const loaded = await loadFromServer();
  if (!loaded) {
    // Show normal empty state for folder picker
    document.getElementById('empty-state').style.display = 'flex';
  }
});

window.addEventListener('resize', () => { if (currentData) fitToView(); });

// Prevent browser page zoom (Ctrl+scroll / trackpad pinch) so only the D3 graph zoom fires
document.addEventListener('wheel', e => {
  if (e.ctrlKey) e.preventDefault();
}, { passive: false });

// Sidebar width keyboard resize: [ to shrink, ] to expand
const _sidebar = document.getElementById('sidebar');
let _sidebarW = 270;
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (e.key === '[') {
    _sidebarW = Math.max(160, _sidebarW - 20);
    _sidebar.style.width = _sidebarW + 'px';
    e.preventDefault();
  } else if (e.key === ']') {
    _sidebarW = Math.min(520, _sidebarW + 20);
    _sidebar.style.width = _sidebarW + 'px';
    e.preventDefault();
  }
});

// ═══════════════════════════════════════════════════
// SEARCH
// ═══════════════════════════════════════════════════
(function () {
  const searchBox   = document.getElementById('search-box');
  const searchInput = document.getElementById('search-input');
  const searchCount = document.getElementById('search-count');

  let _matches = [];   // [{nodeId, cols:[]}] — nodes matching current query
  let _cursor  = -1;   // index into _matches for current highlight
  let _litCols = [];   // [{hitRect, text}] currently lit column rows

  // Open search with Ctrl+F or /
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if ((e.key === 'f' && (e.ctrlKey || e.metaKey)) || e.key === '/') {
      e.preventDefault();
      searchBox.classList.add('visible');
      searchInput.focus();
    }
    if (e.key === 'Escape') closeSearch();
  });

  function closeSearch() {
    searchBox.classList.remove('visible');
    searchInput.value = '';
    clearSearchHighlight();
    _matches = []; _cursor = -1;
    searchCount.textContent = '';
  }

  function clearSearchHighlight() {
    if (!_nodeSel) return;
    _nodeSel.classed('search-cur', false);
    clearHighlight(_nodeSel, _edgeSel);
    // Reset any lit column rows
    _litCols.forEach(({ hitRect, text }) => {
      hitRect.attr('fill', 'transparent');
      text.attr('fill', '#4d5562');
    });
    _litCols = [];
  }

  function runSearch(q) {
    clearSearchHighlight();
    if (!currentData || !q.trim()) { _matches = []; _cursor = -1; searchCount.textContent = ''; return; }
    const lq = q.trim().toLowerCase();
    _matches = currentData.nodes
      .filter(n => {
        if (n.id.toLowerCase().includes(lq)) return true;
        if ((n.columns || []).some(c => c.toLowerCase().includes(lq))) return true;
        return false;
      })
      .map(n => ({
        nodeId: n.id,
        cols: (n.columns || []).filter(c => c.toLowerCase().includes(lq))
      }));
    _cursor = _matches.length ? 0 : -1;
    applySearchHighlight();
  }

  function applySearchHighlight() {
    clearSearchHighlight();
    if (!_nodeSel || !_matches.length) { searchCount.textContent = 'no match'; return; }
    if (_cursor >= 0 && _nodeSel && _edgeSel && _depsOf && _rdepsOf) {
      const cur = _matches[_cursor];
      const curId = cur.nodeId;
      // Same node + deps/edges highlight as hover
      applyHighlight(curId, _nodeSel, _edgeSel, _depsOf, _rdepsOf);
      _nodeSel.classed('search-cur', d => d.id === curId);
      // Highlight matching column rows in the current node
      const nodeColMap = _colRowEls.get(curId);
      if (nodeColMap) {
        cur.cols.forEach(colName => {
          const row = nodeColMap.get(colName);
          if (row) {
            row.hitRect.attr('fill', row.color + '22');
            row.text.attr('fill', row.color);
            _litCols.push(row);
          }
        });
      }
      panToNode(curId);
    }
    searchCount.textContent = `${_cursor + 1} / ${_matches.length}`;
  }

  function panToNode(id) {
    if (!currentData || !zoomBeh || !svgD3) return;
    const node = currentData.nodes.find(n => n.id === id);
    if (!node) return;
    const { clientWidth: w, clientHeight: h } = container;
    const t = d3.zoomTransform(svgD3.node());
    const nx = node._cx * t.k + t.x;
    const ny = node._cy * t.k + t.y;
    const dx = w / 2 - nx, dy = h / 2 - ny;
    svgD3.transition().duration(350)
      .call(zoomBeh.translateBy, dx / t.k, dy / t.k);
  }

  function stepMatch(dir) {
    if (!_matches.length) return;
    _cursor = (_cursor + dir + _matches.length) % _matches.length;
    applySearchHighlight();
  }

  searchInput.addEventListener('input', e => runSearch(e.target.value));
  searchInput.addEventListener('keydown', e => {
    if (e.key === 'Enter')  { e.preventDefault(); stepMatch(e.shiftKey ? -1 : 1); }
    if (e.key === 'Escape') { e.preventDefault(); closeSearch(); }
  });
  document.getElementById('search-next') .addEventListener('click', () => stepMatch(1));
  document.getElementById('search-prev') .addEventListener('click', () => stepMatch(-1));
  document.getElementById('search-clear').addEventListener('click', closeSearch);
})();
