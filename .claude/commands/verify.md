---
description: Run the full quality suite (fmt + lint + typecheck + test)
---

Run `make verify` and report the result concisely.

- If it passes, say so and stop.
- If it fails, show the failing output, diagnose the root cause, and fix it — then run
  `make verify` again to confirm. Do not claim success without a passing run.
