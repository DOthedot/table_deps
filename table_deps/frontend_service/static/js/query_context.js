// ── QUERY CONTEXT — ties the Query view to its project file ───────────────
// When opened as /?p=<project>&t=<table> and the project snapshot is in this
// tab's sessionStorage, show the source file, a context strip (reads-from /
// used-by / prev-next) and a read-only SQL box with "Edit as scratch".
// Without a project it is a plain scratch query, exactly as before.

const TDQueryContext = (() => {
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const params = TDNav.parseParams(location.search);
  const state = { project: params.p, table: params.t, ctx: null };

  const chip = id => `<a class="chip" href="${esc(TDNav.queryUrl(state.project, id))}">` +
    `<span class="dot" style="background:${schemaColor(id.split('.')[0])}"></span>${esc(id)}</a>`;

  function renderStrip() {
    const strip = $('ctx-strip'), c = state.ctx;
    const list = ids => ids.length ? ids.map(chip).join('') : '<span class="ctx-none">—</span>';
    const step = (id, sym, title) => id
      ? `<a class="ctx-step" href="${esc(TDNav.queryUrl(state.project, id))}" title="${title}: ${esc(id)}">${sym}</a>`
      : `<span class="ctx-step disabled">${sym}</span>`;
    strip.innerHTML = `
      <a class="ctx-back" href="${esc(TDNav.projectUrl(state.project, state.table))}" title="Back to the DAG (Esc)">&larr; ${esc(state.project)} <kbd>Esc</kbd></a>
      <span class="ctx-div"></span><span class="ctx-lbl">Reads from</span>${list(c.readsFrom)}
      <span class="ctx-div"></span><span class="ctx-lbl">Used by</span>${list(c.usedBy)}
      <span class="ctx-steps">${step(c.prev, '&lsaquo;', 'Previous file')}${step(c.next, '&rsaquo;', 'Next file')}</span>`;
    strip.hidden = false;
  }

  function setCrumb() {
    const proj = state.project ? [{ label: state.project, href: TDNav.projectUrl(state.project, state.table) }] : [];
    if (state.ctx) TDShell.setCrumb([...proj, { label: `${state.table}.sql` }]);
    else if (state.table) TDShell.setCrumb([...proj, { label: `${state.table} — open the project to load it`, muted: true }]);
    else TDShell.setCrumb([{ label: 'Scratch query' }]);
  }

  function bindSource() {
    const ta = $('sql-input');
    ta.value = state.ctx.node.sql_content || '';
    ta.readOnly = true;
    $('source-file').textContent = state.ctx.node.file || `${state.table}.sql`;
    $('source-note').hidden = false;
  }

  // Leave the file but keep the SQL: becomes a scratch query in the same project.
  function toScratch() {
    state.table = null; state.ctx = null;
    $('sql-input').readOnly = false;
    $('source-note').hidden = true;
    $('ctx-strip').hidden = true;
    history.replaceState(null, '', TDNav.queryUrl(state.project));
    document.title = 'Query · table-deps';
    setCrumb();
    $('sql-input').focus();
  }

  // Returns true when the SQL box was filled from a project file.
  function init() {
    TDShell.init({
      view: 'query',
      project: () => state.project,
      projectSel: () => state.table,
      queryTarget: () => state.table,
    });
    $('scratch-btn').addEventListener('click', toScratch);
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape' || !state.ctx || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
      TDShell.goProject();
    });

    const snap = state.project ? TDNav.loadSnapshot(sessionStorage, state.project) : null;
    state.ctx = snap && state.table ? TDNav.context(snap, state.table) : null;
    setCrumb();
    if (!state.ctx) return false;
    // Same schema→colour order as the Project view, so a schema looks identical in both
    [...new Set(snap.nodes.map(n => n.schema))].sort().forEach(s => schemaColor(s));
    TDNav.saveLastQuery(sessionStorage, state.project, state.table);
    bindSource();
    renderStrip();
    document.title = `${state.table} · table-deps`;
    return true;
  }

  return { init, toScratch, isBound: () => !!state.ctx };
})();
