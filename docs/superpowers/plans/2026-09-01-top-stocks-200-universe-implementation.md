# Top Stocks 200 Canonical Universe Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every current operational Top 100 stock list with one monthly Top Stocks 200 universe selected from KFSP, persisted atomically in Supabase, cached for runtime reads, backed by 100% logo coverage in `stock-logo`, configurable from Root Admin, and safe for destructive legacy cleanup after cutover.

**Architecture:** Supabase owns immutable universe runs/memberships and the monthly refresh. A service-role Edge Function selects from the latest published KFSP snapshot, guarantees a Storage logo object for every selected member, then atomically publishes the staged run. Next.js reads one cached current-universe RPC and every stock-list consumer uses that membership. Historical Top100 evidence remains immutable; current-only legacy schema/data is removed only after zero-reference verification.

**Tech Stack:** Next.js 16.3, React 19, TypeScript 5.7, Supabase Postgres/Storage/Edge Functions/pg_cron, Vercel Runtime Cache + optional Upstash Redis, node:test, pnpm 10.28.

**Spec:** `docs/superpowers/specs/2026-09-01-top-stocks-200-universe-design.md`

## Global Constraints

- Canonical key is `vn_top_stocks`.
- Selector is strict `average_volume_50_sessions > configuredMinAvg50` AND `market_cap_billion > configuredMinMarketCap`.
- Default thresholds are 250000 shares and 10 billion VND.
- Rank by market cap DESC, Avg50 DESC, ticker ASC; hard maximum 200; no padding.
- Membership changes only after a successful monthly publish.
- Supabase bucket `stock-logo` is public-read/service-role-write and every published member must have `{TICKER}.png`.
- Bảng điện, Bubbles, Qeo Composite, detail, Wyckoff and AI Council must use the same current membership.
- Current Wyckoff expected snapshots = `universeCount * 5`; max 1000.
- Do not introduce long-term `is_top200` / `top200_rank`.
- Destructive cleanup is last and must preserve historical evidence.
- Supabase migrations/functions are applied/deployed to production when introduced, per `AGENTS.md`.
- Production web deploy happens once by merging the validated branch to `main`; no manual `vercel --prod`.

---

### Task 1: RED tests for the new universe contract

**Files:**
- Create: `tests/market-universe.test.ts`
- Modify: `tests/root-admin-catalog.test.ts`
- Modify: `tests/root-admin-settings.test.ts`
- Modify: `tests/root-admin-jobs.test.ts`
- Modify: `tests/root-admin-ui.test.ts`
- Modify: `tests/insights-schema.test.ts`
- Modify: `tests/wyckoff-v2-staging.test.ts`
- Modify: `tests/wyckoff-v2-ingest.test.ts`
- Modify: `tests/wyckoff-v2-notion-staging.test.ts`
- Modify: `tests/qeoindex-eod-pipeline.test.ts`

**Interfaces:**
- Produces regression expectations for `selectMarketUniverse`, max 200, Admin settings/job/page, canonical Bubbles membership, dynamic Wyckoff counts and zero exact-100/exact-500 runtime contracts.

- [ ] Add pure selector tests for strict boundaries, deterministic ordering, no padding and max 200.
- [ ] Update Admin tests to expect the two editable market filters, `market.universe_size=200`, monthly job and `/admin/universe`.
- [ ] Update Insights source-contract test so Bubbles cannot use the independent `>300000` selector.
- [ ] Update Wyckoff tests to permit non-HOSE exchanges and validate up to 200 tickers / `N*5` snapshots.
- [ ] Update EOD contract tests to reject exact `100/500` readiness assumptions.
- [ ] Open a draft PR after the first implementation commit so GitHub Verify provides the RED/GREEN execution environment.

### Task 2: Generic Supabase universe persistence and selector

**Files:**
- Create: `supabase/migrations/20260901090000_market_universe_top_stocks.sql`
- Create: `modules/market/universe/selection.ts`
- Create: `modules/market/universe/index.ts`
- Modify: `modules/admin/catalog.ts`
- Modify: `modules/admin/settings.ts`

**Interfaces:**
- `selectMarketUniverse(rows, filters): MarketUniverseCandidate[]`
- `getCanonicalUniverse(): Promise<CanonicalUniverseSnapshot>`
- `invalidateCanonicalUniverseCache(): Promise<void>`
- `getMarketUniverseRuntimeConfig(): Promise<{minMarketCapBillion:number; minAverageVolume50d:number}>`
- RPC `qeo_current_market_universe()` returns one published run plus ordered memberships.
- RPC `qeo_publish_market_universe_run(uuid)` atomically makes a staged run current.

- [ ] Add migration creating `market_universe_runs` and `market_universe_memberships`, indexes, RLS/service-role permissions, current read RPC and atomic publish RPC.
- [ ] Add pure selector implementation matching the strict spec.
- [ ] Add cached server read boundary using `market-universe:v1/current` and fail-open DB semantics.
- [ ] Add Admin setting definitions and runtime config loader.
- [ ] Apply the migration to production and verify tables/RPCs exist without removing compatibility fields.

