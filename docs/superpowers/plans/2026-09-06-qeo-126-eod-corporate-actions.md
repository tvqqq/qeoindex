# QEO-126 EOD v4 Corporate-Action Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate corporate-action sync, impact detection and factor activation into EOD v4 `HISTORY_REFRESH` without adding an eighth operator phase.

**Architecture:** Add bounded nested durable steps before canonical Daily refresh. Sync normalized events, compare ticker lineage, activate/recompute only affected tickers on/after `ex_date`, and expose explicit telemetry. Downstream consumers run only after adjusted-history rebuild/readback succeeds for affected tickers.

**Tech Stack:** Vercel Workflow, TypeScript, Supabase, existing `modules/eod/workflow-steps.ts`, `workflows/qeoindex-eod-pipeline.ts`.

**Spec:** `docs/superpowers/specs/2026-09-06-corporate-actions-adjusted-chart-design.md`

## Global Constraints

- Depends on QEO-123 + QEO-124 production-ready contracts.
- Preserve seven EOD v4 business phases.
- Future event sync must not alter historical adjusted prices before ex-date.
- Unchanged ticker = no factor/history recompute.
- Ambiguous event = fail closed for that ticker; never mix price bases.
- Downstream Wyckoff/indicators/Council must not race ahead of affected-history rebuild.

---

### Task 1: Define workflow-step contracts and telemetry

**Files:**
- Modify: `modules/eod/workflow-steps.ts`
- Modify: `tests/qeoindex-eod-v4-contract.test.ts`

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
```

- [ ] **Step 1: RED workflow contract**

Require `runCorporateActionSyncBatchStep`, `runAdjustmentImpactStep`, `runAffectedAdjustedDailyRebuildStep` and `runDerivedHistoryInvalidationStep` to exist and appear inside `HISTORY_REFRESH` ordering.

- [ ] **Step 2: Implement typed step wrappers with existing durable telemetry conventions**
- [ ] **Step 3: Run EOD contract tests GREEN**
- [ ] **Step 4: Commit**

### Task 2: Add bounded corporate-action sync batches

**Files:**
- Create: `modules/eod/corporate-action-sync.ts`
- Modify: `modules/eod/workflow-steps.ts`
- Modify: `workflows/qeoindex-eod-pipeline.ts`
- Test: `tests/qeoindex-eod-v4-contract.test.ts`

**Interfaces:**

```ts
export async function syncCorporateActionsBatch(input: {
  tickers: string[]
  asOf: string
}): Promise<CorporateActionSyncSummary>
```

- [ ] **Step 1: RED batch-size/idempotency test** — max batch 10; same source evidence twice reports unchanged rather than amended.
- [ ] **Step 2: Implement provider/store calls using QEO-123 APIs**
- [ ] **Step 3: Wire deterministic batches from frozen canonical universe**
- [ ] **Step 4: Assert provider failure is observable and cannot synthesize event terms**
- [ ] **Step 5: Commit**

### Task 3: Add lineage impact detection

**Files:**
- Create: `modules/eod/corporate-action-impact.ts`
- Modify: `modules/eod/workflow-steps.ts`
- Test: `tests/qeo-126-corporate-action-impact.test.ts`

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

- [ ] **Step 1: RED future-event case** — event discovered today with future ex-date => `future_event`, no `affectedFromDate` rebuild.
- [ ] **Step 2: RED activation case** — first EOD on/after ex-date => `activated` with historical affected boundary.
- [ ] **Step 3: RED historical amendment case** => `amended`.
- [ ] **Step 4: RED ambiguous effective case** => `ambiguous` and no rebuild.
- [ ] **Step 5: Implement and GREEN**
- [ ] **Step 6: Commit**

### Task 4: Wire factor activation and adjusted-Daily rebuild

**Files:**
- Create: `modules/eod/adjusted-daily-rebuild.ts`
- Modify: `modules/eod/workflow-steps.ts`
- Modify: `workflows/qeoindex-eod-pipeline.ts`
- Test: `tests/qeo-126-adjusted-daily-rebuild.test.ts`

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

- [ ] **Step 1: RED persisted-readback contract** — in-memory candidate count must not count as rebuilt if DB trigger/read model did not persist exact lineage.
- [ ] **Step 2: Implement factor generation through QEO-124, then adjusted-history persistence through QEO-125 boundary API**
- [ ] **Step 3: Fail if `unresolvedSessions.length > 0`**
- [ ] **Step 4: Commit**

### Task 5: Preserve EOD dependency ordering

**Files:**
- Modify: `workflows/qeoindex-eod-pipeline.ts`
- Modify: `tests/qeoindex-eod-v4-contract.test.ts`

Required order:

```text
freeze universe
  -> corporate action sync
  -> impact detection
  -> canonical raw Daily refresh
  -> affected adjusted Daily rebuild
  -> derived-history invalidation
  -> Wyckoff / deterministic Council consumers
  -> Market Synthesis
  -> LLM Council
```

- [ ] **Step 1: RED order assertion**
- [ ] **Step 2: Wire minimal pipeline changes**
- [ ] **Step 3: Verify non-trading-day behavior remains explicit; future-event sync policy must follow the approved EOD invocation policy rather than inventing a second scheduler**
- [ ] **Step 4: GREEN EOD suite**
- [ ] **Step 5: Commit**

### Task 6: Add Admin/EOD telemetry without a new business phase

**Files:**
- Modify: existing EOD phase-detail/catalog modules used by Admin job detail UI
- Modify: `tests/qeoindex-eod-v4-contract.test.ts`

Telemetry fields under `HISTORY_REFRESH`:

```text
corporateActionsDiscovered
corporateActionsCreated
corporateActionsAmended
corporateActionsAmbiguous
corporateActionsUpcoming
adjustmentTickersActivated
adjustmentTickersRebuilt
adjustmentTickersUnresolved
```

- [ ] **Step 1: RED contract that no new operator-level phase appears**
- [ ] **Step 2: Add nested detail fields**
- [ ] **Step 3: Verify Admin detail renders truthful counts**
- [ ] **Step 4: Commit**

### Task 7: Production staged acceptance

- [ ] Deploy with corporate-action sync enabled but factor activation scoped to VHM canary first.
- [ ] EOD before a known future ex-date: event queryable/visible, adjusted-history lineage unchanged.
- [ ] First EOD on/after canary ex-date: factor activates, affected history rebuilds, exact readback succeeds.
- [ ] Re-run same EOD: no-op/idempotent.
- [ ] Amendment simulation/fixture proves only impacted ticker/range rebuilds.
- [ ] Verify Wyckoff/Council consumes the post-rebuild lineage.
- [ ] Update QEO-126 evidence before Done.
