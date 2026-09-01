# KFSP Canonical 200 Clean Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clean-rebuild KFSP/TTAI stock data so user-facing ratings and TTAI persist only the current `vn_top_stocks` universe while preserving a separate full KFSP candidate feed required to discover future universe entrants.

**Architecture:** `kfsp-rating-sync` fetches the provider universe once, writes a minimal service-role-only candidate snapshot for market-universe selection, then publishes only current canonical members to `insights_stock_ratings`. `qeo_select_market_universe_candidates` moves its five-day activity gate to the candidate table. `kfsp-ttai-history-sync` reads the canonical RPC's current `stocks` payload and supports forced 50-ticker rebuild batches.

**Tech Stack:** Supabase Postgres, Edge Functions/Deno, pg_cron/pg_net, TypeScript, node:test, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-01-top-stocks-200-universe-design.md`

## Global Constraints

- Canonical universe key is `vn_top_stocks`, hard maximum 200, no padding.
- Preserve current market-universe selector semantics: strict market-cap/Avg50 filters and 5 weekday observations with >=4 positive-volume days.
- Preserve active rating/TTAI table schemas and useful indexes; cleanup data, not working read contracts.
- Full provider rows required for future universe discovery must be service-role-only and separate from canonical user-facing ratings.
- All stock rating/TTAI rebuild writes must be scoped to the latest published canonical membership.
- Production cleanup happens only after code/migration verification and Edge Function deployment.

---

### Task 1: RED regression contract

**Files:**
- Create: `tests/kfsp-canonical-universe-sync.test.ts`

**Interfaces:**
- Consumes current Edge Function and migration source as text.
- Produces regression expectations for candidate-feed split, canonical rating filtering, and TTAI `stocks` RPC parsing.

- [ ] Write a test asserting `kfsp-rating-sync` loads `qeo_current_market_universe`, filters canonical ratings, and persists a full candidate feed.
- [ ] Write a test asserting `kfsp-ttai-history-sync` reads `payload.stocks` and rejects obsolete `payload.memberships`.
- [ ] Write a test asserting the new migration owns `kfsp_universe_candidate_snapshots` and redefines `qeo_select_market_universe_candidates` against that table.
- [ ] Run the focused test in GitHub Verify and confirm RED for the missing implementation.

### Task 2: Candidate feed and selector migration

**Files:**
- Create: `supabase/migrations/20260901221500_kfsp_canonical_rating_candidate_split.sql`

**Interfaces:**
- Produces table `public.kfsp_universe_candidate_snapshots` keyed by `(as_of_date,ticker)` with identity, market-cap, Avg50, `volume_1d`, and provider fetch timestamp.
- Replaces `qeo_select_market_universe_candidates(date,numeric,bigint,integer)` to read candidate snapshots while preserving the existing five-day activity semantics.

- [ ] Create service-role-only candidate table, indexes, RLS, and grants.
- [ ] Recreate the candidate selector RPC against the new table using the same rank/order/activity contract.
- [ ] Add a bounded retention helper or writer-side pruning target of at least 10 calendar days.
- [ ] Apply migration to production only after RED/GREEN source verification.

### Task 3: Canonical KFSP rating writer

**Files:**
- Modify: `supabase/functions/kfsp-rating-sync/index.ts`

**Interfaces:**
- `loadCanonicalTickers(supabase): Promise<string[]>`
- Full provider payload -> candidate snapshot rows for every valid provider ticker.
- Full provider payload + canonical tickers -> exactly canonical rating staging rows.

- [ ] Parse the canonical RPC `stocks` list and validate unique count 1..200.
- [ ] Persist minimal candidate rows for the complete provider response before canonical filtering.
- [ ] Fetch supplemental TTAI summary only for canonical tickers.
- [ ] Build/publish rating rows in canonical rank order and fail closed on missing canonical provider coverage.
- [ ] Prune candidate snapshots older than the retention window.
- [ ] Run focused/core tests GREEN and deploy the Edge Function.

### Task 4: TTAI canonical RPC and forced rebuild

**Files:**
- Modify: `supabase/functions/kfsp-ttai-history-sync/index.ts`

**Interfaces:**
- Canonical universe is read from RPC JSON key `stocks`.
- Forced requests `{tickers:[...],force:true}` may rebuild up to 50 requested canonical tickers regardless of sync-state freshness.

- [ ] Replace obsolete `memberships` parsing with `stocks` and validate uniqueness.
- [ ] Keep normal daily candidate behavior financial-period driven.
- [ ] Allow explicit forced canonical requests to attempt provider history even when the rating financial-period field is null.
- [ ] Run focused/core tests GREEN and deploy Edge Function with `normalize.ts`.

### Task 5: Production clean rebuild

**Files:**
- Operational production data only; no migration used for one-time deletion.

**Interfaces:**
- Reset stock data tables: `insights_stock_ratings`, `kfsp_rating_staging`, `kfsp_rating_sync_runs`, `kfsp_ttai_quarterly_history`, `kfsp_ttai_sync_state`, `kfsp_ttai_sync_runs`, and candidate snapshots.
- Preserve schema, cron definitions, canonical universe tables, market-insight history, AI Council history, and active indexes.

- [ ] Preflight FK/view/function dependencies and capture baseline counts/indexes.
- [ ] Delete the authorized KFSP/TTAI stock data in dependency-safe order.
- [ ] Manually invoke the same KFSP Edge Function path used by cron and verify canonical rating count equals current universe count while candidate count remains full-provider sized.
- [ ] Invoke four forced TTAI batches of <=50 canonical tickers and verify no non-canonical history/state rows.
- [ ] Verify active indexes remain present, latest ratings have 200 distinct canonical tickers, TTAI state covers all attempted canonical members, and no stale stock rows survive.

### Task 6: Verification and integration

**Files:**
- Update this plan/checkpoint only if implementation details materially differ.

**Interfaces:**
- GitHub Verify provides test/lint/type/build evidence; production SQL provides data-integrity evidence.

- [ ] Run focused tests, core regression, lint/typecheck/build through GitHub Verify.
- [ ] Compare branch vs `main` for only intended source/migration/test/doc changes.
- [ ] Close or update related Linear issues with implementation evidence.
- [ ] Merge only after verification is green and production clean-rebuild invariants pass.
