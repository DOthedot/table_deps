# ADR-0002: Regex-based SQL parsing, not an AST

- **Status:** Accepted (recorded retroactively)
- **Date:** 2026-10-03
- **Deciders:** project owner

## Context
We need table references from arbitrary SQL across dialects (Postgres, Snowflake, BigQuery,
Spark…), in both Python (CLI/library) and the browser (Query and Project views), with no
database connection. Full SQL parsers are dialect-specific and would add a runtime
dependency in Python and a large bundle in the browser.

## Decision
We will extract dependencies with regular expressions over `FROM`/`JOIN` clauses, strip
CTE aliases and SQL keywords, and accept imperfect coverage of exotic constructs.

## Consequences
- Positive: zero dependencies; identical approach in Python and JS; dialect-tolerant.
- Positive: fast (44 tests in ~0.05 s) and easy to extend case by case, test-first.
- Negative: no semantic understanding — dynamic SQL, macros (Jinja/dbt), and some
  nested constructs can be missed. Documented under "Limitations" in the README.
- Two implementations (`extractor.py`, `sql_parser.js`) must be kept in step by hand.

## Alternatives considered
- **sqlglot / sqlparse** — far better coverage, but a runtime dependency and no browser story.
- **Server-side parsing for the UI** — would break the static Vercel deploy (ADR-0003).
