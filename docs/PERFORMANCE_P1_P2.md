# QeoIndex Performance Milestone — P1 + P2

Status target: **complete when PR #49 is squash-merged and the resulting main deployment passes production smoke checks.**

## P1 — UI read models

- Vercel Runtime Cache is the regional L1.
- Upstash Redis is the optional shared L2 for enumerable UI projections.
- Notion and market providers remain canonical; cache failures fail open to canonical reads and canonical failures are not hidden with indefinite stale data.
- Research UI uses bounded/route-specific projections:
  - Overview: Stock Thesis + pending-review count.
  - Changes: Stock Thesis + two newest related Analysis Logs per thesis.
  - Analysis Log: 50 rows per Notion cursor page.
  - Review: resolved review rows + exact pending-review count.
  - Compatibility/ticker server sections: bounded newest-100 log projection; dedicated ticker projection is available for migration.
- Scanner UI finds the newest scan date first, then queries only that date instead of scanning historical pages.
- Scanner ticker projection reads universe navigation context plus only the selected ticker's latest scan.
- Signals UI uses a 20-second read model. Signal-monitor decisions use fresh Scanner and fresh Open-recommendation queries and never rely on UI cache freshness.
- Daily and 1H ticker-history UI reads are cached across requests for 15 minutes and 5 minutes respectively. Operational scanner/signal history functions remain fresh.
- Scanner/promote/signal writes invalidate their affected UI projections.

## P2 — runtime locality and realtime rendering

- Vercel Functions region is pinned to `sin1` (Singapore).
- DNSE market-board frames are queued and processed once per `requestAnimationFrame`, preserving arrival order while reducing React update churn.
- Stream watchdog timestamps are updated on receipt, before the animation-frame queue, so batching does not weaken stale-stream detection.

## Regression contract

`npm run test:ui-cache` asserts the P1/P1.1 data-routing invariants and the P2 Singapore/batching invariants. GitHub Verify runs this contract on every pull request and push to main.

## Production evidence before P1.1 merge

- P1 read-model reuse was observed on `/research` within the 60-second TTL.
- Production Research and Scanner server execution was observed in `sin1` via `x-vercel-id`.
- P2 code is already in main ancestry; PR #49 adds the completion guard and P1.1 miss-path work.

Do not mark the milestone production-complete until the final squash commit itself is deployed and re-smoked on `/research`, `/research/scanner`, `/research/signals`, and a ticker detail route.
