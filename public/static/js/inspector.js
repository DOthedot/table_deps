// ── INSPECTOR — Project view drawer for the selected node ─────────────────
// Renders a TDNav.context(); all actions go back through callbacks so this
// file knows nothing about the DAG renderer.

const TDInspector = (() => {
  let el = null;
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const chip = (id, internal = true) => internal
    ? `<button class="chip" data-id="${esc(id)}"><span class="dot" style="background:${schemaColor(id.split('.')[0])}"></span>${esc(id)}</button>`
    : `<span class="chip chip-ext"><span class="dot"></span>${esc(id)}</span>`;

  const group = (label, items, empty, internal) => `
    <div class="ins-group"><div class="section-label">${label} · ${items.length}</div>
      <div class="chips">${items.length ? items.map(x => chip(x, internal)).join('') : `<span class="ins-empty">${empty}</span>`}</div></div>`;

  // ctx: TDNav.context(); cb: { onOpen(id), onSelect(id), onClose() }
  function show(container, ctx, cb) {
    hide();
    const n = ctx.node;
    el = document.createElement('aside');
    el.id = 'inspector';
    el.style.setProperty('--c', schemaColor(n.schema));
    el.setAttribute('aria-label', `Details for ${n.id}`);
    el.innerHTML = `
      <div class="ins-head">
        <div class="ins-name">${esc(n.id)}</div>
        <div class="ins-file">${esc(n.file || n.id + '.sql')} · level L${n.level || 0}</div>
        <button class="ins-close" title="Deselect (Esc)" aria-label="Close">&#x2715;</button>
      </div>
      <div class="ins-body">
        ${group('Reads from', ctx.readsFrom, '— source table', true)}
        ${group('Used by', ctx.usedBy, '— nothing downstream', true)}
        ${(n.external_refs || []).length ? group('External refs', n.external_refs, '', false) : ''}
      </div>
      <div class="ins-foot">
        <button class="ins-open">Open in Query view &#x21b5;</button>
        <div class="ins-hint">or double-click the node · <kbd>Esc</kbd> to deselect</div>
      </div>`;
    el.querySelector('.ins-close').addEventListener('click', cb.onClose);
    el.querySelector('.ins-open').addEventListener('click', () => cb.onOpen(n.id));
    el.querySelectorAll('button.chip').forEach(b => b.addEventListener('click', () => cb.onSelect(b.dataset.id)));
    // keep wheel/drag inside the drawer from zooming or panning the DAG
    ['wheel', 'mousedown', 'dblclick'].forEach(t => el.addEventListener(t, e => e.stopPropagation()));
    container.appendChild(el);
  }

  function hide() { el?.remove(); el = null; }
  const isOpen = () => !!el;

  return { show, hide, isOpen };
})();
