"""Scan a project directory of SQL files and build a cross-file dependency graph."""

import json
import logging
from pathlib import Path

from table_deps.extractor import extract_tables

logger = logging.getLogger(__name__)

def _table_id_from_filename(path: Path) -> str | None:
    """Parse 'schema.table_name.sql' → 'schema.table_name'."""
    stem = path.stem
    parts = stem.split(".", 1)
    if len(parts) == 2:
        return stem.lower()
    return None


def scan_project(directory: str | Path) -> dict:
    """
    Scan all .sql files in *directory* and build a cross-file dependency graph.

    Each node includes:
        id, label, schema, table, layer, file, degree,
        all_refs      – every table referenced in this file's SQL
        internal_refs – subset of all_refs that map to another project file
        external_refs – subset of all_refs with no matching project file
    """
    directory = Path(directory)
    if not directory.is_dir():
        raise ValueError(f"Not a directory: {directory}")

    sql_files = sorted(directory.glob("*.sql"))
    logger.debug("Found %d .sql files in %s", len(sql_files), directory)

    # ── 1. First pass: build node map + raw refs ──────────────────────────
    nodes: dict[str, dict] = {}
    file_refs: dict[str, list[str]] = {}   # table_id → all referenced tables

    for path in sql_files:
        table_id = _table_id_from_filename(path)
        if table_id is None:
            logger.warning("Skipping %s: does not match schema.table pattern", path.name)
            continue

        schema = table_id.split(".")[0]
        table  = table_id.split(".", 1)[1] if "." in table_id else table_id

        try:
            sql = path.read_text(encoding="utf-8")
        except OSError as exc:
            logger.warning("Could not read %s: %s", path.name, exc)
            sql = ""

        nodes[table_id] = {
            "id":            table_id,
            "label":         table_id,
            "schema":        schema,
            "table":         table,
            "layer":         schema,
            "file":          path.name,
            "degree":        0,
            "all_refs":      [],
            "internal_refs": [],
            "external_refs": [],
            "sql_content":   sql,
        }

        try:
            refs = extract_tables(sql) if sql else []
        except ValueError as exc:
            logger.warning("Could not parse %s: %s", path.name, exc)
            refs = []

        file_refs[table_id] = refs

    project_ids = set(nodes.keys())

    # ── 2. Resolve refs into internal / external ──────────────────────────
    edges: list[dict] = []
    seen_edges: set[tuple] = set()

    for source_id, refs in file_refs.items():
        node = nodes[source_id]
        added_internal: set[str] = set()
        added_external: set[str] = set()

        for ref in refs:
            ref_lower = ref.lower()

            # Exact match first, then table-name-only match
            if ref_lower in project_ids:
                target_id = ref_lower
            else:
                target_id = next(
                    (t for t in project_ids if t.split(".")[-1] == ref_lower.split(".")[-1]),
                    None,
                )

            if target_id and target_id != source_id:
                # Internal project dependency
                if target_id not in added_internal:
                    added_internal.add(target_id)
                    node["internal_refs"].append(target_id)
                    node["all_refs"].append(target_id)

                key = (source_id, target_id)
                if key not in seen_edges:
                    seen_edges.add(key)
                    edges.append({"source": source_id, "target": target_id})
                    nodes[source_id]["degree"] += 1
                    nodes[target_id]["degree"]  += 1
            else:
                # External reference
                if ref_lower not in added_external and ref_lower not in project_ids:
                    added_external.add(ref_lower)
                    node["external_refs"].append(ref)
                    node["all_refs"].append(ref)

    # ── 3. Stats ──────────────────────────────────────────────────────────
    layer_counts: dict[str, int] = {}
    for n in nodes.values():
        layer_counts[n["layer"]] = layer_counts.get(n["layer"], 0) + 1

    return {
        "project_name": directory.name,
        "nodes":        list(nodes.values()),
        "edges":        edges,
        "stats": {
            "total_tables": len(nodes),
            "total_edges":  len(edges),
            "layer_counts": layer_counts,
        },
    }


def scan_project_json(directory: str | Path) -> str:
    """Return the scan result as a JSON string."""
    return json.dumps(scan_project(directory), indent=2)
