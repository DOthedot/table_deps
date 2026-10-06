# Spec: Expandable SQL editor (format + lint)

- **Status:** Accepted (2026-10-03), mock approved
- **Mockup:** [`mockups/sql-editor.html`](mockups/sql-editor.html)

## Problem
The Query view's SQL box is 160 px tall in a 280 px sidebar. Reading or editing a real query
there is painful, and nothing tells you about obvious mistakes (a JOIN without ON, a trailing
comma) until the graph looks wrong.

## Decision
A **⤢ button** on the SQL box (and `⌘⇧E` / `Ctrl⇧E`) opens a **floating editor window**.
It is draggable and resizable, with a focus mode that fills the screen. It edits the **same
text** as the sidebar box, so there is nothing to save; `Esc` closes it and keeps the edits.

| Feature | Behaviour |
|---|---|
| Editor | Line numbers, current-line highlight, syntax colours; referenced tables underlined in their schema colour |
| Format `⇧⌥F` | `sql-formatter@15.9.0`, lazily loaded from jsDelivr on first use (ADR-0004). If the load fails or the SQL can't be parsed, the built-in formatter is used. Undo with `⌘Z` |
| Lint | Wavy underlines, gutter dots, Problems list (click to jump, one-click **Fix** where possible), a summary chip under the sidebar box |
| Analyze `⌘↵` | Re-renders the graph behind the window. **Live** switch: debounced 600 ms re-analyze |
| Read-only | A file opened from a project is read-only: banner shown, Format disabled, Lint still runs; **Edit as scratch** unlocks it |

### Lint rules (v1)
| Severity | Rule | Fix |
|---|---|---|
| error | `unbalanced-parens` | — |
| error | `trailing-comma` (`,` before FROM) | remove the comma |
| error | `join-without-on` (except CROSS JOIN; USING is fine) | — |
| warning | `select-star` (`count(*)` is not flagged) | — |
| warning | `implicit-join` (`FROM a, b`) | — |
| info | `keyword-case` (mixed upper/lower) | runs Format |

Comments and string literals are never linted.

## Non-goals
- Graph rendering changes (still frozen).
- "View SQL" from the Project view inspector (possible follow-up).
- Dialect selection for the formatter (uses standard `sql`).

## Files
| Piece | File |
|---|---|
| Pure logic: tokenize, table refs, lint, fixes, basic formatter, highlight HTML | `static/js/sql_tools.js` (tested in `tests/js/sql_tools.test.js`) |
| Floating window, sync, keyboard, lazy formatter loading | `static/js/sql_editor.js` |
| Styles | `static/css/sql_editor.css` |
