# QEO-86 AI Council Research Report Evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Feed bounded, point-in-time Research Report evidence into every AI Council ticker's advisory LLM debate, freeze exact immutable provenance per Council run, and expose related-report links without changing deterministic Council authority.

**Architecture:** The Research Reports module owns deterministic point-in-time selection from canonical report/analysis/mention rows. AI Council load-or-freezes one immutable snapshot per `ai_council_runs.id`, attaches only successfully persisted/reused `ready` or `empty` evidence to the first-class LLM packet, and incorporates the snapshot hash into a versioned LLM prompt identity while leaving `ai_council_runs.evidence_hash` unchanged. Debate audit/UI reads the frozen snapshot rather than recomputing current report state.

**Tech Stack:** Next.js 16.3, React 19, TypeScript 5.7, Supabase/PostgreSQL, OpenAI Responses-based AI Council router, Node test runner, pnpm 10.28.

**Spec:** `docs/superpowers/specs/2026-09-05-qeo-86-ai-council-research-report-evidence-design.md`

## Global Constraints

- Research Report evidence applies to **all AI Council tickers**; do not inherit the Notion `MSN` pilot gate.
- Ticker-specific selector default: max **3 reports / 90 days**.
- Macro/Strategy selector default: max **2 reports / 30 days**.
- Final Research Reports prompt payload: max **5 deduped reports** and approximately **10,000 characters total**.
- Selection is deterministic; no embedding, vector search, or LLM ranking.
- Eligibility requires `report.publish_date <= asOf`, `report.created_at <= runAt`, `analysis.processed_at <= runAt`, and ticker mention `created_at <= runAt` when ticker-specific.
- Historical evidence is keyed to exact `analysis_id + content_hash + analysis_version + prompt_version + model_route_key`; never replay from mutable `market_research_reports.content_hash`.
- Same `run_id` retry must reuse the existing snapshot without re-running selectors.
- Research Report evidence may enter an LLM prompt only after the corresponding snapshot has been successfully persisted or reused.
- Snapshot persistence failure fails open for Council execution but **must omit Research Report evidence** from the prompt.
- `ready` and `empty` persisted snapshots participate in LLM prompt identity; persisted `unavailable` and unpersisted failure states do not.
- Broker recommendations/targets are always `SOURCE OPINION`, not verified company facts.
- Contradictory broker narrative must be surfaced as contradiction; it cannot upgrade/downgrade deterministic signal, score, or risk veto.
- `ai_council_runs.evidence_hash` remains unchanged.
- Prompt identity contract version becomes `prompt-identity-v2-report-evidence`; do not silently change v1 semantics.
- Because the actual LLM instructions/packet change, bump `AI_COUNCIL_LLM_PROMPT_VERSION` from `llm-debate-v3-first-class-context` to `llm-debate-v4-research-report-evidence`.
- AI Council runtime must not import/call TOPI, PDF fetch, PDF parse, or Research Reports ingestion.
- Do not put raw/full PDF text or `market_research_report_chunks.content` into Council prompt or snapshot.
- QEO-80/85 Research Reports schema remains quarantined until QEO-87 rollout. Keep QEO-86's rollout-coupled snapshot migration under `supabase/pending-migrations/`; QEO-87 owns production promotion/backfill/rollout.
- Full Verify and DB Drift Reconciliation must pass on the final PR head.

---

## File Structure

### New focused modules

- `modules/research-reports/council-evidence.ts` — deterministic, bounded, point-in-time selector and prompt-safe curated evidence builder; no AI Council imports.
- `modules/ai-council/report-evidence.ts` — immutable snapshot load/freeze adapter, canonical hashing, persistence fail-open contract, and stock attachment shape.
- `tests/research-reports/council-evidence.test.ts` — selector ordering, lookback, point-in-time, reprocessing, dedupe, and prompt-budget tests.
- `tests/ai-council-report-evidence.test.ts` — snapshot reuse/immutability/failure/prompt-boundary tests.
- `tests/ai-council-report-evidence-ui.test.ts` — dashboard frozen-provenance and related-link contract.
- `supabase/pending-migrations/20260905073000_qeo86_ai_council_report_evidence.sql` — rollout-coupled immutable snapshot table/RLS/trigger.

