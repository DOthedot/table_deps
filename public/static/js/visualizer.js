'use strict';

// ═══════════════════════════════════════════════════════════════
// CONSTANTS  (colors.js provides SCHEMA_PALETTE + schemaColor)
//            (sql_parser.js provides SQL_KEYWORDS + FROM_JOIN_RE)
// ═══════════════════════════════════════════════════════════════

const JOIN_COLORS  = { INNER:'#94a3b8', LEFT:'#3fb950', RIGHT:'#d29922', FULL:'#bc8cff', CROSS:'#f85149', UNION:'#39d0d8' };
const CTE_COLOR    = '#a78bfa';

// CTE box geometry constants
const CTE_MIN_W    = 155;
const CTE_TITLE_H  = 30;
const CTE_ROW_H    = 18;
const CTE_PAD_B    = 8;

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function normName(raw) { return raw.replace(/[`"\[\]]/g, '').toLowerCase(); }
function getSchema(name) { const p = name.split('.'); return p.length > 1 ? p[0] : null; }

function joinTypeOf(keyword, modifier) {
  const kw  = (keyword  || '').trim().toUpperCase();
  const mod = (modifier || '').trim().toUpperCase();
  if (kw === 'FROM')         return 'FROM';
  if (/LEFT/.test(mod))      return 'LEFT';
  if (/RIGHT/.test(mod))     return 'RIGHT';
  if (/FULL/.test(mod))      return 'FULL';
  if (/CROSS/.test(mod))     return 'CROSS';
  return 'INNER';
}

function cteBoxSize(cte) {
  const maxLen = Math.max(cte.label.length, ...(cte.tables.map(t => t.length)));
  const w = Math.max(CTE_MIN_W, maxLen * 7.2 + 40);
  const h = CTE_TITLE_H + cte.tables.length * CTE_ROW_H + CTE_PAD_B;
  return { w, h };
}

// ═══════════════════════════════════════════════════════════════
// SQL PARSING
// ═══════════════════════════════════════════════════════════════

function parseSQL(sql) {
  if (!sql || !sql.trim()) return { tableNodes: [], cteNodes: [], edges: [] };

  // ── 1. Clean ────────────────────────────────
  sql = sql.replace(/--[^\n]*/g,        ' ');
  sql = sql.replace(/\/\*[\s\S]*?\*\//g,' ');
  sql = sql.replace(/'(?:[^'\\]|\\.)*'/g,"''");

  // ── 2. Collect CTE names ────────────────────
  const cteNames = new Set();
  for (const m of sql.matchAll(/\b(\w+)\s+AS\s*\(/gi)) {
    const n = normName(m[1]);
    if (!SQL_KEYWORDS.has(n)) cteNames.add(n);
  }

  // ── 3. Extract each CTE body via balanced parens ──
  const cteBodyRanges = [];          // [{start,end}] char ranges to skip in main query
  const cteBodyData   = new Map();   // cteName → {tables:[], internalEdges:[]}

  const cteDefRe = /\b(\w+)\s+AS\s*\(/gi;
  let dm;
  while ((dm = cteDefRe.exec(sql)) !== null) {
    const name    = normName(dm[1]);
    if (!cteNames.has(name)) continue;

    const openIdx = dm.index + dm[0].length - 1; // position of '('
    let depth = 0, endIdx = sql.length;
    for (let i = openIdx; i < sql.length; i++) {
      if      (sql[i] === '(') depth++;
      else if (sql[i] === ')') { if (--depth === 0) { endIdx = i; break; } }
    }
    cteBodyRanges.push({ start: openIdx + 1, end: endIdx });

    // Parse CTE body tokens (exclude other CTE names)
    const body = sql.slice(openIdx + 1, endIdx);
    const bodyTokens = [];
    for (const m of body.matchAll(FROM_JOIN_RE())) {
      const tname = normName(m[3]);
      if (SQL_KEYWORDS.has(tname) || /^\d+$/.test(tname) || cteNames.has(tname)) continue;
      bodyTokens.push({ name: tname, type: joinTypeOf(m[1], m[2]) });
    }
    cteBodyData.set(name, {
      tables:        [...new Set(bodyTokens.map(t => t.name))],
      internalEdges: buildInternalEdges(bodyTokens),
    });
  }

  // ── 4. Pre-compute paren depth at each position ──
  const depthAt = new Array(sql.length).fill(0);
  { let d = 0;
    for (let i = 0; i < sql.length; i++) {
      depthAt[i] = d;
      if      (sql[i] === '(') d++;
      else if (sql[i] === ')') d = Math.max(0, d - 1);
    }
  }

  function inCTEBody(idx) {
    return cteBodyRanges.some(r => idx >= r.start && idx <= r.end);
  }

  const mainTokens = [];
  for (const m of sql.matchAll(FROM_JOIN_RE())) {
    if (inCTEBody(m.index)) continue;
    const name = normName(m[3]);
    if (SQL_KEYWORDS.has(name) || /^\d+$/.test(name)) continue;
    mainTokens.push({
      name, type: joinTypeOf(m[1], m[2]),
      isCTE: cteNames.has(name),
      depth: depthAt[m.index],
      pos: m.index,
    });
  }

  // ── 5. Build node maps ──────────────────────
  const tableNodesMap = new Map();
  const cteNodesMap   = new Map();

  for (const t of mainTokens) {
    if (t.isCTE) {
      if (!cteNodesMap.has(t.name) && cteBodyData.has(t.name)) {
        const bd = cteBodyData.get(t.name);
        cteNodesMap.set(t.name, {
          id: t.name, label: t.name, type: 'cte',
          tables: bd.tables, internalEdges: bd.internalEdges, degree: 0,
        });
      }
    } else {
      if (!tableNodesMap.has(t.name)) {
        const schema = getSchema(t.name);
        tableNodesMap.set(t.name, {
          id: t.name, label: t.name, type: 'table',
          schema, color: schemaColor(schema), degree: 0,
        });
      }
    }
  }

  // ── 6. Build main query edges (FROM-as-hub) ─
  const edgesMap = new Map();
  let fromToken = null, pseudoHub = null, lastJoinType = 'INNER';

  function getNode(name) { return tableNodesMap.get(name) || cteNodesMap.get(name); }

  function addEdge(srcName, tgtName, type) {
    if (!getNode(srcName) || !getNode(tgtName)) return;
    const key = [srcName, tgtName].sort().join('\x00') + '\x00' + type;
    if (edgesMap.has(key)) return;
    edgesMap.set(key, {
      source: srcName, target: tgtName,
      type, color: JOIN_COLORS[type] || JOIN_COLORS.INNER,
    });
    getNode(srcName).degree++;
    getNode(tgtName).degree++;
  }

  for (const token of mainTokens) {
    if (!getNode(token.name)) continue;

    if (token.depth === 0) {
      if (token.type === 'FROM') {
        fromToken = token; pseudoHub = null; lastJoinType = 'INNER';
      } else {
        lastJoinType = token.type;
        const hub = fromToken || pseudoHub;
        if (hub) addEdge(token.name, hub.name, token.type);
        if (!fromToken && !pseudoHub) pseudoHub = token;
      }
    } else if (token.depth === 1 && token.type === 'FROM' && !token.isCTE) {
      const hub = fromToken || pseudoHub;
      if (hub) addEdge(token.name, hub.name, lastJoinType);
    }
  }

  // ── 7. UNION / UNION ALL edges ───────────────
  for (const m of sql.matchAll(/\bUNION\b/gi)) {
    if (inCTEBody(m.index) || depthAt[m.index] !== 0) continue;
    const upos = m.index;
    const depth0Froms = mainTokens.filter(t => t.depth === 0 && t.type === 'FROM');
    const prevFrom = [...depth0Froms].filter(t => t.pos < upos).at(-1);
    const nextFrom = depth0Froms.find(t => t.pos > upos);
    if (prevFrom && nextFrom) addEdge(prevFrom.name, nextFrom.name, 'UNION');
  }

  return {
    tableNodes: Array.from(tableNodesMap.values()),
    cteNodes:   Array.from(cteNodesMap.values()),
    edges:      Array.from(edgesMap.values()),
  };
}

/** Build join edges within a CTE body from its token list. */
function buildInternalEdges(tokens) {
  const seen = new Map();
  let fromToken = null, pseudoHub = null;
  for (const token of tokens) {
    if (token.type === 'FROM') { fromToken = token; pseudoHub = null; }
    else {
      const hub = fromToken || pseudoHub;
      if (hub) {
        const key = [hub.name, token.name].sort().join('\x00') + '\x00' + token.type;
        if (!seen.has(key))
          seen.set(key, { source: hub.name, target: token.name, type: token.type });
      }
      if (!fromToken && !pseudoHub) pseudoHub = token;
    }
  }
  return Array.from(seen.values());
}

// ═══════════════════════════════════════════════════════════════
// D3 GRAPH
// ═══════════════════════════════════════════════════════════════

const svgEl     = document.getElementById('graph');
const svgD3     = d3.select(svgEl);
const tooltip   = document.getElementById('tooltip');
const container = document.getElementById('graph-container');

let gMain, zoomBehaviour, currentSimulation;

function graphDimensions() { return { w: container.clientWidth, h: container.clientHeight }; }
function tableNodeRadius(d) { return Math.max(20, 18 + d.degree * 4); }

/** Compute the point on node n's boundary toward direction (dx,dy). */
function edgeEndpoint(n, dx, dy) {
  const dist = Math.sqrt(dx * dx + dy * dy) || 1;
  const nx = dx / dist, ny = dy / dist;
  if (n.type === 'table') {
    const r = tableNodeRadius(n);
    return { x: n.x + nx * r, y: n.y + ny * r };
  }
  // CTE box: rectangle intersection
  const { w, h } = cteBoxSize(n);
  const scaleX = nx !== 0 ? Math.abs((w / 2) / nx) : Infinity;
  const scaleY = ny !== 0 ? Math.abs((h / 2) / ny) : Infinity;
  const t = Math.min(scaleX, scaleY);
  return { x: n.x + nx * t, y: n.y + ny * t };
}

function initSVG() {
  svgD3.selectAll('*').remove();
  const { w, h } = graphDimensions();
  svgD3.attr('viewBox', [0, 0, w, h]);

  zoomBehaviour = d3.zoom()
    .scaleExtent([0.05, 6])
    .on('zoom', e => gMain.attr('transform', e.transform));
  svgD3.call(zoomBehaviour);

  // Arrow markers per join type
  const defs = svgD3.append('defs');
  for (const [type, color] of Object.entries(JOIN_COLORS)) {
    defs.append('marker')
      .attr('id', `arr-${type}`).attr('viewBox', '0 -5 10 10')
      .attr('refX', 10).attr('refY', 0)
      .attr('markerWidth', 6).attr('markerHeight', 6).attr('orient', 'auto')
      .append('path').attr('d', 'M0,-5L10,0L0,5').attr('fill', color).attr('opacity', 0.75);
  }

  gMain = svgD3.append('g');
}

function render(data) {
  const empty = document.getElementById('empty-state');
  if (!data.tableNodes.length && !data.cteNodes.length) {
    empty.querySelector('p').textContent = 'No tables found in the SQL query.';
    empty.style.display = 'flex'; return;
  }
  empty.style.display = 'none';
  initSVG();
  const { w, h } = graphDimensions();

  // Combine all nodes for the force simulation
  const allNodes = [
    ...data.tableNodes.map(d => ({ ...d })),
    ...data.cteNodes.map(d => ({ ...d })),
  ];
  const nodeById = new Map(allNodes.map(n => [n.id, n]));

  // Resolve edge source/target to node objects
  const edges = data.edges.map(e => ({
    ...e,
    source: nodeById.get(e.source) || e.source,
    target: nodeById.get(e.target) || e.target,
  }));

  if (currentSimulation) currentSimulation.stop();

  currentSimulation = d3.forceSimulation(allNodes)
    .force('link',      d3.forceLink(edges).id(d => d.id).distance(160).strength(0.6))
    .force('charge',    d3.forceManyBody().strength(-600))
    .force('center',    d3.forceCenter(w / 2, h / 2))
    .force('collision', d3.forceCollide().radius(d => {
      if (d.type === 'table') return tableNodeRadius(d) + 18;
      const { w: bw, h: bh } = cteBoxSize(d);
      return Math.sqrt(bw * bw + bh * bh) / 2 + 20;
    }));

  // ── Edges ────────────────────────────────────
  const linkSel = gMain.append('g').selectAll('line').data(edges).join('line')
    .attr('class', 'link')
    .attr('stroke', d => d.color)
    .attr('stroke-dasharray', d => d.type === 'UNION' ? '8,4' : null)
    .attr('marker-end', d => d.type === 'UNION' ? null : `url(#arr-${d.type})`);

  const linkLabelSel = gMain.append('g').selectAll('text').data(edges).join('text')
    .attr('class', 'link-label').text(d => d.type);

  // ── Shared drag behaviour ────────────────────
  const drag = d3.drag()
    .on('start', (event, d) => { if (!event.active) currentSimulation.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
    .on('drag',  (event, d) => { d.fx = event.x; d.fy = event.y; })
    .on('end',   (event, d) => { if (!event.active) currentSimulation.alphaTarget(0); d.fx = null; d.fy = null; });

  function onEnter(event, d) {
    if (d.type === 'cte') {
      document.getElementById('tt-name').textContent  = d.label + '  (CTE)';
      document.getElementById('tt-label1').textContent = 'Tables inside';
      document.getElementById('tt-val1').textContent  = d.tables.length;
    } else {
      document.getElementById('tt-name').textContent  = d.label;
      document.getElementById('tt-label1').textContent = 'Schema';
      document.getElementById('tt-val1').textContent  = d.schema || '(none)';
    }
    document.getElementById('tt-degree').textContent = d.degree;
    tooltip.style.display = 'block';
    positionTooltip(event);
  }

  // ── Table nodes (circles) ────────────────────
  const tableNodes = allNodes.filter(d => d.type === 'table');
  const tableNodeSel = gMain.append('g').selectAll('g').data(tableNodes).join('g')
    .attr('class', 'table-node')
    .call(drag)
    .on('mouseenter', onEnter)
    .on('mousemove',  positionTooltip)
    .on('mouseleave', () => { tooltip.style.display = 'none'; });

  // Glow halo
  tableNodeSel.append('circle')
    .attr('r',      d => tableNodeRadius(d) + 8)
    .attr('fill',   d => d.color + '18')
    .attr('stroke', 'none');
  // Main circle
  tableNodeSel.append('circle')
    .attr('r',      d => tableNodeRadius(d))
    .attr('fill',   d => d.color + '28')
    .attr('stroke', d => d.color)
    .attr('stroke-width', 2);
  // Table name label
  tableNodeSel.append('text')
    .attr('y', 0).attr('fill', '#1a1a1a')
    .attr('font-size', d => Math.max(9, 12 - d.label.length * 0.15) + 'px')
    .attr('font-family', "'SF Mono','Fira Code',monospace")
    .text(d => { const p = d.label.split('.'); const last = p[p.length-1]; return last.length > 16 ? last.slice(0,14)+'…' : last; });
  // Schema prefix above
  tableNodeSel.append('text')
    .attr('y', d => -(tableNodeRadius(d) + 5))
    .attr('fill', '#555555').attr('font-size', '9px')
    .attr('font-family', "'SF Mono',monospace")
    .text(d => { const p = d.label.split('.'); return p.length > 1 ? p.slice(0,-1).join('.') : ''; });

  // ── CTE box nodes ────────────────────────────
  const cteNodes = allNodes.filter(d => d.type === 'cte');
  const cteNodeSel = gMain.append('g').selectAll('g').data(cteNodes).join('g')
    .attr('class', 'cte-node')
    .call(drag)
    .on('mouseenter', onEnter)
    .on('mousemove',  positionTooltip)
    .on('mouseleave', () => { tooltip.style.display = 'none'; });

  cteNodeSel.each(function(d) {
    const el       = d3.select(this);
    const { w, h } = cteBoxSize(d);
    const x = -w / 2, y = -h / 2;

    // Outer rect (background)
    el.append('rect').attr('class', 'cte-bg')
      .attr('x', x).attr('y', y).attr('width', w).attr('height', h)
      .attr('rx', 8)
      .attr('fill', CTE_COLOR + '12')
      .attr('stroke', CTE_COLOR).attr('stroke-width', 1.5);

    // Header band
    el.append('rect')
      .attr('x', x).attr('y', y).attr('width', w).attr('height', CTE_TITLE_H)
      .attr('rx', 8)
      .attr('fill', CTE_COLOR + '2a');
    // Clip bottom corners of header band
    el.append('rect')
      .attr('x', x).attr('y', y + CTE_TITLE_H - 8).attr('width', w).attr('height', 8)
      .attr('fill', CTE_COLOR + '2a');

    // CTE label in header
    el.append('text')
      .attr('x', 0).attr('y', y + CTE_TITLE_H / 2)
      .attr('text-anchor', 'middle').attr('dominant-baseline', 'middle')
      .attr('fill', CTE_COLOR).attr('font-size', '11px').attr('font-weight', '700')
      .attr('font-family', "'SF Mono','Fira Code',monospace")
      .text(d.label);

    // "CTE" badge top-right
    el.append('text')
      .attr('x', x + w - 7).attr('y', y + 10)
      .attr('text-anchor', 'end').attr('dominant-baseline', 'middle')
      .attr('fill', CTE_COLOR + '99').attr('font-size', '8px').attr('font-family', 'sans-serif')
      .text('CTE');

    // Divider
    el.append('line')
      .attr('x1', x + 10).attr('y1', y + CTE_TITLE_H)
      .attr('x2', x + w - 10).attr('y2', y + CTE_TITLE_H)
      .attr('stroke', CTE_COLOR + '55').attr('stroke-width', 1);

    // Internal table list
    d.tables.forEach((tname, i) => {
      el.append('text')
        .attr('x', x + 12)
        .attr('y', y + CTE_TITLE_H + CTE_PAD_B / 2 + (i + 0.75) * CTE_ROW_H)
        .attr('text-anchor', 'start').attr('dominant-baseline', 'middle')
        .attr('fill', '#444444').attr('font-size', '10px')
        .attr('font-family', "'SF Mono',monospace")
        .text('\u25b8 ' + tname);
    });
  });

  // ── Tick ─────────────────────────────────────
  currentSimulation.on('tick', () => {
    linkSel
      .attr('x1', d => { const dx=d.target.x-d.source.x, dy=d.target.y-d.source.y; return edgeEndpoint(d.source,  dx,  dy).x; })
      .attr('y1', d => { const dx=d.target.x-d.source.x, dy=d.target.y-d.source.y; return edgeEndpoint(d.source,  dx,  dy).y; })
      .attr('x2', d => { const dx=d.target.x-d.source.x, dy=d.target.y-d.source.y; return edgeEndpoint(d.target, -dx, -dy).x; })
      .attr('y2', d => { const dx=d.target.x-d.source.x, dy=d.target.y-d.source.y; return edgeEndpoint(d.target, -dx, -dy).y; });

    linkLabelSel
      .attr('x', d => (d.source.x + d.target.x) / 2)
      .attr('y', d => (d.source.y + d.target.y) / 2 - 6);

    tableNodeSel.attr('transform', d => `translate(${d.x},${d.y})`);
    cteNodeSel.attr('transform',   d => `translate(${d.x},${d.y})`);
  });
}

// ═══════════════════════════════════════════════════════════════
// TOOLTIP
// ═══════════════════════════════════════════════════════════════

function positionTooltip(event) {
  const rect = container.getBoundingClientRect();
  let x = event.clientX - rect.left + 14;
  let y = event.clientY - rect.top  + 14;
  if (x + 200 > container.clientWidth)  x -= 220;
  if (y + 100 > container.clientHeight) y -= 115;
  tooltip.style.left = x + 'px'; tooltip.style.top = y + 'px';
}

// ═══════════════════════════════════════════════════════════════
// ZOOM CONTROLS
// ═══════════════════════════════════════════════════════════════

document.getElementById('zoom-in').addEventListener('click', () =>
  svgD3.transition().duration(250).call(zoomBehaviour.scaleBy, 1.4));
document.getElementById('zoom-out').addEventListener('click', () =>
  svgD3.transition().duration(250).call(zoomBehaviour.scaleBy, 0.7));
document.getElementById('zoom-fit').addEventListener('click', () => {
  if (!gMain) return;
  const { w, h } = graphDimensions();
  const bbox = gMain.node().getBBox();
  if (!bbox || bbox.width === 0 || bbox.height === 0) return;
  const pad    = 40;
  const scaleX = (w - pad * 2) / bbox.width;
  const scaleY = (h - pad * 2) / bbox.height;
  const scale  = Math.min(scaleX, scaleY, 2);
  const tx     = w / 2 - scale * (bbox.x + bbox.width  / 2);
  const ty     = h / 2 - scale * (bbox.y + bbox.height / 2);
  svgD3.transition().duration(400).call(
    zoomBehaviour.transform,
    d3.zoomIdentity.translate(tx, ty).scale(scale)
  );
});

// ═══════════════════════════════════════════════════════════════
// SIDEBAR UPDATE
// ═══════════════════════════════════════════════════════════════

function updateSidebar(data) {
  const hasContent = data.tableNodes.length || data.cteNodes.length;

  document.getElementById('stats-section').style.display        = hasContent ? '' : 'none';
  document.getElementById('tables-section').style.display       = data.tableNodes.length ? '' : 'none';
  document.getElementById('ctes-section').style.display         = data.cteNodes.length   ? '' : 'none';
  document.getElementById('schema-legend-section').style.display = data.tableNodes.length ? '' : 'none';

  // Stats
  document.getElementById('table-count').textContent = data.tableNodes.length;
  document.getElementById('cte-count').textContent   = data.cteNodes.length;
  document.getElementById('edge-count').textContent  = data.edges.length;

  // Table list
  const ul = document.getElementById('table-list');
  ul.innerHTML = '';
  [...data.tableNodes].sort((a, b) => a.id.localeCompare(b.id)).forEach(node => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="dot" style="background:${node.color}"></span>${node.label}<span class="badge">${node.degree} join${node.degree !== 1 ? 's' : ''}</span>`;
    ul.appendChild(li);
  });

  // CTE list
  const cteListEl = document.getElementById('cte-list');
  cteListEl.innerHTML = '';
  data.cteNodes.forEach(cte => {
    const div = document.createElement('div');
    div.className = 'cte-item';
    div.innerHTML = `
      <div class="cte-item-header">
        \u2b21 ${cte.label}
        <span class="cte-badge">${cte.tables.length} table${cte.tables.length !== 1 ? 's' : ''}</span>
      </div>
      <div class="cte-item-tables">
        ${cte.tables.map(t => `<div class="cte-item-table">\u25b8 ${t}</div>`).join('')}
      </div>`;
    cteListEl.appendChild(div);
  });

  // Schema legend
  const legendEl = document.getElementById('schema-legend');
  legendEl.innerHTML = '';
  const schemaMap = new Map();
  data.tableNodes.forEach(n => { const s = n.schema || '(no schema)'; if (!schemaMap.has(s)) schemaMap.set(s, n.color); });
  schemaMap.forEach((color, schema) => {
    const row = document.createElement('div');
    row.className = 'legend-row';
    row.innerHTML = `<div class="legend-swatch" style="background:${color}"></div>${schema}`;
    legendEl.appendChild(row);
  });
}

// ═══════════════════════════════════════════════════════════════
// EXAMPLE SQL
// ═══════════════════════════════════════════════════════════════

const EXAMPLE_SQL = `-- Regional sales dashboard
/* Author: analytics team
   FROM fake_comment_table  -- should NOT appear in results
*/
WITH
    region_stats AS (
        SELECT r.region_id, SUM(o.total_amount) AS total_revenue
        FROM public.orders o
        JOIN public.regions r ON o.region_id = r.region_id
        WHERE o.status NOT IN ('FROM_CACHE', 'cancelled')
        GROUP BY r.region_id
    ),
    top_products AS (
        SELECT oi.product_id, SUM(oi.quantity) AS total_qty
        FROM \`order_items\` oi
        JOIN "products" p ON oi.product_id = p.product_id
        GROUP BY oi.product_id
    )
SELECT rs.region_name, tp.name, c.name, e.full_name
FROM region_stats rs
LEFT JOIN top_products tp ON tp.rank = 1
LEFT JOIN analytics.product_categories c ON tp.product_id = c.product_id
LEFT JOIN (
    SELECT employee_id, full_name, region_id
    FROM hr.employees
    WHERE role = 'account_manager'
) e ON e.region_id = rs.region_id
WHERE EXISTS (
    SELECT 1 FROM finance.revenue_targets rt
    WHERE rt.region_id = rs.region_id
)
UNION ALL
SELECT 'UNASSIGNED', NULL, NULL, NULL
FROM public.orders o
WHERE o.region_id IS NULL;`;

// ═══════════════════════════════════════════════════════════════
// EVENT WIRING
// ═══════════════════════════════════════════════════════════════

function analyze() {
  const sql  = document.getElementById('sql-input').value;
  const data = parseSQL(sql);
  render(data);
  updateSidebar(data);
}

document.getElementById('analyze-btn').addEventListener('click', analyze);
document.getElementById('sql-input').addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') analyze(); });
document.getElementById('example-btn').addEventListener('click', () => { document.getElementById('sql-input').value = EXAMPLE_SQL; analyze(); });
document.getElementById('clear-btn').addEventListener('click', () => {
  document.getElementById('sql-input').value = '';
  svgD3.selectAll('*').remove();
  document.getElementById('empty-state').querySelector('p').textContent = 'Paste a SQL query and click Analyze';
  document.getElementById('empty-state').style.display = 'flex';
  ['stats-section','tables-section','ctes-section','schema-legend-section'].forEach(id => {
    document.getElementById(id).style.display = 'none';
  });
});
window.addEventListener('resize', () => { if (document.getElementById('sql-input').value.trim()) analyze(); });

// ── URL hash loading: project page opens this page with base64 SQL ──
window.addEventListener('load', () => {
  const hash = location.hash.slice(1);
  if (!hash) return;
  try {
    const sql = atob(hash);
    document.getElementById('sql-input').value = sql;
    analyze();
  } catch (e) {
    console.warn('Could not decode hash payload:', e);
  }
});
