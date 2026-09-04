# Top Stocks 200 Archive & Automation Implementation Plan

> **Required sub-skills:** test-driven-development, systematic-debugging, verification-before-completion, requesting-code-review.

## Goal

Complete the canonical `vn_top_stocks` migration so every universe-dependent runtime, Wyckoff flow, AI Council step and scheduled job operates on the exact current published Top Stocks membership (max 200), while Supabase remains a bounded hot operational store and long-term analytical/raw history is archived to Notion and Google Drive.

## Architecture

- **Canonical membership:** Supabase `qeo_current_market_universe('vn_top_stocks')`.
- **Selector:** strict `market_cap_billion > configured threshold`, strict `average_volume_50_sessions > configured threshold`, plus recent daily-trading activity gate; sort market cap desc, Avg50 desc, ticker asc; max 200.
- **Supabase:** short-term operational state, latest/current derived artifacts, rolling OHLCV, retry/readiness/job telemetry.
- **Notion:** long-term analytical/audit record and monthly universe membership history; never runtime membership source.
- **Google Drive:** raw historical OHLCV archive; prune hot Supabase only after archive confirmation.
- **EOD:** existing 15:15 ICT durable workflow and retry guards remain authoritative; archive/retention happens after market analysis publication.

## Approved spec

`docs/superpowers/specs/2026-09-01-top-stocks-200-archive-automation-design.md`

## Global constraints

1. Do not reintroduce Top100/HOSE-only membership semantics.
2. Do not change legitimate batch/page/token limits merely because they equal 100.
3. Failed universe refresh preserves last healthy published snapshot.
4. Failed Drive/Notion archive must never delete unarchived Supabase data.
5. Historical Top100 records remain historical evidence, but operational databases/pages must be clearly marked `LEGACY —` or `DEPRECATED —`.
6. Merge to `main` once; do not manually trigger duplicate Vercel production deploys.
7. Supabase migrations/functions are deployed separately and verified before final production sign-off.

---

## Task 1 — Daily-trading activity gate for canonical universe

**Files**
- Modify: `tests/market-universe.test.ts`
- Modify: `modules/market/universe/selection.ts`
- Create: `supabase/migrations/20260901123000_market_universe_daily_activity_gate.sql`
- Modify: `supabase/functions/market-universe-sync/index.ts`

**RED**
1. Add selector test where suspended and weekly-only rows fail while normal daily-traded row passes.
2. Add source contract test requiring monthly sync to call `qeo_select_market_universe_candidates` and enforce 5 observations / >=4 active days.
3. Run targeted universe tests and confirm failure for missing activity behavior.

**GREEN**
1. Add activity metadata to selector row contract.
2. Add SQL RPC computing recent weekday observations and positive-volume days.
3. Switch monthly Edge Function from direct table Top-N query to RPC.
4. Preserve logo guarantee, run persistence and atomic publish.

**Verify**
- RPC returns >=200 eligible candidates for current source date.
- Fresh run publishes 200 rows.
- ROS/TC6/TDN/POM absent; DRI present.
- logo coverage = detail coverage = selected count.

---

## Task 2 — Canonical-first Wyckoff runtime and fastest shell render

**Files**
- Modify: `app/insights/wyckoff/page.tsx`
- Modify: `app/api/insights/wyckoff/route.ts`
- Create/Modify: `components/insights/wyckoff-deferred-dashboard.tsx`
- Modify: active Wyckoff dashboard components/tests
- Modify: `modules/signals/scanner/data.ts`
- Modify: `modules/wyckoff/unified-runner.ts`

**RED**
1. Test SSR page no longer calls Notion/scanner/OHLCV before first render.
2. Test watchlist API returns canonical membership order/count.
3. Test ticker API rejects ticker outside current universe.
4. Test Wyckoff runner target set equals canonical membership.

**GREEN**
1. SSR only auth + cached canonical universe shell.
2. Hydrate watchlist phases after paint from Supabase.
3. Fetch selected ticker chart after paint; use persisted unified data first, cached OHLCV on-demand second.
4. Remove Notion Top100 runtime fallback.

**Verify**
- First component renders without Notion dependency.
- Current universe UI count = canonical selected count.
- No active `hose_top100` operational target path.

---

## Task 3 — AI Council exact canonical membership

**Files**
- Modify: `modules/ai-council/freshness.ts`
- Modify: `modules/ai-council/data.ts`
- Modify: `modules/ai-council/eod-workflow-steps.ts`
- Modify: `modules/ai-council/llm-evidence.ts`
- Modify: related tests

**RED**
1. Test no `AI_COUNCIL_EXPECTED_STOCKS = 100` constant remains.
2. Test readiness compares exact ticker set and dynamic `selectedCount`.
3. Test LLM candidate subset is always contained in canonical membership.

**GREEN**
1. Resolve canonical snapshot once per EOD run and pass its run ID/count through deterministic/LLM steps.
2. Fail closed on membership mismatch; do not silently accept 100/200 partial data.
3. Keep LLM cost cap independent of universe size.

**Verify**
- deterministic coverage = selectedCount.
- missing/extra ticker causes readiness failure with exact diff.

---

## Task 4 — EOD v3 contract and scheduler audit

**Files**
- Modify: `lib/qeoindex-eod-workflow.ts`
- Modify: `modules/eod/workflow-steps.ts`
- Modify: `modules/eod/backfill-ready-step.ts`
- Modify: `modules/wyckoff/eod-refresh.ts`
- Modify: system job/admin catalog/tests/docs as required

