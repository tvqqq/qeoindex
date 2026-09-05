# QEO-85 Research Reports Daily Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the 07:05 ICT daily research-report workflow with bounded discovery, concurrency-safe AI idempotency, versioned GPT-5.6 cost accounting, a 20-request/$1 run budget, durable telemetry, and a confirmed Admin backfill path.

**Architecture:** Supabase `pg_cron` is the canonical scheduler owner and dispatches an authenticated Next.js route that starts a durable Vercel Workflow. The workflow runs a sequential report loop over shared research-report domain services; PostgreSQL owns canonical report/analysis identity, pre-AI leases, run-item evidence, and phase/run telemetry. Daily and backfill share the same orchestrator, lease, pricing, and budget code; only discovery scope/trigger differs.

**Tech Stack:** Next.js 16.3, TypeScript 5.7, Vercel Workflow 4.2.5, Supabase/PostgreSQL + `pg_cron`/`pg_net`/Vault, OpenAI Responses API, Node test runner, pnpm 10.28.

**Spec:** `docs/superpowers/specs/2026-09-05-qeo-85-research-reports-daily-workflow-design.md`

## Global Constraints

- Schedule is `5 0 * * *` UTC = **07:05 Asia/Ho_Chi_Minh every calendar day**, including weekends.
- Canonical scheduled job key is `research_reports.daily`; canonical manual recovery key is `research_reports.backfill`.
- `research_reports.daily` is manual-disabled. `research_reports.backfill` is Root-Admin-only, confirmed, reason-required recovery.
- Default daily discovery: page size 15, max 8 pages / 120 metadata rows, max 20 processing candidates.
- Per workflow invocation: max **20 actual OpenAI request attempts** and max **$1.00 estimated AI cost**.
- Repair, incomplete retry, transport retry, and fallback requests all consume the same 20-request budget.
- Request-attempt budget is consumed **before dispatch**, so timeouts/lost responses cannot bypass the cap.
- Pricing version is `openai-gpt-5.6-standard-2026-09-05`.
- GPT-5.6 Luna standard rates per 1M tokens: input `$0.20`, cached input `$0.02`, cache write `$0.25`, output `$1.20`.
- GPT-5.6 Terra standard rates per 1M tokens: input `$2.00`, cached input `$0.20`, cache write `$2.50`, output `$12.00`.
- Above 272K input tokens, apply 2x input/cached/cache-write rates and 1.5x output rate to the whole request.
- Reasoning tokens are displayed separately but are already included in output tokens and must not be billed twice.
- Existing analysis identity remains `(report_id, content_hash, analysis_version, prompt_version, model_route_key)`.
- Active analysis lease must be acquired after hash/identity resolution and before any AI request; daily/backfill share the same lease identity.
- One report failure does not fail the batch. Core/provider/control-plane failure is `failed`; report-level failures or safety-budget deferral are `partial`.
- Old `ready` data is preserved when a later provider/PDF/OpenAI attempt fails.
- `needs_ocr` and `unsupported` are terminal for the current run and do not loop retry.
- Six operational phases remain `DISCOVER`, `UPSERT_METADATA`, `FETCH_PARSE`, `AI_ANALYZE`, `PUBLISH`, `FINALIZE`.
- Report processing is sequential in QEO-85; do not add parallel report execution.
- The QEO-80/QEO-81 research schema is currently **QUARANTINED**. Amend `supabase/pending-migrations/20260904193000_qeo80_research_reports.sql`; do not add an active production ALTER for research tables while quarantine remains.
- The 07:05 scheduler definition must remain rollout-coupled to the quarantined research schema so production cannot activate cron before required tables/RPCs exist.
- No prompt text, PDF text, secrets, or raw TOPI payloads may appear in Admin telemetry.

---

## File Structure

### New focused modules

- `modules/research-reports/analysis/pricing.ts` — pure versioned token-cost calculator and request reservation estimator.
- `modules/research-reports/analysis/budget.ts` — in-memory per-workflow request/cost guard; consumes attempts before dispatch and aggregates confirmed/unknown usage.
- `modules/research-reports/workflow/types.ts` — shared daily/backfill limits, summaries, report outcomes, orchestrator input/output types.
- `modules/research-reports/workflow/retry.ts` — bounded 3-attempt transient retry helper for TOPI/PDF transport classes.
- `modules/research-reports/workflow/telemetry.ts` — `system_job_runs`, six phase rows, and report-run-item persistence for research jobs.
- `modules/research-reports/workflow/orchestrator.ts` — bounded discovery/upsert/sequential processing/finalization shared by daily and backfill.
- `workflows/research-reports-daily-workflow.ts` — durable workflow entry point with step-safe calls into orchestrator checkpoints.
- `app/api/research-reports/daily/route.ts` — machine-authenticated scheduler dispatch route.