### Existing files to modify

- `modules/ai-council/pre-market-evidence.ts` — freeze report snapshots for all Council tickers after run identity resolution; attach only persisted/reused ready/empty evidence.
- `modules/ai-council/prompt-identity.ts` — add `reportEvidenceHash` and bump identity version to `prompt-identity-v2-report-evidence`.
- `modules/ai-council/prompt-evidence.ts` — first-class `reportEvidence` packet layer and provenance wording.
- `modules/ai-council/llm.ts` — bump prompt version, add anti-bias/source-opinion instructions, expose report provenance/related-report fields on debate records.
- `modules/ai-council/debate-data.ts` — load immutable report snapshots by `run_id` and normalize provenance/related reports from frozen payload.
- `app/insights/ai-council/debates/page.tsx` — add Research Reports provenance card and compact `Báo cáo liên quan` links.
- `modules/shared/supabase/database.types.ts` — regenerate from replayed schema; never hand-edit.
- `modules/research-reports/README.md` — document Council selector boundary/limits/authority semantics.
- `modules/ai-council/README.md` — document report snapshot and deterministic-authority boundary.
- `tests/ai-council-prompt-evidence.test.ts` — packet inclusion/anti-bias/prompt-version assertions.
- `tests/ai-council-persistence.test.ts` — prompt identity v2 and deterministic evidence-hash invariants.
- `tests/ai-council-research-context.test.ts` — keep Notion pilot semantics distinct while pre-market wrapper adds all-ticker report evidence.
- `tests/test-contracts.json` — register all new canonical tests.

---

### Task 1: Build deterministic point-in-time Research Report selectors

**Files:**
- Create: `modules/research-reports/council-evidence.ts`
- Create: `tests/research-reports/council-evidence.test.ts`
- Modify: `tests/test-contracts.json`

**Interfaces:**

```ts
export const COUNCIL_REPORT_TICKER_LIMIT = 3
export const COUNCIL_REPORT_TICKER_LOOKBACK_DAYS = 90
export const COUNCIL_REPORT_MARKET_LIMIT = 2
export const COUNCIL_REPORT_MARKET_LOOKBACK_DAYS = 30
export const COUNCIL_REPORT_MAX_PROMPT_CHARS = 10_000

export interface CouncilReportEvidenceItem {
  reportId: string
  analysisId: string
  provider: string
  sourceName: string
  title: string
  publishDate: string
  category: "macro" | "strategy" | "sector" | "other"
  contentHash: string
  analysisVersion: string
  promptVersion: string
  modelRouteKey: string
  processedAt: string
  roles: Array<"ticker" | "market">
  executiveSummary: string
  marketView: string | null
  sectorOutlook: string | null
  catalysts: unknown[]
  risks: unknown[]
  tickerMention: {
    ticker: string
    stance: "positive" | "negative" | "neutral" | "mixed"
    recommendationText: string | null
    targetPrice: number | null
    targetCurrency: string | null
    rationale: string | null
    evidence: unknown[]
    sourceOpinion: true
  } | null
}

export interface CouncilReportEvidenceSelection {
  ticker: string
  asOf: string
  runAt: string
  reports: CouncilReportEvidenceItem[]
  truncated: boolean
  promptChars: number
}

export async function getRelevantReportEvidence(
  client: SupabaseClient,
  params: {
    ticker: string
    asOf: string
    runAt: string
    tickerLimit?: number
    tickerLookbackDays?: number
  },
): Promise<CouncilReportEvidenceItem[]>

export async function getRelevantMarketReportEvidence(
  client: SupabaseClient,
  params: {
    ticker: string
    asOf: string
    runAt: string
    categories?: Array<"macro" | "strategy">
    marketLimit?: number
    marketLookbackDays?: number
  },
): Promise<CouncilReportEvidenceItem[]>

export async function selectCouncilReportEvidence(
  client: SupabaseClient,
  params: { ticker: string; asOf: string; runAt: string },
): Promise<CouncilReportEvidenceSelection>
```

