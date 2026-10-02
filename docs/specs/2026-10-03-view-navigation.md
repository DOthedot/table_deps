# Spec: View navigation rework (Project view ⇄ Query view)

- **Status:** Draft, awaiting a choice between A and B
- **Date:** 2026-10-03
- **Mockup:** [`mockups/view-navigation.html`](mockups/view-navigation.html), which is interactive.
  Open it in a browser and switch between *Today*, *A* and *B* at the top right.

## Problem
The two views are separate pages that barely know about each other:

1. **Switching is buried.** A link button at the top of the sidebar, labelled with the
   *other* page's name ("SQL Visualizer →" / "Project DAG →"). It reads like content.
2. **Drill-down is hidden.** Project → Query is double-click only. You find out about it
   from the node tooltip.
3. **Context is lost.** Drill-down calls `window.open('/')`, which opens a new tab with
   back disabled. From there, "Project DAG →" lands on an **empty** Project view and the
   folder must be opened again.
4. **The Query view is context-blind.** It gets raw SQL through `localStorage`. It doesn't
   know the file name, project, or neighbours, so it can't take you anywhere.

## Goals
- One obvious, always-visible way to switch views.
- Discoverable drill-down from a node to its query, in the **same tab**, with a working back button.
- The Query view knows its source file and lets you hop to upstream/downstream files.
- URLs you can share or reload (`/project?p=…&sel=…`, `/query?p=…&t=…`).

## Non-goals
- **No changes to the DAG or graph rendering**: layout, `renderBox`, simulations, edge
  routing and column tracing stay frozen. The single exception is an optional ↗ badge on
  Query-view table nodes that are project files (A6), which can be dropped if unwanted.
- No new runtime dependencies or build step. `public/` stays a static Vercel deploy (ADR-0003).

## Proposal A: Unified shell (recommended)
| # | Element | Behaviour |
|---|---|---|
| A1 | **Segmented switch** `◇ Project · ▭ Query` in the header | Always visible. Keys `1`/`2`. Query reopens the last file. |
| A2 | **Breadcrumb** | `kimball_retail › fact.returns.sql`, or `Scratch query` |
| A3 | **Click selects; inspector drawer** | Upstream/downstream chips, external refs, primary **Open in Query view ↵**. Double-click and `Enter` still open. |
| A4 | **Same-tab navigation** | Back, `Esc`, or `← kimball_retail` return to the DAG with selection and zoom kept |
| A5 | **Context strip** in the Query view | "Reads from" and "Used by" chips, plus ‹ › to step through files in DAG order |
| A6 | **↗ badge** on project-file nodes in the Query view | Click opens that file's query |
| A7 | **⌘K jump** | Fuzzy list of tables. `↵` opens the query, `⇧↵` shows it in the DAG |

### Implementation sketch (phase 1, keeping the two pages)
The two pages stay separate. This is a much smaller change than merging `project.js` and
`visualizer.js`, which share element ids and globals.
- Shared header partial (copied into both templates) plus header styles in `shared.css`.
- **Project data handoff:** after a scan, store `{project_name, nodes, edges}` in
  `sessionStorage['table_deps_project']`. It's per-tab, survives same-tab navigation, and
  is cleared when the tab closes. Replace `localStorage` + `window.open` with
  `location.href = '/query?p=…&t=…'`.
- **Query view:** on load, if `t` is set and the project is in `sessionStorage`, take
  the SQL from the node, render the context strip, and mark project tables.
- **Project view:** on load, restore from `sessionStorage` instead of showing the empty
  state. `sel` reselects the node. Zoom transform is saved alongside it.
- **Routes:** add `/query` to `server.py` and `vercel.json`. Keep `/` and `/visualizer`
  as aliases for the Query view.

### Open questions
1. Which page should `/` be once a project is loaded: Project or Query?
2. Should the inspector overlay the DAG (as in the mock, where it hides the right-most
   level) or should the DAG pan to keep the selection visible?
3. Is `sessionStorage` size enough for large projects (≈5 MB, which is SQL text for
   hundreds of files)? If not, fall back to IndexedDB.
4. Keep A6 (↗ badge inside the graph), or is that too close to "changing the graph"?

## Proposal B: Split view
Selecting a node opens its query graph in a right pane next to the DAG.
**Not recommended:** the DAG loses about 45% of its width, both graphs get cramped on
laptops, and running two D3 simulations on one page needs the larger
`visualizer.js`/`project.js` refactor.

## Acceptance criteria (A)
- [ ] The view switch is visible in the header on both pages, and `1`/`2` work.
- [ ] A single click on a node opens the inspector, and its button opens the query in the same tab.
- [ ] Browser back from the Query view restores the DAG, with selection and no re-scan.
- [ ] Reloading `/query?p=…&t=…` in the same tab shows the same file.
- [ ] The Query view shows a breadcrumb and a context strip, and its chips navigate.
- [ ] Pasting SQL with no project shows `Scratch query`, and nothing breaks.
- [ ] DAG and graph rendering are visually identical to before (screenshot comparison).
- [ ] `make verify` passes and `public/` is synced.
