#!/usr/bin/env bash
# PreToolUse (Bash): block direct commits to main/master.
# Exit 2 => the command is blocked and stderr is shown to the agent.
input=$(cat)
cmd=$(printf '%s' "$input" | python3 -c "import sys,json;print(json.load(sys.stdin).get('tool_input',{}).get('command',''))" 2>/dev/null)

if printf '%s' "$cmd" | grep -qE 'git[[:space:]]+commit'; then
  branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
  if [ "$branch" = "main" ] || [ "$branch" = "master" ]; then
    echo "BLOCKED: direct commit to '$branch'. Create a feature branch and open a PR instead." >&2
    exit 2
  fi
fi
exit 0
