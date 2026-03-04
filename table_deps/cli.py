"""Command-line interface for table-deps."""

import argparse
import base64
import json
import logging
import sys
import webbrowser
from pathlib import Path

from table_deps.extractor import extract_tables
from table_deps.project_scanner import scan_project

logger = logging.getLogger(__name__)


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="table-deps",
        description="Extract table dependencies from a SQL query.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
examples:
  # Pass SQL inline
  table-deps "SELECT * FROM orders JOIN customers ON orders.customer_id = customers.id"

  # Read from a file
  table-deps --file query.sql

  # Pipe from stdin
  cat query.sql | table-deps

  # JSON output
  table-deps "SELECT * FROM orders" --output-format json

  # Open single-query visualizer UI
  table-deps ui

  # Open project overview UI for a directory of .sql files
  table-deps project-ui ./my_project/
        """,
    )
    parser.add_argument(
        "sql",
        nargs="?",
        metavar="SQL_OR_FILE",
        help="SQL query string, or a file path when --file is set.",
    )
    parser.add_argument(
        "--file", "-f",
        action="store_true",
        help="Treat the positional argument as a file path.",
    )
    parser.add_argument(
        "--output-format", "-o",
        choices=["plain", "json", "csv"],
        default="plain",
        help="Output format (default: plain).",
    )
    parser.add_argument(
        "--verbose", "-v",
        action="store_true",
        help="Enable debug logging.",
    )
    return parser


def _read_sql(args: argparse.Namespace, parser: argparse.ArgumentParser) -> str | None:
    """Return the SQL string from the appropriate source, or None on error."""
    if args.file:
        if not args.sql:
            parser.error("--file requires a file path argument")
        try:
            with open(args.sql, encoding="utf-8") as fh:
                return fh.read()
        except OSError as exc:
            print(f"Error reading file: {exc}", file=sys.stderr)
            return None

    if args.sql:
        return args.sql

    if not sys.stdin.isatty():
        return sys.stdin.read()

    parser.print_help()
    return None


def _print_results(tables: list[str], output_format: str) -> None:
    if not tables:
        print("No tables found.")
        return

    if output_format == "json":
        print(json.dumps({"tables": tables}, indent=2))
    elif output_format == "csv":
        print(",".join(tables))
    else:
        print("Tables found:")
        for table in tables:
            print(f"  - {table}")


def _open_ui() -> int:
    """Open the browser-based SQL visualizer."""
    html = Path(__file__).parent / "static" / "index.html"
    url = html.resolve().as_uri()
    print(f"Opening visualizer at: {url}")
    webbrowser.open(url)
    return 0


def _open_project_ui(project_path: str) -> int:
    """Scan a project directory and open the project overview UI."""
    try:
        data = scan_project(project_path)
    except ValueError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1

    payload = base64.b64encode(json.dumps(data).encode()).decode()
    html = Path(__file__).parent / "static" / "project_overview.html"
    url = html.resolve().as_uri() + "#" + payload

    n = data["stats"]["total_tables"]
    e = data["stats"]["total_edges"]
    print(f"Project: {data['project_name']}  ({n} tables, {e} dependencies)")
    print(f"Opening project overview at: {html.resolve().as_uri()}")
    webbrowser.open(url)
    return 0


def main(argv: list[str] | None = None) -> int:
    """Entry point for the table-deps CLI.

    Args:
        argv: Argument list (defaults to sys.argv[1:]).

    Returns:
        Exit code (0 = success, 1 = error).
    """
    # Handle subcommands before building the full parser
    raw = argv if argv is not None else sys.argv[1:]
    if raw and raw[0] == "ui":
        return _open_ui()
    if raw and raw[0] == "project-ui":
        if len(raw) < 2:
            print("Usage: table-deps project-ui <directory>", file=sys.stderr)
            return 1
        return _open_project_ui(raw[1])

    parser = _build_parser()
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.WARNING,
        format="%(levelname)s %(name)s: %(message)s",
    )

    sql = _read_sql(args, parser)
    if sql is None:
        return 1

    try:
        tables = extract_tables(sql)
    except ValueError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1

    _print_results(tables, args.output_format)
    return 0


if __name__ == "__main__":
    sys.exit(main())