### Existing files to modify

- `modules/ai/openai-response.ts` — expose `cacheWriteTokens` from Responses usage.
- `modules/research-reports/analysis/openai.ts` — emit per-request usage/attempt events, route every provider request through budget callbacks, populate cost/version.
- `modules/research-reports/analysis/pipeline.ts` — add lease/stage hooks and return operational audit without duplicating analysis identity/publish logic.
- `modules/research-reports/providers/topi.ts` — safe known-page boundary + transient error classification/retry-compatible fetch errors.
- `modules/research-reports/repository.ts` — recent-known metadata query, upsert classification, lease RPC adapters, run-item adapters.
- `modules/research-reports/types.ts` — cache-write/audit/stage/result extensions.
- `supabase/pending-migrations/20260904193000_qeo80_research_reports.sql` — cache-write audit column, lease table/RPC, run-item ledger, scheduler trigger/cron rollout definition.
- `modules/admin/catalog.ts` — daily/backfill catalog entries.
- `modules/admin/manual-job-capabilities.ts` — allowlist `research_reports.backfill` only.
- `modules/admin/jobs.ts` — typed backfill params and dispatch to shared research workflow/orchestrator.
- `app/admin/actions.ts` — parse backfill form fields server-side.
- `components/admin/admin-manual-job-modal.tsx` — bounded backfill form.
- `modules/admin/job-health.ts` — expose research AI usage/run summary from system-job evidence.
- `app/admin/jobs/[key]/page.tsx` — render phase/usage evidence for research jobs as well as EOD.
- `modules/admin/scheduler-reconciliation.ts` and/or Supabase scheduler reconciliation module used by EOD — register exact research cron name/schedule without duplicating scheduler ownership logic.
- `modules/research-reports/README.md` — document daily/backfill/idempotency/budget/rollout contract.
- `tests/test-contracts.json` — register all new canonical tests.

---

### Task 1: Extend the quarantined database contract for usage, leases, run items, and rollout-coupled cron

**Files:**
- Modify: `supabase/pending-migrations/20260904193000_qeo80_research_reports.sql`
- Test: `tests/research-reports/schema.test.ts` (create if QEO-80 schema assertions are currently embedded elsewhere; otherwise extend the existing canonical research schema test)
- Modify: `tests/test-contracts.json`

**Interfaces:**
- Produces RPC `qeo_acquire_research_report_analysis_lease(...)` returning one row with `outcome`, `lease_token`, `expires_at`.
- Produces RPC `qeo_release_research_report_analysis_lease(...)` guarded by `lease_token`.
- Produces `market_research_report_run_items` unique on `(run_id, report_id)`.
- Adds `cache_write_tokens bigint not null default 0` to `market_research_report_analyses`.
- Defines rollout-coupled trigger function `qeo_trigger_research_reports_daily()` and cron name `research-reports-daily-0705-ict` with `5 0 * * *`.

- [ ] **Step 1: Write failing schema assertions**

```ts
assert.match(sql, /cache_write_tokens\s+bigint\s+not null\s+default 0/i)
assert.match(sql, /create table if not exists public\.market_research_report_analysis_leases/i)
assert.match(sql, /unique\s*\(report_id, content_hash, analysis_version, prompt_version, model_route_key\)/i)
assert.match(sql, /create table if not exists public\.market_research_report_run_items/i)
assert.match(sql, /unique\s*\(run_id, report_id\)/i)
assert.match(sql, /qeo_acquire_research_report_analysis_lease/i)
assert.match(sql, /qeo_release_research_report_analysis_lease/i)
assert.match(sql, /research-reports-daily-0705-ict/i)
assert.match(sql, /'5 0 \* \* \*'/)
```

- [ ] **Step 2: Run the focused schema test and verify RED**

Run: `node --test tests/research-reports/schema.test.ts`

Expected: FAIL because QEO-85 lease/run-item/cache-write/scheduler contract is absent.

- [ ] **Step 3: Add the minimal quarantined SQL contract**

