# table-deps

Extract SQL table dependencies and visualise them as interactive graphs — no database connection required.

---

## Why This Exists

Reading a complex SQL query and mentally mapping out which tables feed into which is harder than it sounds.

A real-world query often has 5–10 CTEs, a mix of `LEFT JOIN`, `INNER JOIN`, and `UNION ALL` branches, inline subqueries, and tables spread across multiple schemas. By the time you reach the final `SELECT`, it's easy to lose track of the full dependency chain.

This becomes a real problem when:

- **Planning a migration** — you need the exact order in which tables must be recreated or backfilled.
- **Onboarding to an unfamiliar codebase** — tracing what a query actually touches, without running it against a live database.
- **Refactoring or deprecating tables** — understanding what upstream queries will break before you change anything.
- **Reviewing someone else's SQL** — quickly building a mental model of a query you didn't write.

`table-deps` solves this by parsing SQL statically and rendering interactive dependency graphs — so you see the full picture in seconds instead of reading line by line.

---

## Quick Start

**Try it live** (no install needed) → deployed on Vercel

Or run locally:

```bash
# Install
uv sync

# Visualise a single SQL query in the browser
uv run table-deps ui

# Visualise an entire project directory as a DAG
uv run table-deps project-ui test_projects/kimball_retail
```

---

## Features

| Area | Feature |
| --- | --- |
| **Parser** | Detects `FROM`, `JOIN`, `INTO`, `UPDATE`; strips CTE aliases; handles schema-qualified names, quoted identifiers, comments |
| **CLI** | Plain / JSON / CSV output; reads from inline SQL, file, or stdin |
| **SQL Visualizer** | Force-directed graph of a single query — CTEs as named boxes, join-type edge labels, UNION branches |
| **Project DAG** | Left-to-right DAG of an entire project directory — one node per `.sql` file, cross-file dependency edges |

---

## Requirements

- Python ≥ 3.11

## Installation

```bash
uv sync
```

With development dependencies (pytest, coverage):

```bash
uv sync --extra dev
```

---

## CLI Usage

```text
table-deps [SQL_OR_FILE] [--file] [--output-format {plain,json,csv}] [--verbose]
```

### Examples

```bash
# Inline SQL
table-deps "SELECT * FROM orders JOIN customers ON orders.customer_id = customers.id"

# From a file
table-deps --file query.sql

# From stdin
cat query.sql | table-deps

# JSON output
table-deps "SELECT * FROM orders JOIN customers ON orders.customer_id = customers.id" -o json

# CSV output
table-deps "SELECT * FROM orders JOIN customers ON orders.customer_id = customers.id" -o csv

# Debug logging
table-deps "SELECT * FROM orders" --verbose
```

---

## SQL Visualizer UI

Visualise the dependencies inside a **single SQL query** as an interactive force-directed graph.
Starts a local HTTP server at `http://127.0.0.1:7654` and opens the browser automatically:

```bash
uv run table-deps ui
```

![SQL Visualizer](docs/ui_screenshot.png)

### SQL Visualizer Features

- Force-directed graph — nodes are draggable, canvas is zoomable and pannable
- Schema-based colour coding (`public`, `analytics`, `hr`, `finance`, …)
- **Table boxes** — each table rendered as a named box (matching the Project DAG style) with `schema.` prefix dimmed and table name highlighted; lists every column referenced in the query (SELECT, JOIN, WHERE, GROUP BY) as dot-prefixed rows
- **Column-level edge routing** — arrows exit from the exact column row used in the JOIN condition, making join keys immediately visible
- **Subquery column extraction** — tables inside inline subqueries (`JOIN (...) alias`) expose their full SELECT column list, not just join keys
- **CTE boxes** — each CTE rendered as a named box; internal tables appear as mini table-boxes with their own column lists and schema colours
- Edge arrows show data flow direction; edge labels show JOIN type (INNER, LEFT, RIGHT, FULL, CROSS)
- **UNION / UNION ALL** branches connected by dashed cyan edges
- Sidebar: table list, CTE list, stats, schema legend, join-type legend
- **★ Example** button — loads a built-in complex query instantly
- `Ctrl+Enter` / `Cmd+Enter` to re-analyse

### Example Queries

The `ui_examples/` folder contains four ready-to-paste queries:

| File | Domain | Schemas |
| --- | --- | --- |
| `ecommerce_orders.sql` | E-commerce order fulfilment | `public`, `inventory`, `payments`, `shipping`, `analytics` |
| `hr_payroll.sql` | HR payroll & headcount | `hr`, `finance`, `compliance`, `org` |
| `analytics_funnel.sql` | Product analytics funnel | `events`, `users`, `product`, `marketing`, `billing` |
| `finance_reporting.sql` | Multi-entity P&L consolidation | `finance`, `gl`, `fx`, `audit`, `reporting` |

---

## Project DAG UI

Scan a directory of SQL files and visualise the **entire project's cross-file dependency graph**.
Starts a local HTTP server, scans the project, and opens the browser automatically:

```bash
uv run table-deps project-ui /path/to/your/project
```

Files must follow the `schema.table_name.sql` naming convention. Each file becomes a node; the graph flows **left → right** by dependency level — source/raw tables on the left, reports and marts on the right.

![Project DAG UI](docs/project_overview_ui.png)

### Project DAG Features

