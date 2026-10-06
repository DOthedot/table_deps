# Module: frontend_service (web UI)

> Loaded when an agent works inside `table_deps/frontend_service/`.

## Responsibility
Serve and render the two views. Everything runs in the browser; the Python server only
serves files and `/api/scan` (pre-scanned project data from `table-deps project-ui DIR`).

## Files
- `server.py` — stdlib HTTP server. Routes: `/` and `/visualizer` → Query view,
  `/project` → Project view, `/api/scan`, `/static/*` (path-traversal guarded).
- `templates/visualizer.html` + `static/js/visualizer.js` — **Query view**.
- `templates/project.html` + `static/js/project.js` — **Project view** (DAG).
- `static/js/colors.js` — schema → colour palette shared by both views.
- `static/js/sql_parser.js` — shared keyword/regex constants.
- `static/js/nav.js`, `shell.js`, `inspector.js`, `query_context.js` — view navigation (see below).
- `static/js/sql_tools.js` (pure, tested), `sql_editor.js`, `static/css/sql_editor.css`: floating SQL
  editor with lint and format (`docs/specs/2026-10-03-sql-editor.md`). Lint rules live in `sql_tools.js`;
  add a failing case in `tests/js/sql_tools.test.js` first, and re-lint `test_projects/` for false positives.
- `static/js/tour.js` + `static/css/tour.css` — first-visit welcome guide
  (`docs/specs/2026-10-03-onboarding-guide.md`). Keep scenes in sync with the real UI.
- `static/css/shared.css` — theme tokens (`:root`), header, sidebar, controls.

## Rules
- **Source of truth is this folder.** After any change: `make sync-public`
  (copies into `public/` for Vercel). `make verify` fails on drift.
- **Frozen:** DAG layout, node box rendering (`renderBox`), simulations, edge routing,
  column tracing. Navigation, header, sidebar chrome are fair game.
- Navigation follows `docs/specs/2026-10-03-view-navigation.md` (option A).
  - `nav.js` is pure, DOM-free logic. **Change it test-first** in `tests/js/nav.test.js`
    (`make test-js`).
  - Hand-off: the Project view writes a snapshot to `sessionStorage['table_deps_project']`
    after every load. Navigation is same-tab (`/?p=…&t=…`, `/project?p=…&sel=…`).
  - `shell.js` (header, ⌘K), `inspector.js` (Project view), `query_context.js` (Query view).
- No build step, no bundler: plain `<script>` tags, D3 v7 from CDN.
- Verify UI changes in a real browser (`make project-ui`), not just `node --check`.