Selection must query canonical report/analysis/mention tables only. A persisted analysis row is the successful canonical analysis identity; do not filter on mutable current report `analysis_status` or current report `content_hash`. For each report choose the newest **eligible** analysis at/before `runAt`, then apply deterministic tie-breakers.

- [ ] **Step 1: Write failing selector tests for bounds and ordering**

Use an in-memory Supabase query-builder fixture, following `tests/research-reports/detail-service.test.ts`, with rows that include:

```ts
const REPORTS = [
  { id: "r1", publish_date: "2026-09-01", created_at: "2026-09-01T01:00:00Z", category: "sector" },
  { id: "r2", publish_date: "2026-08-30", created_at: "2026-08-30T01:00:00Z", category: "sector" },
  { id: "r3", publish_date: "2026-08-20", created_at: "2026-08-20T01:00:00Z", category: "sector" },
  { id: "r4", publish_date: "2026-08-10", created_at: "2026-08-10T01:00:00Z", category: "sector" },
]
```

Assert ticker selection returns `r1,r2,r3` and not `r4` when all have explicit `MSN` mentions.

- [ ] **Step 2: Add RED tests for point-in-time cutoffs and reprocessing**

Fixture one report with two analyses:

```ts
const analyses = [
  { id: "a-old", report_id: "r1", content_hash: "a".repeat(64), processed_at: "2026-09-01T01:00:00Z" },
  { id: "a-future", report_id: "r1", content_hash: "b".repeat(64), processed_at: "2026-09-06T01:00:00Z" },
]
```

With `runAt="2026-09-05T07:00:00Z"`, assert `a-old` is selected and future report/analysis/mention rows are excluded.

- [ ] **Step 3: Add RED tests for macro/strategy limits, dedupe and deterministic ties**

Assert:

```ts
assert.equal(market.length, 2)
assert.deepEqual(market.map((row) => row.category), ["macro", "strategy"])
assert.equal(new Set(selection.reports.map((row) => `${row.reportId}|${row.analysisId}`)).size, selection.reports.length)
```

Tie identical publish/processed timestamps with `report_id`, then `analysis_id`, ascending lexical order.

- [ ] **Step 4: Add RED prompt-safety tests**

Assert selection never queries `market_research_report_chunks`, never emits a `content` field containing raw chunk/PDF text, preserves citation page/snippet data from structured mention/analysis JSON only, and clamps final curated serialization to `COUNCIL_REPORT_MAX_PROMPT_CHARS` with deterministic truncation.

- [ ] **Step 5: Run the focused test and verify RED**

Run:

```bash
node --test tests/research-reports/council-evidence.test.ts
```

Expected: FAIL because `modules/research-reports/council-evidence.ts` does not exist.

- [ ] **Step 6: Implement minimal selector/query/canonical truncation code**

Use helper functions with explicit responsibilities:

```ts
function withinLookback(date: string, asOf: string, days: number): boolean
function newestEligibleAnalysisByReport(rows: AnalysisRow[], runAt: string): Map<string, AnalysisRow>
function normalizeCouncilReportItem(...): CouncilReportEvidenceItem
function clampCouncilReportSelection(items: CouncilReportEvidenceItem[]): CouncilReportEvidenceSelection
```

Truncation order: preserve IDs/version/source/date/category/stance/source-opinion fields first; trim optional rationale/evidence prose, then catalysts/risks, then summary tail. Never drop provenance fields to retain prose.

- [ ] **Step 7: Re-run focused tests**

Run:

```bash
node --test tests/research-reports/council-evidence.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add modules/research-reports/council-evidence.ts tests/research-reports/council-evidence.test.ts tests/test-contracts.json
git commit -m "feat(reports): add Council evidence selector"
```

---

### Task 2: Add immutable Council report-evidence snapshot storage and load-or-freeze adapter

**Files:**
- Create: `supabase/pending-migrations/20260905073000_qeo86_ai_council_report_evidence.sql`
- Create: `modules/ai-council/report-evidence.ts`
- Create: `tests/ai-council-report-evidence.test.ts`
- Modify: `tests/test-contracts.json`

**Interfaces:**