Use service-role-only RLS for lease/run-item tables. Lease acquisition must be atomic and return exactly one of `acquired`, `existing_success`, or `busy`; takeover is allowed only when `expires_at <= now()`. Scheduler trigger must read `qeoindex_app_url` and `qeoindex_cron_secret` from Vault and POST `/api/research-reports/daily` with Bearer authorization, following the EOD trigger pattern.

Core lease uniqueness:

```sql
unique (report_id, content_hash, analysis_version, prompt_version, model_route_key)
```

Run-item identity:

```sql
unique (run_id, report_id)
```

- [ ] **Step 4: Re-run focused schema tests**

Run: `node --test tests/research-reports/schema.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/pending-migrations/20260904193000_qeo80_research_reports.sql tests/research-reports/schema.test.ts tests/test-contracts.json
git commit -m "feat(reports): add workflow persistence contract"
```

---

### Task 2: Add exact Responses usage inspection and versioned GPT-5.6 pricing

**Files:**
- Modify: `modules/ai/openai-response.ts`
- Create: `modules/research-reports/analysis/pricing.ts`
- Modify: `modules/research-reports/types.ts`
- Test: `tests/research-reports/pricing.test.ts`
- Modify: `tests/research-reports/analysis.test.ts`
- Modify: `tests/test-contracts.json`

**Interfaces:**
- `OpenAiResponseEnvelopeInspection.cacheWriteTokens: number`.
- `RESEARCH_REPORT_PRICING_VERSION = "openai-gpt-5.6-standard-2026-09-05"`.
- `estimateResearchReportUsageCost(input: ResearchReportUsageCostInput): ResearchReportUsageCost`.
- `reserveResearchReportRequestCost(input: ResearchReportRequestReservationInput): number`.

```ts
export interface ResearchReportUsageCostInput {
  model: string
  inputTokens: number
  cachedInputTokens: number
  cacheWriteTokens: number
  outputTokens: number
}

export interface ResearchReportUsageCost {
  estimatedCostUsd: number
  pricingVersion: typeof RESEARCH_REPORT_PRICING_VERSION
}
```

- [ ] **Step 1: Write pricing and usage-inspection tests first**

Cover Luna, Terra, cached input, cache write, long-context multiplier, and reasoning non-double-billing. Example:

```ts
assert.deepEqual(
  estimateResearchReportUsageCost({
    model: "gpt-5.6-luna",
    inputTokens: 10_000,
    cachedInputTokens: 2_000,
    cacheWriteTokens: 1_000,
    outputTokens: 2_000,
  }),
  { estimatedCostUsd: 0.00409, pricingVersion: RESEARCH_REPORT_PRICING_VERSION },
)
```

Also assert `inspectOpenAiResponseEnvelope()` reads `input_tokens_details.cache_write_tokens`.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test tests/research-reports/pricing.test.ts tests/research-reports/analysis.test.ts`

Expected: FAIL on missing pricing module/cache-write field.

- [ ] **Step 3: Implement pure pricing module**

Bill uncached input as:

```ts
const uncached = Math.max(0, inputTokens - cachedInputTokens - cacheWriteTokens)
```

Do not add reasoning tokens to output billing again. Reject unsupported model names rather than silently applying a wrong rate.

Reservation must use UTF-8 byte length as a conservative input-token upper bound and reserve configured `max_output_tokens` at the selected model's output rate.

- [ ] **Step 4: Re-run focused tests**

Run: `node --test tests/research-reports/pricing.test.ts tests/research-reports/analysis.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add modules/ai/openai-response.ts modules/research-reports/analysis/pricing.ts modules/research-reports/types.ts tests/research-reports/pricing.test.ts tests/research-reports/analysis.test.ts tests/test-contracts.json
git commit -m "feat(reports): add versioned AI pricing"
```

---

### Task 3: Put every OpenAI request behind a 20-attempt/$1 budget guard

**Files:**
- Create: `modules/research-reports/analysis/budget.ts`
- Modify: `modules/research-reports/analysis/openai.ts`
- Modify: `modules/research-reports/types.ts`
- Test: `tests/research-reports/ai-budget.test.ts`
- Modify: `tests/research-reports/analysis.test.ts`
- Modify: `tests/test-contracts.json`

**Interfaces:**

```ts
export interface ResearchReportAiBudgetSnapshot {
  requestAttempts: number
  maxRequestAttempts: number
  estimatedCostUsd: number
  maxEstimatedCostUsd: number
  unknownUsageAttempts: number
  budgetExhausted: boolean
  budgetReason: "ai_request_limit" | "estimated_cost_limit" | null
}

