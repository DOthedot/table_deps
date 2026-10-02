# Spec: First-visit welcome guide

- **Status:** Accepted and implemented (2026-10-03)
- **Mockup:** [`mockups/onboarding-tour.html`](mockups/onboarding-tour.html)

## Problem
New visitors land on an empty Query view (or an empty Project view) without knowing that
there are two views, how to get from one to the other, or what to click.

## Decision
A centered, dismissible card with **five looping CSS/SVG scenes**: welcome, the Query view,
the Project view, inspect and drill down, and keyboard shortcuts. No video or image assets.
Chosen over real screen recordings (binary weight, and they go stale whenever the UI changes)
and over a spotlight tour (it needs a loaded graph and is fiddly across two pages).

## Behaviour
| Rule | Implementation |
|---|---|
| Auto-opens on the first visit to either page | `TDTour.shouldAutoOpen()` + `localStorage['table_deps_tour_seen']` |
| Never auto-opens on deep links (`?t=` / `?sel=`); the **?** button pulses instead | `shouldAutoOpen()` |
| ✕, Skip, Esc, a backdrop click or a last-step button all mark it seen | `close()` → `markSeen()` |
| Reopen with the header **?** or the `?` key | `tour.js` |
| `←` `→` / dots change step; Tab is trapped in the card; app shortcuts are blocked while it is open | window capture listener |
| Last step: **Explore example project** / **Paste my own SQL** | Project view: clicks Example / goes to `/`. Query view: `/project?p=kimball_retail` / focuses the SQL box |
| Narrow screens: the fixed 546×260 scene scales down | `--scale` on `.tour-stage` |
| `prefers-reduced-motion`: the still final frame of each scene | `tour.css` |

## Files
`static/js/tour.js` (pure part unit-tested in `tests/js/tour.test.js`), `static/css/tour.css`,
and a `#help-btn` in both templates.
