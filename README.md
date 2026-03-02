# table-deps

Extract table dependencies from SQL queries — no database connection required.

## Why This Exists

Reading a complex SQL query and mentally mapping out which tables feed into which is harder than it sounds.

A real-world query often has 5–10 CTEs, a mix of `LEFT JOIN`, `INNER JOIN`, and `UNION ALL` branches, inline subqueries, and tables spread across multiple schemas. By the time you reach the final `SELECT`, it's easy to lose track of the full dependency chain — which table ultimately drives the result, which ones are optional lookups, and which CTEs are just intermediate transformations.

This becomes a real problem when:

- **Planning a downward migration** — you need to know the exact order in which tables must be recreated or backfilled, and missing a dependency means broken pipelines.
- **Onboarding to an unfamiliar codebase** — tracing what a query actually touches, without having to run it against a live database.
- **Refactoring or deprecating tables** — understanding what upstream queries depend on a table before you change or drop it.
- **Reviewing someone else's SQL** — quickly building a mental model of a query you didn't write.

`table-deps` solves this by parsing the SQL statically (no database connection needed) and rendering an interactive dependency graph — so you can see the full picture in seconds instead of reading line by line.

## Features

- Detects tables after `FROM`, `JOIN`, `INTO`, and `UPDATE`
- Strips CTEs (WITH clauses) — aliases are excluded from results
- Handles schema-qualified names (`schema.table`, `db.schema.table`)
- Ignores table names inside comments and string literals
- Supports backtick, double-quote, and bracket-quoted identifiers
- Three output formats: `plain`, `json`, `csv`
- Interactive browser-based graph visualizer (`table-deps ui`)
- Usable as a CLI tool or as a Python library

## Requirements

- Python ≥ 3.11

## Installation

```bash
uv sync
```

Install with development dependencies (pytest, coverage):

```bash
uv sync --extra dev
```

## CLI Usage

```text
table-deps [SQL_OR_FILE] [--file] [--output-format {plain,json,csv}] [--verbose]
```

### Examples

#### Inline SQL

```bash
table-deps "SELECT * FROM orders JOIN customers ON orders.customer_id = customers.id"
# Tables found:
#   - customers
#   - orders
```

#### From a file

```bash
table-deps --file query.sql
```

#### From stdin

```bash
cat query.sql | table-deps
```

#### JSON output

```bash
table-deps "SELECT * FROM orders JOIN customers ON orders.customer_id = customers.id" -o json
# {
#   "tables": [
#     "customers",
#     "orders"
#   ]
# }
```

#### CSV output

```bash
table-deps "SELECT * FROM orders JOIN customers ON orders.customer_id = customers.id" -o csv
# customers,orders
```

#### Debug logging

```bash
table-deps "SELECT * FROM orders" --verbose
```

## Visual Graph UI

Launch an interactive browser-based graph that visualises table dependencies:

```bash
uv run table-deps ui
```

![table-deps graph UI](docs/ui_screenshot.png)

### UI Features

- Force-directed graph — nodes are draggable, canvas is zoomable and pannable
- Schema-based colour coding (`public`, `analytics`, `hr`, `finance`, …)
- **CTE boxes** — each CTE is rendered as a named box listing its internal tables
- Edge arrows point from joined tables toward the main `FROM` hub, showing data flow direction
- Edge labels show the JOIN type (INNER, LEFT, RIGHT, FULL, CROSS)
- **UNION / UNION ALL** branches are connected by a dashed cyan edge between their respective hubs
- Sidebar with table list, CTE list, stats, schema legend, and join-type legend
- **Example** button to load a built-in complex query instantly
- `Ctrl+Enter` / `Cmd+Enter` keyboard shortcut to re-analyse

No server or extra dependencies needed — everything runs in the browser via D3.js.

### Example Queries

The `ui_examples/` folder contains four ready-to-paste complex queries:

| File | Domain | Schemas |
| --- | --- | --- |
| `ecommerce_orders.sql` | E-commerce order fulfilment | `public`, `inventory`, `payments`, `shipping`, `analytics` |
| `hr_payroll.sql` | HR payroll & headcount | `hr`, `finance`, `compliance`, `org` |
| `analytics_funnel.sql` | Product analytics funnel | `events`, `users`, `product`, `marketing`, `billing` |
| `finance_reporting.sql` | Multi-entity P&L consolidation | `finance`, `gl`, `fx`, `audit`, `reporting` |

Each query features multiple CTEs, cross-schema joins, inline subqueries, and UNION ALL branches.

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

`extract_tables` raises `ValueError` for empty input and returns a sorted list of unique, lowercased table names.

## Project Structure

```text
table_deps/
├── table_deps/          # Library package
│   ├── __init__.py      # Public API: extract_tables
│   ├── extractor.py     # Core parsing logic
│   ├── cli.py           # argparse-based CLI
│   └── static/
│       └── index.html   # D3.js graph visualizer (opened by `table-deps ui`)
├── tests/
│   ├── test_extractor.py
│   └── test_cli.py
├── ui_examples/         # Complex SQL queries for testing the visualizer
│   ├── ecommerce_orders.sql
│   ├── hr_payroll.sql
│   ├── analytics_funnel.sql
│   └── finance_reporting.sql
├── main.py              # Backward-compatible entry point
└── pyproject.toml
```

## Running Tests

```bash
uv run pytest
```

With coverage:

```bash
uv run pytest --cov=table_deps --cov-report=term-missing
```

## Limitations

- Uses regex-based parsing, not a full SQL AST parser.
  Extremely unusual SQL constructs (e.g. dynamic SQL built inside stored procedures) may not be handled correctly.
- Does not resolve view definitions or follow cross-database references.
