# Project Context (root)

> Loaded automatically at the start of every agent session in this repo.
> Keep it short and true. It is the single most important context an agent has.

## What this is
`table-deps` statically extracts table dependencies from SQL (no database) and renders them
as interactive graphs. Three surfaces share one parser: a **Python library/CLI**, a
**Query view** (single SQL query → force graph), and a **Project view** (folder of
`schema.table.sql` files → left-to-right DAG). Stdlib-only Python; D3 in the browser.

## How to run everything
```bash
make install       # uv sync --extra dev
make verify        # fmt-check + lint + typecheck + js syntax + public/ drift + py & js tests
```
Same command CI runs. Other targets: `make fmt`, `make test`, `make cov`, `make ui`,
`make project-ui`, `make sync-public`. Package manager is **uv**, never pip.

## Module map
| Module | Responsibility | Context |
|---|---|---|
| `table_deps/extractor.py` | Regex SQL parser → sorted table list (the deep module) | `table_deps/CLAUDE.md` |
| `table_deps/project_scanner.py` | Folder of `.sql` files → nodes/edges/levels | `table_deps/CLAUDE.md` |
| `table_deps/cli.py` | argparse edge: `ui`, `project-ui`, plain/json/csv output | — |
| `table_deps/frontend_service/` | stdlib HTTP server + HTML/CSS/D3 UI | `table_deps/frontend_service/CLAUDE.md` |
| `public/` | **Generated** static mirror of the frontend for Vercel | never hand-edit — `make sync-public` |
| `test_projects/`, `ui_examples/` | Fixture SQL used by tests, demos, and the Example buttons | — |

## Conventions (non-negotiable)
- **Test-first.** Write/adjust a failing test in `tests/` before the implementation.
- **Edit the frontend in `table_deps/frontend_service/`, then `make sync-public`.**
  `make verify` fails if `public/` drifted.
- **Do not change the DAG layout or the table/graph rendering** (`renderBox`, simulation,
  edge routing) without explicit approval — the user considers them done.
- **Conventional Commits**; **never commit to `main`** (a hook enforces this).
- **Irreversible decisions get an ADR** in `docs/adr/` (`/adr <title>`).
- **Specs before non-trivial features** in `docs/specs/` (`/spec`).

## Where things live
| Need | Location |
|---|---|
| Docs index | `docs/README.md` |
| Architecture & data flow | `docs/architecture.md` |
| Domain terms (Query view, Project view, DAG level, …) | `docs/glossary.md` |
| Design docs / specs / mockups | `docs/specs/` |
| Decision records | `docs/adr/` |
| CI | `.github/workflows/ci.yml` |
| Project hooks & commands | `.claude/` |

## Protected paths (agents: do not edit without explicit human approval)
`.github/`, `Makefile`, `pyproject.toml`, `uv.lock`, `vercel.json`, `.claude/`.
A hook blocks edits to `.github/`, `Makefile`, and `.claude/`.
