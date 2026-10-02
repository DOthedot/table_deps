# ADR-0001: Record architecture decisions

- **Status:** Accepted
- **Date:** 2026-10-03
- **Deciders:** project owner

## Context
Agents and humans both make architectural choices while working in this repo. Without a
record of *why* a choice was made, later contributors (especially AI agents, which start each
session with no memory) re-litigate settled decisions or unknowingly violate them.

## Decision
We will record every significant, hard-to-reverse decision as an ADR in `docs/adr/`, numbered
sequentially, using `0000-template.md` as the template. Create new ADRs with `/adr <title>`.

## Consequences
- Positive: decisions carry their rationale; agents get the *why*, not just the *what*.
- Positive: onboarding (human or agent) is faster.
- Trade-off: a small amount of writing discipline per decision.

## Alternatives considered
- **Only code comments** — scattered, easily lost, no rationale/history.
- **A wiki** — lives outside the repo, drifts from the code, not loaded into agent context.
