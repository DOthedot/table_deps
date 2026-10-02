#!/usr/bin/env bash
# PreToolUse (Write|Edit): block edits to protected paths *inside this project*.
# Exit 2 => the tool call is blocked and stderr is shown to the agent.
# Paths outside $CLAUDE_PROJECT_DIR (e.g. ~/.claude/ memory) are never matched.
input=$(cat)
file=$(printf '%s' "$input" | python3 -c "import sys,json;print(json.load(sys.stdin).get('tool_input',{}).get('file_path',''))" 2>/dev/null)
root="${CLAUDE_PROJECT_DIR:-$PWD}"

case "$file" in
  "$root"/*) rel="${file#"$root"/}" ;;
  *) exit 0 ;;
esac

case "$rel" in
  .github/*|Makefile|.claude/*|vercel.json|uv.lock)
    echo "BLOCKED: '$rel' is a protected path (CI, build, deploy, lockfile, or agent config)." >&2
    echo "Get explicit human approval before editing it." >&2
    exit 2
    ;;
esac
exit 0