### Task 3: Monthly Edge refresh and guaranteed Storage logos

**Files:**
- Create: `supabase/functions/market-universe-sync/index.ts`
- Create: `supabase/migrations/20260901091000_market_universe_monthly_cron.sql`
- Modify: `scripts/download-square-official-logos.cjs` or replace it with a non-static compatibility utility.

**Interfaces:**
- Edge function reads latest KFSP + Admin settings, builds candidate rows, ensures `stock-logo/{ticker}.png`, stages memberships and calls atomic publish RPC.
- It accepts authorized scheduled/manual requests only.
- Official logo source priority remains Ruatichsan → 24hMoney → Vietstock; deterministic generated PNG is final fallback.

- [ ] Implement bounded logo discovery with image validation and Storage upsert.
- [ ] Implement deterministic generated fallback PNG so Storage coverage is 100% before publish.
- [ ] Implement refresh telemetry/run failure semantics; failed run leaves current universe unchanged.
- [ ] Add pg_cron schedule `10 0 1 * *` UTC = 07:10 ICT day 1.
- [ ] Deploy Edge Function and apply cron migration.
- [ ] Run a non-destructive preflight refresh if possible and verify 207 current qualifiers are deterministically capped to 200 under defaults.

### Task 4: Root Admin universe control plane

**Files:**
- Create: `modules/admin/universe.ts`
- Create: `app/admin/universe/page.tsx`
- Create: `components/admin/admin-universe-table.tsx`
- Modify: `components/admin/admin-nav.tsx`
- Modify: `modules/admin/catalog.ts`
- Modify: `modules/admin/jobs.ts`
- Modify: `modules/admin/effective-job-catalog.ts`
- Modify: `modules/admin/job-schedule.ts`
- Modify: `modules/admin/schedule-policy.ts`
- Modify: `modules/admin/cron-timeline.ts`
- Modify: `app/admin/actions.ts`

**Interfaces:**
- Admin loader returns current run, members, current filters, next-run configured filters, logo/detail coverage, last and next scheduled refresh.
- Manual job key `market.universe_monthly` dispatches the authorized refresh.

- [ ] Add `Top Stocks 200` nav and root-only page.
- [ ] Show selected/max, current run/source date, last/next update, current vs next filter values, coverage counts and membership table.
- [ ] Extend Admin scheduler semantics to monthly day-of-month instead of presenting the job as daily/manual.
- [ ] Add manual refresh allowlist/dispatch and audit trail.

### Task 5: Logo runtime cutover and market-board consumers

**Files:**
- Create: `lib/stock-logo-url.ts`
- Modify: `components/stock-logo.tsx`
- Modify: `app/page.tsx`
- Modify: `lib/market-sync-universe.ts`
- Modify: `modules/eod/shares.ts`
- Modify: `modules/market/realtime/intraday-5m-service.ts`
- Modify: `lib/supabase/realtime.ts`
- Modify: `supabase/functions/orderbook-sync/index.ts`
- Modify: operational scripts that import the static universe.

**Interfaces:**
- Stock logos resolve through Supabase public Storage.
- Orderbook Edge Function loads current membership from the canonical RPC.
- All market-board provider calls receive current cached tickers.

- [ ] Switch `StockLogo` from `/logos/{ticker}.png` to the Storage public URL while retaining badge error fallback.
- [ ] Load current universe once during server page bootstrap and pass it to quotes/5m/board model.
- [ ] Remove duplicated Top100 array from orderbook Edge Function and deploy it.
- [ ] Replace `top100:*` cache/channel labels with semantic universe names where they are membership contracts.

### Task 6: Insights/Bubbles/Qeo Composite/detail migration

**Files:**
- Modify: `modules/research/insights/data.ts`
- Modify: `components/insights/insights-dashboard.tsx`
- Modify: related detail/popup components and docs/tests.

**Interfaces:**
- Latest rating/detail rows are intersected with current universe membership.
- Bubbles receives only members; visualization sorting remains independent.
- Detail loader can use latest previous published KFSP row for the same ticker when today is missing.

- [ ] Remove `.gt(average_volume_50_sessions, 300000)` as a membership rule.
- [ ] Replace Top100 fields/labels in the active Insights read model with generic universe rank semantics.
- [ ] Ensure every current member can resolve popup/detail identity and metrics.

### Task 7: Scanner/Wyckoff dynamic-universe migration