```ts
export const AI_COUNCIL_REPORT_EVIDENCE_VERSION = "ai-council-report-evidence-v1"

export type CouncilReportEvidenceSnapshotStatus = "ready" | "empty" | "unavailable"

export interface CouncilReportEvidenceSnapshotPayload {
  contextVersion: typeof AI_COUNCIL_REPORT_EVIDENCE_VERSION
  ticker: string
  asOfDate: string
  selectionRunAt: string
  status: CouncilReportEvidenceSnapshotStatus
  reports: CouncilReportEvidenceItem[]
  limitations: string[]
}

export interface FrozenCouncilReportEvidence {
  persisted: boolean
  reused: boolean
  contextHash: string | null
  snapshot: CouncilReportEvidenceSnapshotPayload | null
}

export async function freezeCouncilReportEvidence(
  supabase: SupabaseClient,
  params: { runId: string; ticker: string; asOfDate: string; runAt: string },
): Promise<FrozenCouncilReportEvidence>
```

SQL contract:

```sql
create table if not exists public.ai_council_report_evidence_snapshots (
  run_id uuid primary key references public.ai_council_runs(id) on delete cascade,
  ticker text not null check (ticker ~ '^[A-Z0-9]{2,12}$'),
  as_of_date date not null,
  context_version text not null,
  context_hash text not null check (context_hash ~ '^[0-9a-f]{64}$'),
  status text not null check (status in ('ready','empty','unavailable')),
  context_payload jsonb not null check (jsonb_typeof(context_payload) = 'object'),
  report_ids jsonb not null default '[]'::jsonb check (jsonb_typeof(report_ids) = 'array'),
  analysis_ids jsonb not null default '[]'::jsonb check (jsonb_typeof(analysis_ids) = 'array'),
  captured_at timestamptz not null default now()
);
```

Add authenticated read policy, service-role privileges, anon denial, `(ticker, as_of_date desc, captured_at desc)` index, and a `BEFORE UPDATE` trigger that raises because rows are immutable.

- [ ] **Step 1: Write RED DB/source contract assertions**

Assert migration contains the exact table/status/RLS/immutability contract and that `report-evidence.ts` exports `AI_COUNCIL_REPORT_EVIDENCE_VERSION` and `freezeCouncilReportEvidence`.

- [ ] **Step 2: Write RED behavior test for same-run reuse**

Seed an existing snapshot row for `run-1`. Assert:

```ts
const frozen = await freezeCouncilReportEvidence(client, params)
assert.equal(frozen.reused, true)
assert.equal(selectorCallCount, 0)
assert.equal(frozen.contextHash, EXISTING_HASH)
```

- [ ] **Step 3: Write RED behavior tests for `ready`, `empty`, selector failure, and persistence failure**

Required expectations:

```ts
assert.equal(ready.persisted, true)
assert.equal(ready.snapshot?.status, "ready")
assert.equal(empty.snapshot?.status, "empty")
assert.deepEqual(empty.snapshot?.reports, [])
assert.equal(unavailable.snapshot?.status, "unavailable")
assert.equal(unavailable.persisted, true)
assert.equal(storeFailure.persisted, false)
assert.equal(storeFailure.snapshot, null)
assert.equal(storeFailure.contextHash, null)
```

If selector throws but the table can insert, persist a bounded `unavailable` snapshot with no report evidence and a limitation string. If insertion itself fails, return unpersisted/null evidence and do not throw into deterministic Council execution.

- [ ] **Step 4: Run focused tests and verify RED**

Run:

```bash
node --test tests/ai-council-report-evidence.test.ts
```

Expected: FAIL on missing migration/module.

- [ ] **Step 5: Implement canonical hash + load-first freeze**

Reuse the existing canonical JSON SHA-256 pattern from `modules/ai-council/research-context.ts`, but keep report snapshot semantics in the new focused module. Hash the complete versioned bounded payload, including `status` and `selectionRunAt`.

Pseudo-flow:

