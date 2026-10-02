# Architecture

## Overview
`table-deps` is a static analyser: SQL text in, dependency graph out, never touching a
database. One parsing idea, three surfaces.

```
                ┌──────────────────────┐
  SQL text ───▶ │ extractor.py (regex) │ ──▶ list[str] tables ──▶ CLI (plain/json/csv)
                └──────────────────────┘
                           ▲
  folder of     ┌──────────┴───────────┐
  schema.t.sql ▶│ project_scanner.py   │ ──▶ {nodes, edges} ──▶ /api/scan ──▶ Project view
                └──────────────────────┘

  Browser (no Python needed — this is what Vercel serves):
    Query view    visualizer.js  parses one query client-side → force graph (tables, CTEs, joins)
    Project view  project.js     scans a picked folder client-side (or reads /api/scan)
                                 → computeLevels() → left-to-right DAG
```

## Principles
- **Stdlib-only Python.** No runtime dependencies; installs anywhere.
- **Deep module, thin edges.** `extractor.py` holds the parsing complexity behind one
  function; `cli.py` and `server.py` only translate.
- **Browser-first UI.** Both views work with zero backend, which is why `public/` can be a
  pure static deploy (ADR-0003). The Python server is a local convenience.
- **One verification command.** `make verify` — hooks and CI call the same thing.

## Module map
```
table_deps/
  extractor.py            # SQL → tables (deep module)            ← tests/test_extractor.py
  project_scanner.py      # folder → nodes/edges
  cli.py                  # argparse edge                         ← tests/test_cli.py
  frontend_service/
    server.py             # stdlib HTTP: /, /project, /api/scan, /static
    templates/            # visualizer.html (Query view), project.html (Project view)
    static/js/            # visualizer.js, project.js, colors.js, sql_parser.js, kimball_example.js,
                          # nav.js (pure, tested), shell.js, inspector.js, query_context.js
    static/css/           # shared.css (tokens + chrome), visualizer.css, project.css
public/                   # GENERATED mirror for Vercel — `make sync-public`
test_projects/            # kimball_retail, forecast_monthly, data_vault fixtures
ui_examples/              # standalone queries for the Query view
tests/js/                 # node:test unit tests for nav.js
```

## How the two views connect
Both pages share one header (Project | Query switch, breadcrumb, ⌘K) from `shell.js`.
```
Project view ── click node ─▶ inspector ── Open / dbl-click / ↵ ──▶ /?p=<proj>&t=<file>
     ▲   writes sessionStorage snapshot                                  │ reads snapshot →
     └──────────── Esc / ← / breadcrumb / key 1 ◀────────────────────────┘ SQL + context strip
```
`nav.js` holds the rules (URLs, snapshot, reads-from / used-by, prev/next). Design and
decisions are in `docs/specs/2026-10-03-view-navigation.md`.

## Adding a feature
1. `/spec` → design doc in `docs/specs/`.
2. Failing test in `tests/` (Python) or a reproducible browser check (UI).
3. Implement; for UI, edit `frontend_service/` then `make sync-public`.
4. `make verify` → `/ship`.

## Decisions
See `docs/adr/` — index in `docs/README.md`.