export interface ResearchReportAiBudget {
  beforeRequest(input: ResearchReportRequestReservationInput): void
  recordResponse(input: ResearchReportUsageCostInput): ResearchReportUsageCost
  recordUnknownUsage(): void
  snapshot(): ResearchReportAiBudgetSnapshot
}
```

`beforeRequest()` increments request-attempt count before provider dispatch. If reservation exceeds remaining USD or attempts are exhausted, throw a typed `ResearchReportBudgetExceededError` without calling fetch.

`analyzeResearchReportPages()` gains optional dependencies:

```ts
budget?: ResearchReportAiBudget
onRequestAudit?: (event: ResearchReportAiRequestAuditEvent) => Promise<void> | void
```

Each request event includes model, attempt ordinal, outcome, usage if known, pricing version, and estimated USD; never include prompt/document text.

- [ ] **Step 1: Write failing budget tests**

Tests must prove:

```ts
assert.equal(fetchCalls, 20)
assert.throws(() => budget.beforeRequest(nextReservation), ResearchReportBudgetExceededError)
```

and a transport timeout still increments `requestAttempts` and `unknownUsageAttempts`.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test tests/research-reports/ai-budget.test.ts tests/research-reports/analysis.test.ts`

Expected: FAIL because provider calls are not guarded.

- [ ] **Step 3: Implement budget + OpenAI instrumentation**

Call order inside `callOpenAiOnce()` must be:

```ts
budget?.beforeRequest(reservation)
try {
  response = await fetchImpl(...)
} catch (error) {
  budget?.recordUnknownUsage()
  await onRequestAudit?.({ outcome: "unknown_usage", ...safeMetadata })
  throw error
}
```

After a valid response envelope, compute/persist actual usage immediately before validation/repair/fallback decisions.

- [ ] **Step 4: Re-run focused tests**

Run: `node --test tests/research-reports/ai-budget.test.ts tests/research-reports/analysis.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add modules/research-reports/analysis/budget.ts modules/research-reports/analysis/openai.ts modules/research-reports/types.ts tests/research-reports/ai-budget.test.ts tests/research-reports/analysis.test.ts tests/test-contracts.json
git commit -m "feat(reports): enforce AI run budget"
```

---

### Task 4: Add atomic pre-AI lease acquisition and operational audit hooks to the processing pipeline

**Files:**
- Modify: `modules/research-reports/repository.ts`
- Modify: `modules/research-reports/analysis/pipeline.ts`
- Modify: `modules/research-reports/types.ts`
- Test: `tests/research-reports/pipeline.test.ts`
- Create: `tests/research-reports/lease.test.ts`
- Modify: `tests/test-contracts.json`

**Interfaces:**

Repository:

```ts
export async function acquireResearchReportAnalysisLease(
  client: ResearchReportLeaseClient,
  input: ResearchReportAnalysisIdentity & { runId: string; ttlSeconds: number },
): Promise<
  | { outcome: "acquired"; leaseToken: string; expiresAt: string }
  | { outcome: "existing_success"; analysisId: string }
  | { outcome: "busy"; expiresAt: string }
>

export async function releaseResearchReportAnalysisLease(
  client: ResearchReportLeaseClient,
  input: { leaseToken: string; terminalOutcome: "ready" | "failed" },
): Promise<void>
```

Pipeline dependency additions:

```ts
budget?: ResearchReportAiBudget
runId?: string
acquireLease?: typeof acquireResearchReportAnalysisLease
releaseLease?: typeof releaseResearchReportAnalysisLease
onStage?: (event: ResearchReportProcessingStageEvent) => Promise<void> | void
onAiRequestAudit?: (event: ResearchReportAiRequestAuditEvent) => Promise<void> | void
```

`ProcessResearchReportResult.status` adds `skipped_concurrent`; result carries aggregate AI audit/budget snapshot without raw page text.

- [ ] **Step 1: Write concurrency tests first**

Prove an active lease produces:

```ts
assert.equal(result.status, "skipped_concurrent")
assert.equal(analyzeCalls, 0)
```

