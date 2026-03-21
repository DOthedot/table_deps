'use strict';

// ═══════════════════════════════════════════════════
// SQL PARSING  (sql_parser.js provides SQL_KEYWORDS + FROM_JOIN_RE)
//              (colors.js provides schemaColor)
// ═══════════════════════════════════════════════════

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
                      sql_content: content });
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
  const longestRef = Math.max(node.label.length,
    ...(node.all_refs.length ? node.all_refs.map(r => r.length) : [0]));
  return Math.min(MAX_W, Math.max(MIN_W, Math.min(longestRef, 30) * 6.9 + PAD_H * 2));
}

function boxH(node) {
  return HDR_H + (node.all_refs.length > 0
    ? PAD_V + Math.min(node.all_refs.length, 12) * ROW_H + PAD_V
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

let gMain, zoomBeh, currentSim = null, currentData = null, hlId = null;

function renderGraph(data) {
  currentData = data;
  const { nodes, edges } = data;
  const { totalW, totalH, maxLevel } = assignPositions(nodes, edges);

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

  // Draw box content into each <g>
  nodeSel.each(function(d) { renderBox(d3.select(this), d, depsOf, rdepsOf); });

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
    .on('end', () => fitToView());

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
  window.open('/#' + btoa(sql), '_blank');
}

// ── Box rendering ─────────────────────────────────

function renderBox(sel, node) {
  const w = node._w, h = node._h;
  const x = -w / 2, y = -h / 2;
  const color = schemaColor(node.schema);
  const internalSet = new Set(node.internal_refs || []);

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

  // Dep rows
  const refs     = node.all_refs || [];
  const showRows = refs.slice(0, 12);
  const extra    = refs.length - 12;

  showRows.forEach((ref, i) => {
    const ry     = y + HDR_H + PAD_V + (i + 0.5) * ROW_H;
    const isInt  = internalSet.has(ref);
    const dotClr = isInt ? schemaColor(ref.split('.')[0]) : '#6b7280';

    sel.append('circle').attr('cx', x + 12).attr('cy', ry).attr('r', 3).attr('fill', dotClr);

    sel.append('text')
      .attr('x', x + 21).attr('y', ry)
      .attr('dominant-baseline', 'middle')
      .attr('fill', isInt ? '#111111' : '#888888')
      .attr('font-size', '9.5px')
      .attr('font-family', "'SF Mono',monospace")
      .text(ref.length > 31 ? ref.slice(0, 29) + '\u2026' : ref);
  });

  if (extra > 0) {
    const ry = y + HDR_H + PAD_V + (showRows.length + 0.5) * ROW_H;
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

// ═══════════════════════════════════════════════════
// ZOOM CONTROLS
// ═══════════════════════════════════════════════════

function fitToView() {
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
  const scale = Math.min(w / bw, h / bh, 2);
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
  setTimeout(fitToView, 400);
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
// PROCESS GRAPH DATA
// ═══════════════════════════════════════════════════

function processGraphData(data, projectName) {
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
const EXAMPLE_PAYLOAD = 'eyJwcm9qZWN0X25hbWUiOiAia2ltYmFsbF9yZXRhaWwiLCAibm9kZXMiOiBbeyJpZCI6ICJkaW0uY3VzdG9tZXIiLCAibGFiZWwiOiAiZGltLmN1c3RvbWVyIiwgInNjaGVtYSI6ICJkaW0iLCAidGFibGUiOiAiY3VzdG9tZXIiLCAibGF5ZXIiOiAiZGltIiwgImZpbGUiOiAiZGltLmN1c3RvbWVyLnNxbCIsICJkZWdyZWUiOiA1LCAiYWxsX3JlZnMiOiBbInNyYy5yYXdfY3VzdG9tZXJzIl0sICJpbnRlcm5hbF9yZWZzIjogWyJzcmMucmF3X2N1c3RvbWVycyJdLCAiZXh0ZXJuYWxfcmVmcyI6IFtdLCAic3FsX2NvbnRlbnQiOiAiLS0gS2ltYmFsbCBTQ0QtMiBjdXN0b21lciBkaW1lbnNpb25cbi0tIERlcDogc3JjLnJhd19jdXN0b21lcnNcbkNSRUFURSBPUiBSRVBMQUNFIFRBQkxFIGRpbS5jdXN0b21lciBBU1xuU0VMRUNUXG4gICAgTUQ1KENBU1QoYy5jdXN0b21lcl9pZCBBUyBWQVJDSEFSKSB8fCBDQVNUKGMuX2xvYWRlZF9hdCBBUyBWQVJDSEFSKSkgQVMgY3VzdG9tZXJfa2V5LFxuICAgIGMuY3VzdG9tZXJfaWQsXG4gICAgYy5maXJzdF9uYW1lLCBjLmxhc3RfbmFtZSxcbiAgICBjLmVtYWlsLCBjLnBob25lLFxuICAgIGMuY2l0eSwgYy5zdGF0ZSwgYy5jb3VudHJ5LFxuICAgIGMuZ2VuZGVyLFxuICAgIERBVEVESUZGKCd5ZWFyJywgYy5iaXJ0aF9kYXRlLCBDVVJSRU5UX0RBVEUpICAgICBBUyBhZ2UsXG4gICAgREFURURJRkYoJ3llYXInLCBjLnNpZ251cF9kYXRlLCBDVVJSRU5UX0RBVEUpICAgIEFTIHRlbnVyZV95ZWFycyxcbiAgICBjLmxveWFsdHlfdGllcixcbiAgICBDQVNFXG4gICAgICAgIFdIRU4gYy5sb3lhbHR5X3RpZXIgPSAnUExBVElOVU0nIFRIRU4gNFxuICAgICAgICBXSEVOIGMubG95YWx0eV90aWVyID0gJ0dPTEQnICAgICBUSEVOIDNcbiAgICAgICAgV0hFTiBjLmxveWFsdHlfdGllciA9ICdTSUxWRVInICAgVEhFTiAyXG4gICAgICAgIEVMU0UgMVxuICAgIEVORCBBUyBsb3lhbHR5X3JhbmssXG4gICAgVFJVRSAgQVMgaXNfY3VycmVudCxcbiAgICBjLl9sb2FkZWRfYXQgQVMgdmFsaWRfZnJvbSxcbiAgICBOVUxMICAgICAgICAgQVMgdmFsaWRfdG9cbkZST00gc3JjLnJhd19jdXN0b21lcnMgYztcbiJ9LCB7ImlkIjogImRpbS5kYXRlIiwgImxhYmVsIjogImRpbS5kYXRlIiwgInNjaGVtYSI6ICJkaW0iLCAidGFibGUiOiAiZGF0ZSIsICJsYXllciI6ICJkaW0iLCAiZmlsZSI6ICJkaW0uZGF0ZS5zcWwiLCAiZGVncmVlIjogNSwgImFsbF9yZWZzIjogWyJleHRlcm5hbC51dGlsX2RiLmRpbV9kYXRlIl0sICJpbnRlcm5hbF9yZWZzIjogW10sICJleHRlcm5hbF9yZWZzIjogWyJleHRlcm5hbC51dGlsX2RiLmRpbV9kYXRlIl0sICJzcWxfY29udGVudCI6ICItLSBLaW1iYWxsIGRhdGUgZGltZW5zaW9uIFx1MjAxNCBubyB1cHN0cmVhbSBwcm9qZWN0IGRlcGVuZGVuY3lcbkNSRUFURSBPUiBSRVBMQUNFIFRBQkxFIGRpbS5kYXRlIEFTXG5TRUxFQ1RcbiAgICBkYXRlX2tleSwgICAgICAgICAgLS0gWVlZWU1NREQgaW50ZWdlciBzdXJyb2dhdGVcbiAgICBmdWxsX2RhdGUsXG4gICAgeWVhciwgcXVhcnRlciwgbW9udGgsIG1vbnRoX25hbWUsXG4gICAgd2Vla19vZl95ZWFyLCBkYXlfb2Zfd2VlaywgZGF5X25hbWUsXG4gICAgaXNfd2Vla2VuZCwgaXNfaG9saWRheSwgZmlzY2FsX3llYXIsXG4gICAgZmlzY2FsX3F1YXJ0ZXIsIGZpc2NhbF9tb250aCwgZmlzY2FsX3dlZWtcbkZST00gZXh0ZXJuYWwudXRpbF9kYi5kaW1fZGF0ZVxuV0hFUkUgZnVsbF9kYXRlIEJFVFdFRU4gJzIwMTgtMDEtMDEnIEFORCAnMjAzNS0xMi0zMSc7XG4ifSwgeyJpZCI6ICJkaW0ucHJvZHVjdCIsICJsYWJlbCI6ICJkaW0ucHJvZHVjdCIsICJzY2hlbWEiOiAiZGltIiwgInRhYmxlIjogInByb2R1Y3QiLCAibGF5ZXIiOiAiZGltIiwgImZpbGUiOiAiZGltLnByb2R1Y3Quc3FsIiwgImRlZ3JlZSI6IDQsICJhbGxfcmVmcyI6IFsic3JjLnJhd19wcm9kdWN0cyJdLCAiaW50ZXJuYWxfcmVmcyI6IFsic3JjLnJhd19wcm9kdWN0cyJdLCAiZXh0ZXJuYWxfcmVmcyI6IFtdLCAic3FsX2NvbnRlbnQiOiAiLS0gS2ltYmFsbCBwcm9kdWN0IGRpbWVuc2lvbiB3aXRoIG1hcmdpbiBlbnJpY2htZW50XG4tLSBEZXA6IHNyYy5yYXdfcHJvZHVjdHNcbkNSRUFURSBPUiBSRVBMQUNFIFRBQkxFIGRpbS5wcm9kdWN0IEFTXG5TRUxFQ1RcbiAgICBNRDUoQ0FTVChwLnByb2R1Y3RfaWQgQVMgVkFSQ0hBUikpICBBUyBwcm9kdWN0X2tleSxcbiAgICBwLnByb2R1Y3RfaWQsIHAuc2t1LFxuICAgIHAucHJvZHVjdF9uYW1lLCBwLmJyYW5kLFxuICAgIHAuY2F0ZWdvcnksIHAuc3ViX2NhdGVnb3J5LFxuICAgIHAuY29zdF9wcmljZSwgcC5saXN0X3ByaWNlLFxuICAgIFJPVU5EKChwLmxpc3RfcHJpY2UgLSBwLmNvc3RfcHJpY2UpIC8gTlVMTElGKHAubGlzdF9wcmljZSwgMCkgKiAxMDAsIDIpIEFTIG1hcmdpbl9wY3QsXG4gICAgcC53ZWlnaHRfa2csXG4gICAgcC5sYXVuY2hfZGF0ZSxcbiAgICBwLmRpc2NvbnRpbnVlZF9kYXRlLFxuICAgIChwLmRpc2NvbnRpbnVlZF9kYXRlIElTIE5VTEwpIEFTIGlzX2FjdGl2ZVxuRlJPTSBzcmMucmF3X3Byb2R1Y3RzIHA7XG4ifSwgeyJpZCI6ICJkaW0ucHJvbW90aW9uIiwgImxhYmVsIjogImRpbS5wcm9tb3Rpb24iLCAic2NoZW1hIjogImRpbSIsICJ0YWJsZSI6ICJwcm9tb3Rpb24iLCAibGF5ZXIiOiAiZGltIiwgImZpbGUiOiAiZGltLnByb21vdGlvbi5zcWwiLCAiZGVncmVlIjogMywgImFsbF9yZWZzIjogWyJzcmMucmF3X3Byb21vdGlvbnMiXSwgImludGVybmFsX3JlZnMiOiBbInNyYy5yYXdfcHJvbW90aW9ucyJdLCAiZXh0ZXJuYWxfcmVmcyI6IFtdLCAic3FsX2NvbnRlbnQiOiAiLS0gS2ltYmFsbCBwcm9tb3Rpb24gZGltZW5zaW9uXG4tLSBEZXA6IHNyYy5yYXdfcHJvbW90aW9uc1xuQ1JFQVRFIE9SIFJFUExBQ0UgVEFCTEUgZGltLnByb21vdGlvbiBBU1xuU0VMRUNUXG4gICAgTUQ1KENBU1QocC5wcm9tb3Rpb25faWQgQVMgVkFSQ0hBUikpIEFTIHByb21vdGlvbl9rZXksXG4gICAgcC5wcm9tb3Rpb25faWQsIHAucHJvbW90aW9uX25hbWUsXG4gICAgcC5wcm9tb190eXBlLCBwLmRpc2NvdW50X3R5cGUsXG4gICAgcC5kaXNjb3VudF92YWx1ZSxcbiAgICBwLnN0YXJ0X2RhdGUsIHAuZW5kX2RhdGUsXG4gICAgREFURURJRkYoJ2RheScsIHAuc3RhcnRfZGF0ZSwgcC5lbmRfZGF0ZSkgKyAxIEFTIGR1cmF0aW9uX2RheXMsXG4gICAgcC5jaGFubmVsLCBwLnRhcmdldF9zZWdtZW50LFxuICAgIChDVVJSRU5UX0RBVEUgQkVUV0VFTiBwLnN0YXJ0X2RhdGUgQU5EIHAuZW5kX2RhdGUpIEFTIGlzX2FjdGl2ZVxuRlJPTSBzcmMucmF3X3Byb21vdGlvbnMgcDtcbiJ9LCB7ImlkIjogImRpbS5zdG9yZSIsICJsYWJlbCI6ICJkaW0uc3RvcmUiLCAic2NoZW1hIjogImRpbSIsICJ0YWJsZSI6ICJzdG9yZSIsICJsYXllciI6ICJkaW0iLCAiZmlsZSI6ICJkaW0uc3RvcmUuc3FsIiwgImRlZ3JlZSI6IDQsICJhbGxfcmVmcyI6IFsic3JjLnJhd19zdG9yZXMiXSwgImludGVybmFsX3JlZnMiOiBbInNyYy5yYXdfc3RvcmVzIl0sICJleHRlcm5hbF9yZWZzIjogW10sICJzcWxfY29udGVudCI6ICItLSBLaW1iYWxsIHN0b3JlL2NoYW5uZWwgZGltZW5zaW9uXG4tLSBEZXA6IHNyYy5yYXdfc3RvcmVzXG5DUkVBVEUgT1IgUkVQTEFDRSBUQUJMRSBkaW0uc3RvcmUgQVNcblNFTEVDVFxuICAgIE1ENShDQVNUKHMuc3RvcmVfaWQgQVMgVkFSQ0hBUikpICBBUyBzdG9yZV9rZXksXG4gICAgcy5zdG9yZV9pZCwgcy5zdG9yZV9uYW1lLFxuICAgIHMuc3RvcmVfdHlwZSwgcy5yZWdpb24sXG4gICAgcy5jaXR5LCBzLnN0YXRlLCBzLmNvdW50cnksXG4gICAgcy5vcGVuX2RhdGUsIHMuY2xvc2VfZGF0ZSxcbiAgICBzLnNxZnQsXG4gICAgQ0FTRVxuICAgICAgICBXSEVOIHMuc3RvcmVfdHlwZSA9ICdPTkxJTkUnICAgICBUSEVOICdEaWdpdGFsJ1xuICAgICAgICBXSEVOIHMuc3RvcmVfdHlwZSA9ICdGTEFHU0hJUCcgICBUSEVOICdMYXJnZSBGb3JtYXQnXG4gICAgICAgIFdIRU4gcy5zdG9yZV90eXBlID0gJ09VVExFVCcgICAgIFRIRU4gJ0Rpc2NvdW50J1xuICAgICAgICBFTFNFICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICdTdGFuZGFyZCdcbiAgICBFTkQgQVMgc3RvcmVfY2F0ZWdvcnksXG4gICAgKHMuY2xvc2VfZGF0ZSBJUyBOVUxMKSBBUyBpc19hY3RpdmVcbkZST00gc3JjLnJhd19zdG9yZXMgcztcbiJ9LCB7ImlkIjogImZhY3QucmV0dXJucyIsICJsYWJlbCI6ICJmYWN0LnJldHVybnMiLCAic2NoZW1hIjogImZhY3QiLCAidGFibGUiOiAicmV0dXJucyIsICJsYXllciI6ICJmYWN0IiwgImZpbGUiOiAiZmFjdC5yZXR1cm5zLnNxbCIsICJkZWdyZWUiOiA3LCAiYWxsX3JlZnMiOiBbImRpbS5jdXN0b21lciIsICJkaW0uZGF0ZSIsICJkaW0ucHJvZHVjdCIsICJkaW0uc3RvcmUiLCAic3JjLnJhd190cmFuc2FjdGlvbnMiXSwgImludGVybmFsX3JlZnMiOiBbImRpbS5jdXN0b21lciIsICJkaW0uZGF0ZSIsICJkaW0ucHJvZHVjdCIsICJkaW0uc3RvcmUiLCAic3JjLnJhd190cmFuc2FjdGlvbnMiXSwgImV4dGVybmFsX3JlZnMiOiBbXSwgInNxbF9jb250ZW50IjogIi0tIEtpbWJhbGwgcmV0dXJucyBmYWN0IHRhYmxlXG4tLSBEZXBzOiBzcmMucmF3X3RyYW5zYWN0aW9ucywgZGltLmN1c3RvbWVyLCBkaW0ucHJvZHVjdCwgZGltLnN0b3JlLCBkaW0uZGF0ZVxuQ1JFQVRFIE9SIFJFUExBQ0UgVEFCTEUgZmFjdC5yZXR1cm5zIEFTXG5TRUxFQ1RcbiAgICBkYy5jdXN0b21lcl9rZXksXG4gICAgZHAucHJvZHVjdF9rZXksXG4gICAgZHMuc3RvcmVfa2V5LFxuICAgIGRkLmRhdGVfa2V5LFxuICAgIHQudHJhbnNhY3Rpb25faWQsXG4gICAgdC5vcmRlcl9pZCxcbiAgICB0LmNoYW5uZWwsXG5cbiAgICAtLSBSZXR1cm4gbWVhc3VyZXNcbiAgICB0LnF1YW50aXR5ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBBUyByZXR1cm5lZF9xdHksXG4gICAgUk9VTkQodC5xdWFudGl0eSAqIHQudW5pdF9wcmljZSwgMikgICAgICAgICAgICAgICAgQVMgcmV0dXJuZWRfZ3Jvc3NfdmFsdWUsXG4gICAgUk9VTkQodC5xdWFudGl0eSAqIHQudW5pdF9wcmljZSAtIHQuZGlzY291bnRfYW10LCAyKSBBUyByZXR1cm5lZF9uZXRfdmFsdWUsXG4gICAgUk9VTkQodC5xdWFudGl0eSAqIGRwLmNvc3RfcHJpY2UsIDIpICAgICAgICAgICAgICAgQVMgcmV0dXJuZWRfY29ncyxcblxuICAgIHQudHJhbnNhY3Rpb25fdHMgQVMgcmV0dXJuX3RzXG5cbkZST00gc3JjLnJhd190cmFuc2FjdGlvbnMgdFxuSk9JTiBkaW0uY3VzdG9tZXIgIGRjICBPTiB0LmN1c3RvbWVyX2lkICAgICAgICAgID0gZGMuY3VzdG9tZXJfaWQgQU5EIGRjLmlzX2N1cnJlbnRcbkpPSU4gZGltLnByb2R1Y3QgICBkcCAgT04gdC5wcm9kdWN0X2lkICAgICAgICAgICA9IGRwLnByb2R1Y3RfaWRcbkpPSU4gZGltLnN0b3JlICAgICBkcyAgT04gdC5zdG9yZV9pZCAgICAgICAgICAgICA9IGRzLnN0b3JlX2lkXG5KT0lOIGRpbS5kYXRlICAgICAgZGQgIE9OIERBVEUodC50cmFuc2FjdGlvbl90cykgPSBkZC5mdWxsX2RhdGVcbldIRVJFIHQucmV0dXJuX2ZsYWcgPSBUUlVFO1xuIn0sIHsiaWQiOiAiZmFjdC5zYWxlcyIsICJsYWJlbCI6ICJmYWN0LnNhbGVzIiwgInNjaGVtYSI6ICJmYWN0IiwgInRhYmxlIjogInNhbGVzIiwgImxheWVyIjogImZhY3QiLCAiZmlsZSI6ICJmYWN0LnNhbGVzLnNxbCIsICJkZWdyZWUiOiA5LCAiYWxsX3JlZnMiOiBbImRpbS5jdXN0b21lciIsICJkaW0uZGF0ZSIsICJkaW0ucHJvZHVjdCIsICJkaW0ucHJvbW90aW9uIiwgImRpbS5zdG9yZSIsICJzcmMucmF3X3RyYW5zYWN0aW9ucyJdLCAiaW50ZXJuYWxfcmVmcyI6IFsiZGltLmN1c3RvbWVyIiwgImRpbS5kYXRlIiwgImRpbS5wcm9kdWN0IiwgImRpbS5wcm9tb3Rpb24iLCAiZGltLnN0b3JlIiwgInNyYy5yYXdfdHJhbnNhY3Rpb25zIl0sICJleHRlcm5hbF9yZWZzIjogW10sICJzcWxfY29udGVudCI6ICItLSBLaW1iYWxsIGNlbnRyYWwgc2FsZXMgZmFjdCB0YWJsZSBcdTIwMTQgc3RhciBqb2luIGFjcm9zcyBhbGwgZGltZW5zaW9uc1xuLS0gRGVwczogc3JjLnJhd190cmFuc2FjdGlvbnMsIGRpbS5jdXN0b21lciwgZGltLnByb2R1Y3QsIGRpbS5zdG9yZSwgZGltLmRhdGUsIGRpbS5wcm9tb3Rpb25cbkNSRUFURSBPUiBSRVBMQUNFIFRBQkxFIGZhY3Quc2FsZXMgQVNcblNFTEVDVFxuICAgIC0tIFN1cnJvZ2F0ZSBrZXlzIChGSyB0byBkaW1zKVxuICAgIGRjLmN1c3RvbWVyX2tleSxcbiAgICBkcC5wcm9kdWN0X2tleSxcbiAgICBkcy5zdG9yZV9rZXksXG4gICAgZGQuZGF0ZV9rZXksXG4gICAgQ09BTEVTQ0UoZHByLnByb21vdGlvbl9rZXksICdOT19QUk9NTycpICBBUyBwcm9tb3Rpb25fa2V5LFxuXG4gICAgLS0gRGVnZW5lcmF0ZSBkaW1lbnNpb25zXG4gICAgdC50cmFuc2FjdGlvbl9pZCwgdC5vcmRlcl9pZCwgdC5jaGFubmVsLCB0LnBheW1lbnRfbWV0aG9kLFxuXG4gICAgLS0gQWRkaXRpdmUgbWVhc3VyZXNcbiAgICB0LnF1YW50aXR5LFxuICAgIHQudW5pdF9wcmljZSxcbiAgICB0LmRpc2NvdW50X2FtdCxcbiAgICBST1VORCh0LnF1YW50aXR5ICogdC51bml0X3ByaWNlLCAyKSAgICAgICAgICAgICAgICBBUyBncm9zc19yZXZlbnVlLFxuICAgIFJPVU5EKHQucXVhbnRpdHkgKiB0LnVuaXRfcHJpY2UgLSB0LmRpc2NvdW50X2FtdCwgMikgQVMgbmV0X3JldmVudWUsXG4gICAgUk9VTkQodC5xdWFudGl0eSAqIGRwLmNvc3RfcHJpY2UsIDIpICAgICAgICAgICAgICAgQVMgY29ncyxcbiAgICBST1VORCh0LnF1YW50aXR5ICogdC51bml0X3ByaWNlIC0gdC5kaXNjb3VudF9hbXRcbiAgICAgICAgICAtIHQucXVhbnRpdHkgKiBkcC5jb3N0X3ByaWNlLCAyKSAgICAgICAgICAgICBBUyBncm9zc19wcm9maXQsXG5cbiAgICAtLSBTZW1pLWFkZGl0aXZlXG4gICAgdC50cmFuc2FjdGlvbl90c1xuXG5GUk9NIHNyYy5yYXdfdHJhbnNhY3Rpb25zIHRcbkpPSU4gZGltLmN1c3RvbWVyICBkYyAgT04gdC5jdXN0b21lcl9pZCAgPSBkYy5jdXN0b21lcl9pZCAgQU5EIGRjLmlzX2N1cnJlbnRcbkpPSU4gZGltLnByb2R1Y3QgICBkcCAgT04gdC5wcm9kdWN0X2lkICAgPSBkcC5wcm9kdWN0X2lkXG5KT0lOIGRpbS5zdG9yZSAgICAgZHMgIE9OIHQuc3RvcmVfaWQgICAgID0gZHMuc3RvcmVfaWRcbkpPSU4gZGltLmRhdGUgICAgICBkZCAgT04gREFURSh0LnRyYW5zYWN0aW9uX3RzKSA9IGRkLmZ1bGxfZGF0ZVxuTEVGVCBKT0lOIGRpbS5wcm9tb3Rpb24gZHByIE9OIHQucHJvbW90aW9uX2lkICA9IGRwci5wcm9tb3Rpb25fa2V5XG5XSEVSRSB0LnJldHVybl9mbGFnID0gRkFMU0U7XG4ifSwgeyJpZCI6ICJycHQuY3VzdG9tZXJfMzYwIiwgImxhYmVsIjogInJwdC5jdXN0b21lcl8zNjAiLCAic2NoZW1hIjogInJwdCIsICJ0YWJsZSI6ICJjdXN0b21lcl8zNjAiLCAibGF5ZXIiOiAicnB0IiwgImZpbGUiOiAicnB0LmN1c3RvbWVyXzM2MC5zcWwiLCAiZGVncmVlIjogNCwgImFsbF9yZWZzIjogWyJkaW0uY3VzdG9tZXIiLCAiZGltLmRhdGUiLCAiZmFjdC5yZXR1cm5zIiwgImZhY3Quc2FsZXMiXSwgImludGVybmFsX3JlZnMiOiBbImRpbS5jdXN0b21lciIsICJkaW0uZGF0ZSIsICJmYWN0LnJldHVybnMiLCAiZmFjdC5zYWxlcyJdLCAiZXh0ZXJuYWxfcmVmcyI6IFtdLCAic3FsX2NvbnRlbnQiOiAiLS0gUmVwb3J0OiAzNjBcdTAwYjAgY3VzdG9tZXIgdmlldyBcdTIwMTQgcHVyY2hhc2UgaGlzdG9yeSwgcmV0dXJucywgTFRWXG4tLSBEZXBzOiBmYWN0LnNhbGVzLCBmYWN0LnJldHVybnMsIGRpbS5jdXN0b21lciwgZGltLmRhdGVcbkNSRUFURSBPUiBSRVBMQUNFIFRBQkxFIHJwdC5jdXN0b21lcl8zNjAgQVNcbldJVEggY3VzdG9tZXJfc2FsZXMgQVMgKFxuICAgIFNFTEVDVFxuICAgICAgICBmcy5jdXN0b21lcl9rZXksXG4gICAgICAgIENPVU5UKERJU1RJTkNUIGZzLnRyYW5zYWN0aW9uX2lkKSBBUyB0b3RhbF9vcmRlcnMsXG4gICAgICAgIFNVTShmcy5xdWFudGl0eSkgICAgICAgICAgICAgICAgICAgQVMgdG90YWxfdW5pdHMsXG4gICAgICAgIFNVTShmcy5uZXRfcmV2ZW51ZSkgICAgICAgICAgICAgICAgQVMgdG90YWxfbmV0X3JldmVudWUsXG4gICAgICAgIFNVTShmcy5ncm9zc19wcm9maXQpICAgICAgICAgICAgICAgQVMgdG90YWxfZ3Jvc3NfcHJvZml0LFxuICAgICAgICBNQVgoZGQuZnVsbF9kYXRlKSAgICAgICAgICAgICAgICAgIEFTIGxhc3RfcHVyY2hhc2VfZGF0ZSxcbiAgICAgICAgTUlOKGRkLmZ1bGxfZGF0ZSkgICAgICAgICAgICAgICAgICBBUyBmaXJzdF9wdXJjaGFzZV9kYXRlLFxuICAgICAgICBDT1VOVChESVNUSU5DVCBkZC5maXNjYWxfeWVhcikgICAgIEFTIGFjdGl2ZV95ZWFyc1xuICAgIEZST00gZmFjdC5zYWxlcyBmc1xuICAgIEpPSU4gZGltLmRhdGUgZGQgT04gZnMuZGF0ZV9rZXkgPSBkZC5kYXRlX2tleVxuICAgIEdST1VQIEJZIDFcbiksXG5jdXN0b21lcl9yZXR1cm5zIEFTIChcbiAgICBTRUxFQ1RcbiAgICAgICAgZnIuY3VzdG9tZXJfa2V5LFxuICAgICAgICBDT1VOVChESVNUSU5DVCBmci50cmFuc2FjdGlvbl9pZCkgQVMgdG90YWxfcmV0dXJucyxcbiAgICAgICAgU1VNKGZyLnJldHVybmVkX25ldF92YWx1ZSkgICAgICAgIEFTIHRvdGFsX3JldHVybmVkX3ZhbHVlXG4gICAgRlJPTSBmYWN0LnJldHVybnMgZnJcbiAgICBHUk9VUCBCWSAxXG4pXG5TRUxFQ1RcbiAgICBkYy5jdXN0b21lcl9rZXksXG4gICAgZGMuY3VzdG9tZXJfaWQsXG4gICAgZGMuZmlyc3RfbmFtZSwgZGMubGFzdF9uYW1lLFxuICAgIGRjLmxveWFsdHlfdGllciwgZGMuY291bnRyeSwgZGMudGVudXJlX3llYXJzLFxuXG4gICAgLS0gUHVyY2hhc2UgYmVoYXZpb3VyXG4gICAgQ09BTEVTQ0UoY3MudG90YWxfb3JkZXJzLCAwKSAgICAgICAgQVMgdG90YWxfb3JkZXJzLFxuICAgIENPQUxFU0NFKGNzLnRvdGFsX3VuaXRzLCAwKSAgICAgICAgIEFTIHRvdGFsX3VuaXRzLFxuICAgIENPQUxFU0NFKGNzLnRvdGFsX25ldF9yZXZlbnVlLCAwKSAgIEFTIHRvdGFsX25ldF9yZXZlbnVlLFxuICAgIENPQUxFU0NFKGNzLnRvdGFsX2dyb3NzX3Byb2ZpdCwgMCkgIEFTIHRvdGFsX2dyb3NzX3Byb2ZpdCxcbiAgICBjcy5sYXN0X3B1cmNoYXNlX2RhdGUsXG4gICAgY3MuZmlyc3RfcHVyY2hhc2VfZGF0ZSxcbiAgICBEQVRFRElGRignZGF5JywgY3MubGFzdF9wdXJjaGFzZV9kYXRlLCBDVVJSRU5UX0RBVEUpIEFTIGRheXNfc2luY2VfbGFzdF9wdXJjaGFzZSxcblxuICAgIC0tIFJldHVybnNcbiAgICBDT0FMRVNDRShjci50b3RhbF9yZXR1cm5zLCAwKSAgICAgICAgQVMgdG90YWxfcmV0dXJucyxcbiAgICBDT0FMRVNDRShjci50b3RhbF9yZXR1cm5lZF92YWx1ZSwgMCkgQVMgdG90YWxfcmV0dXJuZWRfdmFsdWUsXG4gICAgUk9VTkQoQ09BTEVTQ0UoY3IudG90YWxfcmV0dXJucywgMCkgL1xuICAgICAgICAgIE5VTExJRihDT0FMRVNDRShjcy50b3RhbF9vcmRlcnMsIDApLCAwKSAqIDEwMCwgMikgQVMgcmV0dXJuX3JhdGVfcGN0LFxuXG4gICAgLS0gU2ltcGxlIExUViBwcm94eVxuICAgIFJPVU5EKENPQUxFU0NFKGNzLnRvdGFsX25ldF9yZXZlbnVlLCAwKSAqIDMuMCwgMikgQVMgZXN0aW1hdGVkX2x0dlxuXG5GUk9NIGRpbS5jdXN0b21lciBkY1xuTEVGVCBKT0lOIGN1c3RvbWVyX3NhbGVzICAgY3MgT04gZGMuY3VzdG9tZXJfa2V5ID0gY3MuY3VzdG9tZXJfa2V5XG5MRUZUIEpPSU4gY3VzdG9tZXJfcmV0dXJucyBjciBPTiBkYy5jdXN0b21lcl9rZXkgPSBjci5jdXN0b21lcl9rZXk7XG4ifSwgeyJpZCI6ICJycHQucHJvZHVjdF9wZXJmb3JtYW5jZSIsICJsYWJlbCI6ICJycHQucHJvZHVjdF9wZXJmb3JtYW5jZSIsICJzY2hlbWEiOiAicnB0IiwgInRhYmxlIjogInByb2R1Y3RfcGVyZm9ybWFuY2UiLCAibGF5ZXIiOiAicnB0IiwgImZpbGUiOiAicnB0LnByb2R1Y3RfcGVyZm9ybWFuY2Uuc3FsIiwgImRlZ3JlZSI6IDUsICJhbGxfcmVmcyI6IFsiZGltLmRhdGUiLCAiZGltLnByb2R1Y3QiLCAiZGltLnN0b3JlIiwgImZhY3QucmV0dXJucyIsICJmYWN0LnNhbGVzIl0sICJpbnRlcm5hbF9yZWZzIjogWyJkaW0uZGF0ZSIsICJkaW0ucHJvZHVjdCIsICJkaW0uc3RvcmUiLCAiZmFjdC5yZXR1cm5zIiwgImZhY3Quc2FsZXMiXSwgImV4dGVybmFsX3JlZnMiOiBbXSwgInNxbF9jb250ZW50IjogIi0tIFJlcG9ydDogcHJvZHVjdCBwZXJmb3JtYW5jZSBieSBzdG9yZSByZWdpb24gYW5kIHBlcmlvZFxuLS0gRGVwczogZmFjdC5zYWxlcywgZmFjdC5yZXR1cm5zLCBkaW0ucHJvZHVjdCwgZGltLnN0b3JlLCBkaW0uZGF0ZVxuQ1JFQVRFIE9SIFJFUExBQ0UgVEFCTEUgcnB0LnByb2R1Y3RfcGVyZm9ybWFuY2UgQVNcbldJVEggc2FsZXMgQVMgKFxuICAgIFNFTEVDVFxuICAgICAgICBmcy5wcm9kdWN0X2tleSwgZnMuc3RvcmVfa2V5LCBmcy5kYXRlX2tleSxcbiAgICAgICAgU1VNKGZzLnF1YW50aXR5KSAgICAgIEFTIHNvbGRfcXR5LFxuICAgICAgICBTVU0oZnMuZ3Jvc3NfcmV2ZW51ZSkgQVMgZ3Jvc3NfcmV2LFxuICAgICAgICBTVU0oZnMubmV0X3JldmVudWUpICAgQVMgbmV0X3JldixcbiAgICAgICAgU1VNKGZzLmdyb3NzX3Byb2ZpdCkgIEFTIGdyb3NzX3Byb2ZpdFxuICAgIEZST00gZmFjdC5zYWxlcyBmc1xuICAgIEdST1VQIEJZIDEsIDIsIDNcbiksXG5yZXR1cm5zIEFTIChcbiAgICBTRUxFQ1RcbiAgICAgICAgZnIucHJvZHVjdF9rZXksIGZyLnN0b3JlX2tleSwgZnIuZGF0ZV9rZXksXG4gICAgICAgIFNVTShmci5yZXR1cm5lZF9xdHkpICAgICAgICAgIEFTIHJldF9xdHksXG4gICAgICAgIFNVTShmci5yZXR1cm5lZF9uZXRfdmFsdWUpICAgIEFTIHJldF92YWx1ZVxuICAgIEZST00gZmFjdC5yZXR1cm5zIGZyXG4gICAgR1JPVVAgQlkgMSwgMiwgM1xuKVxuU0VMRUNUXG4gICAgZGQuZmlzY2FsX3llYXIsXG4gICAgZGQuZmlzY2FsX3F1YXJ0ZXIsXG4gICAgZHAuY2F0ZWdvcnksIGRwLnN1Yl9jYXRlZ29yeSwgZHAuYnJhbmQsIGRwLnByb2R1Y3RfbmFtZSxcbiAgICBkcy5yZWdpb24sIGRzLnN0b3JlX3R5cGUsXG5cbiAgICBDT0FMRVNDRShzLnNvbGRfcXR5LCAwKSAgICAgQVMgc29sZF9xdHksXG4gICAgQ09BTEVTQ0Uoci5yZXRfcXR5LCAwKSAgICAgIEFTIHJldHVybmVkX3F0eSxcbiAgICBDT0FMRVNDRShzLnNvbGRfcXR5LCAwKVxuICAgICAgLSBDT0FMRVNDRShyLnJldF9xdHksIDApIEFTIG5ldF9xdHksXG4gICAgQ09BTEVTQ0Uocy5ncm9zc19yZXYsIDApICAgIEFTIGdyb3NzX3JldmVudWUsXG4gICAgQ09BTEVTQ0Uocy5uZXRfcmV2LCAwKSAgICAgIEFTIG5ldF9yZXZlbnVlLFxuICAgIENPQUxFU0NFKHMuZ3Jvc3NfcHJvZml0LCAwKSBBUyBncm9zc19wcm9maXQsXG4gICAgQ09BTEVTQ0Uoci5yZXRfdmFsdWUsIDApICAgIEFTIHJldHVybl92YWx1ZSxcbiAgICBST1VORChDT0FMRVNDRShyLnJldF9xdHksIDApIC8gTlVMTElGKENPQUxFU0NFKHMuc29sZF9xdHksIDApLCAwKSAqIDEwMCwgMikgQVMgcmV0dXJuX3JhdGVfcGN0XG5cbkZST00gc2FsZXMgc1xuSk9JTiBkaW0ucHJvZHVjdCBkcCBPTiBzLnByb2R1Y3Rfa2V5ID0gZHAucHJvZHVjdF9rZXlcbkpPSU4gZGltLnN0b3JlICAgZHMgT04gcy5zdG9yZV9rZXkgICA9IGRzLnN0b3JlX2tleVxuSk9JTiBkaW0uZGF0ZSAgICBkZCBPTiBzLmRhdGVfa2V5ICAgID0gZGQuZGF0ZV9rZXlcbkxFRlQgSk9JTiByZXR1cm5zIHJcbiAgICBPTiAgcy5wcm9kdWN0X2tleSA9IHIucHJvZHVjdF9rZXlcbiAgICBBTkQgcy5zdG9yZV9rZXkgICA9IHIuc3RvcmVfa2V5XG4gICAgQU5EIHMuZGF0ZV9rZXkgICAgPSByLmRhdGVfa2V5O1xuIn0sIHsiaWQiOiAicnB0LnNhbGVzX2J5X2NoYW5uZWwiLCAibGFiZWwiOiAicnB0LnNhbGVzX2J5X2NoYW5uZWwiLCAic2NoZW1hIjogInJwdCIsICJ0YWJsZSI6ICJzYWxlc19ieV9jaGFubmVsIiwgImxheWVyIjogInJwdCIsICJmaWxlIjogInJwdC5zYWxlc19ieV9jaGFubmVsLnNxbCIsICJkZWdyZWUiOiA0LCAiYWxsX3JlZnMiOiBbImRpbS5jdXN0b21lciIsICJkaW0uZGF0ZSIsICJkaW0ucHJvbW90aW9uIiwgImZhY3Quc2FsZXMiXSwgImludGVybmFsX3JlZnMiOiBbImRpbS5jdXN0b21lciIsICJkaW0uZGF0ZSIsICJkaW0ucHJvbW90aW9uIiwgImZhY3Quc2FsZXMiXSwgImV4dGVybmFsX3JlZnMiOiBbXSwgInNxbF9jb250ZW50IjogIi0tIFJlcG9ydDogc2FsZXMgcGVyZm9ybWFuY2UgYnkgY2hhbm5lbCBcdTAwZDcgY3VzdG9tZXIgc2VnbWVudCBcdTAwZDcgcGVyaW9kXG4tLSBEZXBzOiBmYWN0LnNhbGVzLCBkaW0uY3VzdG9tZXIsIGRpbS5kYXRlLCBkaW0ucHJvbW90aW9uXG5DUkVBVEUgT1IgUkVQTEFDRSBUQUJMRSBycHQuc2FsZXNfYnlfY2hhbm5lbCBBU1xuU0VMRUNUXG4gICAgZGQuZmlzY2FsX3llYXIsXG4gICAgZGQuZmlzY2FsX3F1YXJ0ZXIsXG4gICAgZGQubW9udGhfbmFtZSxcbiAgICBmcy5jaGFubmVsLFxuICAgIGRjLmxveWFsdHlfdGllcixcbiAgICBkYy5jb3VudHJ5LFxuICAgIGRwci5wcm9tb190eXBlLFxuXG4gICAgQ09VTlQoRElTVElOQ1QgZnMudHJhbnNhY3Rpb25faWQpICBBUyBudW1fdHJhbnNhY3Rpb25zLFxuICAgIENPVU5UKERJUlRJTkNUIGRjLmN1c3RvbWVyX2tleSkgICAgQVMgdW5pcXVlX2N1c3RvbWVycyxcbiAgICBTVU0oZnMucXVhbnRpdHkpICAgICAgICAgICAgICAgICAgIEFTIHRvdGFsX3VuaXRzLFxuICAgIFNVTShmcy5ncm9zc19yZXZlbnVlKSAgICAgICAgICAgICAgQVMgZ3Jvc3NfcmV2ZW51ZSxcbiAgICBTVU0oZnMubmV0X3JldmVudWUpICAgICAgICAgICAgICAgIEFTIG5ldF9yZXZlbnVlLFxuICAgIFNVTShmcy5ncm9zc19wcm9maXQpICAgICAgICAgICAgICAgQVMgZ3Jvc3NfcHJvZml0LFxuICAgIEFWRyhmcy5uZXRfcmV2ZW51ZSkgICAgICAgICAgICAgICAgQVMgYXZnX29yZGVyX3ZhbHVlLFxuICAgIFNVTShmcy5kaXNjb3VudF9hbXQpICAgICAgICAgICAgICAgQVMgdG90YWxfZGlzY291bnRzXG5cbkZST00gZmFjdC5zYWxlcyBmc1xuSk9JTiBkaW0uY3VzdG9tZXIgIGRjICBPTiBmcy5jdXN0b21lcl9rZXkgID0gZGMuY3VzdG9tZXJfa2V5XG5KT0lOIGRpbS5kYXRlICAgICAgZGQgIE9OIGZzLmRhdGVfa2V5ICAgICAgPSBkZC5kYXRlX2tleVxuTEVGVCBKT0lOIGRpbS5wcm9tb3Rpb24gZHByIE9OIGZzLnByb21vdGlvbl9rZXkgPSBkcHIucHJvbW90aW9uX2tleVxuR1JPVVAgQlkgMSwgMiwgMywgNCwgNSwgNiwgNztcbiJ9LCB7ImlkIjogInNyYy5yYXdfY3VzdG9tZXJzIiwgImxhYmVsIjogInNyYy5yYXdfY3VzdG9tZXJzIiwgInNjaGVtYSI6ICJzcmMiLCAidGFibGUiOiAicmF3X2N1c3RvbWVycyIsICJsYXllciI6ICJzcmMiLCAiZmlsZSI6ICJzcmMucmF3X2N1c3RvbWVycy5zcWwiLCAiZGVncmVlIjogMSwgImFsbF9yZWZzIjogWyJleHRlcm5hbC5jcm1fZGIuY3VzdG9tZXJzIl0sICJpbnRlcm5hbF9yZWZzIjogW10sICJleHRlcm5hbF9yZWZzIjogWyJleHRlcm5hbC5jcm1fZGIuY3VzdG9tZXJzIl0sICJzcWxfY29udGVudCI6ICItLSBTb3VyY2U6IHJhdyBjdXN0b21lciByZWNvcmRzIGZyb20gQ1JNXG5DUkVBVEUgT1IgUkVQTEFDRSBUQUJMRSBzcmMucmF3X2N1c3RvbWVycyBBU1xuU0VMRUNUXG4gICAgY3VzdG9tZXJfaWQsIGZpcnN0X25hbWUsIGxhc3RfbmFtZSwgZW1haWwsIHBob25lLFxuICAgIGFkZHJlc3MsIGNpdHksIHN0YXRlLCB6aXAsIGNvdW50cnksXG4gICAgZ2VuZGVyLCBiaXJ0aF9kYXRlLCBzaWdudXBfZGF0ZSwgbG95YWx0eV90aWVyLCBfbG9hZGVkX2F0XG5GUk9NIGV4dGVybmFsLmNybV9kYi5jdXN0b21lcnM7XG4ifSwgeyJpZCI6ICJzcmMucmF3X3Byb2R1Y3RzIiwgImxhYmVsIjogInNyYy5yYXdfcHJvZHVjdHMiLCAic2NoZW1hIjogInNyYyIsICJ0YWJsZSI6ICJyYXdfcHJvZHVjdHMiLCAibGF5ZXIiOiAic3JjIiwgImZpbGUiOiAic3JjLnJhd19wcm9kdWN0cy5zcWwiLCAiZGVncmVlIjogMSwgImFsbF9yZWZzIjogWyJleHRlcm5hbC5lcnBfZGIucHJvZHVjdF9jYXRhbG9nIl0sICJpbnRlcm5hbF9yZWZzIjogW10sICJleHRlcm5hbF9yZWZzIjogWyJleHRlcm5hbC5lcnBfZGIucHJvZHVjdF9jYXRhbG9nIl0sICJzcWxfY29udGVudCI6ICItLSBTb3VyY2U6IHJhdyBwcm9kdWN0IGNhdGFsb2cgZnJvbSBFUlBcbkNSRUFURSBPUiBSRVBMQUNFIFRBQkxFIHNyYy5yYXdfcHJvZHVjdHMgQVNcblNFTEVDVFxuICAgIHByb2R1Y3RfaWQsIHNrdSwgcHJvZHVjdF9uYW1lLCBicmFuZCwgY2F0ZWdvcnksIHN1Yl9jYXRlZ29yeSxcbiAgICBjb3N0X3ByaWNlLCBsaXN0X3ByaWNlLCB3ZWlnaHRfa2csIGxhdW5jaF9kYXRlLCBkaXNjb250aW51ZWRfZGF0ZSwgX2xvYWRlZF9hdFxuRlJPTSBleHRlcm5hbC5lcnBfZGIucHJvZHVjdF9jYXRhbG9nO1xuIn0sIHsiaWQiOiAic3JjLnJhd19wcm9tb3Rpb25zIiwgImxhYmVsIjogInNyYy5yYXdfcHJvbW90aW9ucyIsICJzY2hlbWEiOiAic3JjIiwgInRhYmxlIjogInJhd19wcm9tb3Rpb25zIiwgImxheWVyIjogInNyYyIsICJmaWxlIjogInNyYy5yYXdfcHJvbW90aW9ucy5zcWwiLCAiZGVncmVlIjogMSwgImFsbF9yZWZzIjogWyJleHRlcm5hbC5tYXJrZXRpbmdfZGIucHJvbW90aW9ucyJdLCAiaW50ZXJuYWxfcmVmcyI6IFtdLCAiZXh0ZXJuYWxfcmVmcyI6IFsiZXh0ZXJuYWwubWFya2V0aW5nX2RiLnByb21vdGlvbnMiXSwgInNxbF9jb250ZW50IjogIi0tIFNvdXJjZTogcmF3IHByb21vdGlvbiAvIGNhbXBhaWduIHJlY29yZHNcbkNSRUFURSBPUiBSRVBMQUNFIFRBQkxFIHNyYy5yYXdfcHJvbW90aW9ucyBBU1xuU0VMRUNUXG4gICAgcHJvbW90aW9uX2lkLCBwcm9tb3Rpb25fbmFtZSwgcHJvbW9fdHlwZSxcbiAgICBkaXNjb3VudF90eXBlLCBkaXNjb3VudF92YWx1ZSwgc3RhcnRfZGF0ZSwgZW5kX2RhdGUsXG4gICAgY2hhbm5lbCwgdGFyZ2V0X3NlZ21lbnQsIF9sb2FkZWRfYXRcbkZST00gZXh0ZXJuYWwubWFya2V0aW5nX2RiLnByb21vdGlvbnM7XG4ifSwgeyJpZCI6ICJzcmMucmF3X3N0b3JlcyIsICJsYWJlbCI6ICJzcmMucmF3X3N0b3JlcyIsICJzY2hlbWEiOiAic3JjIiwgInRhYmxlIjogInJhd19zdG9yZXMiLCAibGF5ZXIiOiAic3JjIiwgImZpbGUiOiAic3JjLnJhd19zdG9yZXMuc3FsIiwgImRlZ3JlZSI6IDEsICJhbGxfcmVmcyI6IFsiZXh0ZXJuYWwub3BzX2RiLnN0b3JlcyJdLCAiaW50ZXJuYWxfcmVmcyI6IFtdLCAiZXh0ZXJuYWxfcmVmcyI6IFsiZXh0ZXJuYWwub3BzX2RiLnN0b3JlcyJdLCAic3FsX2NvbnRlbnQiOiAiLS0gU291cmNlOiBzdG9yZSAvIGNoYW5uZWwgbWFzdGVyIGZyb20gcmV0YWlsIG9wc1xuQ1JFQVRFIE9SIFJFUExBQ0UgVEFCTEUgc3JjLnJhd19zdG9yZXMgQVNcblNFTEVDVFxuICAgIHN0b3JlX2lkLCBzdG9yZV9uYW1lLCBzdG9yZV90eXBlLCByZWdpb24sIGNpdHksXG4gICAgc3RhdGUsIGNvdW50cnksIG9wZW5fZGF0ZSwgY2xvc2VfZGF0ZSwgc3FmdCwgX2xvYWRlZF9hdFxuRlJPTSBleHRlcm5hbC5vcHNfZGIuc3RvcmVzO1xuIn0sIHsiaWQiOiAic3JjLnJhd190cmFuc2FjdGlvbnMiLCAibGFiZWwiOiAic3JjLnJhd190cmFuc2FjdGlvbnMiLCAic2NoZW1hIjogInNyYyIsICJ0YWJsZSI6ICJyYXdfdHJhbnNhY3Rpb25zIiwgImxheWVyIjogInNyYyIsICJmaWxlIjogInNyYy5yYXdfdHJhbnNhY3Rpb25zLnNxbCIsICJkZWdyZWUiOiAyLCAiYWxsX3JlZnMiOiBbImV4dGVybmFsLnBvc19kYi50cmFuc2FjdGlvbnMiXSwgImludGVybmFsX3JlZnMiOiBbXSwgImV4dGVybmFsX3JlZnMiOiBbImV4dGVybmFsLnBvc19kYi50cmFuc2FjdGlvbnMiXSwgInNxbF9jb250ZW50IjogIi0tIFNvdXJjZTogcmF3IFBPUSBXL2UtY29tbWVyY2UgdHJhbnNhY3Rpb24gZXZlbnRzXG5DUkVBVEUgT1IgUkVQTEFDRSBUQUJMRSBzcmMucmF3X3RyYW5zYWN0aW9ucyBBU1xuU0VMRUNUXG4gICAgdHJhbnNhY3Rpb25faWQsIG9yZGVyX2lkLCBjdXN0b21lcl9pZCwgcHJvZHVjdF9pZCwgc3RvcmVfaWQsXG4gICAgcHJvbW90aW9uX2lkLCB0cmFuc2FjdGlvbl90cywgcXVhbnRpdHksIHVuaXRfcHJpY2UsIGRpc2NvdW50X2FtdCxcbiAgICByZXR1cm5fZmxhZywgY2hhbm5lbCwgcGF5bWVudF9tZXRob2QsIF9sb2FkZWRfYXRcbkZST00gZXh0ZXJuYWwucG9zX2RiLnRyYW5zYWN0aW9ucztcbiJ9XSwgImVkZ2VzIjogW3sic291cmNlIjogImRpbS5jdXN0b21lciIsICJ0YXJnZXQiOiAic3JjLnJhd19jdXN0b21lcnMifSwgeyJzb3VyY2UiOiAiZGltLnByb2R1Y3QiLCAidGFyZ2V0IjogInNyYy5yYXdfcHJvZHVjdHMifSwgeyJzb3VyY2UiOiAiZGltLnByb21vdGlvbiIsICJ0YXJnZXQiOiAic3JjLnJhd19wcm9tb3Rpb25zIn0sIHsic291cmNlIjogImRpbS5zdG9yZSIsICJ0YXJnZXQiOiAic3JjLnJhd19zdG9yZXMifSwgeyJzb3VyY2UiOiAiZmFjdC5yZXR1cm5zIiwgInRhcmdldCI6ICJkaW0uY3VzdG9tZXIifSwgeyJzb3VyY2UiOiAiZmFjdC5yZXR1cm5zIiwgInRhcmdldCI6ICJkaW0uZGF0ZSJ9LCB7InNvdXJjZSI6ICJmYWN0LnJldHVybnMiLCAidGFyZ2V0IjogImRpbS5wcm9kdWN0In0sIHsic291cmNlIjogImZhY3QucmV0dXJucyIsICJ0YXJnZXQiOiAiZGltLnN0b3JlIn0sIHsic291cmNlIjogImZhY3QucmV0dXJucyIsICJ0YXJnZXQiOiAic3JjLnJhd190cmFuc2FjdGlvbnMifSwgeyJzb3VyY2UiOiAiZmFjdC5zYWxlcyIsICJ0YXJnZXQiOiAiZGltLmN1c3RvbWVyIn0sIHsic291cmNlIjogImZhY3Quc2FsZXMiLCAidGFyZ2V0IjogImRpbS5kYXRlIn0sIHsic291cmNlIjogImZhY3Quc2FsZXMiLCAidGFyZ2V0IjogImRpbS5wcm9kdWN0In0sIHsic291cmNlIjogImZhY3Quc2FsZXMiLCAidGFyZ2V0IjogImRpbS5wcm9tb3Rpb24ifSwgeyJzb3VyY2UiOiAiZmFjdC5zYWxlcyIsICJ0YXJnZXQiOiAiZGltLnN0b3JlIn0sIHsic291cmNlIjogImZhY3Quc2FsZXMiLCAidGFyZ2V0IjogInNyYy5yYXdfdHJhbnNhY3Rpb25zIn0sIHsic291cmNlIjogInJwdC5jdXN0b21lcl8zNjAiLCAidGFyZ2V0IjogImRpbS5jdXN0b21lciJ9LCB7InNvdXJjZSI6ICJycHQuY3VzdG9tZXJfMzYwIiwgInRhcmdldCI6ICJkaW0uZGF0ZSJ9LCB7InNvdXJjZSI6ICJycHQuY3VzdG9tZXJfMzYwIiwgInRhcmdldCI6ICJmYWN0LnJldHVybnMifSwgeyJzb3VyY2UiOiAicnB0LmN1c3RvbWVyXzM2MCIsICJ0YXJnZXQiOiAiZmFjdC5zYWxlcyJ9LCB7InNvdXJjZSI6ICJycHQucHJvZHVjdF9wZXJmb3JtYW5jZSIsICJ0YXJnZXQiOiAiZGltLmRhdGUifSwgeyJzb3VyY2UiOiAicnB0LnByb2R1Y3RfcGVyZm9ybWFuY2UiLCAidGFyZ2V0IjogImRpbS5wcm9kdWN0In0sIHsic291cmNlIjogInJwdC5wcm9kdWN0X3BlcmZvcm1hbmNlIiwgInRhcmdldCI6ICJkaW0uc3RvcmUifSwgeyJzb3VyY2UiOiAicnB0LnByb2R1Y3RfcGVyZm9ybWFuY2UiLCAidGFyZ2V0IjogImZhY3QucmV0dXJucyJ9LCB7InNvdXJjZSI6ICJycHQucHJvZHVjdF9wZXJmb3JtYW5jZSIsICJ0YXJnZXQiOiAiZmFjdC5zYWxlcyJ9LCB7InNvdXJjZSI6ICJycHQuc2FsZXNfYnlfY2hhbm5lbCIsICJ0YXJnZXQiOiAiZGltLmN1c3RvbWVyIn0sIHsic291cmNlIjogInJwdC5zYWxlc19ieV9jaGFubmVsIiwgInRhcmdldCI6ICJkaW0uZGF0ZSJ9LCB7InNvdXJjZSI6ICJycHQuc2FsZXNfYnlfY2hhbm5lbCIsICJ0YXJnZXQiOiAiZGltLnByb21vdGlvbiJ9LCB7InNvdXJjZSI6ICJycHQuc2FsZXNfYnlfY2hhbm5lbCIsICJ0YXJnZXQiOiAiZmFjdC5zYWxlcyJ9XSwgInN0YXRzIjogeyJ0b3RhbF90YWJsZXMiOiAxNSwgInRvdGFsX2VkZ2VzIjogMjgsICJsYXllcl9jb3VudHMiOiB7ImRpbSI6IDUsICJmYWN0IjogMiwgInJwdCI6IDMsICJzcmMiOiA1fX19';

document.getElementById('example-btn').addEventListener('click', () => {
  const data = JSON.parse(atob(EXAMPLE_PAYLOAD));
  processGraphData(data, data.project_name);
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
