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
- `static/css/shared.css` — theme tokens (`:root`), header, sidebar, controls.

## Rules
- **Source of truth is this folder.** After any change: `make sync-public`
  (copies into `public/` for Vercel). `make verify` fails on drift.
- **Frozen:** DAG layout, node box rendering (`renderBox`), simulations, edge routing,
  column tracing. Navigation, header, sidebar chrome are fair game.
- Navigation between views is being redesigned — read
  `docs/specs/2026-10-03-view-navigation.md` before touching it.
- Current hand-off Project → Query: `openNodeInVisualizer()` in `project.js` writes
  `localStorage['table_deps_viz_sql']` and opens `/` in a new tab; `visualizer.js` reads
  and deletes it on load.
- No build step, no bundler: plain `<script>` tags, D3 v7 from CDN.
- Verify UI changes in a real browser (`make project-ui`), not just `node --check`.