```ts
const existing = await loadPersistedSnapshot(runId)
if (existing) return persistedFrozen(existing, true)

try {
  const selected = await selectCouncilReportEvidence(...)
  const payload = selected.reports.length ? readyPayload(selected) : emptyPayload(selected)
  return await persistPayload(payload)
} catch (error) {
  return await tryPersistUnavailable(error)
}
```

The adapter must not expose unpersisted selected reports after insert failure.

- [ ] **Step 6: Re-run focused tests**

Run:

```bash
node --test tests/ai-council-report-evidence.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add supabase/pending-migrations/20260905073000_qeo86_ai_council_report_evidence.sql modules/ai-council/report-evidence.ts tests/ai-council-report-evidence.test.ts tests/test-contracts.json
git commit -m "feat(council): freeze report evidence snapshots"
```

---

### Task 3: Freeze report evidence for every Council ticker at the pre-debate boundary

**Files:**
- Modify: `modules/ai-council/pre-market-evidence.ts`
- Modify: `tests/ai-council-report-evidence.test.ts`
- Modify: `tests/ai-council-research-context.test.ts`

**Interfaces:**

Extend `AiCouncilPreMarketEvidenceResult` with:

```ts
reportEvidenceVersion: typeof AI_COUNCIL_REPORT_EVIDENCE_VERSION
reportEvidenceReady: number
reportEvidenceEmpty: number
reportEvidenceUnavailable: number
reportEvidenceReused: number
reportEvidencePersisted: number
reportEvidenceMissingRunIdentities: number
```

Attached stock shape only for successfully persisted/reused `ready` or `empty` snapshots:

```ts
reportEvidence: {
  purpose: "Curated Research Report evidence for advisory LLM reasoning only; recommendations and targets are source opinions."
  contextVersion: typeof AI_COUNCIL_REPORT_EVIDENCE_VERSION
  contextHash: string
  status: "ready" | "empty"
  context: CouncilReportEvidenceSnapshotPayload
}
```

- [ ] **Step 1: Write RED all-ticker wrapper tests**

Keep the existing Notion assertion:

```ts
assert.match(researchContextSource, /DEFAULT_PILOT_TICKERS = "MSN"/)
```

But assert Research Report path has **no** `isCouncilResearchTickerEnabled` gate and iterates all `raw.stocks` that have a run identity.

- [ ] **Step 2: Write RED attachment/failure boundary tests**

Assert:

- `ready` and `empty` persisted snapshots attach `stock.reportEvidence`;
- persisted `unavailable` does not attach prompt evidence;
- unpersisted store failure does not attach prompt evidence;
- a missing report snapshot never removes existing `llmEvidence` or Notion `researchContext`;
- same `run_id` retry returns reused snapshot.

- [ ] **Step 3: Run focused tests and verify RED**

Run:

```bash
node --test tests/ai-council-report-evidence.test.ts tests/ai-council-research-context.test.ts
```

Expected: FAIL because the wrapper has only raw + Notion enrichment.

- [ ] **Step 4: Refactor run-identity loading once, without changing deterministic identity**

`loadRunIdentities()` should resolve identities for **all** `raw.stocks`, not only Notion-enabled stocks. Preserve `runKey(ticker,evidenceHash)` so the existing deterministic run remains authoritative.

Capture one wall-clock cutoff for this enrichment invocation:

```ts
const reportSelectionRunAt = new Date().toISOString()
```

Pass the same value to every report selector in this invocation.

- [ ] **Step 5: Freeze all-ticker report evidence after raw/Notion hydration**

For each stock with a resolved run identity:

```ts
const frozen = await freezeCouncilReportEvidence(supabase, {
  runId: run.id,
  ticker: stock.ticker,
  asOfDate: params.ratingDate,
  runAt: reportSelectionRunAt,
})
```

Attach only when `frozen.persisted && frozen.contextHash && frozen.snapshot` and status is `ready` or `empty`.

- [ ] **Step 6: Re-run focused tests**

Run:

```bash
node --test tests/ai-council-report-evidence.test.ts tests/ai-council-research-context.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add modules/ai-council/pre-market-evidence.ts tests/ai-council-report-evidence.test.ts tests/ai-council-research-context.test.ts
git commit -m "feat(council): hydrate report evidence before debate"
```