and existing successful analysis still returns `skipped_existing` with zero AI calls.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test tests/research-reports/lease.test.ts tests/research-reports/pipeline.test.ts`

Expected: FAIL because pipeline has no lease hook/status.

- [ ] **Step 3: Implement lease adapter and pipeline integration**

Order is fixed:

```text
fetch -> hash -> parse -> identity -> existing-success check -> acquire lease -> mark processing -> AI -> publish -> release/terminalize lease
```

Do not hold a lease for `needs_ocr` or `unsupported`. If AI/publish throws, release/terminalize the owned lease in a guarded cleanup path; never release another run's token.

- [ ] **Step 4: Re-run focused tests**

Run: `node --test tests/research-reports/lease.test.ts tests/research-reports/pipeline.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add modules/research-reports/repository.ts modules/research-reports/analysis/pipeline.ts modules/research-reports/types.ts tests/research-reports/lease.test.ts tests/research-reports/pipeline.test.ts tests/test-contracts.json
git commit -m "feat(reports): prevent concurrent AI spend"
```

---

### Task 5: Strengthen TOPI discovery and add bounded transient retry

**Files:**
- Modify: `modules/research-reports/providers/topi.ts`
- Create: `modules/research-reports/workflow/retry.ts`
- Modify: `modules/research-reports/types.ts`
- Test: `tests/research-reports/topi.test.ts`
- Modify: `tests/test-contracts.json`

**Interfaces:**

```ts
export interface DiscoverTopiReportsOptions {
  knownExternalReportIds?: ReadonlySet<string>
  recentPublishDateFloor?: string | null
  fetchImpl?: typeof fetch
  pageSize?: number
  maxPages?: number
  timeoutMs?: number
}
```

`ResearchReportDiscoveryResult` adds `reachedSafetyLimit`, `boundaryReason`, and includes recent known rows instead of returning only unknown rows.

Retry helper:

```ts
export async function withBoundedTransientRetry<T>(input: {
  maxAttempts?: 3
  baseDelayMs?: number
  fn: (attempt: number) => Promise<T>
  isRetryable: (error: unknown) => boolean
  sleep?: (ms: number) => Promise<void>
}): Promise<T>
```

- [ ] **Step 1: Write failing discovery tests**

Fixtures must include reordered/non-contiguous IDs where page 1 contains a known ID followed by a new ID. Assert the new ID is still discovered. Also test full-known old page boundary, short-page boundary, and max-page safety limit.

- [ ] **Step 2: Run focused test and verify RED**

Run: `node --test tests/research-reports/topi.test.ts`

Expected: existing first-known-ID behavior fails the reorder test.

- [ ] **Step 3: Implement safe boundary + typed transient failures**

Only stop on short/no page, max-pages, or a full page of known reports older than the recent floor. Deduplicate by external ID but keep fetched recent known rows available for metadata-change detection.

- [ ] **Step 4: Re-run focused test**

Run: `node --test tests/research-reports/topi.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add modules/research-reports/providers/topi.ts modules/research-reports/workflow/retry.ts modules/research-reports/types.ts tests/research-reports/topi.test.ts tests/test-contracts.json
git commit -m "feat(reports): harden TOPI discovery"
```

---

### Task 6: Build shared daily/backfill orchestrator and durable telemetry

**Files:**
- Create: `modules/research-reports/workflow/types.ts`
- Create: `modules/research-reports/workflow/telemetry.ts`
- Create: `modules/research-reports/workflow/orchestrator.ts`
- Modify: `modules/research-reports/repository.ts`
- Test: `tests/research-reports/workflow.test.ts`
- Modify: `tests/test-contracts.json`

**Interfaces:**

```ts
export type ResearchReportWorkflowMode = "daily" | "backfill"

export interface RunResearchReportsWorkflowInput {
  mode: ResearchReportWorkflowMode
  jobKey: "research_reports.daily" | "research_reports.backfill"
  trigger: "schedule" | "manual" | "workflow"
  actorUserId?: string | null
  fromDate?: string
  toDate?: string
  maxReports?: number
}

