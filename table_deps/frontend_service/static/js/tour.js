// ── WELCOME GUIDE — first-visit overview with looping CSS scenes ──────────
// Shown once per browser (localStorage), reopened from the header "?" button
// or the "?" key. Scenes are pure CSS/SVG — no media files. Design and
// mockup: docs/specs/2026-10-03-onboarding-guide.md.
// The top part (shouldAutoOpen / markSeen) is pure and unit-tested in
// tests/js/tour.test.js; everything below the `document` guard is DOM.

const TDTour = (() => {
  const SEEN_KEY = 'table_deps_tour_seen';

  // Deep links (?t= / ?sel=) open straight to what was shared, so no popup.
  function shouldAutoOpen(storage, search) {
    const q = new URLSearchParams(search || '');
    if (q.get('t') || q.get('sel')) return false;
    try { return !(storage && storage.getItem(SEEN_KEY)); } catch { return true; }
  }
  function markSeen(storage) { try { storage.setItem(SEEN_KEY, '1'); } catch { /* private mode */ } }

  if (typeof document === 'undefined') return { SEEN_KEY, shouldAutoOpen, markSeen };

  // ── keyframe factory: every element gets its own timeline in a 7 s loop ──
  const LOOP = 7, STAGE_W = 546;
  const made = new Set();
  let sheet = null;
  function kf(name, body) {
    sheet ??= document.head.appendChild(document.createElement('style')).sheet;
    if (!made.has(name)) { made.add(name); sheet.insertRule(`@keyframes ${name}{${body}}`); }
    return name;
  }
  const anim = (name, timing = 'ease') => `animation:${name} ${LOOP}s ${timing} infinite both;`;
  const hash = s => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7).toString(36);

  // appear at a% (pop | fade | slide | draw | type), hold to 88%, gone by 95%
  function at(kind, a) {
    const b = Math.min(a + 6, 86);
    const [from, to] = {
      pop: ['opacity:0;transform:scale(.6)', 'opacity:1;transform:scale(1)'],
      fade: ['opacity:0', 'opacity:1'],
      slide: ['opacity:0;transform:translateX(-24px)', 'opacity:1;transform:none'],
      draw: ['stroke-dashoffset:1;opacity:1', 'stroke-dashoffset:0;opacity:1'],
      type: ['clip-path:inset(0 100% 0 0)', 'clip-path:inset(0 0 0 0)'],
    }[kind];
    const end = kind === 'draw' ? 'opacity:0' : from;
    const name = kf(`td-${kind}-${a}`, `0%,${a}%{${from}} ${b}%{${to}} 88%{${to}} 95%,100%{${end}}`);
    return anim(name, kind === 'type' ? `steps(${Math.max(4, (b - a) * 2)})` : 'ease');
  }
  const between = (a, b, from = 'opacity:0', to = 'opacity:1') =>
    anim(kf(`td-btw-${a}-${b}-${hash(from + to)}`, `0%,${a}%{${from}} ${a + 3}%,${b}%{${to}} ${b + 3}%,100%{${from}}`));
  const press = a => anim(kf(`td-press-${a}`,
    `0%,${a}%{transform:scale(1);filter:none} ${a + 1.5}%{transform:scale(.88);filter:brightness(1.6)} ${a + 4}%,100%{transform:scale(1);filter:none}`));
  const ripple = a => anim(kf(`td-rip-${a}`,
    `0%,${a}%{opacity:0;transform:scale(.3)} ${a + 1}%{opacity:1;transform:scale(.4)} ${a + 6}%,100%{opacity:0;transform:scale(1.5)}`));
  const once = (name, body) => anim(kf(`td-${name}`, body));
  function cursorPath(id, pts) {
    const frames = pts.map(([p, x, y]) => `${p}%{transform:translate(${x}px,${y}px);opacity:1}`).join(' ');
    return anim(kf(`td-cur-${id}`, `0%{transform:translate(${pts[0][1]}px,${pts[0][2]}px);opacity:0} ${frames} 95%,100%{opacity:0}`), 'ease-in-out');
  }
  const CURSOR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 2l7 19 2.5-7.5L20 11z" fill="#fff" stroke="#111" stroke-width="1.5" stroke-linejoin="round"/></svg>';
  const box = (n, c, x, y, style = '') =>
    `<div class="mb" data-n="${n}" style="--c:var(--t-${c});left:${x}px;top:${y}px;${style}"><i></i><i></i><i></i></div>`;
  const edge = (d, style = '', cls = '') => `<path pathLength="1" stroke-dasharray="1" class="${cls}" d="${d}" style="${style}"/>`;
  const curve = (x1, y1, x2, y2) => { const m = (x1 + x2) / 2; return `M${x1},${y1} C${m},${y1} ${m},${y2} ${x2},${y2}`; };
  const canvasBg = 'background-color:var(--t-canvas);background-image:radial-gradient(#d9d3c7 1px,transparent 1px);background-size:18px 18px';

  // ── the five scenes (coordinates are px inside a 546×260 stage) ──
  const SCENES = [
    {
      title: 'Welcome to table-deps',
      text: 'See how your SQL tables depend on each other, as an interactive map. It all runs in your browser: no database, and nothing is uploaded.',
      stage: () => `
        <div class="file" style="--c:var(--t-src);left:26px;top:58px;${at('slide', 3)}">raw.orders.sql</div>
        <div class="file" style="--c:var(--t-dim);left:26px;top:112px;${at('slide', 9)}">dim.customer.sql</div>
        <div class="file" style="--c:var(--t-fact);left:26px;top:166px;${at('slide', 15)}">fact.sales.sql</div>
        <div class="arrow" style="left:196px;top:104px;${at('pop', 24)}">&rarr;</div>
        <svg class="edges">${edge(curve(354, 70, 420, 130), at('draw', 52))}${edge(curve(354, 186, 420, 130), at('draw', 56))}</svg>
        ${box('raw.orders', 'src', 258, 44, at('pop', 32))}
        ${box('dim.customer', 'dim', 258, 160, at('pop', 38))}
        ${box('fact.sales', 'fact', 420, 104, at('pop', 44))}
        <div class="cap" style="left:262px;top:226px;${at('fade', 60)}">sources &rarr; facts &rarr; reports</div>`,
    },
    {
      title: 'Paste a query, see its tables',
      text: 'In the <b>Query view</b>, paste any SQL and press <b>Analyze</b> (or <kbd>Ctrl</kbd>+<kbd>&crarr;</kbd>). Each table becomes a box, and each join becomes an arrow labelled with its type.',
      dark: true,
      stage: () => `
        <div class="mini-sb">
          <div class="mini-label">SQL Query</div>
          <div class="mini-ta">
            <span style="${at('type', 4)}">SELECT o.id, c.name</span>
            <span style="${at('type', 12)}">FROM orders o</span>
            <span style="${at('type', 20)}">JOIN customers c ON &hellip;</span>
            <span style="${at('type', 28)}">LEFT JOIN payments p &hellip;</span>
          </div>
          <div class="mini-btn" style="${press(44)}">&#9654; Analyze</div>
        </div>
        <div class="fill" style="left:178px;${canvasBg}"></div>
        <svg class="edges">${edge('M298,128 L392,66', at('draw', 60))}${edge('M298,128 L392,190', at('draw', 63))}</svg>
        ${box('orders', 'fact', 214, 102, at('pop', 50))}
        ${box('customers', 'dim', 392, 40, at('pop', 54))}
        ${box('payments', 'src', 392, 164, at('pop', 57))}
        <div class="lbl" style="left:330px;top:84px;${at('fade', 66)}">INNER</div>
        <div class="lbl" style="left:334px;top:160px;${at('fade', 68)}">LEFT</div>
        <div class="cursor" style="${cursorPath('q', [[34, 150, 210], [42, 40, 142], [46, 40, 142], [60, 120, 230]])}">${CURSOR}</div>
        <div class="ripple" style="left:48px;top:150px;${ripple(44)}"></div>`,
    },
    {
      title: 'Open a whole project',
      text: 'In the <b>Project view</b>, open a folder of <code>schema.table.sql</code> files. Each file becomes a node, laid out left to right from raw sources to reports.',
      stage: () => `
        <div class="folder" style="left:20px;top:88px">
          <span class="folder-ic">&#x1f4c1;</span><b style="${at('fade', 30)}">kimball_retail</b>
          <span style="${at('fade', 32)}">15 tables &middot; 28 deps</span>
        </div>
        <div class="file" style="--c:var(--t-src);left:24px;top:14px;${once('fly1', '0%,4%{opacity:0;transform:none} 8%{opacity:1} 20%{opacity:1;transform:translate(16px,90px) scale(.6)} 24%,100%{opacity:0;transform:translate(16px,90px) scale(.5)}')}">src.raw_customers.sql</div>
        <div class="file" style="--c:var(--t-dim);left:24px;top:14px;${once('fly2', '0%,10%{opacity:0;transform:none} 14%{opacity:1} 26%{opacity:1;transform:translate(16px,90px) scale(.6)} 30%,100%{opacity:0;transform:translate(16px,90px) scale(.5)}')}">dim.customer.sql</div>
        <svg class="edges">
          ${edge(curve(258, 54, 290, 54), at('draw', 66))}${edge(curve(258, 170, 290, 170), at('draw', 67))}
          ${edge(curve(386, 54, 404, 112), at('draw', 69))}${edge(curve(386, 170, 404, 112), at('draw', 70))}
          ${edge(curve(500, 112, 510, 112), at('draw', 72))}
        </svg>
        <div class="cap" style="left:186px;top:8px;${at('fade', 40)}">L0</div>
        ${box('src.customers', 'src', 162, 28, at('pop', 40))}
        ${box('src.stores', 'src', 162, 144, at('pop', 42))}
        <div class="cap" style="left:316px;top:8px;${at('fade', 48)}">L1</div>
        ${box('dim.customer', 'dim', 290, 28, at('pop', 48))}
        ${box('dim.store', 'dim', 290, 144, at('pop', 50))}
        <div class="cap" style="left:430px;top:66px;${at('fade', 56)}">L2</div>
        ${box('fact.sales', 'fact', 404, 86, at('pop', 56))}
        <div class="cap" style="left:470px;top:226px;${at('fade', 74)}">&rarr; reports</div>`,
    },
    {
      title: 'Click to inspect, open to dive in',
      text: 'Click any node to see what it <b>reads from</b> and what <b>uses</b> it. Press <b>Open in Query view</b> to see that file\'s own graph. <kbd>Esc</kbd> brings you back to the DAG.',
      stage: () => `
        <svg class="edges">
          <path d="${curve(106, 60, 138, 120)}"/><path d="${curve(106, 190, 138, 120)}"/><path d="${curve(234, 120, 262, 120)}"/>
          <path class="hi" d="${curve(106, 60, 138, 120)}" style="${between(27, 58)}"/>
          <path class="hi" d="${curve(106, 190, 138, 120)}" style="${between(27, 58)}"/>
          <path class="hi" d="${curve(234, 120, 262, 120)}" style="${between(27, 58)}"/>
        </svg>
        ${box('dim.customer', 'dim', 10, 34)}
        ${box('dim.store', 'dim', 10, 164)}
        ${box('fact.returns', 'fact', 138, 94, between(27, 58, 'box-shadow:none', 'box-shadow:0 0 0 4px rgba(63,185,80,.45)'))}
        ${box('rpt.c360', 'rpt', 262, 94)}
        <div class="ins" style="${once('ins', '0%,28%{opacity:0;transform:translateX(30px)} 33%,58%{opacity:1;transform:none} 61%,100%{opacity:0;transform:none}')}">
          <div class="ins-t">fact.returns</div><div class="ins-s">fact.returns.sql &middot; L2</div>
          <div class="ins-k">READS FROM &middot; 2</div><div class="chipz"><span>dim.customer</span><span>dim.store</span></div>
          <div class="ins-k">USED BY &middot; 1</div><div class="chipz"><span>rpt.c360</span></div>
          <div class="ins-open" style="${press(55)}">Open in Query view &crarr;</div>
        </div>
        <div class="qv" style="${canvasBg};${once('qv', '0%,59%{opacity:0} 63%,90%{opacity:1} 95%,100%{opacity:0}')}">
          <div class="qv-bar"><span class="qv-back">&larr; kimball_retail</span><span>Reads from</span><b>dim.customer</b><b>dim.store</b></div>
          <svg class="edges"><path d="M226,140 L330,92"/><path d="M226,140 L330,196"/></svg>
          ${box('fact.returns', 'fact', 140, 116)}${box('dim.customer', 'dim', 330, 64)}${box('dim.store', 'dim', 330, 172)}
          <div class="toast" style="${once('toast', '0%,72%{opacity:0} 75%,90%{opacity:1} 95%,100%{opacity:0}')}"><kbd>Esc</kbd> back to the DAG</div>
        </div>
        <div class="cursor" style="${cursorPath('i', [[8, 470, 230], [22, 182, 116], [26, 182, 116], [44, 430, 112], [52, 448, 124], [58, 448, 124], [70, 500, 230]])}">${CURSOR}</div>
        <div class="ripple" style="left:188px;top:122px;${ripple(26)}"></div>
        <div class="ripple" style="left:454px;top:130px;${ripple(55)}"></div>`,
    },
    {
      title: 'Get around fast',
      text: '<kbd>1</kbd> / <kbd>2</kbd> switch between the Project and Query views. <kbd>&#x2318;K</kbd> jumps to any table. <kbd>Esc</kbd> goes back. Press <kbd>?</kbd> to see this guide again.',
      dark: true,
      stage: () => `
        <div class="mhead"><span class="mlogo">&#x2b21; table-deps</span>
          <div class="mseg"><div class="ind" style="${once('seg', '0%,11%{transform:none} 14%,72%{transform:translateX(70px)} 75%,100%{transform:none}')}"></div><span>Project</span><span>Query</span></div>
        </div>
        <div class="mbody">
          <div class="v" style="${once('vp', '0%,11%{opacity:1} 13%,73%{opacity:0} 76%,100%{opacity:1}')}"><span class="v-ic">&#x25c7;</span><b>Project view</b><span>the DAG</span></div>
          <div class="v" style="${once('vq', '0%,11%{opacity:0} 13%,73%{opacity:1} 76%,100%{opacity:0}')}"><span class="v-ic">&#x25ad;</span><b>Query view</b><span>one file's graph</span></div>
        </div>
        <div class="mpal" style="${between(36, 58, 'opacity:0;transform:translateY(-6px)', 'opacity:1;transform:none')}">
          <div class="mpal-in">cust<span class="caret">&#x258c;</span></div>
          <div class="r on" style="--c:var(--t-dim)"><i></i>dim.customer</div>
          <div class="r" style="--c:var(--t-rpt)"><i></i>rpt.customer_360</div>
          <div class="r" style="--c:var(--t-src)"><i></i>src.raw_customers</div>
        </div>
        <div class="keys">
          <div class="key"><kbd style="${press(11)}">2</kbd>Query</div>
          <div class="key"><kbd style="${press(35)}">&#x2318;K</kbd>Jump</div>
          <div class="key"><kbd style="${press(58)}">Esc</kbd>Close</div>
          <div class="key"><kbd style="${press(72)}">1</kbd>Project</div>
        </div>`,
    },
  ];

  // ── controller ──
  let root = null, step = 0, returnFocus = null;
  const onProject = () => location.pathname.startsWith('/project');

  function render() {
    const s = SCENES[step], last = step === SCENES.length - 1;
    root.innerHTML = `
      <div class="tour-card" role="dialog" aria-modal="true" aria-labelledby="tour-title">
        <div class="tour-top"><span class="tour-count">Step ${step + 1} of ${SCENES.length}</span>
          <button class="tour-x" data-act="close" title="Close (Esc)" aria-label="Close guide">&#x2715;</button></div>
        <div class="tour-stage ${s.dark ? 'dark' : ''}" aria-hidden="true"><div class="tour-scene">${s.stage()}</div></div>
        <div class="tour-text"><h2 id="tour-title">${s.title}</h2><p>${s.text}</p></div>
        <div class="tour-foot">
          <div class="tour-pips">${SCENES.map((_, k) =>
            `<button class="${k === step ? 'on' : ''}" data-step="${k}" aria-label="Step ${k + 1}"${k === step ? ' aria-current="step"' : ''}></button>`).join('')}</div>
          ${last
            ? `<div class="tour-ctas"><button class="tour-btn" data-act="own">Paste my own SQL</button>
               <button class="tour-btn pri" data-act="example">Explore example project &rarr;</button></div>`
            : `<button class="tour-skip" data-act="close">Skip</button>
               ${step ? '<button class="tour-btn" data-act="prev">&larr; Back</button>' : ''}
               <button class="tour-btn pri" data-act="next">${step ? 'Next &rarr;' : 'Show me how &rarr;'}</button>`}
        </div>
      </div>`;
    fitStage();
    root.querySelector('.tour-btn.pri').focus();
  }

  // Scale the fixed 546px scene down on narrow screens
  function fitStage() {
    const stage = root?.querySelector('.tour-stage');
    if (stage) stage.style.setProperty('--scale', Math.min(1, stage.clientWidth / STAGE_W));
  }

  function open(at = 0) {
    if (root) return;
    step = at;
    returnFocus = document.activeElement;
    root = document.createElement('div');
    root.className = 'tour-backdrop';
    root.addEventListener('mousedown', e => { if (e.target === root) close(); });
    root.addEventListener('click', onClick);
    document.body.appendChild(root);
    document.getElementById('help-btn')?.classList.remove('pulse');
    render();
  }

  function close() {
    if (!root) return;
    markSeen(localStorage);
    root.remove(); root = null;
    returnFocus?.focus?.();
  }

  const go = k => { step = Math.max(0, Math.min(SCENES.length - 1, k)); render(); };

  function onClick(e) {
    const pip = e.target.closest('[data-step]');
    if (pip) return go(+pip.dataset.step);
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'close') close();
    else if (act === 'next') go(step + 1);
    else if (act === 'prev') go(step - 1);
    else if (act === 'example') {
      close();
      if (onProject()) document.getElementById('example-btn')?.click();
      else location.href = TDNav.projectUrl('kimball_retail');
    } else if (act === 'own') {
      close();
      if (onProject()) location.href = TDNav.queryUrl();
      else document.getElementById('sql-input')?.focus();
    }
  }

  // Capture on window: while open, the guide owns the keyboard (app shortcuts
  // like 1/2, Tab, / must not fire behind the modal).
  window.addEventListener('keydown', e => {
    if (!root) {
      const typing = ['INPUT', 'TEXTAREA'].includes(e.target.tagName) || e.target.isContentEditable;
      if (e.key === '?' && !typing && !e.metaKey && !e.ctrlKey) { e.preventDefault(); open(); }
      return;
    }
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); go(step + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); go(step - 1); }
    else if (e.key === 'Tab') { // keep focus inside the card
      const f = [...root.querySelectorAll('button')];
      const i = f.indexOf(document.activeElement);
      e.preventDefault();
      f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus();
    }
  }, true);
  window.addEventListener('resize', fitStage);

  document.addEventListener('DOMContentLoaded', () => {
    const help = document.getElementById('help-btn');
    help?.addEventListener('click', () => open());
    if (shouldAutoOpen(localStorage, location.search)) open();
    else if (!localStorage.getItem(SEEN_KEY)) help?.classList.add('pulse'); // deep link, first visit
  });

  return { SEEN_KEY, shouldAutoOpen, markSeen, open, close };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = TDTour;
