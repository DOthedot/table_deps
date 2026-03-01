"""
Core SQL table dependency extraction logic.

Supports:
- Single- and multi-line SQL comments
- String literals (values not mistaken for table names)
- CTEs (WITH clauses) — CTE aliases are excluded from results
- Schema-qualified names: schema.table, db.schema.table
- Backtick, double-quote, and bracket-quoted identifiers
- DML: SELECT/INSERT INTO/UPDATE/DELETE FROM
"""

import logging
import re

logger = logging.getLogger(__name__)

# SQL keywords that are never valid table names.
SQL_KEYWORDS: frozenset[str] = frozenset(
    {
        "select", "from", "where", "join", "inner", "left", "right", "full",
        "outer", "cross", "on", "as", "and", "or", "not", "in", "exists",
        "between", "like", "is", "null", "true", "false", "case", "when",
        "then", "else", "end", "group", "by", "order", "having", "limit",
        "offset", "union", "all", "distinct", "with", "recursive", "lateral",
        "insert", "update", "delete", "into", "values", "set", "create",
        "materialized", "view", "replace", "table", "temp", "temporary", "if",
        "using", "over", "partition", "filter", "rows", "range", "preceding",
        "following", "current", "row",
    }
)

# Matches a single identifier segment: optionally quoted with `, ", or [].
_IDENT = r'(?:[`"\[][\w\s]+[`"\]]|\w+)'

# Matches a (possibly schema-qualified) table reference: a.b.c
_TABLE_IDENT = rf"({_IDENT}(?:\.{_IDENT})*)"

# Matches the keywords that introduce a table reference.
_TABLE_REF_RE = re.compile(
    rf"(?:FROM|JOIN|INTO|UPDATE)\s+{_TABLE_IDENT}",
    re.IGNORECASE,
)

# Matches CTE name declarations: <name> AS (
_CTE_RE = re.compile(rf"({_IDENT})\s+AS\s*\(", re.IGNORECASE)

# Strips surrounding quote characters from a single identifier segment.
_UNQUOTE_RE = re.compile(r'^[`"\[]|[`"\]]$')


def _strip_quotes(segment: str) -> str:
    """Remove surrounding quote characters from one identifier segment."""
    return _UNQUOTE_RE.sub("", segment)


def _normalise_name(raw: str) -> str:
    """Lowercase and unquote each part of a (possibly qualified) name."""
    return ".".join(_strip_quotes(part).lower() for part in raw.split("."))


def _remove_comments(sql: str) -> str:
    sql = re.sub(r"--[^\n]*", " ", sql)
    sql = re.sub(r"/\*.*?\*/", " ", sql, flags=re.DOTALL)
    return sql


def _redact_string_literals(sql: str) -> str:
    """Replace string literals with '' to prevent false identifier matches."""
    return re.sub(r"'(?:[^'\\]|\\.)*'", "''", sql)


def extract_tables(sql: str) -> list[str]:
    """Extract table names referenced in a SQL query.

    Args:
        sql: The SQL query string to parse.

    Returns:
        A sorted list of unique, lowercased, unquoted table names.

    Raises:
        ValueError: If *sql* is empty or contains only whitespace.
    """
    if not sql or not sql.strip():
        raise ValueError("SQL query must not be empty")

    logger.debug("Extracting tables from SQL (%d chars)", len(sql))

    cleaned = _remove_comments(sql)
    cleaned = _redact_string_literals(cleaned)

    # Collect CTE aliases so we can exclude them from results.
    cte_names: set[str] = set()
    for match in _CTE_RE.finditer(cleaned):
        alias = _normalise_name(match.group(1))
        cte_names.add(alias)
        logger.debug("CTE alias detected: %s", alias)

    tables: set[str] = set()
    for match in _TABLE_REF_RE.finditer(cleaned):
        name = _normalise_name(match.group(1))
        if name in SQL_KEYWORDS or name in cte_names or name.isdigit():
            logger.debug("Skipping non-table token: %s", name)
            continue
        tables.add(name)
        logger.debug("Table found: %s", name)

    result = sorted(tables)
    logger.info("Extracted %d table(s): %s", len(result), result)
    return result
