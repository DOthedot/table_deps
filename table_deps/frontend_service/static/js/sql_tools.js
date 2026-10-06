// ── SQL TOOLS — tokenize, table refs, lint, fixes, basic formatter, highlight ──
// Pure, DOM-free logic for the SQL editor (sql_editor.js). Loaded as a classic
// <script> (global `TDSql`) and required by tests/js/sql_tools.test.js.
// Like the rest of table-deps this is regex-based, not a SQL AST (ADR-0002).

const TDSql = (() => {
  const KW = new Set(('select from where join inner left right full outer cross natural on and or not in is ' +
    'null as with by group order having limit offset union all distinct case when then else end between ' +
    'like ilike exists using over partition asc desc create table view replace insert into values update ' +
    'set delete recursive lateral true false window qualify filter rows range interval if').split(' '));
  const ENDS_FROM = new Set(['where', 'group', 'order', 'having', 'limit', 'union', 'select', 'window', 'qualify', 'offset']);
  const JOIN_MOD = new Set(['left', 'right', 'inner', 'full', 'cross', 'natural', 'outer']);
  const CASE_KW = new Set(['select', 'from', 'where', 'join', 'on', 'and', 'or', 'group', 'order', 'by', 'as', 'left', 'inner', 'with', 'having']);

  // com | str | qid | num | word | ws | p     (tokens concatenate back to the input)
  const TOK = /(--[^\n]*|\/\*[\s\S]*?(?:\*\/|$))|('(?:[^']|'')*'?)|("(?:[^"]|"")*"?|`[^`]*`?)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][\w$]*(?:\.[A-Za-z_*][\w$]*)*)|(\s+)|([\s\S])/g;
  function tokenize(sql) {
    const out = []; let m;
    TOK.lastIndex = 0;
    while ((m = TOK.exec(sql))) {
      const k = m[1] ? 'com' : m[2] ? 'str' : m[3] ? 'qid' : m[4] ? 'num' : m[5] ? 'word' : m[6] ? 'ws' : 'p';
      out.push({ t: m[0], i: m.index, k });
    }
    return out;
  }
  const significant = sql => tokenize(sql).filter(x => x.k !== 'ws' && x.k !== 'com');

  // Tables after FROM / JOIN, and after commas in a FROM list at the same paren depth.
  function tableRefs(sql) {
    const toks = significant(sql);
    const ctes = [], cteSet = new Set(), tables = [], seen = new Set();
    let joins = 0, depth = 0, fromDepth = -1, prev = '';
    toks.forEach((x, k) => {
      const lw = x.t.toLowerCase();
      if (x.t === '(') depth++;
      else if (x.t === ')') { depth--; if (depth < fromDepth) fromDepth = -1; }
      if (x.k === 'word' && toks[k + 1]?.t.toLowerCase() === 'as' && toks[k + 2]?.t === '(' && !cteSet.has(lw)) {
        cteSet.add(lw); ctes.push(lw);
      }
      const afterComma = prev === ',' && depth === fromDepth;
      if (x.k === 'word' && !KW.has(lw) && (prev === 'from' || prev === 'join' || afterComma) && !cteSet.has(lw) && !seen.has(lw)) {
        seen.add(lw); tables.push(lw);
      }
      if (lw === 'join') joins++;
      if (lw === 'from') fromDepth = depth;
      else if (ENDS_FROM.has(lw) && depth === fromDepth) fromDepth = -1;
      prev = x.k === 'word' ? lw : x.t;
    });
    return { tables, ctes, joins };
  }

  // ── lint ──────────────────────────────────────────────────────────────
  // Mask comments and string contents (same length, newlines kept) so rules never see them.
  function mask(sql) {
    return tokenize(sql).map(x => {
      if (x.k === 'com') return x.t.replace(/[^\n]/g, ' ');
      if (x.k === 'str') return x.t.length > 1 ? "'" + ' '.repeat(x.t.length - 2) + "'" : x.t;
      return x.t;
    }).join('');
  }
  const lineOf = (sql, i) => sql.slice(0, i).split('\n').length;
  const RANK = { error: 0, warning: 1, info: 2 };

  function lint(sql) {
    const code = mask(sql), P = [];
    const add = (sev, rule, from, len, msg, fix) => P.push({ sev, rule, line: lineOf(sql, from), from, to: from + len, msg, fix });
    let m;

    const open = [];
    [...code].forEach((c, i) => {
      if (c === '(') open.push(i);
      else if (c === ')') { if (open.length) open.pop(); else add('error', 'unbalanced-parens', i, 1, 'Unexpected ")": no matching "("'); }
    });
    open.forEach(i => add('error', 'unbalanced-parens', i, 1, '"(" is never closed'));

    const tc = /,(?=\s*\bfrom\b)/gi;
    while ((m = tc.exec(code))) add('error', 'trailing-comma', m.index, 1, 'Trailing comma before FROM', 'trailing-comma');

    // After each JOIN, look for ON/USING at the JOIN's own paren depth, skipping
    // subqueries like "JOIN (SELECT … WHERE …) e ON …"; stop at the next clause.
    const jre = /\b((?:left|right|inner|full|cross|natural)\s+(?:outer\s+)?)?join\b/gi;
    const STOP = /\(|\)|\b(on|using|join|where|group\s+by|order\s+by|having|limit|union|qualify|window)\b/gi;
    while ((m = jre.exec(code))) {
      if (/^(cross|natural)/i.test(m[1] || '')) continue;
      let depth = 0, found = false, s;
      STOP.lastIndex = m.index + m[0].length;
      while ((s = STOP.exec(code))) {
        if (s[0] === '(') depth++;
        else if (s[0] === ')') { if (--depth < 0) break; } // left the enclosing subquery
        else if (depth === 0) { found = /^(on|using)$/i.test(s[1]); break; }
      }
      if (!found) add('error', 'join-without-on', m.index, m[0].length, 'JOIN has no ON / USING condition');
    }

    const ss = /\bselect\s+(?:distinct\s+)?\*|,\s*\*(?=\s|$)/gi;
    while ((m = ss.exec(code))) add('warning', 'select-star', m.index + m[0].lastIndexOf('*'), 1, 'Avoid SELECT *: list columns so lineage stays explicit');

    const ij = /\bfrom\s+[\w.]+(?:\s+(?:as\s+)?(?!(?:where|join|left|right|inner|full|cross|natural|group|order|on|limit|union)\b)\w+)?\s*,\s*[\w.]+/gi;
    while ((m = ij.exec(code))) add('warning', 'implicit-join', m.index, 4, 'Implicit join (FROM a, b): use an explicit JOIN … ON');

    // Token-based, so identifiers like hub.order or t.from never count as keywords.
    const kws = tokenize(sql).filter(x => x.k === 'word' && CASE_KW.has(x.t.toLowerCase()));
    const up = kws.filter(x => x.t === x.t.toUpperCase()).length;
    const lo = kws.filter(x => x.t === x.t.toLowerCase()).length;
    if (up && lo) add('info', 'keyword-case', kws[0].i, 0, `Keywords in mixed case (${up} upper, ${lo} lower)`, 'format');
    return P.sort((a, b) => RANK[a.sev] - RANK[b.sev] || a.line - b.line || a.from - b.from);
  }

  // Returns the fixed SQL, or null when the problem has no automatic fix.
  function applyFix(sql, p, format = formatBasic) {
    if (p.fix === 'trailing-comma') return sql.slice(0, p.from) + sql.slice(p.to);
    if (p.fix === 'format') return format(sql);
    return null;
  }

  // ── basic formatter (fallback for sql-formatter, ADR-0004) ──────────────
  const CLAUSE = new Set(['select', 'from', 'where', 'having', 'limit', 'union', 'with', 'join', 'group', 'order', 'qualify', 'window']);
  function formatBasic(sql) {
    const toks = tokenize(sql).filter(x => x.k !== 'ws');
    const lines = [], stack = [];
    let line = '', depth = 0, clause = '', between = false;
    const brk = (extra = 0) => { if (line.trim()) lines.push(line.replace(/\s+$/, '')); line = '    '.repeat(depth) + ' '.repeat(extra); };
    const push = s => { line += (!line.trim() || /[(.]$/.test(line) || /^[,).]/.test(s) ? '' : ' ') + s; };

    toks.forEach((x, k) => {
      const lw = x.t.toLowerCase(), next = toks[k + 1]?.t.toLowerCase(), prevLw = toks[k - 1]?.t.toLowerCase();
      const word = x.k === 'word' && KW.has(lw) ? x.t.toUpperCase() : x.t;
      if (x.k === 'com') { brk(); line += x.t; brk(); return; }
      if (x.k === 'word') {
        const joinStart = JOIN_MOD.has(lw) && lw !== 'outer' && (next === 'join' || next === 'outer');
        const startsClause = (CLAUSE.has(lw) && !(lw === 'join' && JOIN_MOD.has(prevLw))) || joinStart;
        if (startsClause) { brk(); clause = joinStart ? 'join' : lw; push(word); if (lw === 'select') brk(4); return; }
        if (lw === 'between') between = true;
        if (lw === 'on') { brk(4); push(word); return; }
        if ((lw === 'and' || lw === 'or') && ['where', 'having', 'join'].includes(clause)) {
          if (between && lw === 'and') between = false;
          else { brk(4); push(word); return; }
        }
      }
      if (x.t === '(') {
        const call = toks[k - 1]?.k === 'word' && !KW.has(prevLw);
        if (call) line += '('; else push('(');
        stack.push({ sub: next === 'select', clause }); depth++;
        if (next === 'select') brk();
        return;
      }
      if (x.t === ')') {
        depth = Math.max(0, depth - 1);
        const fr = stack.pop() || { sub: false, clause };
        clause = fr.clause;
        if (fr.sub) brk();
        push(')');
        return;
      }
      if (x.t === ',') {
        push(',');
        if (prevLw === ')' && clause === 'with') brk(); // next CTE on its own line
        else if (['select', 'group', 'order'].includes(clause)) brk(4);
        return;
      }
      push(word);
    });
    brk();
    return lines.join('\n');
  }

  // ── highlight → HTML for the overlay <pre> ─────────────────────────────
  const esc = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  function highlight(sql, problems, colorOf) {
    const toks = tokenize(sql), tables = new Set(tableRefs(sql).tables);
    const marks = problems.filter(p => p.to > p.from);
    const nextSig = k => { for (let j = k + 1; j < toks.length; j++) if (toks[j].k !== 'ws') return toks[j]; return null; };
    return toks.map((x, k) => {
      let s = esc(x.t);
      if (x.k === 'com') s = `<span class="t-com">${s}</span>`;
      else if (x.k === 'str') s = `<span class="t-str">${s}</span>`;
      else if (x.k === 'num') s = `<span class="t-num">${s}</span>`;
      else if (x.k === 'word') {
        const lw = x.t.toLowerCase();
        if (KW.has(lw)) s = `<span class="t-kw">${s}</span>`;
        else if (tables.has(lw)) s = `<span class="t-tbl" style="--c:${colorOf(lw.split('.')[0])}">${s}</span>`;
        else if (nextSig(k)?.t === '(') s = `<span class="t-fn">${s}</span>`;
      }
      const hit = x.k !== 'ws' && marks.find(p => x.i < p.to && x.i + x.t.length > p.from);
      return hit ? `<span class="sq ${hit.sev}">${s}</span>` : s;
    }).join('');
  }

  return { tokenize, tableRefs, lint, applyFix, formatBasic, highlight };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = TDSql;
