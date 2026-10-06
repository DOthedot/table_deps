# ADR-0004: Load sql-formatter lazily from a CDN, with a built-in fallback

- **Status:** Accepted
- **Date:** 2026-10-03
- **Deciders:** project owner

## Context
The SQL editor needs a Format action. Formatting quality is visible to every user, and SQL
formatting has many edge cases (CTEs, CASE, window functions, dialect quirks). The frontend
has no bundler and already loads D3 from a CDN (ADR-0003: static `public/` build).

## Decision
We will load `sql-formatter@15.9.0` (UMD, about 312 KB minified) from jsDelivr **the first
time Format is used**, with the exact version pinned. If it cannot load (offline, CDN down) or
throws on unparseable SQL, we fall back to a small built-in formatter in `sql_tools.js`.

## Consequences
- Positive: high-quality formatting with no build step, and no cost to users who never format.
- Positive: Format always works, including offline `table-deps ui` and half-written SQL.
- Negative: a second third-party runtime dependency (after D3), plus a network request on
  first use. Output differs slightly between the library and the fallback.
- Upgrading means changing a pinned version string in `sql_editor.js`.

## Alternatives considered
- **Built-in formatter only:** no dependency, but noticeably worse output on real queries.
- **Vendor the file into `static/`:** works offline, but adds 312 KB to the repo and the
  deploy for a feature most visits never use.
- **CodeMirror plus a formatter:** a much richer editor, but needs ES-module tooling and a far
  larger payload than this feature justifies.
