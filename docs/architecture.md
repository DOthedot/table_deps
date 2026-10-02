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
    static/js/            # visualizer.js, project.js, colors.js, sql_parser.js, kimball_example.js
    static/css/           # shared.css (tokens + chrome), visualizer.css, project.css
public/                   # GENERATED mirror for Vercel — `make sync-public`
test_projects/            # kimball_retail, forecast_monthly, data_vault fixtures
ui_examples/              # standalone queries for the Query view
```

## The two views and how they connect (today)
| From → To | Mechanism | Problem |
|---|---|---|
| Query → Project | Sidebar link `/project` | Lands on an empty Project view; project must be re-opened |
| Project → Query | Double-click node → `localStorage` → `window.open('/')` | Hidden gesture, new tab, no way back, Query view doesn't know its source file |

This is being redesigned — see `docs/specs/2026-10-03-view-navigation.md`.

## Adding a feature
1. `/spec` → design doc in `docs/specs/`.
2. Failing test in `tests/` (Python) or a reproducible browser check (UI).
3. Implement; for UI, edit `frontend_service/` then `make sync-public`.
4. `make verify` → `/ship`.

## Decisions
See `docs/adr/` — index in `docs/README.md`.
