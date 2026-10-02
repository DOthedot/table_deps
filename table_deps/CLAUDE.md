# Module: table_deps (parser + scanner)

> Loaded when an agent works inside `table_deps/`. The frontend has its own
> `frontend_service/CLAUDE.md`.

## Responsibility
Turn SQL text into dependency facts. No I/O beyond reading files in the scanner; no
third-party dependencies (stdlib `re`, `logging`, `pathlib`, `json`).

## Files
- `extractor.py` — the deep module. `extract_tables(sql) -> list[str]`: sorted,
  lowercased, deduplicated; CTE aliases excluded; raises `ValueError` on empty input.
- `project_scanner.py` — scans `schema.table.sql` files, resolves each ref to a project
  file (exact id first, then table-name-only match), emits nodes and edges. DAG levels
  are computed in the browser (`project.js`).
  Unmatched refs become **external tables**.
- `cli.py` — thin edge. Parses args, calls the above, formats output. No parsing logic here.

## Rules
- Parser behaviour changes start with a failing case in `tests/test_extractor.py`.
- Regex, not an AST — see `docs/adr/0002-regex-parser-not-ast.md` before proposing a
  parser library.
- The JS parser in `frontend_service/static/js/sql_parser.js` mirrors keyword lists from
  here; if you change one, check the other.
