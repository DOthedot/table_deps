'use strict';

// ═══════════════════════════════════════════════════════════════
// CONSTANTS  (colors.js → schemaColor,  sql_parser.js → SQL_KEYWORDS + FROM_JOIN_RE)
// ═══════════════════════════════════════════════════════════════

const JOIN_COLORS = {
  INNER: '#94a3b8', LEFT: '#3fb950', RIGHT: '#f97316',
  FULL:  '#bc8cff', CROSS: '#f85149', UNION: '#39d0d8',
};
const CTE_COLOR = '#a78bfa';

// ── Table box geometry (exact same values as project overview) ──
const HDR_H = 36, ROW_H = 19, PAD_V = 9, PAD_H = 14;
const MIN_W = 195, MAX_W = 270;

// ── CTE box geometry ──
const CTE_MIN_W = 180, CTE_HDR_H = 30, CTE_PAD_B = 10;
// ── Mini table-box inside CTE ──
const MINI_HDR = 22, MINI_ROW = 15, MINI_PAD = 5, MINI_GAP = 8;

// ═══════════════════════════════════════════════════════════════
// GEOMETRY HELPERS
// ═══════════════════════════════════════════════════════════════

function normName(raw) { return raw.replace(/[`"\[\]]/g, '').toLowerCase(); }
function getSchema(n)  { const p = n.split('.'); return p.length > 1 ? p[0] : null; }

function joinTypeOf(kw, mod) {
  kw  = (kw  || '').trim().toUpperCase();
  mod = (mod || '').trim().toUpperCase();
  if (kw === 'FROM')       return 'FROM';
  if (/LEFT/.test(mod))    return 'LEFT';
  if (/RIGHT/.test(mod))   return 'RIGHT';
  if (/FULL/.test(mod))    return 'FULL';
  if (/CROSS/.test(mod))   return 'CROSS';
  return 'INNER';
}

// Table box — same formula as project.js boxW / boxH
function tblSize(node) {
  const cols = node.columns || [];
  const longest = Math.max(node.label.length, ...(cols.length ? cols.map(c => c.length) : [0]));
  const w = Math.min(MAX_W, Math.max(MIN_W, Math.min(longest, 30) * 6.9 + PAD_H * 2));
  const h = HDR_H + (cols.length > 0 ? PAD_V + cols.length * ROW_H + PAD_V : PAD_V);
  return { w, h };
}

// Height of one mini table-box inside a CTE
function miniBoxH(cols) {
  return MINI_HDR + (cols.length > 0 ? MINI_PAD + cols.length * MINI_ROW + MINI_PAD : MINI_PAD);
}

// CTE box — sized to contain inner mini-graph without overlap
function cteSize(node) {
  const tableColumns = node.tableColumns || new Map();
  // Estimate widest mini-node (tbl chars * ~6.2 + padding, also accounting for columns)
  let maxNodeW = 90;
  for (const t of node.tables) {
    const tbl = t.split('.').at(-1);
    const cols = tableColumns.get(t) || [];
    const longestCol = cols.length ? Math.max(...cols.map(c => c.length)) : 0;
    maxNodeW = Math.max(maxNodeW, tbl.length * 6.2 + 16, longestCol * 6.2 + 30);
  }
  // Estimate tallest mini-node
  let maxNodeH = MINI_HDR + MINI_PAD * 2;
  for (const t of node.tables) {
    const cols = tableColumns.get(t) || [];
    maxNodeH = Math.max(maxNodeH, MINI_HDR + (cols.length ? MINI_PAD + cols.length * MINI_ROW + MINI_PAD : MINI_PAD));
  }
  const n = node.tables.length;
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const innerW = Math.max(260, cols * (maxNodeW + 60));
  const innerH = Math.max(200, rows * (maxNodeH + 60));
  return { w: innerW + 20, h: CTE_HDR_H + innerH + 15 };
}

// Absolute y of a column row's centre, relative to node centre
function colRowY(node, colName) {
  const idx = (node.columns || []).indexOf(colName);
  if (idx < 0) return 0;
  const { h } = tblSize(node);
  return -h / 2 + HDR_H + PAD_V + (idx + 0.5) * ROW_H;
}

// ═══════════════════════════════════════════════════════════════
// SQL PARSING  — complete rewrite
// ═══════════════════════════════════════════════════════════════

function parseSQL(raw) {
  if (!raw || !raw.trim()) return { tableNodes: [], cteNodes: [], edges: [] };

  // 1 ── strip comments + string literals
  let sql = raw
    .replace(/--[^\n]*/g,         ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'(?:[^'\\]|\\.)*'/g,"''");

  // 2 ── collect CTE names
  const cteNames = new Set();
  for (const m of sql.matchAll(/\b(\w+)\s+AS\s*\(/gi)) {
    const n = normName(m[1]);
    if (!SQL_KEYWORDS.has(n)) cteNames.add(n);
  }

  // 3 ── balanced-paren extractor (returns [start, end] of body inside outer parens)
  function extractBody(sqlStr, openIdx) {
    let depth = 0, end = sqlStr.length;
    for (let i = openIdx; i < sqlStr.length; i++) {
      if (sqlStr[i] === '(') depth++;
      else if (sqlStr[i] === ')' && --depth === 0) { end = i; break; }
    }
    return end;
  }

  // 4 ── alias map:  alias → real table name
  const aliasMap = new Map();

  // a) simple:  FROM/JOIN table [AS] alias
  for (const m of sql.matchAll(
    /\b(?:FROM|JOIN)\s+([`"\[]?[\w]+[`"\]]?(?:\.[`"\[]?[\w]+[`"\]]?)*)\s+(?:AS\s+)?([a-zA-Z_]\w*)\b/gi
  )) {
    const tname = normName(m[1]), alias = normName(m[2]);
    if (!SQL_KEYWORDS.has(alias) && alias !== tname && !cteNames.has(alias))
      aliasMap.set(alias, tname);
  }

  // b) subquery:  JOIN (...) [AS] alias  →  inner FROM table + SELECT columns
  const subqueryCols = new Map(); // innerTable → [col, ...]
  for (const m of sql.matchAll(/\bJOIN\s*\(/gi)) {
    const openIdx = m.index + m[0].length - 1;
    const endIdx  = extractBody(sql, openIdx);
    const after   = sql.slice(endIdx + 1).match(/^\s*(?:AS\s+)?([a-zA-Z_]\w*)/i);
    if (!after) continue;
    const alias = normName(after[1]);
    if (SQL_KEYWORDS.has(alias) || cteNames.has(alias)) continue;
    const body  = sql.slice(openIdx + 1, endIdx);
    const inner = body.match(/\bFROM\s+([`"\[]?[\w]+[`"\]]?(?:\.[`"\[]?[\w]+[`"\]]?)*)/i);
    if (!inner) continue;
    const innerTable = normName(inner[1]);
    aliasMap.set(alias, innerTable);

    // Parse SELECT list to get all columns exposed by this subquery
    const selMatch = body.match(/\bSELECT\s+([\s\S]+?)\s+FROM\b/i);
    if (selMatch) {
      const cols = [];
      for (const part of selMatch[1].split(',')) {
        const p = part.trim();
        // AS alias takes priority: col AS alias
        const asM = p.match(/\bAS\s+([`"\[]?\w+[`"\]]?)\s*$/i);
        if (asM) { cols.push(normName(asM[1])); continue; }
        // table.col  →  col
        const qualM = p.match(/[\w`"\[\]]+\s*\.\s*([`"\[]?\w+[`"\]]?)\s*$/);
        if (qualM) { cols.push(normName(qualM[1])); continue; }
        // plain col name
        const plainM = p.match(/([`"\[]?\w+[`"\]]?)\s*$/);
        if (plainM) {
          const n = normName(plainM[1]);
          if (n !== '*' && !SQL_KEYWORDS.has(n)) cols.push(n);
        }
      }
      if (cols.length) subqueryCols.set(innerTable, cols);
    }
  }

  function resolve(name) { return aliasMap.get(name) || name; }

  // 5 ── extract CTE bodies + internal deps
  const cteBodyRanges = [];
  const cteBodyData   = new Map();

  for (const m of sql.matchAll(/\b(\w+)\s+AS\s*\(/gi)) {
    const name    = normName(m[1]);
    if (!cteNames.has(name)) continue;
    const openIdx = m.index + m[0].length - 1;
    const endIdx  = extractBody(sql, openIdx);
    cteBodyRanges.push({ start: openIdx + 1, end: endIdx });
    const body    = sql.slice(openIdx + 1, endIdx);
    const tokens  = [];
    for (const tm of body.matchAll(FROM_JOIN_RE())) {
      const tname = normName(tm[3]);
      if (SQL_KEYWORDS.has(tname) || /^\d+$/.test(tname) || cteNames.has(tname)) continue;
      tokens.push({ name: tname, type: joinTypeOf(tm[1], tm[2]) });
    }
    // Build alias map within this CTE body
    const cteAliasMap = new Map();
    for (const am of body.matchAll(/\b(?:FROM|JOIN)\s+([\w.`"\[\]]+)\s+(?:AS\s+)?(\w+)\b/gi)) {
      const tn = normName(am[1]), al = normName(am[2]);
      if (!SQL_KEYWORDS.has(al) && al !== tn) cteAliasMap.set(al, tn);
    }
    // Collect all alias.col references inside the CTE body
    const tableColumnsInCTE = new Map();
    for (const cm of body.matchAll(/\b(\w+)\.(\w+)\b/gi)) {
      const t   = cteAliasMap.get(normName(cm[1])) || normName(cm[1]);
      const col = normName(cm[2]);
      if (SQL_KEYWORDS.has(col) || SQL_KEYWORDS.has(t)) continue;
      if (!tableColumnsInCTE.has(t)) tableColumnsInCTE.set(t, []);
      const list = tableColumnsInCTE.get(t);
      if (!list.includes(col)) list.push(col);
    }

    // For single-FROM-table CTE bodies, also capture bare SELECT column names
    {
      const hasJoin = /\bJOIN\b/i.test(body);
      if (!hasJoin) {
        const fmMatch = body.match(/\bFROM\s+([\w.`"\[\]]+)/i);
        if (fmMatch) {
          const singleT = cteAliasMap.get(normName(fmMatch[1])) || normName(fmMatch[1]);
          // Find SELECT…FROM in the body
          const upBody = body.toUpperCase();
          let si = -1, fi = -1, dep = 0;
          for (let i = 0; i < body.length; i++) {
            if (body[i] === '(') { dep++; continue; }
            if (body[i] === ')') { dep--; continue; }
            if (dep !== 0) continue;
            const bef = i === 0 || /\W/.test(body[i-1]);
            if (si === -1 && upBody.slice(i,i+6) === 'SELECT' && bef && /\s/.test(body[i+6]||' ')) { si = i+6; continue; }
            if (si !== -1 && upBody.slice(i,i+4) === 'FROM'   && bef && /\W/.test(body[i+4]||' ')) { fi = i; break; }
          }
          if (si >= 0 && fi >= 0) {
            const clause = body.slice(si, fi);
            const items = []; let cur2 = '', d2 = 0;
            for (const ch of clause) {
              if (ch === '(') { d2++; cur2 += ch; }
              else if (ch === ')') { d2--; cur2 += ch; }
              else if (ch === ',' && d2 === 0) { items.push(cur2.trim()); cur2 = ''; }
              else cur2 += ch;
            }
            if (cur2.trim()) items.push(cur2.trim());
            if (!tableColumnsInCTE.has(singleT)) tableColumnsInCTE.set(singleT, []);
            const list = tableColumnsInCTE.get(singleT);
            for (const part of items) {
              if (!part) continue;
              // AS alias → use alias as col name; else take last identifier
              const asM2 = part.match(/\bAS\s+([`"\[]?\w+[`"\]]?)\s*$/i);
              const colN = asM2
                ? normName(asM2[1])
                : (() => { const pm = part.match(/([`"\[]?\w+[`"\]]?)\s*$/); return pm ? normName(pm[1]) : null; })();
              if (colN && !SQL_KEYWORDS.has(colN) && colN !== '*' && !list.includes(colN))
                list.push(colN);
            }
          }
        }
      }
    }

    // Wire sourceCol/targetCol on internal edges from ON conditions in the CTE body
    const internalEdges = buildInternalEdges(tokens);
    const cteJoinColMap = new Map();
    for (const m of body.matchAll(/\b([\w]+)\.([\w]+)\s*=\s*([\w]+)\.([\w]+)/gi)) {
      const t1 = cteAliasMap.get(normName(m[1])) || normName(m[1]), c1 = normName(m[2]);
      const t2 = cteAliasMap.get(normName(m[3])) || normName(m[3]), c2 = normName(m[4]);
      if (!cteJoinColMap.has(t1)) cteJoinColMap.set(t1, []);
      if (!cteJoinColMap.has(t2)) cteJoinColMap.set(t2, []);
      cteJoinColMap.get(t1).push({ col: c1, peer: t2, peerCol: c2 });
      cteJoinColMap.get(t2).push({ col: c2, peer: t1, peerCol: c1 });
    }
    for (const edge of internalEdges) {
      const srcConds = cteJoinColMap.get(edge.source) || [];
      const tgtConds = cteJoinColMap.get(edge.target) || [];
      const direct = srcConds.find(c => c.peer === edge.target);
      if (direct) { edge.sourceCol = direct.col; edge.targetCol = direct.peerCol; }
      else {
        if (srcConds.length) edge.sourceCol = srcConds[0].col;
        if (tgtConds.length) edge.targetCol = tgtConds[0].col;
      }
    }

    cteBodyData.set(name, {
      tables:        [...new Set(tokens.map(t => t.name))],
      internalEdges,
      tableColumns:  tableColumnsInCTE,
    });
  }

  function inCTE(idx) { return cteBodyRanges.some(r => idx >= r.start && idx <= r.end); }

  // 6 ── paren depth at every character position
  const depthAt = new Array(sql.length).fill(0);
  { let d = 0;
    for (let i = 0; i < sql.length; i++) {
      depthAt[i] = d;
      if      (sql[i] === '(') d++;
      else if (sql[i] === ')') d = Math.max(0, d - 1);
    }
  }

  // 7 ── main-query FROM/JOIN tokens
  const mainToks = [];
  for (const m of sql.matchAll(FROM_JOIN_RE())) {
    if (inCTE(m.index)) continue;
    const name = normName(m[3]);
    if (SQL_KEYWORDS.has(name) || /^\d+$/.test(name)) continue;
    mainToks.push({
      name, type: joinTypeOf(m[1], m[2]),
      isCTE: cteNames.has(name),
      depth: depthAt[m.index],
      pos:   m.index,
    });
  }

  // 8 ── build node maps
  const tableMap = new Map();
  const cteMap   = new Map();

  for (const t of mainToks) {
    if (t.isCTE) {
      if (!cteMap.has(t.name) && cteBodyData.has(t.name)) {
        const bd = cteBodyData.get(t.name);
        cteMap.set(t.name, {
          id: t.name, label: t.name, type: 'cte',
          tables: bd.tables, internalEdges: bd.internalEdges,
          tableColumns: bd.tableColumns, degree: 0,
        });
      }
    } else if (!tableMap.has(t.name)) {
      tableMap.set(t.name, {
        id: t.name, label: t.name, type: 'table',
        schema: getSchema(t.name), color: schemaColor(getSchema(t.name)),
        degree: 0, columns: [],
      });
    }
  }

  // 9 ── build edges (FROM-as-hub model)
  const edgeMap = new Map();
  let fromTok = null, pseudoHub = null, lastType = 'INNER';

  function getNode(name) { return tableMap.get(name) || cteMap.get(name); }

  function addEdge(src, tgt, type) {
    if (!getNode(src) || !getNode(tgt)) return;
    const key = [src, tgt].sort().join('\x00') + '\x00' + type;
    if (edgeMap.has(key)) return;
    edgeMap.set(key, {
      source: src, target: tgt,
      type,  color: JOIN_COLORS[type] || JOIN_COLORS.INNER,
      sourceCol: null, targetCol: null,
    });
    getNode(src).degree++;
    getNode(tgt).degree++;
  }

  for (const tok of mainToks) {
    if (!getNode(tok.name)) continue;
    if (tok.depth === 0) {
      if (tok.type === 'FROM') { fromTok = tok; pseudoHub = null; lastType = 'INNER'; }
      else {
        lastType = tok.type;
        const hub = fromTok || pseudoHub;
        if (hub) addEdge(tok.name, hub.name, tok.type);
        if (!fromTok && !pseudoHub) pseudoHub = tok;
      }
    } else if (tok.depth === 1 && tok.type === 'FROM' && !tok.isCTE) {
      const hub = fromTok || pseudoHub;
      if (hub) addEdge(tok.name, hub.name, lastType);
    }
  }

  // UNION edges
  for (const m of sql.matchAll(/\bUNION\b/gi)) {
    if (inCTE(m.index) || depthAt[m.index] !== 0) continue;
    const d0 = mainToks.filter(t => t.depth === 0 && t.type === 'FROM');
    const prev = [...d0].filter(t => t.pos < m.index).at(-1);
    const next = d0.find(t => t.pos > m.index);
    if (prev && next) addEdge(prev.name, next.name, 'UNION');
  }

  // 10 ── apply subquery SELECT columns to inner tables
  for (const [tname, cols] of subqueryCols) {
    const node = tableMap.get(tname);
    if (!node) continue;
    for (const col of cols)
      if (!node.columns.includes(col)) node.columns.push(col);
  }

  // 11 ── collect ALL qualified column references: alias.col everywhere in the SQL
  //  (SELECT list, WHERE, ON, GROUP BY, ORDER BY, HAVING — everything)
  for (const m of sql.matchAll(/\b([\w]+)\.([\w]+)\b/gi)) {
    const t   = resolve(normName(m[1]));
    const col = normName(m[2]);
    if (SQL_KEYWORDS.has(col)) continue;
    const node = tableMap.get(t);
    if (node && !node.columns.includes(col)) node.columns.push(col);
  }

  // 12 ── wire sourceCol / targetCol on edges from equality join conditions
  // Build per-table join-col map: table → [{col, peer, peerCol}]
  const joinColMap = new Map();
  for (const m of sql.matchAll(/\b([\w]+)\.([\w]+)\s*=\s*([\w]+)\.([\w]+)/gi)) {
    const t1 = resolve(normName(m[1])), c1 = normName(m[2]);
    const t2 = resolve(normName(m[3])), c2 = normName(m[4]);
    if (!joinColMap.has(t1)) joinColMap.set(t1, []);
    if (!joinColMap.has(t2)) joinColMap.set(t2, []);
    joinColMap.get(t1).push({ col: c1, peer: t2, peerCol: c2 });
    joinColMap.get(t2).push({ col: c2, peer: t1, peerCol: c1 });
  }
  for (const edge of edgeMap.values()) {
    const srcConds = joinColMap.get(edge.source) || [];
    const tgtConds = joinColMap.get(edge.target) || [];
    // Prefer a condition where both endpoints match (direct join pair)
    const direct = srcConds.find(c => c.peer === edge.target);
    if (direct) {
      edge.sourceCol = direct.col;
      edge.targetCol = direct.peerCol;
    } else {
      // Hub-spoke: assign best available col to each endpoint independently
      if (srcConds.length) edge.sourceCol = srcConds[0].col;
      if (tgtConds.length) edge.targetCol = tgtConds[0].col;
    }
  }

  return {
    tableNodes: [...tableMap.values()],
    cteNodes:   [...cteMap.values()],
    edges:      [...edgeMap.values()],
  };
}

function buildInternalEdges(tokens) {
  const seen = new Map();
  let fromTok = null, pseudo = null;
  for (const tok of tokens) {
    if (tok.type === 'FROM') { fromTok = tok; pseudo = null; }
    else {
      const hub = fromTok || pseudo;
      if (hub) {
        const key = [hub.name, tok.name].sort().join('\x00') + '\x00' + tok.type;
        if (!seen.has(key)) seen.set(key, { source: hub.name, target: tok.name, type: tok.type });
      }
      if (!fromTok && !pseudo) pseudo = tok;
    }
  }
  return [...seen.values()];
}

// ═══════════════════════════════════════════════════════════════
// EDGE ENDPOINT — exits from column row for table boxes
// ═══════════════════════════════════════════════════════════════

function edgeEndpoint(n, dx, dy, colName) {
  if (n.type === 'table') {
    const { w, h } = tblSize(n);
    const ry = (colName && (n.columns || []).includes(colName)) ? colRowY(n, colName) : 0;
    if (Math.abs(dx) >= Math.abs(dy) * 0.3)
      return { x: n.x + (dx > 0 ? w / 2 : -w / 2), y: n.y + ry };
    return { x: n.x, y: n.y + (dy > 0 ? h / 2 : -h / 2) };
  }
  // CTE — rectangle intersection
  const { w, h } = cteSize(n);
  const dist = Math.sqrt(dx * dx + dy * dy) || 1;
  const nx = dx / dist, ny = dy / dist;
  const t  = Math.min(
    nx !== 0 ? Math.abs((w / 2) / nx) : Infinity,
    ny !== 0 ? Math.abs((h / 2) / ny) : Infinity
  );
  return { x: n.x + nx * t, y: n.y + ny * t };
}

// ═══════════════════════════════════════════════════════════════
// RENDER BOX — project.js renderBox, adapted for table nodes
// ═══════════════════════════════════════════════════════════════

function renderTableBox(sel, node) {
  const { w, h } = tblSize(node);
  const x = -w / 2, y = -h / 2;
  const color  = node.color;
  const parts  = node.label.split('.');
  const schema = parts.length > 1 ? parts[0] : '';
  const tname  = parts[parts.length - 1];
  const cols   = node.columns || [];

  // Background
  sel.append('rect')
    .attr('x', x).attr('y', y).attr('width', w).attr('height', h)
    .attr('rx', 8)
    .attr('fill', color + '15')
    .attr('stroke', color).attr('stroke-width', 1.5);

  // Header band
  sel.append('rect')
    .attr('x', x).attr('y', y).attr('width', w).attr('height', HDR_H)
    .attr('rx', 8).attr('fill', color + '2e');
  sel.append('rect')   // square off bottom corners of header band
    .attr('x', x).attr('y', y + HDR_H - 8).attr('width', w).attr('height', 8)
    .attr('fill', color + '2e');

  // Header text: schema. (dimmed) + tablename (bright) — left-aligned
  const schW = schema.length * 6.5;
  if (schema) {
    sel.append('text')
      .attr('x', x + PAD_H - 2).attr('y', y + HDR_H / 2)
      .attr('dominant-baseline', 'middle')
      .attr('fill', color + 'aa')
      .attr('font-size', '10px').attr('font-weight', '600')
      .attr('font-family', "'SF Mono','Fira Code',monospace")
      .text(schema + '.');
  }
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

  // Column rows — dot + left-aligned name (exact project.js dep-row layout)
  cols.forEach((col, i) => {
    const ry = y + HDR_H + PAD_V + (i + 0.5) * ROW_H;
    sel.append('circle')
      .attr('cx', x + 12).attr('cy', ry).attr('r', 3)
      .attr('fill', color);
    sel.append('text')
      .attr('x', x + 21).attr('y', ry)
      .attr('dominant-baseline', 'middle')
      .attr('fill', '#111111').attr('font-size', '9.5px')
      .attr('font-family', "'SF Mono',monospace")
      .text(col.length > 31 ? col.slice(0, 29) + '\u2026' : col);
  });
}

// ═══════════════════════════════════════════════════════════════
// D3 GRAPH
// ═══════════════════════════════════════════════════════════════

const svgEl     = document.getElementById('graph');
const svgD3     = d3.select(svgEl);
const tooltip   = document.getElementById('tooltip');
const container = document.getElementById('graph-container');

let gMain, zoomBehaviour, currentSimulation;
function dims() { return { w: container.clientWidth, h: container.clientHeight }; }

function initSVG() {
  svgD3.selectAll('*').remove();
  const { w, h } = dims();
  svgD3.attr('viewBox', [0, 0, w, h]);
  zoomBehaviour = d3.zoom()
    .scaleExtent([0.05, 6])
    .on('zoom', e => gMain.attr('transform', e.transform));
  svgD3.call(zoomBehaviour);
  const defs = svgD3.append('defs');
  for (const [type, color] of Object.entries(JOIN_COLORS)) {
    defs.append('marker')
      .attr('id', `arr-${type}`).attr('viewBox', '0 -5 10 10')
      .attr('refX', 10).attr('refY', 0)
      .attr('markerWidth', 6).attr('markerHeight', 6).attr('orient', 'auto')
      .append('path').attr('d', 'M0,-5L10,0L0,5').attr('fill', color).attr('opacity', 0.8);
  }
  gMain = svgD3.append('g');
}

function render(data) {
  const emptyEl = document.getElementById('empty-state');
  if (!data.tableNodes.length && !data.cteNodes.length) {
    emptyEl.querySelector('p').textContent = 'No tables found in the SQL query.';
    emptyEl.style.display = 'flex'; return;
  }
  emptyEl.style.display = 'none';
  initSVG();
  const { w, h } = dims();

  const allNodes = [
    ...data.tableNodes.map(d => ({ ...d })),
    ...data.cteNodes.map(d => ({ ...d })),
  ];
  const byId = new Map(allNodes.map(n => [n.id, n]));

  const edges = data.edges.map(e => ({
    ...e,
    source: byId.get(e.source) || e.source,
    target: byId.get(e.target) || e.target,
  }));

  if (currentSimulation) currentSimulation.stop();

  currentSimulation = d3.forceSimulation(allNodes)
    .force('link',      d3.forceLink(edges).id(d => d.id).distance(264).strength(0.5))
    .force('charge',    d3.forceManyBody().strength(-900))
    .force('center',    d3.forceCenter(w / 2, h / 2))
    .force('collision', d3.forceCollide().radius(d => {
      const { w: bw, h: bh } = d.type === 'table' ? tblSize(d) : cteSize(d);
      return Math.sqrt(bw * bw + bh * bh) / 2 + 20;
    }));

  // ── Edges ────────────────────────────────────
  const linkSel = gMain.append('g').selectAll('line').data(edges).join('line')
    .attr('class', 'link')
    .attr('stroke', d => d.color)
    .attr('stroke-width', 1.5)
    .attr('stroke-dasharray', d => d.type === 'UNION' ? '8,4' : null)
    .attr('marker-end', d => d.type === 'UNION' ? null : `url(#arr-${d.type})`);

  const linkLabelGrp = gMain.append('g').selectAll('text')
    .data(edges.filter(e => e.type !== 'FROM')).join('text')
    .attr('class', 'link-label')
    .text(d => d.type);

  const srcColLabelSel = gMain.append('g').selectAll('text')
    .data(edges.filter(e => e.sourceCol)).join('text')
    .attr('class', 'col-endpoint-label')
    .text(d => d.sourceCol);

  const tgtColLabelSel = gMain.append('g').selectAll('text')
    .data(edges.filter(e => e.targetCol)).join('text')
    .attr('class', 'col-endpoint-label')
    .text(d => d.targetCol);

  // ── Drag ────────────────────────────────────
  const drag = d3.drag()
    .on('start', (e, d) => { if (!e.active) currentSimulation.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
    .on('drag',  (e, d) => { d.fx = e.x; d.fy = e.y; })
    .on('end',   (e, d) => { if (!e.active) currentSimulation.alphaTarget(0); d.fx = null; d.fy = null; });

  // ── Tooltip ──────────────────────────────────
  function onEnter(event, d) {
    if (d.type === 'cte') {
      document.getElementById('tt-name').textContent   = d.label + '  (CTE)';
      document.getElementById('tt-label1').textContent = 'Tables inside';
      document.getElementById('tt-val1').textContent   = d.tables.length;
    } else {
      document.getElementById('tt-name').textContent   = d.label;
      document.getElementById('tt-label1').textContent = 'Schema';
      document.getElementById('tt-val1').textContent   = d.schema || '(none)';
    }
    document.getElementById('tt-degree').textContent = d.degree;
    tooltip.style.display = 'block';
    positionTooltip(event);
  }

  // ── Table nodes ──────────────────────────────
  const tblNodes  = allNodes.filter(d => d.type === 'table');
  const tblNodeSel = gMain.append('g').selectAll('g').data(tblNodes).join('g')
    .attr('class', 'table-node')
    .call(drag)
    .on('mouseenter', onEnter)
    .on('mousemove',  positionTooltip)
    .on('mouseleave', () => { tooltip.style.display = 'none'; });

  tblNodeSel.each(function(d) { renderTableBox(d3.select(this), d); });

  // ── CTE nodes (purple box — unchanged style) ─
  const cteNodes  = allNodes.filter(d => d.type === 'cte');
  const cteNodeSel = gMain.append('g').selectAll('g').data(cteNodes).join('g')
    .attr('class', 'cte-node')
    .call(drag)
    .on('mouseenter', onEnter)
    .on('mousemove',  positionTooltip)
    .on('mouseleave', () => { tooltip.style.display = 'none'; });

  cteNodeSel.each(function(d) {
    const el = d3.select(this);
    const { w, h } = cteSize(d);
    const x = -w / 2, y = -h / 2;

    // Outer CTE box
    el.append('rect')
      .attr('x', x).attr('y', y).attr('width', w).attr('height', h)
      .attr('rx', 8).attr('fill', CTE_COLOR + '12').attr('stroke', CTE_COLOR).attr('stroke-width', 1.5);
    el.append('rect')
      .attr('x', x).attr('y', y).attr('width', w).attr('height', CTE_HDR_H)
      .attr('rx', 8).attr('fill', CTE_COLOR + '2a');
    el.append('rect')
      .attr('x', x).attr('y', y + CTE_HDR_H - 8).attr('width', w).attr('height', 8)
      .attr('fill', CTE_COLOR + '2a');
    el.append('text')
      .attr('x', 0).attr('y', y + CTE_HDR_H / 2)
      .attr('text-anchor', 'middle').attr('dominant-baseline', 'middle')
      .attr('fill', CTE_COLOR).attr('font-size', '11px').attr('font-weight', '700')
      .attr('font-family', "'SF Mono','Fira Code',monospace")
      .text(d.label);
    el.append('text')
      .attr('x', x + w - 7).attr('y', y + 10)
      .attr('text-anchor', 'end').attr('dominant-baseline', 'middle')
      .attr('fill', CTE_COLOR + '99').attr('font-size', '8px').attr('font-family', 'sans-serif')
      .text('CTE');
    el.append('line')
      .attr('x1', x + 10).attr('y1', y + CTE_HDR_H)
      .attr('x2', x + w - 10).attr('y2', y + CTE_HDR_H)
      .attr('stroke', CTE_COLOR + '55').attr('stroke-width', 1);

    // ── Inner mini-graph ──────────────────────────
    const innerPad = 12;
    const innerX = x + innerPad, innerY = y + CTE_HDR_H + innerPad;
    const innerW = w - innerPad * 2, innerH = h - CTE_HDR_H - innerPad * 2;
    const cx = innerX + innerW / 2, cy = innerY + innerH / 2;

    // Clip inner graph to CTE body
    const clipId = 'cte-clip-' + d.id.replace(/\W/g, '_');
    el.append('clipPath').attr('id', clipId)
      .append('rect')
        .attr('x', innerX).attr('y', innerY)
        .attr('width', innerW).attr('height', innerH).attr('rx', 5);

    const innerG = el.append('g').attr('clip-path', `url(#${clipId})`);

    const tableColumns = d.tableColumns || new Map();

    // Pre-compute per-node box sizes, store on node data for collision + clamping
    const miniNodes = d.tables.map(tname => {
      const cols   = tableColumns.get(tname) || [];
      const parts  = tname.split('.');
      const schema = parts.length > 1 ? parts[0] : '';
      const tbl    = parts[parts.length - 1];
      const color  = schemaColor(tname.split('.')[0] || null);
      const longestCol = cols.length ? Math.max(...cols.map(c => c.length)) : 0;
      const mw     = Math.max(90, tbl.length * 6.2 + 16, longestCol * 6.2 + 30);
      const mh     = MINI_HDR + (cols.length ? MINI_PAD + cols.length * MINI_ROW + MINI_PAD : MINI_PAD);
      return {
        id: tname, tbl, schema, color, cols, mw, mh,
        x: cx + (Math.random() - 0.5) * innerW * 0.4,
        y: cy + (Math.random() - 0.5) * innerH * 0.4,
      };
    });

    // Single-node CTE: expand node to fill the inner box
    if (miniNodes.length === 1) {
      const sp = 16;
      miniNodes[0].mw = Math.max(miniNodes[0].mw, innerW - sp * 2);
      miniNodes[0].mh = Math.max(miniNodes[0].mh, innerH - sp * 2);
      miniNodes[0].x  = cx;
      miniNodes[0].y  = cy;
    }

    const miniLinks = (d.internalEdges || []).map(e => ({
      source: e.source, target: e.target, type: e.type,
      color: JOIN_COLORS[e.type] || JOIN_COLORS.INNER,
      sourceCol: e.sourceCol || null, targetCol: e.targetCol || null,
    }));

    // Clamp helper — keeps node fully inside inner bounds
    function clampMini(n) {
      n.x = Math.max(innerX + n.mw / 2 + 4, Math.min(innerX + innerW - n.mw / 2 - 4, n.x));
      n.y = Math.max(innerY + n.mh / 2 + 4, Math.min(innerY + innerH - n.mh / 2 - 4, n.y));
    }

    const miniSim = d3.forceSimulation(miniNodes)
      .force('link', d3.forceLink(miniLinks).id(n => n.id)
        .distance(Math.min(innerW, innerH) * 0.85).strength(0.3))
      .force('charge', d3.forceManyBody().strength(-1200))
      .force('center', d3.forceCenter(cx, cy))
      .force('collision', d3.forceCollide().radius(n => Math.sqrt(n.mw * n.mw + n.mh * n.mh) / 2 + 18).strength(1))
      .force('x', d3.forceX(cx).strength(0.02))
      .force('y', d3.forceY(cy).strength(0.02))
      .stop();

    // Pre-settle layout
    for (let i = 0; i < 400; i++) { miniSim.tick(); miniNodes.forEach(clampMini); }

    // ── Draw edges (updatable) ──
    const miniLinkLines = innerG.append('g').selectAll('line').data(miniLinks).join('line')
      .attr('stroke', lk => lk.color).attr('stroke-width', 1.2).attr('stroke-opacity', 0.65)
      .attr('marker-end', lk => lk.type !== 'UNION' ? `url(#arr-${lk.type})` : null)
      .attr('stroke-dasharray', lk => lk.type === 'UNION' ? '5,3' : null);

    const miniLinkLabels = innerG.append('g').selectAll('text')
      .data(miniLinks.filter(lk => lk.type !== 'FROM')).join('text')
      .attr('class', 'link-label')
      .attr('font-size', '7px').attr('fill', '#999999')
      .text(lk => lk.type);

    const miniSrcColLabels = innerG.append('g').selectAll('text')
      .data(miniLinks.filter(lk => lk.sourceCol)).join('text')
      .attr('class', 'col-endpoint-label').attr('font-size', '7px')
      .text(lk => lk.sourceCol);

    const miniTgtColLabels = innerG.append('g').selectAll('text')
      .data(miniLinks.filter(lk => lk.targetCol)).join('text')
      .attr('class', 'col-endpoint-label').attr('font-size', '7px')
      .text(lk => lk.targetCol);

    // ── Draw nodes (updatable) ──
    const miniNodeEls = innerG.append('g').selectAll('g').data(miniNodes).join('g')
      .attr('cursor', 'grab');

    miniNodeEls.each(function(n) {
      const ng = d3.select(this);
      const { mw, mh, color, schema, tbl, cols } = n;
      const schW = schema ? schema.length * 5 : 0;

      ng.append('rect')
        .attr('x', -mw / 2).attr('y', -mh / 2).attr('width', mw).attr('height', mh)
        .attr('rx', 5).attr('fill', color + '20').attr('stroke', color).attr('stroke-width', 1);
      ng.append('rect')
        .attr('x', -mw / 2).attr('y', -mh / 2).attr('width', mw).attr('height', MINI_HDR)
        .attr('rx', 5).attr('fill', color + '35');
      ng.append('rect')
        .attr('x', -mw / 2).attr('y', -mh / 2 + MINI_HDR - 3).attr('width', mw).attr('height', 3)
        .attr('fill', color + '35');
      if (schema) {
        ng.append('text')
          .attr('x', -mw / 2 + 5).attr('y', -mh / 2 + MINI_HDR / 2)
          .attr('dominant-baseline', 'middle')
          .attr('fill', color + 'aa').attr('font-size', '8px').attr('font-weight', '600')
          .attr('font-family', "'SF Mono',monospace").text(schema + '.');
      }
      ng.append('text')
        .attr('x', -mw / 2 + 5 + schW).attr('y', -mh / 2 + MINI_HDR / 2)
        .attr('dominant-baseline', 'middle')
        .attr('fill', color).attr('font-size', '9px').attr('font-weight', '700')
        .attr('font-family', "'SF Mono',monospace")
        .text(tbl.length > 16 ? tbl.slice(0, 14) + '\u2026' : tbl);
      if (cols.length) {
        ng.append('line')
          .attr('x1', -mw / 2 + 4).attr('y1', -mh / 2 + MINI_HDR)
          .attr('x2',  mw / 2 - 4).attr('y2', -mh / 2 + MINI_HDR)
          .attr('stroke', color + '44').attr('stroke-width', 0.75);
        cols.forEach((col, ci) => {
          const ry = -mh / 2 + MINI_HDR + MINI_PAD + (ci + 0.5) * MINI_ROW;
          ng.append('circle').attr('cx', -mw / 2 + 8).attr('cy', ry).attr('r', 2).attr('fill', color);
          ng.append('text')
            .attr('x', -mw / 2 + 14).attr('y', ry).attr('dominant-baseline', 'middle')
            .attr('fill', '#111111').attr('font-size', '9px')
            .attr('font-family', "'SF Mono',monospace")
            .text(col.length > 22 ? col.slice(0, 20) + '\u2026' : col);
        });
      }
    });

    // Exit point at mini-box boundary (mirrors outer edgeEndpoint logic)
    function miniEP(n, dx, dy) {
      if (Math.abs(dx) >= Math.abs(dy) * 0.3)
        return { x: n.x + (dx > 0 ? n.mw / 2 : -n.mw / 2), y: n.y };
      return { x: n.x, y: n.y + (dy > 0 ? n.mh / 2 : -n.mh / 2) };
    }
    function applyMiniLinks() {
      miniLinkLines.each(function(lk) {
        const dx = lk.target.x - lk.source.x, dy = lk.target.y - lk.source.y;
        const p1 = miniEP(lk.source,  dx,  dy);
        const p2 = miniEP(lk.target, -dx, -dy);
        lk._mp1 = p1; lk._mp2 = p2;
        d3.select(this)
          .attr('x1', Math.round(p1.x)).attr('y1', Math.round(p1.y))
          .attr('x2', Math.round(p2.x)).attr('y2', Math.round(p2.y));
      });
      miniLinkLabels
        .attr('x', lk => lk._mp1 ? Math.round((lk._mp1.x + lk._mp2.x) / 2) : 0)
        .attr('y', lk => lk._mp1 ? Math.round((lk._mp1.y + lk._mp2.y) / 2) - 4 : 0);
      miniSrcColLabels
        .attr('x', lk => lk._mp1 ? Math.round(lk._mp1.x + (lk._mp2.x - lk._mp1.x) * 0.2) : 0)
        .attr('y', lk => lk._mp1 ? Math.round(lk._mp1.y + (lk._mp2.y - lk._mp1.y) * 0.2) - 5 : 0);
      miniTgtColLabels
        .attr('x', lk => lk._mp1 ? Math.round(lk._mp1.x + (lk._mp2.x - lk._mp1.x) * 0.8) : 0)
        .attr('y', lk => lk._mp1 ? Math.round(lk._mp1.y + (lk._mp2.y - lk._mp1.y) * 0.8) - 5 : 0);
    }

    // Set initial positions (rounded to avoid sub-pixel blur)
    miniNodeEls.attr('transform', n => `translate(${Math.round(n.x)},${Math.round(n.y)})`);
    applyMiniLinks();

    // ── Drag — constrained to CTE inner bounds ──
    const miniDrag = d3.drag()
      .on('start', (e, dn) => {
        e.sourceEvent.stopPropagation();
        if (!e.active) miniSim.alphaTarget(0.3).restart();
        dn.fx = dn.x; dn.fy = dn.y;
      })
      .on('drag', (e, dn) => {
        dn.fx = Math.max(innerX + dn.mw / 2 + 4, Math.min(innerX + innerW - dn.mw / 2 - 4, e.x));
        dn.fy = Math.max(innerY + dn.mh / 2 + 4, Math.min(innerY + innerH - dn.mh / 2 - 4, e.y));
      })
      .on('end', (e, dn) => {
        if (!e.active) miniSim.alphaTarget(0);
        dn.fx = null; dn.fy = null;
      });
    miniNodeEls.call(miniDrag);

    // ── Tick — clamp + redraw ──
    miniSim.on('tick', () => {
      miniNodes.forEach(clampMini);
      miniNodeEls.attr('transform', n => `translate(${Math.round(n.x)},${Math.round(n.y)})`);
      applyMiniLinks();
    });

    miniSim.restart();
  });

  // ── Simulation tick ──────────────────────────
  currentSimulation.on('tick', () => {
    linkSel.each(function(d) {
      const dx = d.target.x - d.source.x, dy = d.target.y - d.source.y;
      const p1 = edgeEndpoint(d.source,  dx,  dy, d.sourceCol);
      const p2 = edgeEndpoint(d.target, -dx, -dy, d.targetCol);
      d._p1 = p1; d._p2 = p2;
      d3.select(this).attr('x1', p1.x).attr('y1', p1.y).attr('x2', p2.x).attr('y2', p2.y);
    });
    linkLabelGrp
      .attr('transform', d => {
        const mx = d._p1 ? (d._p1.x + d._p2.x) / 2 : (d.source.x + d.target.x) / 2;
        const my = d._p1 ? (d._p1.y + d._p2.y) / 2 : (d.source.y + d.target.y) / 2;
        return `translate(${mx},${my})`;
      });
    srcColLabelSel
      .attr('x', d => d._p1 ? d._p1.x + (d._p2.x - d._p1.x) * 0.15 : 0)
      .attr('y', d => d._p1 ? d._p1.y + (d._p2.y - d._p1.y) * 0.15 - 5 : 0);
    tgtColLabelSel
      .attr('x', d => d._p1 ? d._p1.x + (d._p2.x - d._p1.x) * 0.85 : 0)
      .attr('y', d => d._p1 ? d._p1.y + (d._p2.y - d._p1.y) * 0.85 - 5 : 0);
    tblNodeSel.attr('transform', d => `translate(${d.x},${d.y})`);
    cteNodeSel.attr('transform', d => `translate(${d.x},${d.y})`);
  });
}

// ═══════════════════════════════════════════════════════════════
// TOOLTIP
// ═══════════════════════════════════════════════════════════════

function positionTooltip(event) {
  const r = container.getBoundingClientRect();
  let x = event.clientX - r.left + 14, y = event.clientY - r.top + 14;
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
  const { w, h } = dims();
  const bb = gMain.node().getBBox();
  if (!bb || bb.width === 0) return;
  const pad = 40, scale = Math.min((w - pad * 2) / bb.width, (h - pad * 2) / bb.height, 2);
  svgD3.transition().duration(400).call(
    zoomBehaviour.transform,
    d3.zoomIdentity
      .translate(w / 2 - scale * (bb.x + bb.width  / 2),
                 h / 2 - scale * (bb.y + bb.height / 2))
      .scale(scale)
  );
});

// ═══════════════════════════════════════════════════════════════
// SIDEBAR
// ═══════════════════════════════════════════════════════════════

function updateSidebar(data) {
  const has = data.tableNodes.length || data.cteNodes.length;
  document.getElementById('stats-section').style.display         = has ? '' : 'none';
  document.getElementById('tables-section').style.display        = data.tableNodes.length ? '' : 'none';
  document.getElementById('ctes-section').style.display          = data.cteNodes.length   ? '' : 'none';
  document.getElementById('schema-legend-section').style.display = data.tableNodes.length ? '' : 'none';

  document.getElementById('table-count').textContent = data.tableNodes.length;
  document.getElementById('cte-count').textContent   = data.cteNodes.length;
  document.getElementById('edge-count').textContent  = data.edges.length;

  const ul = document.getElementById('table-list');
  ul.innerHTML = '';
  [...data.tableNodes].sort((a, b) => a.id.localeCompare(b.id)).forEach(n => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="dot" style="background:${n.color}"></span>${n.label}<span class="badge">${n.degree} join${n.degree !== 1 ? 's' : ''}</span>`;
    ul.appendChild(li);
  });

  const cteEl = document.getElementById('cte-list');
  cteEl.innerHTML = '';
  data.cteNodes.forEach(cte => {
    const div = document.createElement('div');
    div.className = 'cte-item';
    div.innerHTML = `
      <div class="cte-item-header">\u2b21 ${cte.label}
        <span class="cte-badge">${cte.tables.length} table${cte.tables.length !== 1 ? 's' : ''}</span>
      </div>
      <div class="cte-item-tables">${cte.tables.map(t => `<div class="cte-item-table">\u25b8 ${t}</div>`).join('')}</div>`;
    cteEl.appendChild(div);
  });

  const legEl = document.getElementById('schema-legend');
  legEl.innerHTML = '';
  const schMap = new Map();
  data.tableNodes.forEach(n => { const s = n.schema || '(no schema)'; if (!schMap.has(s)) schMap.set(s, n.color); });
  schMap.forEach((color, schema) => {
    const row = document.createElement('div');
    row.className = 'legend-row';
    row.innerHTML = `<div class="legend-swatch" style="background:${color}"></div>${schema}`;
    legEl.appendChild(row);
  });
}

// ═══════════════════════════════════════════════════════════════
// EXAMPLE SQL
// ═══════════════════════════════════════════════════════════════

const EXAMPLE_SQL = `-- Regional sales dashboard
WITH
  region_stats AS (
    SELECT r.region_id, SUM(o.total_amount) AS total_revenue
    FROM public.orders o
    JOIN public.regions r ON o.region_id = r.region_id
    GROUP BY r.region_id
  ),
  top_products AS (
    SELECT oi.product_id, SUM(oi.quantity) AS total_qty
    FROM order_items oi
    JOIN products p ON oi.product_id = p.product_id
    GROUP BY oi.product_id
  )
SELECT rs.region_id, tp.product_id, c.name, e.full_name
FROM region_stats rs
LEFT JOIN top_products tp ON tp.product_id = rs.region_id
LEFT JOIN analytics.product_categories c ON tp.product_id = c.product_id
LEFT JOIN (
  SELECT employee_id, full_name, region_id
  FROM hr.employees
  WHERE active = true
) e ON e.region_id = rs.region_id
WHERE EXISTS (
  SELECT 1 FROM finance.revenue_targets rt
  WHERE rt.region_id = rs.region_id
)
UNION ALL
SELECT NULL, NULL, NULL, NULL
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
document.getElementById('sql-input').addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') analyze();
});
document.getElementById('example-btn').addEventListener('click', () => {
  if (TDQueryContext.isBound()) TDQueryContext.toScratch();
  document.getElementById('sql-input').value = EXAMPLE_SQL;
  analyze();
});
document.getElementById('clear-btn').addEventListener('click', () => {
  if (TDQueryContext.isBound()) TDQueryContext.toScratch();
  document.getElementById('sql-input').value = '';
  svgD3.selectAll('*').remove();
  document.getElementById('empty-state').querySelector('p').textContent = 'Paste a SQL query and click Analyze';
  document.getElementById('empty-state').style.display = 'flex';
  ['stats-section','tables-section','ctes-section','schema-legend-section']
    .forEach(id => { document.getElementById(id).style.display = 'none'; });
});
window.addEventListener('resize', () => {
  if (document.getElementById('sql-input').value.trim()) analyze();
});

// Opened from the Project view as /?p=<project>&t=<table>: load that file's SQL
window.addEventListener('load', () => {
  if (TDQueryContext.init()) analyze();
});