**Files:**
- Modify: `modules/signals/scanner/data.ts`
- Modify: `modules/signals/scanner/runner.ts`
- Modify: `app/api/scanner/run/route.ts`
- Modify: `modules/wyckoff/eod-universe.ts`
- Modify: `modules/wyckoff/eod-universe-source.ts`
- Modify: `modules/wyckoff/eod-contract.ts`
- Modify: `modules/wyckoff/eod-ingest.ts`
- Modify: `modules/wyckoff/eod-notion-staging.ts`
- Modify: `modules/wyckoff/unified-data.ts`
- Modify: `modules/wyckoff/notion-ingest.ts`
- Modify: `app/insights/wyckoff/page.tsx`
- Modify: EOD workflow/steps/tests.

**Interfaces:**
- Operational universe source is `vn_top_stocks` current memberships.
- `expectedSnapshotCount(tickerCount) = tickerCount * 5`.
- Historical runs preserve their old key/count.

- [ ] Remove HOSE-only and exact-100 validation from operational selection.
- [ ] Thread actual universe count/key through Notion Run properties and validation.
- [ ] Increase bounded Notion pagination to support max 1000 snapshots without changing per-request safety.
- [ ] Make EOD loops work over 200 tickers in existing 10-ticker durable batches.
- [ ] Update Admin EOD phase labels/copy from Wyckoff 500 to dynamic snapshots.

### Task 8: AI Council/EOD readiness migration

**Files:**
- Modify: `modules/ai-council/data.ts`
- Modify: `modules/ai-council/eod-workflow-steps.ts`
- Modify: `workflows/ai-council-eod-workflow.ts`
- Modify: `modules/eod/backfill-ready-step.ts`
- Modify: `modules/eod/workflow-steps.ts`
- Modify: `workflows/qeoindex-eod-pipeline.ts`

**Interfaces:**
- AI Council candidate universe is the published canonical membership.
- Existing `ai_council.llm_max_tickers` remains the LLM cost boundary.

- [ ] Replace `is_top100/top100_rank` readiness queries with canonical membership intersection/order.
- [ ] Replace ten hardcoded 10-stock batches with dynamic bounded loops.
- [ ] Remove exact 100/500 assertions while keeping fail-closed same-session freshness.

### Task 9: Stop writing legacy Top100 flags and preserve history before cleanup

**Files:**
- Modify: `supabase/functions/kfsp-rating-sync/index.ts`
- Create: `supabase/migrations/20260901092000_archive_legacy_top100_membership.sql`
- Deploy: `kfsp-rating-sync`

**Interfaces:**
- Archive table preserves `{as_of_date,ticker,legacy_rank,source}` for historical Top100 membership before column removal.
- KFSP daily writer no longer depends on `CANONICAL_TOP100_TICKERS` or writes legacy fields.

- [ ] Create exact historical legacy-membership archive with service-role-only access and uniqueness.
- [ ] Backfill archive from current rating history.
- [ ] Remove legacy flag writes/import from KFSP Edge Function and deploy it.
- [ ] Verify daily KFSP publish works without legacy fields being required.

### Task 10: Guarded destructive cleanup

**Files:**
- Create: `supabase/migrations/20260901093000_cleanup_legacy_top100_contract.sql`
- Delete/refactor: obsolete static Top100 catalog/list artifacts and local logo indexes only when no runtime references remain.

**Interfaces:**
- Migration preconditions assert a current published `vn_top_stocks` run exists and archive coverage is present before legacy rating columns/constraints/indexes are dropped.

- [ ] Code-search active runtime for `is_top100`, `top100_rank`, `hose_top100`, static Top100 lists, exact-100/exact-500 universe contracts and `top100:*` cache names.
- [ ] Preflight DB functions/views/FKs/indexes for legacy references.
- [ ] Apply cleanup migration only when both scans are clean.
- [ ] Remove obsolete current `hose_top100` membership materialization while preserving historical run/snapshot evidence.
- [ ] Verify all current read models still work after cleanup.

### Task 11: Full refresh, PR verification, single production release

**Files:**
- Modify: `docs/HANDOVER.md`
- Modify: `docs/market-board.md`
- Modify: `docs/insights-handover.md`
- Modify: `docs/wyckoff-chart-unified-data.md`

**Interfaces:**
- GitHub PR runs `pnpm test:core`, touched lint, typecheck, secret scan and Next production build.
- Final manual refresh publishes the current 200-member universe and fills all logo objects.

- [ ] Run `market.universe_monthly` and verify current source snapshot, strict filters, count <=200, deterministic ranks, detail coverage=count and logo coverage=count.
- [ ] Trigger dependent orderbook/market refresh and verify all active list surfaces use the same membership.
- [ ] Run EOD/readiness contract verification for Wyckoff/AI Council without creating unbounded LLM work.
- [ ] Open/update PR and require GitHub Verify GREEN.
- [ ] Perform verification-before-completion review against the spec and changed-file diff.
- [ ] Merge once to `main`; verify the single Git-triggered Vercel production deployment reaches READY.
- [ ] Smoke-test `/`, `/insights`, `/insights/wyckoff`, `/insights/ai-council`, `/admin/universe` and current universe DB/Storage invariants.