---

### Task 4: Version prompt identity and first-class semantic packet for report evidence

**Files:**
- Modify: `modules/ai-council/prompt-identity.ts`
- Modify: `modules/ai-council/prompt-evidence.ts`
- Modify: `modules/ai-council/llm.ts`
- Modify: `tests/ai-council-prompt-evidence.test.ts`
- Modify: `tests/ai-council-persistence.test.ts`
- Modify: `tests/ai-council-report-evidence.test.ts`

**Interfaces:**

```ts
export const AI_COUNCIL_PROMPT_IDENTITY_VERSION = "prompt-identity-v2-report-evidence"

export interface AiCouncilPromptIdentityInput {
  deterministicEvidenceHash: string
  rawContextHash: string | null
  researchContextHash: string | null
  reportEvidenceHash: string | null
  promptVersion: string
  marketSynthesisHash?: string | null
}
```

Bump:

```ts
export const AI_COUNCIL_LLM_PROMPT_VERSION = "llm-debate-v4-research-report-evidence"
```

Extend `AiCouncilEvidencePacketV2` and builder stock input:

```ts
reportEvidence?: unknown
```

- [ ] **Step 1: Write RED prompt-identity tests**

Assert two otherwise identical inputs produce different hashes when only `reportEvidenceHash` differs:

```ts
assert.notEqual(
  buildAiCouncilPromptIdentityHash({ ...base, reportEvidenceHash: "a".repeat(64) }),
  buildAiCouncilPromptIdentityHash({ ...base, reportEvidenceHash: "b".repeat(64) }),
)
```

Assert `AI_COUNCIL_PROMPT_IDENTITY_VERSION` is v2 and current deterministic `stock.evidenceHash` is still passed untouched.

- [ ] **Step 2: Write RED packet/prompt semantics assertions**

Require source to contain all of these concepts:

```text
RESEARCH_REPORT_EVIDENCE
SOURCE OPINION
The deterministic QeoIndex policy remains the final decision authority
conflict / contradiction with deterministic price/volume/Wyckoff evidence
must not upgrade or downgrade the deterministic signal
```

Assert `buildAiCouncilEvidencePacketV2()` includes `reportEvidence` only when attached, and does not read report chunks/PDF text.

- [ ] **Step 3: Write RED empty/unavailable identity tests**

`empty` persisted evidence has a real context hash and must influence v2 identity. `unavailable`/unpersisted evidence must be omitted by the pre-market attachment path, so `resolveAiCouncilPromptIdentityHash()` sees `reportEvidenceHash=null`.

- [ ] **Step 4: Run focused tests and verify RED**

Run:

```bash
node --test tests/ai-council-prompt-evidence.test.ts tests/ai-council-persistence.test.ts tests/ai-council-report-evidence.test.ts
```

Expected: FAIL on identity version/hash input/prompt version/report packet layer.

- [ ] **Step 5: Implement v2 identity resolution**

Add safe hash extraction from:

```ts
stock.reportEvidence?.contextHash
```

and include it in computed identity. Update `buildAiCouncilPromptCacheKey()` to keep the same `qeo-council-<hash>` format; the hash input changes, the cache-key API does not.

- [ ] **Step 6: Add first-class report layer and anti-bias instructions**

Packet builder attaches the already-bounded frozen snapshot data:

```ts
...(stock.reportEvidence ? { reportEvidence: stock.reportEvidence } : {})
```

The LLM system/common instructions must explicitly state that broker recommendations/targets are source opinions and contradictions must be surfaced without overriding deterministic authority. Do not create a new LLM call or scoring path.

- [ ] **Step 7: Re-run focused tests**

Run:

```bash
node --test tests/ai-council-prompt-evidence.test.ts tests/ai-council-persistence.test.ts tests/ai-council-report-evidence.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add modules/ai-council/prompt-identity.ts modules/ai-council/prompt-evidence.ts modules/ai-council/llm.ts tests/ai-council-prompt-evidence.test.ts tests/ai-council-persistence.test.ts tests/ai-council-report-evidence.test.ts
git commit -m "feat(council): add report evidence to LLM identity"
```