**Invariant order**
`EOD_READY → MARKET_CLOSE_COLLECT → HISTORY_REFRESH → NO_TRADE_REPAIR → WYCKOFF_BUILD → SUPABASE_VALIDATE → SUPABASE_PUBLISH → AI_COUNCIL_DETERMINISTIC → AI_COUNCIL_LLM → MARKET_SYNTHESIS → NOTION_ARCHIVE → DRIVE_ARCHIVE → RETENTION_CLEANUP → COMPLETE`

**Reliability invariants**
- Scheduler: 15:15 ICT Monday–Friday.
- `EOD_READY`: max 4 attempts, 5-minute spacing.
- `MARKET_CLOSE_COLLECT`: max 3 attempts, 5-minute spacing.
- History batch max 10 remains an operational batch cap.
- Wyckoff expected snapshots = `universeCount * timeframeCount` (currently 200 * 5 = 1000 maximum).

**Verify**
- Enumerate every pg_cron/Vercel scheduled job in production and classify whether it requires canonical membership.
- No universe-dependent cron uses static ticker arrays or Top100 predicates.

---

## Task 5 — Notion v3 long-term schema and legacy labeling

**Notion changes**
1. Audit all databases under VN Stock Research Hub.
2. Preserve generic/historical databases (`Stock Thesis`, `Analysis Log`, `Research Sources`) unchanged except links/descriptions when needed.
3. Rename obsolete Top50/Top100 operational databases/pages to `LEGACY — ...` or `DEPRECATED — ...` without rewriting history.
4. Create fresh:
   - `Top Stocks 200 — Universe History`
   - `Top Stocks 200 — EOD Archive 2026`
   - `Top Stocks 200 — EOD Runs`
   - workflow/documentation page for automation contract.
5. Ensure HNX/UPCOM are valid exchange values.

**Universe History minimum properties**
- Universe Run ID, Effective From, Effective To, Active, Rank, Ticker, Company, Exchange, Sector, Market Cap (bn VND), Avg Vol 50D, Detail Complete, Logo Kind/Path, selector thresholds.

**EOD Archive minimum properties**
- Trading Date, Universe Run ID/Rank, Ticker, Qeo Composite, key KFSP metrics, compact 5TF Wyckoff summary, deterministic AI Council conclusion, optional LLM conclusion, evidence/validation hash.

**EOD Runs minimum properties**
- Trading Date, Run ID, Status, Universe Run ID/Count, expected/completed Wyckoff, deterministic/LLM coverage, archive statuses, duration, errors, validation hash.

---

## Task 6 — Drive raw archive and safe retention

**Implementation rule**
Production cron cannot rely on the interactive ChatGPT Drive connector. Runtime archive requires configured Google service credentials/API path. Until those credentials are verified, retention cleanup must be fail-closed and must not delete raw OHLCV.

**Archive layout**
`VN Stock Research/Archive/OHLCV/YYYY/MM/<timeframe>/<ticker>.<csv|parquet>.gz`

**Hot retention targets**
- Full-market KFSP: latest snapshot outside canonical history requirements.
- Canonical ratings: ~45 calendar days.
- Universe runs: current + previous operational run; full monthly history in Notion.
- 1H OHLCV: ~90 days.
- Daily: enough for MA200/1Y working calculations (~320 trading bars).
- Weekly/monthly compact rollups retained longer.
- Wyckoff derived: ~10 trading sessions.
- AI Council deterministic: ~30 trading sessions; LLM evidence shorter (~7–10 sessions).
- Job telemetry: ~30 days.

**Safety**
1. Archive object written.
2. Hash/row-count verified.
3. Notion archive/index row written.
4. Only then mark archive checkpoint complete.
5. Cleanup deletes only rows behind completed checkpoints.

---

## Task 7 — Runtime semantic cleanup

Search active code for:
- `Top 100`, `top100`, `hose_top100`
- `is_top100`, `top100_rank`
- exact length/count 100 used as universe requirement
- `market:top100`, `top100:*`
- static Top100 ticker arrays

For each hit classify as:
- **universe semantic** → migrate/remove;
- **historical documentation/evidence** → retain with legacy label;
- **batch/page/score limit** → leave unchanged.

---

## Task 8 — Verification, merge and production acceptance

1. Run targeted regression suite.
2. Run complete tests, lint, typecheck and Next.js production build via available CI/Vercel preview evidence.
3. Run Supabase migration/function smoke tests.
4. Verify new canonical universe exactly 200 and activity gate.
5. Verify Board/Bubbles/Qeo Composite/Wyckoff/AI Council/Admin consume same current run ID.
6. Verify all scheduled jobs and next-run schedules.
7. Mark PR ready; request review; fix findings.
8. Squash/merge once into `main`.
9. Wait for the single Vercel production deployment and require READY.
10. Run post-deploy production smoke tests.
11. Trigger a fresh universe/readiness/EOD smoke path where safe; do not fabricate a trading session on a market holiday.
12. Write final `docs/automation/CRON_WORKFLOW_TOP_STOCKS_200.md` containing every cron/function, schedule, input, canonical-universe dependency, output, retry policy, retention/archive behavior, manual-run command/path and failure semantics.

## Completion evidence required

- Production canonical run ID and 200-row verification.
- Exact excluded suspended/restricted symbols check.
- Supabase Edge Function version/hash.
- Notion v3 database/page URLs and legacy/deprecated inventory.
- Production cron inventory from `cron.job` plus Vercel schedule inventory.
- AI Council deterministic exact-membership proof.
- Wyckoff expected snapshot formula and current count.
- Vercel production deployment READY on merged main SHA.
- Final workflow document committed and shared with user.