- **Left-to-right DAG layout** — topological levels computed automatically, no configuration needed
- **Dynamic schema colouring** — the schema prefix (everything before the first `.` in the filename) is used as the layer colour; works for any architecture (Medallion, Kimball, Data Vault, etc.)
- **CTE-style node boxes** — each node shows its schema header and dependency list; coloured dots distinguish internal project deps from external refs
- **Physics simulation** — nodes repel each other and bounce; drag a node and release to watch it spring back to its original position
- **Live edge stretching** — bezier edges redraw in real time while dragging
- **Double-click a node** → opens that file's SQL in the SQL Visualizer in a new tab, auto-analyzed
- **★ Example** button — loads the Kimball retail project instantly (no folder needed)
- Zoom · Pan · Fit-to-view · Reset layout controls
- Sidebar: project stats, table list sorted by DAG level, schema colour legend
- Served via a local HTTP server at `http://127.0.0.1:7654` — no `file://` limitations
- Browser folder picker still available for ad-hoc use without the CLI

### Naming Convention

```text
schema.table_name.sql
│       │
│       └─ table name (underscores ok)
└─ schema / layer prefix  →  determines node colour
```

Examples: `raw.orders.sql`, `dim.customer.sql`, `fact.sales.sql`, `mart.revenue_summary.sql`

### Example Projects

Three example projects are included under `test_projects/`:

| Project | Architecture | Layers | Nodes | Edges |
| --- | --- | --- | --- | --- |
| `kimball_retail` | Kimball star schema | `src` → `dim` → `fact` → `rpt` | 15 | 28 |
| `forecast_monthly` | Medallion | `raw` → `staging` → `mart` → `gold` | 11 | 17 |
| `data_vault` | Data Vault 2.0 | `raw` → `hub`/`link`/`sat` → `bv` → `mart` | 19 | 35 |

```bash
uv run table-deps project-ui test_projects/kimball_retail
uv run table-deps project-ui test_projects/forecast_monthly
uv run table-deps project-ui test_projects/data_vault
```

---

## Python Library Usage

```python
from table_deps import extract_tables

sql = """
    WITH ranked AS (SELECT * FROM employees ORDER BY salary DESC)
    SELECT r.name, d.name
    FROM ranked r
    JOIN departments d ON r.dept_id = d.id
"""

tables = extract_tables(sql)
print(tables)  # ['departments', 'employees']
```

`extract_tables` raises `ValueError` for empty input and returns a sorted, deduplicated, lowercased list of table names with CTE aliases removed.

---

## Project Structure

```text
table_deps/
├── table_deps/              # Library package
│   ├── __init__.py          # Public API: extract_tables
│   ├── extractor.py         # Core regex parsing logic
│   ├── cli.py               # CLI — ui and project-ui subcommands
│   ├── project_scanner.py   # Directory scanner: builds cross-file dep graph
│   └── frontend_service/    # Local HTTP server + split CSS/JS/HTML templates
│       ├── server.py              # stdlib HTTP server (no external deps)
│       ├── templates/
│       │   ├── visualizer.html    # SQL Visualizer page
│       │   └── project.html       # Project DAG page
│       └── static/
│           ├── css/
│           │   ├── shared.css     # Shared variables, layout, sidebar, controls
│           │   ├── visualizer.css # Visualizer-specific styles
│           │   └── project.css    # Project DAG-specific styles
│           └── js/
│               ├── colors.js      # Schema colour palette (shared)
│               ├── sql_parser.js  # SQL_KEYWORDS + FROM_JOIN_RE (shared)
│               ├── visualizer.js  # D3 SQL visualizer app
│               └── project.js     # D3 project DAG app
├── tests/
│   ├── test_extractor.py    # 36 parser tests
│   └── test_cli.py          # 8 CLI tests
├── ui_examples/             # Complex SQL queries for the SQL Visualizer
│   ├── ecommerce_orders.sql
│   ├── hr_payroll.sql
│   ├── analytics_funnel.sql
│   └── finance_reporting.sql
├── test_projects/           # Example multi-file projects for the Project DAG UI
│   ├── kimball_retail/      # Kimball star schema  (15 files)
│   ├── forecast_monthly/    # Medallion architecture (11 files)
│   └── data_vault/          # Data Vault 2.0 (19 files)
├── docs/
│   └── ui_screenshot.png
├── public/                  # Static build for Vercel deployment
│   ├── index.html           # SQL Visualizer (served at /)
│   ├── project.html         # Project DAG (served at /project)
│   └── static/              # CSS + JS assets
├── vercel.json              # Vercel route rewrites
├── main.py                  # Backward-compatible entry point
└── pyproject.toml
```

---

## Running Tests

```bash
uv run pytest
```

With coverage:

```bash
uv run pytest --cov=table_deps --cov-report=term-missing
```

---

## Live Demo

The SQL Visualizer and Project DAG are deployed as a static site on Vercel — no installation needed:

- **SQL Visualizer** — paste any SQL query and explore the dependency graph
- **Project DAG** — open a local folder of `.sql` files and visualise the full project graph

Both pages run entirely in the browser (no backend, no data sent anywhere).

---

## Deployment

The `public/` directory contains the static build ready for Vercel.

### Deploy to Vercel (one-time setup)

1. Push this repo to GitHub
2. Go to [vercel.com](https://vercel.com) → **Add New Project** → import the repo
3. Set **Framework Preset** to `Other` and **Output Directory** to `public`
4. Click **Deploy**

Every subsequent `git push` to `main` triggers an automatic re-deploy.

### Project structure for Vercel

```text
public/
├── index.html          ← SQL Visualizer  (served at / and /visualizer)
├── project.html        ← Project DAG     (served at /project)
└── static/
    ├── css/            ← shared, visualizer, project styles
    └── js/             ← colors, sql_parser, visualizer, project scripts
vercel.json             ← route rewrites (/visualizer → index.html, /project → project.html)
```

---

## Limitations

- Uses regex-based parsing, not a full SQL AST. Extremely unusual constructs (e.g. dynamic SQL in stored procedures) may not parse correctly.
- Does not resolve view definitions or follow cross-database references.
- Project DAG UI requires files named `schema.table.sql`; files not matching this pattern are skipped.
