# Docs index

Start here. Agents: the root `CLAUDE.md` is the summary; this is the map.

| Doc | What it answers |
|---|---|
| [architecture.md](architecture.md) | How SQL becomes a graph; module boundaries; the `public/` mirror |
| [glossary.md](glossary.md) | What we mean by Query view, Project view, DAG level, external table… |
| [specs/](specs/) | Design docs written before non-trivial features (`/spec`) |
| [adr/](adr/) | Decisions that are hard to reverse, with their *why* (`/adr <title>`) |

## Specs
| Date | Spec | Status |
|---|---|---|
| 2026-10-03 | [View navigation rework](specs/2026-10-03-view-navigation.md) · [mockup](specs/mockups/view-navigation.html) | Accepted (A) |
| 2026-10-03 | [First-visit welcome guide](specs/2026-10-03-onboarding-guide.md) · [mockup](specs/mockups/onboarding-tour.html) | Accepted |
| 2026-10-03 | [Expandable SQL editor (format + lint)](specs/2026-10-03-sql-editor.md) · [mockup](specs/mockups/sql-editor.html) | Accepted |

## ADRs
| # | Decision | Status |
|---|---|---|
| [0001](adr/0001-record-architecture-decisions.md) | Record architecture decisions | Accepted |
| [0002](adr/0002-regex-parser-not-ast.md) | Regex-based SQL parsing, not an AST | Accepted |
| [0003](adr/0003-static-public-mirror.md) | Ship the UI as a static `public/` mirror on Vercel | Accepted |
| [0004](adr/0004-lazy-cdn-sql-formatter.md) | Load sql-formatter lazily from a CDN, with a built-in fallback | Accepted |

## Lifecycle
`idea → /spec → plan → failing test → implement → make verify → /ship → CI → merge`

## Screenshots
`column_deps.png`, `global_search.png`, `project_overview_ui.png`, `ui_screenshot.png` —
used by the top-level README.