---

### Task 5: Load frozen provenance and render `Báo cáo liên quan` in Debate Lab

**Files:**
- Modify: `modules/ai-council/debate-data.ts`
- Modify: `modules/ai-council/llm.ts`
- Modify: `app/insights/ai-council/debates/page.tsx`
- Create: `tests/ai-council-report-evidence-ui.test.ts`
- Modify: `tests/test-contracts.json`

**Interfaces:**

Extend debate provenance:

```ts
reportEvidenceVersion: string | null
reportEvidenceHash: string | null
reportEvidenceStatus: "ready" | "empty" | "unavailable" | null
reportEvidenceCount: number
reportEvidenceCapturedAt: string | null
```

Add frozen UI rows:

```ts
relatedReports: Array<{
  reportId: string
  analysisId: string
  title: string
  sourceName: string
  publishDate: string
  category: string
  stance: string | null
  hasSourceOpinion: boolean
}>
```

- [ ] **Step 1: Write RED dashboard-data tests**

Assert `getAiCouncilDebateDashboardData()` queries `ai_council_report_evidence_snapshots` by the debate `run_id` set, reads `context_payload`, and does **not** call `selectCouncilReportEvidence()` or current Research Report tables.

- [ ] **Step 2: Write RED UI contract tests**

Require the Debate page to contain:

```text
Research Reports
Báo cáo liên quan
Source opinion
/research/reports/
```

and to render the count/hash from `row.evidenceProvenance`, not from a live selector.

- [ ] **Step 3: Run focused tests and verify RED**

Run:

```bash
node --test tests/ai-council-report-evidence-ui.test.ts
```

Expected: FAIL because dashboard data/UI do not load/render the new snapshot.

- [ ] **Step 4: Extend dashboard snapshot query/normalization**

Add a third query beside raw and Notion audit rows:

```ts
supabase
  .from("ai_council_report_evidence_snapshots")
  .select("run_id,context_version,context_hash,status,context_payload,report_ids,analysis_ids,captured_at")
  .in("run_id", runIds)
```

Normalize related reports solely from frozen `context_payload.reports`. If malformed, return an empty list rather than falling back to current report DB state.

- [ ] **Step 5: Extend Debate Card provenance**

Add a Research Reports provenance tile with status/count/short hash/captured time. Keep the existing deterministic/raw/Notion/cache identity tiles and authority wording.

- [ ] **Step 6: Add compact related reports section**

For each frozen row render title/source/date/category/stance, optional `Source opinion` badge, and:

```tsx
<Link href={`/research/reports/${report.reportId}`}>...</Link>
```

Do not render full executive summary or PDF text.

- [ ] **Step 7: Re-run focused tests**

Run:

```bash
node --test tests/ai-council-report-evidence-ui.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add modules/ai-council/debate-data.ts modules/ai-council/llm.ts app/insights/ai-council/debates/page.tsx tests/ai-council-report-evidence-ui.test.ts tests/test-contracts.json
git commit -m "feat(council): show related research reports"
```

---

### Task 6: Lock cross-module authority boundaries, docs, and generated schema types

**Files:**
- Modify: `modules/research-reports/README.md`
- Modify: `modules/ai-council/README.md`
- Modify: `tests/ai-council-report-evidence.test.ts`
- Modify: `tests/ai-council-persistence.test.ts`
- Modify: `tests/ai-council-research-context.test.ts`
- Regenerate: `modules/shared/supabase/database.types.ts`

**Interfaces:**
- Documentation states Research Reports selector is canonical DB-only and all-ticker.
- Documentation states Notion Research Context remains separately MSN-pilot-gated.
- Documentation states deterministic Council authority is unchanged.
- Generated Database types include `ai_council_report_evidence_snapshots` exactly as replayed from pending schema policy used by repository verification.

- [ ] **Step 1: Add RED architectural boundary assertions**

Read `modules/ai-council` source files and assert there is no runtime import/path reference to:

```text
modules/research-reports/providers/topi
modules/research-reports/analysis/pdf
pdfjs-dist
market_research_report_chunks
```

