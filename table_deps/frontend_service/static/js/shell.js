// ── APP SHELL — header view switch, breadcrumb, ⌘K jump palette ───────────
// Shared by Project view and Query view. Page-specific behaviour is injected
// through TDShell.init(hooks); navigation rules live in nav.js (TDNav).

const TDShell = (() => {
  let hooks = null;
  let pal = null; // { el, input, list, hits, i }

  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const typing = e => ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) || e.target.isContentEditable;

  function go(url) {
    hooks.beforeLeave?.();
    location.href = url;
  }
  const goProject = () => go(TDNav.projectUrl(hooks.project(), hooks.projectSel?.()));
  const goQuery = () => go(TDNav.queryUrl(hooks.project(), hooks.queryTarget?.()));

  // parts: [{ label, href?, muted? }]
  function setCrumb(parts) {
    $('crumb').innerHTML = parts.map((p, k) => {
      const sep = k ? '<span class="crumb-sep">›</span>' : '';
      const cls = p.muted ? 'crumb-muted' : (k === parts.length - 1 ? 'crumb-cur' : '');
      return sep + (p.href
        ? `<a class="${cls}" href="${esc(p.href)}">${esc(p.label)}</a>`
        : `<span class="${cls}">${esc(p.label)}</span>`);
    }).join('');
  }

  // ── palette ──
  function snapshot() { return TDNav.loadSnapshot(sessionStorage, hooks.project() || undefined); }

  function openPalette() {
    if (pal) return;
    const el = document.createElement('div');
    el.className = 'palette-bg';
    el.innerHTML = `<div class="palette" role="dialog" aria-label="Jump to table">
      <input class="palette-input" placeholder="Jump to table…" autocomplete="off" spellcheck="false" />
      <ul class="palette-list" role="listbox"></ul>
      <div class="palette-foot"><span><kbd>↵</kbd> open query</span><span><kbd>⇧↵</kbd> show in DAG</span><span><kbd>Esc</kbd> close</span></div>
    </div>`;
    document.body.appendChild(el);
    pal = { el, input: el.querySelector('input'), list: el.querySelector('ul'), hits: [], i: 0 };
    el.addEventListener('mousedown', e => { if (e.target === el) closePalette(); });
    pal.input.addEventListener('input', () => { pal.i = 0; renderPalette(); });
    pal.list.addEventListener('click', e => {
      const li = e.target.closest('li[data-id]');
      if (li) choose(li.dataset.id, e.shiftKey);
    });
    renderPalette();
    pal.input.focus();
  }
  function closePalette() { pal?.el.remove(); pal = null; }

  function renderPalette() {
    const snap = snapshot();
    if (!snap) {
      pal.hits = [];
      pal.list.innerHTML = `<li class="palette-empty">No project loaded in this tab — open one in the Project view.</li>`;
      return;
    }
    const level = new Map(snap.nodes.map(n => [n.id, n.level]));
    pal.hits = TDNav.search(snap, pal.input.value);
    pal.i = Math.min(pal.i, Math.max(pal.hits.length - 1, 0));
    pal.list.innerHTML = pal.hits.length
      ? pal.hits.map((id, k) => `<li data-id="${esc(id)}" class="${k === pal.i ? 'on' : ''}" role="option">
          <span class="dot" style="background:${schemaColor(id.split('.')[0])}"></span>${esc(id)}
          <span class="lv">L${level.get(id) || 0}</span></li>`).join('')
      : `<li class="palette-empty">No table matches “${esc(pal.input.value)}”.</li>`;
    pal.list.querySelector('li.on')?.scrollIntoView({ block: 'nearest' });
  }

  function choose(id, reveal) {
    const project = snapshot()?.project_name;
    closePalette();
    if (reveal && hooks.reveal) return hooks.reveal(id);
    go(reveal ? TDNav.projectUrl(project, id) : TDNav.queryUrl(project, id));
  }

  function onKey(e) {
    if (pal) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePalette(); }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        pal.i = Math.max(0, Math.min(pal.hits.length - 1, pal.i + (e.key === 'ArrowDown' ? 1 : -1)));
        renderPalette();
      } else if (e.key === 'Enter' && pal.hits[pal.i]) { e.preventDefault(); choose(pal.hits[pal.i], e.shiftKey); }
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); return openPalette(); }
    if (typing(e) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === '1' && hooks.view !== 'project') { e.preventDefault(); goProject(); }
    if (e.key === '2' && hooks.view !== 'query') { e.preventDefault(); goQuery(); }
  }

  // hooks: { view, project(), queryTarget()?, projectSel()?, beforeLeave()?, reveal(id)? }
  function init(h) {
    hooks = h;
    $('tab-' + h.view).classList.add('on');
    $('tab-' + h.view).setAttribute('aria-current', 'page');
    $('tab-project').addEventListener('click', e => { e.preventDefault(); if (h.view !== 'project') goProject(); });
    $('tab-query').addEventListener('click', e => { e.preventDefault(); if (h.view !== 'query') goQuery(); });
    $('jump-btn').addEventListener('click', openPalette);
    // capture phase: the palette must see Esc/Enter before page-level handlers
    document.addEventListener('keydown', onKey, true);
  }

  return { init, setCrumb, go, goProject, goQuery, openPalette };
})();
