"""Backward-compatible entry point. Prefer using the `table-deps` CLI command."""

import sys
from table_deps.cli import main

if __name__ == "__main__":
    sys.exit(main())
