# QEO-126 EOD v4 Corporate-Action Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate corporate-action sync, factor maintenance and adjusted-Daily maintenance into EOD v4 `HISTORY_REFRESH` without adding an eighth operator phase.

**Architecture:** QEO-129 provides the shadow adjusted-Daily rebuild API. EOD first syncs normalized corporate actions and classifies lineage impact, then completes raw Daily refresh. After raw Daily is durable, every verified `shadow|active` ticker gets an incremental adjusted row for the current session; only tickers whose effective event lineage changed receive a historical adjusted-range rebuild. Downstream consumers remain ordered after `HISTORY_REFRESH`.

**Tech Stack:** Vercel Workflow, TypeScript, Supabase, `modules/eod/workflow-steps.ts`, `workflows/qeoindex-eod-pipeline.ts`, QEO-123/QEO-124/QEO-129 modules.

**Spec:** `docs/superpowers/specs/2026-09-06-corporate-actions-adjusted-chart-design.md`

## Global Constraints

- Depends on QEO-123, QEO-124 and QEO-129 production-ready shadow contracts.
- Preserve the existing seven EOD v4 **business phases** from `modules/admin/job-phases.ts`; no new operator-level phase.
- Future event sync must not alter active historical factors before canonical `ex_date`.
- Every verified shadow/active ticker must append/refresh the latest completed adjusted Daily session each EOD even when no corporate action changed.
- Historical rebuild is change-driven only; unchanged lineage must not trigger an ~8Y rewrite.
- Ambiguous effective event fails closed for that ticker; never mix price bases.
- Adjusted persistence success is based on exact DB readback from QEO-129.
- Once QEO-125 activates consumers, Wyckoff/AI Council must remain downstream of this maintenance path.

---

### Task 1: Define EOD workflow-step contracts

**Files:**
- Modify: `modules/eod/workflow-steps.ts`
- Modify: `tests/eod-orchestrator-contract.test.ts`
- Modify: `tests/eod-data-refresh-contract.test.ts`

**Interfaces:**

```ts
export type CorporateActionSyncSummary = {
  requestedTickers: number
  discovered: number
  created: number
  amended: number
  canceled: number
  ambiguous: number
  upcoming: number
}

export type AdjustmentImpact = {
  ticker: string
  reason: "unchanged" | "future_event" | "activated" | "amended" | "ambiguous"
  previousLineageHash: string | null
  nextLineageHash: string | null
  affectedFromDate: string | null
}

export type AdjustedDailyMaintenanceSummary = {
  eligibleTickers: number
  currentSessionPersisted: number
  historicalRebuildTickers: number
  rebuiltSessions: number
  unresolvedTickers: string[]
}
```

- [ ] **Step 1: Add RED orchestration assertions**

Require typed wrappers for:

```text
runCorporateActionSyncBatchStep
runAdjustmentImpactStep
runAdjustedDailyCurrentSessionBatchStep
runAffectedAdjustedDailyRebuildStep
runDerivedHistoryInvalidationStep
```

and assert they remain nested under the existing `HISTORY_REFRESH` internal phase/business mapping rather than becoming new `QEOINDEX_EOD_PHASES` entries.

- [ ] **Step 2: Implement typed durable step wrappers using existing phase/checkpoint conventions**
- [ ] **Step 3: Run canonical EOD orchestrator/data-refresh tests GREEN**
- [ ] **Step 4: Commit**

### Task 2: Add bounded corporate-action sync batches

**Files:**
- Create: `modules/eod/corporate-action-sync.ts`
- Modify: `modules/eod/workflow-steps.ts`
- Modify: `workflows/qeoindex-eod-pipeline.ts`
- Create: `tests/qeo-126-corporate-actions-eod.test.ts`
- Modify: `tests/test-contracts.json`

**Interfaces:**

```ts
export async function syncCorporateActionsBatch(input: {
  tickers: string[]
  asOf: string
}): Promise<CorporateActionSyncSummary>
```

