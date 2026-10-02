// ── NAVIGATION MODEL — shared by Project view and Query view ──────────────
// Pure logic, no DOM. Loaded as a classic <script> (global `TDNav`) and
// required by tests/js/nav.test.js under Node.
//
// The Project view writes a project *snapshot* to sessionStorage (per-tab,
// survives same-tab navigation). The Query view reads it to know which file
// it is showing and who its neighbours are. See
// docs/specs/2026-10-03-view-navigation.md.

const TDNav = (() => {
  const STORE_KEY = 'table_deps_project';
  const VIEW_KEY = 'table_deps_dag_view';
  const LAST_KEY = 'table_deps_last_query';
  const NODE_FIELDS = ['id', 'label', 'schema', 'table', 'file', 'all_refs',
    'internal_refs', 'external_refs', 'degree', 'sql_content'];

  const edgeEnd = e => (typeof e === 'object' && e !== null ? e.id : e);

  // Strip simulation/derived state; keep what loadGraph() needs to rebuild.
  function snapshot(projectName, nodes, edges) {
    return {
      project_name: projectName,
      nodes: nodes.map(n => {
        const out = {};
        for (const k of NODE_FIELDS) if (k in n) out[k] = n[k];
        out.level = n._level || 0;
        return out;
      }),
      edges: edges.map(e => ({ source: edgeEnd(e.source), target: edgeEnd(e.target) })),
    };
  }

  // ── storage (every call is safe: private mode / quota / missing storage) ──
  function _get(storage, key) {
    try { const raw = storage && storage.getItem(key); return raw ? JSON.parse(raw) : null; }
    catch { return null; }
  }
  function _set(storage, key, value) {
    try { storage.setItem(key, JSON.stringify(value)); return true; }
    catch { return false; }
  }
  function _del(storage, key) { try { storage && storage.removeItem(key); } catch { /* ignore */ } }

  function saveSnapshot(storage, snap) { return _set(storage, STORE_KEY, snap); }
  function loadSnapshot(storage, projectName) {
    const snap = _get(storage, STORE_KEY);
    if (!snap || !Array.isArray(snap.nodes)) return null;
    if (projectName && snap.project_name !== projectName) return null;
    return snap;
  }
  function clearSnapshot(storage) { _del(storage, STORE_KEY); _del(storage, VIEW_KEY); _del(storage, LAST_KEY); }

  const saveView = (storage, project, t) => _set(storage, VIEW_KEY, { project, k: t.k, x: t.x, y: t.y });
  function loadView(storage, project) {
    const v = _get(storage, VIEW_KEY);
    return v && v.project === project ? v : null;
  }
  const saveLastQuery = (storage, project, table) => _set(storage, LAST_KEY, { project, table });
  function loadLastQuery(storage, project) {
    const v = _get(storage, LAST_KEY);
    return v && v.project === project ? v.table : null;
  }

  // ── URLs ── Query view stays at "/" so vercel.json routes need no change ──
  function _qs(params) {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
    const s = q.toString();
    return s ? `?${s}` : '';
  }
  const projectUrl = (project, sel) => `/project${_qs({ p: project, sel })}`;
  const queryUrl = (project, table) => `/${_qs({ p: project, t: table })}`;
  function parseParams(search) {
    const q = new URLSearchParams(search || '');
    return { p: q.get('p'), t: q.get('t'), sel: q.get('sel') };
  }

  // ── graph context ──
  const _byLevel = (a, b) => (a.level || 0) - (b.level || 0) || a.id.localeCompare(b.id);
  const ordered = snap => [...snap.nodes].sort(_byLevel).map(n => n.id);

  function context(snap, id) {
    const node = snap.nodes.find(n => n.id === id);
    if (!node) return null;
    const order = ordered(snap);
    const i = order.indexOf(id);
    const usedBy = snap.edges.filter(e => e.target === id).map(e => e.source);
    const rank = new Map(order.map((x, k) => [x, k]));
    return {
      node,
      readsFrom: [...(node.internal_refs || [])],
      usedBy: [...new Set(usedBy)].sort((a, b) => rank.get(a) - rank.get(b)),
      prev: i > 0 ? order[i - 1] : null,
      next: i < order.length - 1 ? order[i + 1] : null,
    };
  }

  // Rank: 0 table name starts with q · 1 id starts with q · 2 id contains q.
  function search(snap, q) {
    const order = ordered(snap);
    const needle = (q || '').trim().toLowerCase();
    if (!needle) return order;
    const rankOf = id => {
      const table = id.split('.').slice(1).join('.');
      if (table.startsWith(needle)) return 0;
      if (id.startsWith(needle)) return 1;
      return id.includes(needle) ? 2 : -1;
    };
    return order
      .map((id, k) => ({ id, k, r: rankOf(id) }))
      .filter(x => x.r >= 0)
      .sort((a, b) => a.r - b.r || a.k - b.k)
      .map(x => x.id);
  }

  // Which file should the "Query" tab (or key 2) open from the Project view?
  //   selected — node currently selected in the DAG (or null)
  //   lastFile — file most recently opened in the Query view this tab (or null)
  // Return a table id to open that file, or null to open an empty scratch query.
  // "Show me what I'm looking at" beats "take me back"; nothing → scratch query.
  function resolveQueryTarget({ selected, lastFile }) {
    return selected || lastFile || null;
  }

  return {
    STORE_KEY, snapshot, saveSnapshot, loadSnapshot, clearSnapshot,
    saveView, loadView, saveLastQuery, loadLastQuery,
    projectUrl, queryUrl, parseParams, ordered, context, search, resolveQueryTarget,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = TDNav;