export interface ResearchReportWorkflowSummary {
  status: "succeeded" | "partial" | "failed"
  discovered: number
  created: number
  changed: number
  unchanged: number
  processed: number
  ready: number
  skippedExisting: number
  skippedConcurrent: number
  needsOcr: number
  unsupported: number
  failed: number
  deferred: number
  pagesFetched: number
  models: string[]
  aiRequestAttempts: number
  inputTokens: number
  cachedInputTokens: number
  cacheWriteTokens: number
  outputTokens: number
  reasoningTokens: number
  totalTokens: number
  estimatedCostUsd: number
  pricingVersion: string | null
  budgetExhausted: boolean
  budgetReason: string | null
  unknownUsageAttempts: number
}
```

Telemetry API:

```ts
startResearchReportJobRun(...): Promise<string>
upsertResearchReportPhase(...): Promise<void>
upsertResearchReportRunItem(...): Promise<void>
finalizeResearchReportJobRun(runId, status, summary, error?): Promise<void>
```

- [ ] **Step 1: Write the acceptance smoke test before implementation**

Fixture: **2 new + 1 existing + 1 failed PDF**. Expected first run is `partial`; two new become ready, existing spends no AI, failure is isolated. Rerun identical fixture and assert previously ready reports spend zero new AI requests.

Also test provider outage => `failed` and old ready records untouched; budget exhaustion => `partial` with deferred count.

- [ ] **Step 2: Run workflow test and verify RED**

Run: `node --test tests/research-reports/workflow.test.ts`

Expected: FAIL because orchestrator/telemetry do not exist.

- [ ] **Step 3: Implement sequential orchestrator**

Pseudo-flow:

```ts
const runId = await startResearchReportJobRun(...)
try {
  const discovery = await phase("DISCOVER", discover)
  const candidates = await phase("UPSERT_METADATA", upsertAndClassify)
  for (const report of candidates.slice(0, maxReports)) {
    const result = await processResearchReport(client, report, sharedDeps)
    await persistRunItem(runId, result)
    accumulate(summary, result)
  }
  return await finalize(summaryToTerminalStatus(summary))
} catch (error) {
  await finalizeResearchReportJobRun(runId, "failed", summary, error)
  throw error
}
```

`FETCH_PARSE`, `AI_ANALYZE`, and `PUBLISH` phase rows are aggregate operational evidence updated from `onStage` events during the sequential loop; they are not barriers that hold all parsed pages in workflow state.

- [ ] **Step 4: Re-run workflow test**

Run: `node --test tests/research-reports/workflow.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add modules/research-reports/workflow modules/research-reports/repository.ts tests/research-reports/workflow.test.ts tests/test-contracts.json
git commit -m "feat(reports): orchestrate durable daily processing"
```

---

### Task 7: Add scheduler route and durable workflow entry point

**Files:**
- Create: `app/api/research-reports/daily/route.ts`
- Create: `workflows/research-reports-daily-workflow.ts`
- Test: `tests/research-reports/daily-route.test.ts`
- Test: `tests/research-reports/daily-workflow.test.ts`
- Modify: `tests/test-contracts.json`

**Interfaces:**

Route behavior follows `app/api/signals/daily/route.ts`:

```ts
export const runtime = "nodejs"
export const dynamic = "force-dynamic"
```

Machine authorization must use the existing helper; success dispatches `researchReportsDailyWorkflow` with no user-controlled budget override.

Workflow:

```ts
export async function researchReportsDailyWorkflow() {
  "use workflow"
  return await runResearchReportsDailyStep()
}
```

The step calls shared orchestrator with fixed daily limits and `jobKey: "research_reports.daily"`.

- [ ] **Step 1: Write unauthorized/authorized dispatch tests**

Assert missing/wrong Bearer secret is rejected and authorized dispatch starts exactly one workflow.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test tests/research-reports/daily-route.test.ts tests/research-reports/daily-workflow.test.ts`

Expected: FAIL because route/workflow do not exist.

- [ ] **Step 3: Implement route/workflow using existing machine-auth and Workflow patterns**

Do not add a `vercel.json` cron entry.

- [ ] **Step 4: Re-run focused tests**

Run: `node --test tests/research-reports/daily-route.test.ts tests/research-reports/daily-workflow.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/research-reports/daily/route.ts workflows/research-reports-daily-workflow.ts tests/research-reports/daily-route.test.ts tests/research-reports/daily-workflow.test.ts tests/test-contracts.json
git commit -m "feat(reports): dispatch 0705 daily workflow"
```

---

### Task 8: Register Admin jobs and implement confirmed bounded backfill

**Files:**
- Modify: `modules/admin/catalog.ts`
- Modify: `modules/admin/manual-job-capabilities.ts`
- Modify: `modules/admin/jobs.ts`
- Modify: `app/admin/actions.ts`
- Modify: `components/admin/admin-manual-job-modal.tsx`
- Test: `tests/root-admin-jobs.test.ts`
- Test: `tests/root-admin-ui.test.ts`
- Modify: `tests/test-contracts.json`

