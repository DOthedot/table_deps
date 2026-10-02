# ADR-0003: Ship the UI as a static `public/` mirror on Vercel

- **Status:** Accepted (recorded retroactively)
- **Date:** 2026-10-03
- **Deciders:** project owner

## Context
The UI is served locally by `frontend_service/server.py` (`table-deps ui`), but the public
demo should need no Python runtime. Both views already parse SQL and scan folders entirely
in the browser.

## Decision
We will keep `table_deps/frontend_service/` as the source of truth and generate a static
copy in `public/` (`make sync-public`) that Vercel serves via `vercel.json` routes.
`make verify` fails when the two drift.

## Consequences
- Positive: free, zero-ops hosting; every push to `main` redeploys.
- Positive: the same files run locally and in production.
- Negative: duplicated files in git. Drift already happened once (`project.css`) before
  the `check-public` guard existed.
- Any feature needing a backend (e.g. server-side scanning) only works locally.

## Alternatives considered
- **Symlink `public/static` → source** — not evaluated; would need testing against Vercel's static builder.
- **Build step in Vercel** — adds a toolchain for what is a plain copy.
- **Serverless Python on Vercel** — unnecessary; the browser already does the work.
