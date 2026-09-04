# QeoIndex documentation

Last reviewed: 2026-09-04.

This file is the navigation and lifecycle contract for repository documentation. It prevents historical plans, rollout notes, and temporary handoffs from becoming competing architecture sources.

## Source-of-truth hierarchy

When documents disagree, use this order:

1. `AGENTS.md` — repository-wide execution and deployment invariants.
2. `docs/HANDOVER.md` — current production architecture and operational contract.
3. Domain docs listed as **Active** below — detailed contracts for their area.
4. Runtime code, migrations, tests, and production evidence — verify implementation details against these when a document may have drifted.
5. `docs/superpowers/specs/` and `docs/superpowers/plans/` — historical design/implementation records. They explain decisions but do not override the current contract.
6. Git history / merged PRs — historical evidence only.

Linear is the source of truth for current issue status, sequencing, blockers, and next work. Do not encode mutable task status in a repository-wide handoff file.

## Current architecture at a glance

- Canonical stock universe: latest published `vn_top_stocks`, capped at 200 tickers.
- Operational persistence: Supabase-first.
- Canonical EOD scheduler: Supabase `pg_cron` job `qeoindex-eod-pipeline-1515-ict` at 15:15 ICT on trading weekdays.
- EOD architecture: `supabase-first-eod-v4-dag`.
- Wyckoff operational timeframes: exactly `1D` + `1W` completed bars.
- Persistent raw Wyckoff OHLCV: `1D` only; `1W` is deterministically derived.
- Notion/other external knowledge systems may be downstream analytical or research layers, but they are not the active operational EOD state store.
- Production release path: merge once to `main` → one Vercel Git Integration deployment → smoke the live system.

See `HANDOVER.md` for the full contract and safety gates.

## Active core docs

| Document | Role |
| --- | --- |
| [`HANDOVER.md`](./HANDOVER.md) | Canonical production architecture, EOD, storage, DB safety, validation and acceptance. |
| [`market-board.md`](./market-board.md) | Market-board bootstrap, realtime path, filters, lifecycle and performance. |
| [`security.md`](./security.md) | Security requirements and audit boundaries. |
| [`auth.md`](./auth.md) | Supabase Auth, sessions, feature gates and RLS ownership. |
| [`UI_LESSONS_LEARNED.md`](./UI_LESSONS_LEARNED.md) | Mandatory UI performance/interaction lessons. |
| [`build-performance.md`](./build-performance.md) | Build/cache performance guidance. |
| [`finhay-live-adapter.md`](./finhay-live-adapter.md) | Optional Finhay live adapter contract. |

## Active automation and database docs

- [`automation/CRON_WORKFLOW_TOP_STOCKS_200.md`](./automation/CRON_WORKFLOW_TOP_STOCKS_200.md) — canonical EOD/Top Stocks 200 runbook.
- `db/` — database-specific operational notes. Migration safety itself is governed by `HANDOVER.md` and the executable DB verification scripts.

## Active Insights docs

| Document | Role |
| --- | --- |
| [`insights-homepage.md`](./insights-homepage.md) | Current `/insights` architecture and data ownership. |
| [`insights-handover.md`](./insights-handover.md) | KFSP provider/storage operational contract and troubleshooting. |
| [`insights-rating-model.md`](./insights-rating-model.md) | Qeo rating/state formulas and thresholds. |
| [`insights-design.md`](./insights-design.md) | Current UI/UX and accessibility contract. |
| [`insights-ttai-history.md`](./insights-ttai-history.md) | TTAI history storage and rendering contract. |

Files named `insights-plan.md`, `insights-market-close-plan.md`, and `insights-explainability-ai-council-handoff.md` capture implementation/rollout context. Read them as historical/design references when needed; current behavior must match the active docs and runtime tests above.

## Active Wyckoff docs

- [`wyckoff-chart-unified-data.md`](./wyckoff-chart-unified-data.md) — current Supabase-first 1D/1W Wyckoff storage/read contract.

`wyckoff-infographic-ui-plan.md` is a focused implementation/design record, not the architecture source of truth.

## Historical design records

`docs/superpowers/specs/` and `docs/superpowers/plans/` are intentionally retained. They preserve the reasoning, acceptance criteria, and implementation history of previous work. Statements such as EOD v3, Top 100, Notion-operational storage, Drive archives, or retired timeframes may be correct **for that historical point in time** and must not be silently rewritten to look current.

If historical material conflicts with an Active document, the Active document wins unless runtime evidence proves the Active document has drifted; in that case update the Active document in the same change that fixes or accepts the runtime contract.

## Documentation lifecycle rules

1. Update the relevant Active doc in the same PR as a material architecture/workflow change.
2. Prefer one canonical document per concern and link to it instead of copying its content.
3. Do not add repo-wide `NEXT_AGENT_HANDOFF.md`, `HANDOVER-LEGACY.md`, timestamped status dumps, or “current branch” narratives. Linear holds current work state; Git keeps history.
4. Historical specs/plans stay immutable except for an explicit correction note. Do not rewrite old predictions or old architecture to match the present.
5. Remove a doc when it is wholly superseded and Git history is sufficient. Keep a historical doc only when it adds durable decision context.
6. Before deleting/renaming a doc, search README, AGENTS, tests, source comments, and other docs for references.
7. Keep commands and file names executable/real. If a command changes, update docs together with `package.json`/scripts.
8. Never put credentials, bearer tokens, private provider payloads, or secret-bearing URLs in docs.

## Docs-only release checklist

- No active doc contradicts the canonical universe, EOD v4, Supabase-first, or Wyckoff 1D/1W contracts.
- No links remain to deleted repo-wide handoff files.
- `pnpm verify:pr` passes.
- `pnpm build` passes when the change is intended for release.
- PR diff is reviewed for accidental historical-document rewrites or leaked secrets.