**Interfaces:**

Extend manual params:

```ts
export interface ResearchReportBackfillParams {
  fromDate?: string
  toDate?: string
  maxReports: number
}

export interface ManualJobParams {
  limit?: number
  offset?: number
  tickers?: string[]
  force?: boolean
  researchReportBackfill?: ResearchReportBackfillParams
}
```

Server validation:

```ts
1 <= maxReports <= 100
fromDate <= toDate
range <= 90 calendar days
```

Backfill dispatch calls the shared orchestrator/workflow entry with `research_reports.backfill`; it never accepts `force`, custom AI request limit, or custom USD limit.

- [ ] **Step 1: Write failing Admin policy/validation tests**

Assert daily is not manual-allowlisted; backfill requires confirmation/reason; invalid dates/range/maxReports reject; valid input dispatches with same fixed 20-request/$1 budget.

- [ ] **Step 2: Run focused Admin tests and verify RED**

Run: `node --test tests/root-admin-jobs.test.ts tests/root-admin-ui.test.ts`

Expected: FAIL because catalog/backfill controls are absent.

- [ ] **Step 3: Implement catalog, allowlist, action parsing, and modal fields**

Backfill modal fields:

```text
fromDate optional
toDate optional
maxReports required/default 20/min 1/max 100
reason required 8-240 chars
confirmation required
```

- [ ] **Step 4: Re-run focused Admin tests**

Run: `node --test tests/root-admin-jobs.test.ts tests/root-admin-ui.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add modules/admin/catalog.ts modules/admin/manual-job-capabilities.ts modules/admin/jobs.ts app/admin/actions.ts components/admin/admin-manual-job-modal.tsx tests/root-admin-jobs.test.ts tests/root-admin-ui.test.ts tests/test-contracts.json
git commit -m "feat(admin): add research report backfill"
```

---

### Task 9: Expose scheduler, phase, model/token/cost telemetry in Admin

**Files:**
- Modify: `modules/admin/scheduler-reconciliation.ts` and the existing Supabase cron reconciliation module used by `qeoindex.eod_pipeline`
- Modify: `modules/admin/job-health.ts`
- Modify: `app/admin/jobs/[key]/page.tsx`
- Modify: `components/admin/admin-job-phase-timeline.tsx` only if a generic rendering seam is required; do not fork a second timeline component.
- Test: `tests/root-admin-ui.test.ts`
- Test: scheduler reconciliation test that currently owns EOD `pg_cron` mappings
- Modify: `tests/test-contracts.json`

**Interfaces:**

Admin latest-run evidence must expose from sanitized run summary:

```ts
{
  models,
  aiRequestAttempts,
  inputTokens,
  cachedInputTokens,
  cacheWriteTokens,
  outputTokens,
  reasoningTokens,
  totalTokens,
  estimatedCostUsd,
  pricingVersion,
  budgetExhausted,
  budgetReason,
  unknownUsageAttempts,
  discovered,
  created,
  changed,
  processed,
  ready,
  failed,
  deferred,
}
```

Scheduler reconciliation expects name `research-reports-daily-0705-ict` and schedule `5 0 * * *` when the quarantined scheduler is activated in the same rollout as the schema.

- [ ] **Step 1: Write failing telemetry rendering/reconciliation tests**

Assert research daily detail page renders phase timeline and usage labels including model, cached/cache-write/reasoning/total tokens, estimated USD, pricing version, and budget state. Assert scheduler mismatch is `drifted` and exact name/schedule is `live_verified` when inventory is available.

- [ ] **Step 2: Run focused tests and verify RED**

Run the exact Admin UI and scheduler reconciliation test files registered in `tests/test-contracts.json`.

Expected: FAIL because research job is not wired into generic phase/usage UI or reconciliation.

- [ ] **Step 3: Implement generic research telemetry wiring**

Prefer reading QEO-85 aggregate AI usage directly from `system_job_runs.summary`; do not infer spend by date-range querying analysis rows, because failed/lost attempts would be omitted.

