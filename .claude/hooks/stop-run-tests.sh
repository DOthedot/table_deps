#!/usr/bin/env bash
# Stop: run the test suite when the agent finishes. If tests fail, exit 2 to
# keep the agent working until they pass. Tune `make test` for large suites
# (e.g. run only changed-file tests) if this becomes slow.
if ! make test >/tmp/agent-stop-test.log 2>&1; then
  echo "Tests are failing — do not stop yet. Output:" >&2
  tail -n 30 /tmp/agent-stop-test.log >&2
  exit 2
fi
exit 0
