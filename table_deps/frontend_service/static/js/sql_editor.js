// ── SQL EDITOR — floating editor for the Query view's SQL box ─────────────
// ⤢ on the SQL box (or ⌘/Ctrl+Shift+E) opens a draggable, resizable window
// that edits the SAME text as #sql-input. Highlighting, lint and the basic
// formatter come from sql_tools.js (TDSql); Format prefers sql-formatter,
// lazily loaded from a CDN (ADR-0004). Spec: docs/specs/2026-10-03-sql-editor.md.

const TDEditor = (() => {
  const FORMATTER_URL = 'https://cdn.jsdelivr.net/npm/sql-formatter@15.9.0/dist/sql-formatter.min.js';
  const LIVE_MS = 600, PREF_KEY = 'table_deps_editor';
  const SEV_ICON = { error: '●', warning: '▲', info: 'ℹ' };

  const $ = id => document.getElementById(id);
  const side = () => $('sql-input');
  const readOnly = () => side().readOnly;
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  let win = null, problems = [], liveTimer = null, lastAnalyzed = '', formatter = null, toastTimer = null, sizeObs = null;
  const prefs = { mode: 'float', live: false, showProbs: true, rect: null };
  try { Object.assign(prefs, JSON.parse(localStorage.getItem(PREF_KEY) || '{}')); } catch { /* defaults */ }
  const savePrefs = () => { try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch { /* private mode */ } };

  // ── sidebar: lint summary chip under the SQL box ──
  function updateChip() {
    const chip = $('sql-lint'), sql = side().value;
    if (!sql.trim()) { chip.hidden = true; return; }
    const P = TDSql.lint(sql), e = P.filter(p => p.sev === 'error').length, w = P.filter(p => p.sev === 'warning').length;
    chip.hidden = false;
    chip.className = 'sql-lint ' + (e ? 'has-error' : w ? 'has-warning' : 'clean');
    chip.innerHTML = e || w
      ? `${e ? `● ${e} error${e > 1 ? 's' : ''}` : ''}${e && w ? ' · ' : ''}${w ? `▲ ${w} warning${w > 1 ? 's' : ''}` : ''} <span class="sql-lint-cta">open &#x2922; for details</span>`
      : '✓ no problems';
  }

  // ── window ──
  function shell() {
    const ro = readOnly(), focus = prefs.mode === 'focus';
    const file = $('source-file')?.textContent || 'query.sql';
    return `
      ${focus ? '<div class="ed-backdrop" data-act="close"></div>' : ''}
      <section class="ed ${focus ? 'focus' : ''}" role="dialog" aria-label="SQL editor">
        <div class="ed-bar">
          <div class="ed-title"><span class="ed-ic">&#x25ad;</span>${ro ? `${esc(file)} <span class="ed-ro">READ-ONLY</span>` : 'Scratch query'}
            <span class="ed-dirty" hidden title="Changed since last Analyze"></span></div>
          <div class="ed-spacer"></div>
          <button class="ed-tb" data-act="format" ${ro ? 'disabled title="Read-only: click Edit as scratch to format"' : 'title="Format SQL (⇧⌥F)"'}>&#x2726; Format</button>
          <button class="ed-tb ${prefs.showProbs ? 'on' : ''}" data-act="lint" title="Show/hide problems">Lint <span class="ed-cnt"></span></button>
          <button class="ed-tb icon" data-act="copy" title="Copy SQL">&#x29c9;</button>
          <span class="ed-sep"></span>
          <button class="ed-tb icon" data-act="mode" title="${focus ? 'Back to floating window' : 'Focus mode: fill the screen'}">${focus ? '&#x2921;' : '&#x2922;'}</button>
          <button class="ed-tb icon" data-act="close" title="Close (Esc). Your edits stay in the SQL box" aria-label="Close editor">&#x2715;</button>
        </div>
        ${ro ? `<div class="ed-ro-banner">&#x1f512; Read-only: this is <b>${esc(file)}</b> from the project. Lint still runs.
          <button data-act="scratch">Edit as scratch</button></div>` : ''}
        <div class="ed-body">
          <div class="ed-gutter" aria-hidden="true"></div>
          <div class="ed-code">
            <div class="ed-curline"></div>
            <pre class="ed-hl" aria-hidden="true"></pre>
            <textarea class="ed-src" spellcheck="false" autocomplete="off" autocapitalize="off" wrap="off"
              aria-label="SQL" ${ro ? 'readonly' : ''}></textarea>
          </div>
        </div>
        <div class="ed-probs" ${prefs.showProbs ? '' : 'hidden'}></div>
        <div class="ed-status">
          <span class="ed-pos">Ln 1, Col 1</span><span class="ed-tables"></span>
          <label class="ed-live" title="Re-analyze as you type"><input type="checkbox" data-act="live" ${prefs.live ? 'checked' : ''}><span class="ed-sw"></span>Live</label>
          <span class="ed-hint"><kbd>Esc</kbd> close</span>
          <button class="ed-run" data-act="run">&#9654; Analyze <kbd>&#x2318;&#x21b5;</kbd></button>
        </div>
        <div class="ed-toast" role="status" aria-live="polite"></div>
      </section>`;
  }

  const q = sel => win.querySelector(sel);

  function place() {
    const ed = q('.ed');
    if (prefs.mode === 'focus') return;
    const vw = innerWidth, vh = innerHeight;
    const r = prefs.rect || {};
    const w = Math.min(r.w || 620, vw - 32), h = Math.min(r.h || 560, vh - 96);
    const left = r.left ?? vw - w - 24, top = r.top ?? 64;
    Object.assign(ed.style, {
      width: w + 'px', height: h + 'px',
      left: Math.max(8, Math.min(left, vw - 120)) + 'px', top: Math.max(8, Math.min(top, vh - 48)) + 'px',
    });
  }
  function rememberRect() {
    if (!win || prefs.mode !== 'float') return;
    const ed = q('.ed');
    prefs.rect = { left: ed.offsetLeft, top: ed.offsetTop, w: ed.offsetWidth, h: ed.offsetHeight };
    savePrefs();
  }

  function open() {
    if (win) return q('.ed-src').focus();
    win = document.createElement('div');
    win.className = 'ed-host';
    document.body.appendChild(win);
    mount();
  }
  function mount(caret = 0) {
    win.innerHTML = shell();
    place();
    const src = q('.ed-src');
    src.value = side().value;
    bind();
    refresh();
    src.focus();
    src.setSelectionRange(caret, caret);
  }
  function close() {
    if (!win) return;
    rememberRect();
    sizeObs?.disconnect(); sizeObs = null;
    win.remove(); win = null;
    side().focus();
  }

  // ── render highlight, gutter, problems, status ──
  function refresh() {
    if (!win) return;
    const src = q('.ed-src'), sql = src.value;
    problems = TDSql.lint(sql);
    q('.ed-hl').innerHTML = TDSql.highlight(sql, problems, schemaColor) + '\n';
    const firstByLine = {};
    problems.forEach(p => { firstByLine[p.line] ??= p; });
    q('.ed-gutter').innerHTML = sql.split('\n').map((_, k) => {
      const p = firstByLine[k + 1];
      return `<div>${p ? `<span class="ed-mk ${p.sev}" title="${esc(p.msg)}"></span>` : ''}${k + 1}</div>`;
    }).join('');
    const e = problems.filter(p => p.sev === 'error').length, w = problems.filter(p => p.sev === 'warning').length;
    const cnt = q('.ed-cnt');
    cnt.textContent = problems.length || '✓';
    cnt.className = 'ed-cnt ' + (e ? 'error' : w ? 'warning' : problems.length ? 'info' : 'clean');
    q('.ed-probs').innerHTML = `<div class="ed-probs-h">Problems · ${problems.length}<span>click to jump</span></div>` +
      (problems.length ? problems.map((p, k) => `
        <div class="ed-prob" data-p="${k}" role="button" tabindex="0">
          <span class="ed-prob-ic ${p.sev}">${SEV_ICON[p.sev]}</span><span class="ed-prob-ln">Ln ${p.line}</span>
          <span class="ed-prob-msg">${esc(p.msg)}</span>
          ${p.fix && !readOnly() ? `<button class="ed-fix" data-fix="${k}">Fix</button>` : ''}
          <span class="ed-prob-rule">${p.rule}</span></div>`).join('')
        : '<div class="ed-clean">✓ No problems found</div>');
    const n = TDSql.tableRefs(sql).tables.length;
    q('.ed-tables').textContent = `${n} table${n === 1 ? '' : 's'}`;
    q('.ed-dirty').hidden = sql === lastAnalyzed;
    syncScroll();
  }
  function syncScroll() {
    const src = q('.ed-src');
    q('.ed-hl').scrollTop = src.scrollTop; q('.ed-hl').scrollLeft = src.scrollLeft;
    q('.ed-gutter').scrollTop = src.scrollTop;
    caretInfo();
  }
  function caretInfo() {
    const src = q('.ed-src'), before = src.value.slice(0, src.selectionStart).split('\n');
    const line = before.length;
    q('.ed-pos').textContent = `Ln ${line}, Col ${before[line - 1].length + 1}`;
    const lh = parseFloat(getComputedStyle(src).lineHeight) || 20, pad = parseFloat(getComputedStyle(src).paddingTop) || 10;
    q('.ed-curline').style.top = (pad + (line - 1) * lh - src.scrollTop) + 'px';
    q('.ed-gutter').querySelectorAll('div').forEach((d, k) => d.classList.toggle('cur', k === line - 1));
  }

  // Write editor text back to the sidebar box (single source of truth for analyze()).
  function pushToSide() {
    side().value = q('.ed-src').value;
    updateChip();
  }
  // Replace all text but keep it undoable (execCommand preserves the native undo stack).
  function replaceAll(text) {
    const src = q('.ed-src');
    src.focus(); src.select();
    if (!document.execCommand('insertText', false, text)) { src.value = text; onInput(); }
    src.setSelectionRange(0, 0); src.scrollTop = 0; syncScroll();
  }
  function jumpTo(line) {
    const src = q('.ed-src'), lines = src.value.split('\n');
    const start = lines.slice(0, line - 1).reduce((a, l) => a + l.length + 1, 0);
    src.focus(); src.setSelectionRange(start, start + (lines[line - 1] || '').length);
    const lh = parseFloat(getComputedStyle(src).lineHeight) || 20;
    src.scrollTop = Math.max(0, (line - 4) * lh); syncScroll();
  }
  function toast(msg) {
    const t = q('.ed-toast'); t.textContent = msg; t.classList.add('on');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), 1600);
  }

  function runAnalyze() {
    pushToSide();
    analyze(); // visualizer.js
    lastAnalyzed = side().value;
    if (win) { q('.ed-dirty').hidden = true; toast('Analyzed. Graph updated'); }
  }

  function loadFormatter() {
    formatter ??= new Promise((resolve, reject) => {
      if (window.sqlFormatter) return resolve(window.sqlFormatter);
      const s = document.createElement('script');
      const timer = setTimeout(() => reject(new Error('timeout')), 8000);
      s.src = FORMATTER_URL; s.async = true;
      s.onload = () => { clearTimeout(timer); window.sqlFormatter ? resolve(window.sqlFormatter) : reject(new Error('missing')); };
      s.onerror = () => { clearTimeout(timer); reject(new Error('offline')); };
      document.head.appendChild(s);
    }).catch(err => { formatter = null; throw err; }); // allow a retry later
    return formatter;
  }
  async function formatNow() {
    if (!win || readOnly()) return;
    const sql = q('.ed-src').value;
    if (!sql.trim()) return;
    q('[data-act="format"]').disabled = true;
    let out, note = 'Formatted. ⌘Z to undo';
    try {
      const f = await loadFormatter();
      try { out = f.format(sql, { language: 'sql', keywordCase: 'upper', tabWidth: 4 }); }
      catch { out = TDSql.formatBasic(sql); note = "Couldn't fully parse. Used the basic formatter"; }
    } catch {
      out = TDSql.formatBasic(sql); note = 'Formatter offline. Used the basic formatter';
    }
    if (!win) return;
    q('[data-act="format"]').disabled = false;
    if (out !== sql) replaceAll(out);
    toast(out === sql ? 'Already formatted' : note);
  }

  function onInput() {
    pushToSide();
    refresh();
    if (prefs.live) { clearTimeout(liveTimer); liveTimer = setTimeout(runAnalyze, LIVE_MS); }
  }

  function bind() {
    const src = q('.ed-src');
    src.addEventListener('input', onInput);
    src.addEventListener('scroll', syncScroll);
    ['click', 'keyup', 'select'].forEach(t => src.addEventListener(t, caretInfo));
    src.addEventListener('keydown', e => {
      if (e.key === 'Tab' && !e.shiftKey && !readOnly()) { e.preventDefault(); document.execCommand('insertText', false, '  '); }
    });

    win.addEventListener('click', e => {
      const fx = e.target.closest('[data-fix]');
      if (fx) {
        const p = problems[+fx.dataset.fix];
        if (p.fix === 'format') return formatNow();
        const fixed = TDSql.applyFix(q('.ed-src').value, p);
        if (fixed != null) { replaceAll(fixed); toast('Fixed: ' + p.rule); }
        return;
      }
      const pr = e.target.closest('[data-p]');
      if (pr) return jumpTo(problems[+pr.dataset.p].line);
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'close') close();
      else if (act === 'format') formatNow();
      else if (act === 'run') runAnalyze();
      else if (act === 'copy') { navigator.clipboard?.writeText(q('.ed-src').value).then(() => toast('Copied'), () => toast('Copy failed')); }
      else if (act === 'lint') {
        prefs.showProbs = !prefs.showProbs; savePrefs();
        q('.ed-probs').hidden = !prefs.showProbs; q('[data-act="lint"]').classList.toggle('on', prefs.showProbs);
      } else if (act === 'mode') {
        rememberRect(); prefs.mode = prefs.mode === 'float' ? 'focus' : 'float'; savePrefs();
        mount(q('.ed-src').selectionStart);
      } else if (act === 'scratch') {
        TDQueryContext.toScratch();
        mount(q('.ed-src').selectionStart);
        toast('Now a scratch query. Format is enabled');
      }
    });
    win.addEventListener('change', e => {
      if (e.target.dataset.act !== 'live') return;
      prefs.live = e.target.checked; savePrefs();
      if (prefs.live) runAnalyze();
    });
    win.addEventListener('keydown', e => {
      const p = e.target.closest?.('[data-p]');
      if (p && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); jumpTo(problems[+p.dataset.p].line); }
    });

    // drag by the title bar (floating mode)
    q('.ed-bar').addEventListener('mousedown', e => {
      if (prefs.mode !== 'float' || e.target.closest('button')) return;
      e.preventDefault();
      const ed = q('.ed'), sx = e.clientX, sy = e.clientY, ox = ed.offsetLeft, oy = ed.offsetTop;
      const move = ev => {
        ed.style.left = Math.max(0, Math.min(innerWidth - 120, ox + ev.clientX - sx)) + 'px';
        ed.style.top = Math.max(0, Math.min(innerHeight - 48, oy + ev.clientY - sy)) + 'px';
      };
      const up = () => { removeEventListener('mousemove', move); removeEventListener('mouseup', up); rememberRect(); };
      addEventListener('mousemove', move); addEventListener('mouseup', up);
    });
    sizeObs?.disconnect();
    if ('ResizeObserver' in window) (sizeObs = new ResizeObserver(() => { if (win) { rememberRect(); caretInfo(); } })).observe(q('.ed'));
  }

  // Pull text written to the sidebar box by other code (Example, Clear, Edit as scratch).
  function pullFromSide() {
    if (!win) return updateChip();
    const src = q('.ed-src');
    if (src.value !== side().value) { src.value = side().value; refresh(); }
    updateChip();
  }

  // ── global wiring ──
  function init() {
    $('sql-expand').addEventListener('click', open);
    $('sql-lint').addEventListener('click', () => { prefs.showProbs = true; open(); });
    side().addEventListener('input', pullFromSide);
    ['example-btn', 'clear-btn'].forEach(id => $(id)?.addEventListener('click', () => setTimeout(pullFromSide)));
    $('analyze-btn')?.addEventListener('click', () => { lastAnalyzed = side().value; if (win) refresh(); });
    // capture: Esc must close the editor before other handlers (e.g. Query→Project Esc) see it
    window.addEventListener('keydown', e => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.shiftKey && e.key.toLowerCase() === 'e') { e.preventDefault(); return win ? close() : open(); }
      if (!win) return;
      if (e.key === 'Escape' && !document.querySelector('.palette-bg, .tour-backdrop')) {
        e.preventDefault(); e.stopPropagation(); close();
      } else if (mod && e.key === 'Enter' && win.contains(e.target)) { e.preventDefault(); runAnalyze(); }
      else if (e.shiftKey && e.altKey && e.code === 'KeyF' && win.contains(e.target)) { e.preventDefault(); formatNow(); }
    }, true);
    addEventListener('resize', () => { if (win && prefs.mode === 'float') place(); });
    // query_context.js fills the box (and analyzes) on load when opened from a project file
    addEventListener('load', () => setTimeout(() => { lastAnalyzed = side().value; pullFromSide(); }));
    updateChip();
  }

  document.addEventListener('DOMContentLoaded', init);
  return { open, close, refresh: pullFromSide };
})();