- [ ] **Step 1: Register focused test contract**

Add `tests/qeo-126-corporate-actions-eod.test.ts` to `tests/test-contracts.json` with owner `eod` and invariant covering bounded idempotent event sync, ex-date activation and persisted adjusted-Daily maintenance.

- [ ] **Step 2: RED batch/idempotency cases** — max batch 10; repeated unchanged evidence reports unchanged, not amended.
- [ ] **Step 3: Implement QEO-123 provider/store calls with bounded timeout/concurrency**
- [ ] **Step 4: Wire deterministic batches from the frozen canonical universe**
- [ ] **Step 5: Provider/source failure is truthful telemetry; no synthesized event terms**
- [ ] **Step 6: GREEN focused test and commit**

### Task 3: Add deterministic lineage-impact detection

**Files:**
- Create: `modules/eod/corporate-action-impact.ts`
- Modify: `tests/qeo-126-corporate-actions-eod.test.ts`

**Interfaces:**

```ts
export function classifyAdjustmentImpact(input: {
  asOfDate: string
  previousLineageHash: string | null
  currentLineageHash: string | null
  earliestChangedExDate: string | null
  hasAmbiguousEffectiveEvent: boolean
  hasFutureOnlyChange: boolean
}): AdjustmentImpact["reason"]
```

- [ ] **Step 1: RED future-event case** — discovered event with `exDate > asOfDate` => `future_event`, no historical rebuild.
- [ ] **Step 2: RED activation case** — first EOD on/after ex-date => `activated` with affected historical boundary.
- [ ] **Step 3: RED historical amendment case** => `amended` from earliest changed effective ex-date.
- [ ] **Step 4: RED ambiguous effective case** => `ambiguous`, no factor/history activation.
- [ ] **Step 5: Implement and GREEN**
- [ ] **Step 6: Commit**

### Task 4: Maintain current-session factors + adjusted Daily for every shadow/active ticker

**Files:**
- Create: `modules/eod/adjusted-daily-maintenance.ts`
- Modify: `modules/eod/workflow-steps.ts`
- Modify: `workflows/qeoindex-eod-pipeline.ts`
- Modify: `tests/qeo-126-corporate-actions-eod.test.ts`
- Modify: `tests/eod-data-refresh-contract.test.ts`

**Interfaces:**

```ts
export async function maintainAdjustedDailyCurrentSession(input: {
  tickers: string[]
  targetSessionDate: string
}): Promise<AdjustedDailyMaintenanceSummary>
```

- [ ] **Step 1: RED no-event-current-session case**

A verified shadow/active ticker with unchanged lineage still extends QEO-124 factor coverage through the completed session and persists exactly one adjusted Daily row for that session.

- [ ] **Step 2: RED missing raw Daily case** — ticker remains unresolved; do not fabricate an adjusted bar.
- [ ] **Step 3: RED persisted-readback case** — write acknowledgment without exact QEO-129 readback does not count as current-session persisted.
- [ ] **Step 4: Implement bounded batches using QEO-124 factor engine/store + QEO-129 single-session rebuild**
- [ ] **Step 5: Preserve rollout state** — this maintenance must not change `shadow -> active`; QEO-125 owns activation.
- [ ] **Step 6: GREEN and commit**

### Task 5: Rebuild historical adjusted range only for activated/amended lineage

**Files:**
- Modify: `modules/eod/adjusted-daily-maintenance.ts`
- Modify: `modules/eod/workflow-steps.ts`
- Modify: `workflows/qeoindex-eod-pipeline.ts`
- Modify: `tests/qeo-126-corporate-actions-eod.test.ts`
- Modify: `tests/eod-fault-isolation-contract.test.ts`

**Interfaces:**

```ts
export async function rebuildAffectedAdjustedDaily(input: {
  ticker: string
  affectedFromDate: string
  targetSessionDate: string
  lineageHash: string
}): Promise<{
  ticker: string
  rebuiltSessions: number
  unresolvedSessions: string[]
  persistedLineageHash: string
}>
```

