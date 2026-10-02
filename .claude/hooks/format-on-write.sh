#!/usr/bin/env bash
# PostToolUse (Write|Edit): auto-format the Python file that was just written.
# Uses the project's pinned ruff (uv); silently does nothing if uv is missing.
input=$(cat)
file=$(printf '%s' "$input" | python3 -c "import sys,json;print(json.load(sys.stdin).get('tool_input',{}).get('file_path',''))" 2>/dev/null)
[ -z "$file" ] && exit 0
[ -f "$file" ] || exit 0

case "$file" in
  *.py)
    command -v uv >/dev/null 2>&1 && uv run --quiet ruff format "$file" >/dev/null 2>&1
    ;;
esac
exit 0
