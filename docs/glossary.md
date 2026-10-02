# Glossary (Ubiquitous Language)

> Shared vocabulary. Agents lean on this heavily — a precise glossary prevents the same
> concept being coded three different ways. Add a term the moment it appears in a spec.

## Product
| Term | Definition |
|---|---|
| **Query view** | The single-query page (`visualizer.html`). Code and older docs call it "SQL Visualizer". |
| **Project view** | The multi-file DAG page (`project.html`). Code and older docs call it "Project DAG". |
| **Drill down** | Moving from a node in the Project view to that file's Query view. |
| **Scratch query** | SQL pasted into the Query view that is not tied to a project file. |

## Graph
| Term | Definition |
|---|---|
| **Node** | Project view: one `.sql` file. Query view: one referenced table. |
| **Edge** | Project view: "reads from" between files. Query view: a JOIN or UNION between tables. |
| **DAG level** | Topological depth (`L0` = sources). Computed by `computeLevels()` in `project.js`. |
| **Schema prefix** | The `schema` in `schema.table.sql`; drives node colour (`colors.js`). |
| **Internal ref** | A table reference that resolves to another file in the project. |
| **External table** | A referenced table with no project file. Rendered grey. |
| **Column source tracing** | Hovering a column row highlights the upstream table it originates from. |
| **CTE box** | Query view container for a CTE, with its own mini force graph. |

## Workflow
| Term | Definition |
|---|---|
| **verify** | `make verify` — fmt-check, lint, typecheck, JS syntax, `public/` drift, tests. |
| **public mirror** | `public/` — generated copy of `frontend_service/` for Vercel. Never hand-edit. |
| **ADR** | Architecture Decision Record in `docs/adr/`. |
| **Spec** | Design doc in `docs/specs/`, written before a non-trivial feature. |