- [ ] **Step 4: Re-run focused tests**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add modules/admin/scheduler-reconciliation.ts modules/admin/job-health.ts app/admin/jobs/[key]/page.tsx components/admin/admin-job-phase-timeline.tsx tests/root-admin-ui.test.ts tests/test-contracts.json
git commit -m "feat(admin): show research workflow telemetry"
```

---

### Task 10: Document rollout contract and run full verification

**Files:**
- Modify: `modules/research-reports/README.md`
- Modify: automation/scheduler documentation file that currently documents the EOD Supabase cron pattern.
- Modify: `docs/superpowers/specs/2026-09-05-qeo-85-research-reports-daily-workflow-design.md` only if implementation discovered a factual mismatch; do not silently change approved semantics.

**Interfaces:**
- No new runtime interfaces. Documentation must state quarantine/activation order explicitly.

- [ ] **Step 1: Document scheduler activation order**

Required rollout order:

```text
1. Apply/activate the quarantined QEO-80/QEO-85 research migration.
2. Verify report tables, lease/run-item tables, publish/lease RPCs.
3. Verify Vault app URL + cron secret are present.
4. Activate/verify `research-reports-daily-0705-ict` at `5 0 * * *`.
5. Manually dispatch one bounded smoke run.
6. Verify system_job_runs + six phases + run items + model/token/cost evidence.
7. Only then rely on the next scheduled 07:05 run.
```

- [ ] **Step 2: Run the focused QEO-85 suite**

Run:

```bash
node --test \
  tests/research-reports/schema.test.ts \
  tests/research-reports/pricing.test.ts \
  tests/research-reports/ai-budget.test.ts \
  tests/research-reports/lease.test.ts \
  tests/research-reports/topi.test.ts \
  tests/research-reports/pipeline.test.ts \
  tests/research-reports/workflow.test.ts \
  tests/research-reports/daily-route.test.ts \
  tests/research-reports/daily-workflow.test.ts \
  tests/root-admin-jobs.test.ts \
  tests/root-admin-ui.test.ts
```

Expected: all PASS.

- [ ] **Step 3: Run project verification**

Run:

```bash
pnpm verify:pr
pnpm db:drift:verify
pnpm db:replay:verify
pnpm db:types:verify
pnpm build
```

Expected: all commands exit 0. If quarantine intentionally excludes the pending migration from replay/drift, tests must verify that convention rather than moving research SQL into active migrations merely to satisfy a check.

- [ ] **Step 4: Run secret/hygiene review**

Confirm no API key, Bearer token, raw PDF text, prompt text, or full TOPI provider payload appears in committed telemetry fixtures/snapshots.

- [ ] **Step 5: Commit docs/verification metadata**

```bash
git add modules/research-reports/README.md docs tests/test-contracts.json
git commit -m "docs(reports): document daily workflow rollout"
```

---

## Self-Review

### Spec coverage

- Exact 07:05 daily/weekend scheduler: Tasks 1, 7, 9, 10.
- Safe non-contiguous discovery + bounded pages/reports: Tasks 5, 6.
- New/changed metadata upsert: Task 6.
- Hash/version idempotency + no rerun re-spend: Tasks 4, 6.
- Concurrent daily/backfill no double-spend: Tasks 1, 4, 6.
- One bad PDF isolates failure: Task 6.
- Provider outage -> failed, old data preserved: Tasks 5, 6.
- Six phase telemetry + partial status: Task 6.
- Model/token/cache-write/reasoning/cost evidence: Tasks 1-3, 6, 9.
- 20 actual request attempts + $1 guard: Task 3, enforced through Tasks 4/6/8.
- Failed/lost-response operational evidence: Tasks 3, 6.
- Confirmed bounded Admin backfill: Task 8.
- 2 new + 1 existing + 1 failed smoke fixture and rerun: Task 6.
- Quarantined research-schema rollout safety: Tasks 1 and 10.

### Placeholder scan

No `TBD`, `TODO`, "implement later", or undefined follow-up tasks remain. Every task has an explicit test-first command, implementation boundary, pass command, and commit boundary.

### Type consistency

- Pricing uses `cacheWriteTokens` consistently from response inspection through AI audit, canonical analysis persistence, run-item evidence, and Admin summary.
- Request budget counts `requestAttempts` before provider dispatch and separately tracks `unknownUsageAttempts`.
- Daily/backfill share `RunResearchReportsWorkflowInput` and fixed AI limits; Admin parameters do not expose budget overrides.
- Lease identity exactly matches the existing canonical successful-analysis identity and adds only run ownership/TTL.