Allow import of the stable selector through `modules/ai-council/report-evidence.ts` only; AI Council must not import provider/ingestion internals.

- [ ] **Step 2: Add RED deterministic authority assertions**

Assert QEO-86 code does not write/update `ai_council_runs.evidence_hash`, `signal`, `council_score`, or `risk_status`, and the Debate UI continues labeling deterministic result as final authority.

- [ ] **Step 3: Update module docs with exact limits/failure semantics**

Research Reports README must record `3/90d`, `2/30d`, max 5, ~10k chars, exact analysis identity, source-opinion semantics, and no PDF/runtime fetch. AI Council README must record snapshot statuses, same-run reuse, v2 prompt identity, and deterministic authority separation.

- [ ] **Step 4: Regenerate Supabase types through the repository DB verification flow**

Run the local replay/type generation flow used by DB Drift:

```bash
pnpm db:replay:verify
pnpm db:types:generate
pnpm db:types:verify
```

Expected: generated `modules/shared/supabase/database.types.ts` contains `ai_council_report_evidence_snapshots`; type verification passes.

- [ ] **Step 5: Run focused architecture tests**

Run:

```bash
node --test tests/ai-council-report-evidence.test.ts tests/ai-council-persistence.test.ts tests/ai-council-research-context.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add modules/research-reports/README.md modules/ai-council/README.md modules/shared/supabase/database.types.ts tests/ai-council-report-evidence.test.ts tests/ai-council-persistence.test.ts tests/ai-council-research-context.test.ts
git commit -m "docs(council): lock report evidence authority boundary"
```

---

### Task 7: Full regression, draft PR, Verify + DB Drift acceptance

**Files:**
- Modify only files required by failures discovered in this gate.
- PR body references QEO-86 spec/plan and explicitly says production rollout remains QEO-87.

**Interfaces:**
- Final PR head is the sole acceptance SHA.
- No merge until Verify and DB Drift are green on that exact SHA.

- [ ] **Step 1: Run all focused QEO-86 suites locally/CI-equivalent**

Run:

```bash
node --test \
  tests/research-reports/council-evidence.test.ts \
  tests/ai-council-report-evidence.test.ts \
  tests/ai-council-report-evidence-ui.test.ts \
  tests/ai-council-prompt-evidence.test.ts \
  tests/ai-council-persistence.test.ts \
  tests/ai-council-research-context.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run current contract suite, lint, and typecheck**

Run:

```bash
pnpm test:current
pnpm lint:touched
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 3: Run production build**

Run:

```bash
pnpm build
```

Expected: PASS with `/insights/ai-council/debates` compiled successfully.

- [ ] **Step 4: Run full DB reconciliation gates**

Run:

```bash
pnpm db:drift:verify
pnpm db:replay:verify
pnpm db:types:verify
pnpm test:db-drift
```

Expected: PASS.

- [ ] **Step 5: Create/update a draft PR**

PR title:

```text
QEO-86: feed curated Research Reports into AI Council
```

PR body must summarize:

- all-ticker deterministic selector;
- immutable per-run snapshot;
- prompt identity v2 + prompt version v4;
- source-opinion contradiction semantics;
- related report links;
- deterministic `evidence_hash` unchanged;
- production rollout/backfill deferred to QEO-87.

- [ ] **Step 6: Verify CI on the exact final head**

Require successful repository **Verify** and **DB Drift Reconciliation** workflow runs for the PR's final SHA. If another commit is pushed, discard prior green evidence and verify the new SHA.

- [ ] **Step 7: Review diff for the five critical failure modes**

Explicitly inspect:

1. future analysis/mention leaking through `runAt` cutoff;
2. same-run retry reselecting newer reports;
3. unpersisted evidence entering the prompt;
4. Research Report hash mutating deterministic `ai_council_runs.evidence_hash` or deterministic decision fields;
5. historical UI recomputing current reports instead of using the frozen snapshot.

Expected: none present.

- [ ] **Step 8: Mark PR ready for review only after all gates are green**

Do not merge or mark Linear QEO-86 Done until final-head Verify + DB Drift evidence is present. Do not claim production deployment/runtime rollout; that belongs to QEO-87.