- [ ] **Step 1: RED activated-event case** — factor lineage is recomputed/activated through target session and historical adjusted range is rebuilt.
- [ ] **Step 2: RED unchanged lineage case** — historical rebuild API is not invoked.
- [ ] **Step 3: RED unresolved readback case** — ticker is unresolved/fail-closed; healthy tickers in another bounded batch retain truthful progress according to existing EOD fault-isolation policy.
- [ ] **Step 4: Implement via QEO-124 + QEO-129 APIs; no duplicate adjustment implementation in EOD module**
- [ ] **Step 5: GREEN focused/fault-isolation tests and commit**

### Task 6: Lock exact EOD dependency order

**Files:**
- Modify: `workflows/qeoindex-eod-pipeline.ts`
- Modify: `tests/eod-orchestrator-contract.test.ts`
- Modify: `tests/eod-data-refresh-contract.test.ts`

Required `HISTORY_REFRESH` sub-order:

```text
corporate action sync
  -> adjustment impact detection
  -> canonical raw Daily refresh
  -> current-session factor + adjusted Daily maintenance for shadow/active tickers
  -> historical adjusted rebuild for activated/amended tickers
  -> affected derived-history invalidation
  -> HISTORY_REFRESH terminal checkpoint
  -> Wyckoff Build / publish
  -> deterministic Council
  -> Market Synthesis
  -> LLM Council
```

- [ ] **Step 1: RED source-order assertions against actual workflow**
- [ ] **Step 2: Wire minimal ordering changes**
- [ ] **Step 3: Preserve current non-trading-day scheduler behavior** — do not invent a second corporate-action scheduler in this issue.
- [ ] **Step 4: GREEN canonical EOD suite and commit**

### Task 7: Add truthful nested telemetry without new business/internal phase keys

**Files:**
- Modify: `modules/admin/job-phases.ts` descriptions/summary aggregation only if needed; do not add a business phase or top-level internal phase key
- Modify: EOD checkpoint summary producer in `modules/eod/workflow-steps.ts`
- Modify: `tests/eod-telemetry-contract.test.ts`
- Modify: `tests/root-admin-ui.test.ts`

Telemetry under `HISTORY_REFRESH` summary:

```text
corporateActionsDiscovered
corporateActionsCreated
corporateActionsAmended
corporateActionsAmbiguous
corporateActionsUpcoming
adjustedDailyEligibleTickers
adjustedDailyCurrentSessionPersisted
adjustmentTickersActivatedByDate
adjustmentHistoricalRebuildTickers
adjustmentRebuiltSessions
adjustmentTickersUnresolved
```

- [ ] **Step 1: RED contract that `QEOINDEX_EOD_BUSINESS_PHASES.length === 7` and no new top-level `QEOINDEX_EOD_PHASES` key is added for corporate actions**
- [ ] **Step 2: Add/aggregate nested HISTORY_REFRESH summary fields**
- [ ] **Step 3: Verify Admin job detail exposes truthful counts without a new phase card**
- [ ] **Step 4: GREEN telemetry/UI tests and commit**

### Task 8: Production staged acceptance before QEO-125 consumer cutover

- [ ] Deploy with VHM rollout still `shadow`.
- [ ] Run an EOD with unchanged VHM lineage: latest completed raw Daily appears, current-session factor coverage extends, one adjusted shadow row persists, no historical rewrite.
- [ ] Validate a known/pinned future-event fixture or controlled test path: event becomes queryable while historical adjusted lineage remains inactive before ex-date.
- [ ] Validate activation path with deterministic fixture/staged date: on/after ex-date historical factor lineage rebuilds and exact readback succeeds.
- [ ] Re-run same EOD: current-session maintenance is idempotent and historical rebuild is no-op.
- [ ] Verify no production consumer has switched solely because shadow rows exist.
- [ ] Update QEO-126 evidence; only then unblock QEO-125 final consumer cutover.
