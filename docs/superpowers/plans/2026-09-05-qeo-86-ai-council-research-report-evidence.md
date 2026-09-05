# QEO-86 AI Council Research Report Evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Feed bounded, point-in-time Research Report evidence into every AI Council ticker's advisory LLM debate, freeze exact immutable provenance per Council run, and expose related-report links without changing deterministic Council authority.

**Architecture:** The Research Reports module owns deterministic selection from canonical report/analysis/mention rows. AI Council load-or-freezes one immutable snapshot per `ai_council_runs.id`, attaches only successfully persisted/reused `ready` or `empty` evidence to the first-class LLM packet, and incorporates the snapshot hash into a versioned LLM prompt identity while leaving `ai_council_runs.evidence_hash` unchanged. Historical debate audit/UI reads the frozen snapshot instead of recomputing current report state.

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
- Because the LLM packet/instructions change, bump `AI_COUNCIL_LLM_PROMPT_VERSION` from `llm-debate-v3-first-class-context` to `llm-debate-v4-research-report-evidence`.
- AI Council runtime must not import/call TOPI, PDF fetch, PDF parse, or Research Reports ingestion.
- Do not put raw/full PDF text or `market_research_report_chunks.content` into Council prompt or snapshot.
- QEO-80/85 Research Reports schema remains **quarantined** until QEO-87 rollout. QEO-86's snapshot SQL therefore stays under `supabase/pending-migrations/` and is not promoted into active `supabase/migrations/` here.
- `supabase db reset` and generated DB types reflect only active migrations. **Do not hand-edit or regenerate `modules/shared/supabase/database.types.ts` to include the pending QEO-86 table.** QEO-87 owns promotion and resulting generated-type change.
- Full Verify and DB Drift Reconciliation must pass on the final PR head; DB Drift must confirm the active migration ledger/types remain unchanged while the pending SQL contract is source-tested.

---

## File Structure

### New focused modules

- `modules/research-reports/council-evidence.ts` — deterministic, bounded, point-in-time selector and prompt-safe curated evidence builder; no AI Council imports.
- `modules/ai-council/report-evidence.ts` — immutable snapshot load/freeze adapter, canonical hashing, persistence fail-open contract, and stock attachment shape.
- `tests/research-reports/council-evidence.test.ts` — selector ordering, lookback, point-in-time, reprocessing, dedupe, and prompt-budget tests.
- `tests/ai-council-report-evidence.test.ts` — snapshot reuse/immutability/failure/prompt-boundary tests.
- `tests/ai-council-report-evidence-ui.test.ts` — frozen provenance and related-link UI contract.
- `supabase/pending-migrations/20260905073000_qeo86_ai_council_report_evidence.sql` — rollout-coupled immutable snapshot table/RLS/trigger; QEO-87 will promote it.

### Existing files to modify

- `modules/ai-council/pre-market-evidence.ts` — freeze report snapshots for all Council tickers after run identity resolution; attach only persisted/reused ready/empty evidence.
- `modules/ai-council/prompt-identity.ts` — add `reportEvidenceHash` and bump identity version to `prompt-identity-v2-report-evidence`.
- `modules/ai-council/prompt-evidence.ts` — add first-class `reportEvidence` packet layer and provenance wording.
- `modules/ai-council/llm.ts` — bump prompt version, add anti-bias/source-opinion instructions, expose report provenance/related-report fields on debate records.
- `modules/ai-council/debate-data.ts` — load immutable report snapshots by `run_id` and normalize provenance/related reports from frozen payload.
- `app/insights/ai-council/debates/page.tsx` — add Research Reports provenance card and compact `Báo cáo liên quan` links.
- `modules/research-reports/README.md` — document selector boundary/limits/authority semantics.
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
  params: { ticker: string; asOf: string; runAt: string; tickerLimit?: number; tickerLookbackDays?: number },
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

The selector queries only `market_research_reports`, `market_research_report_analyses`, and `market_research_report_ticker_mentions`. A persisted analysis row is the successful versioned analysis identity; do not filter on mutable current report `analysis_status` or current report `content_hash`. For each report select the newest eligible analysis at/before `runAt`, then apply deterministic tie-breaks.

- [ ] **Step 1: Write the failing bound/order tests**

Use an in-memory Supabase query-builder fixture like `tests/research-reports/detail-service.test.ts`. Seed four explicit ticker mentions within 90 days and assert only the newest three are selected.

```ts
assert.deepEqual(result.map((row) => row.reportId), ["r1", "r2", "r3"])
```

- [ ] **Step 2: Write failing point-in-time/reprocessing tests**

For one report seed two analyses:

```ts
const analyses = [
  { id: "a-old", report_id: "r1", content_hash: "a".repeat(64), processed_at: "2026-09-01T01:00:00Z" },
  { id: "a-future", report_id: "r1", content_hash: "b".repeat(64), processed_at: "2026-09-06T01:00:00Z" },
]
```

With `runAt="2026-09-05T07:00:00Z"`, assert `a-old` is selected. Also exclude report `created_at > runAt`, mention `created_at > runAt`, and `publish_date > asOf`.

- [ ] **Step 3: Write failing market/dedupe/tie tests**

Assert max two market reports, macro before strategy, dedupe by `reportId|analysisId`, and lexical `reportId` then `analysisId` tie-break when timestamps match.

- [ ] **Step 4: Write failing prompt-safety/budget tests**

Assert no query touches `market_research_report_chunks`; no emitted item contains raw `content`; final canonical serialization is <= `COUNCIL_REPORT_MAX_PROMPT_CHARS`; truncation preserves IDs/version/source/date/category/stance/source-opinion before trimming rationale/evidence/catalyst/risk/summary prose.

- [ ] **Step 5: Run focused test and verify RED**

```bash
node --test tests/research-reports/council-evidence.test.ts
```

Expected: FAIL because the selector module does not exist.

- [ ] **Step 6: Implement the minimal selector**

Use focused pure helpers:

```ts
function newestEligibleAnalysisByReport(rows: AnalysisRow[], runAt: string): Map<string, AnalysisRow>
function normalizeCouncilReportItem(...): CouncilReportEvidenceItem
function clampCouncilReportSelection(...): CouncilReportEvidenceSelection
```

Apply the exact default limits and ordering from the spec. Do not introduce embeddings or provider fetches.

- [ ] **Step 7: Re-run focused test**

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

### Task 2: Add quarantined immutable snapshot SQL and load-or-freeze adapter

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

Pending SQL contract:

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

Add authenticated read policy, service-role write/read, anon denial, `(ticker, as_of_date desc, captured_at desc)` index, and a `BEFORE UPDATE` trigger that rejects mutation.

Because this table is pending/quarantined, `report-evidence.ts` should keep the DB boundary typed with the generic `SupabaseClient` used by other pending Research Report adapters. Do not edit generated `Database` types in this task.

- [ ] **Step 1: Write failing pending-SQL source assertions**

Assert exact table/status/hash/RLS/index/no-update trigger contract by reading the pending SQL file.

- [ ] **Step 2: Write failing same-run reuse test**

Seed an existing row and assert:

```ts
const frozen = await freezeCouncilReportEvidence(client, params)
assert.equal(frozen.reused, true)
assert.equal(selectorCallCount, 0)
assert.equal(frozen.contextHash, EXISTING_HASH)
```

- [ ] **Step 3: Write failing `ready`, `empty`, unavailable and insert-failure tests**

Required behavior:

```ts
assert.equal(ready.persisted, true)
assert.equal(ready.snapshot?.status, "ready")
assert.equal(empty.snapshot?.status, "empty")
assert.deepEqual(empty.snapshot?.reports, [])
assert.equal(unavailable.persisted, true)
assert.equal(unavailable.snapshot?.status, "unavailable")
assert.equal(storeFailure.persisted, false)
assert.equal(storeFailure.snapshot, null)
assert.equal(storeFailure.contextHash, null)
```

- [ ] **Step 4: Run focused test and verify RED**

```bash
node --test tests/ai-council-report-evidence.test.ts
```

Expected: FAIL on missing SQL/module.

- [ ] **Step 5: Implement canonical hash + load-first freeze**

Reuse the canonical JSON SHA-256 style from `modules/ai-council/research-context.ts`. Hash the complete versioned bounded payload including status and `selectionRunAt`.

```ts
const existing = await loadPersistedSnapshot(runId)
if (existing) return persistedFrozen(existing, true)

try {
  const selected = await selectCouncilReportEvidence(...)
  return await persistPayload(selected.reports.length ? readyPayload(selected) : emptyPayload(selected))
} catch (error) {
  return await tryPersistUnavailable(error)
}
```

If insert itself fails, return `persisted:false`, `snapshot:null`, `contextHash:null`. Never return selected but unpersisted report evidence.

- [ ] **Step 6: Re-run focused test**

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

### Task 3: Freeze report evidence for every Council ticker before debate

**Files:**
- Modify: `modules/ai-council/pre-market-evidence.ts`
- Modify: `tests/ai-council-report-evidence.test.ts`
- Modify: `tests/ai-council-research-context.test.ts`

**Interfaces:**

Extend `AiCouncilPreMarketEvidenceResult`:

```ts
reportEvidenceVersion: typeof AI_COUNCIL_REPORT_EVIDENCE_VERSION
reportEvidenceReady: number
reportEvidenceEmpty: number
reportEvidenceUnavailable: number
reportEvidenceReused: number
reportEvidencePersisted: number
reportEvidenceMissingRunIdentities: number
```

Attach only persisted/reused `ready` or `empty` snapshots:

```ts
reportEvidence: {
  purpose: "Curated Research Report evidence for advisory LLM reasoning only; recommendations and targets are source opinions."
  contextVersion: typeof AI_COUNCIL_REPORT_EVIDENCE_VERSION
  contextHash: string
  status: "ready" | "empty"
  context: CouncilReportEvidenceSnapshotPayload
}
```

- [ ] **Step 1: Write failing all-ticker wrapper assertions**

Keep Notion pilot assertions intact, but require the Research Report path to iterate all `raw.stocks` with resolved run identities and not use `isCouncilResearchTickerEnabled`.

- [ ] **Step 2: Write failing attachment/degradation tests**

Assert ready/empty attaches; unavailable/unpersisted does not; existing `llmEvidence` and Notion `researchContext` remain unchanged; same-run retry reuses snapshot.

- [ ] **Step 3: Run focused tests and verify RED**

```bash
node --test tests/ai-council-report-evidence.test.ts tests/ai-council-research-context.test.ts
```

Expected: FAIL because the wrapper currently enriches only raw + Notion context.

- [ ] **Step 4: Resolve run identities once for all stocks**

Keep `runKey(ticker,evidenceHash)` so deterministic run identity remains unchanged. Capture one cutoff:

```ts
const reportSelectionRunAt = new Date().toISOString()
```

Use that same timestamp for every report selector in this enrichment invocation.

- [ ] **Step 5: Freeze all-ticker snapshots and attach only auditable evidence**

```ts
const frozen = await freezeCouncilReportEvidence(supabase, {
  runId: run.id,
  ticker: stock.ticker,
  asOfDate: params.ratingDate,
  runAt: reportSelectionRunAt,
})
```

Attach only when `frozen.persisted && frozen.contextHash && frozen.snapshot` and status is ready/empty.

- [ ] **Step 6: Re-run focused tests**

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

### Task 4: Version prompt identity and first-class semantic packet

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

export const AI_COUNCIL_LLM_PROMPT_VERSION = "llm-debate-v4-research-report-evidence"
```

Extend `AiCouncilEvidencePacketV2` and builder input with `reportEvidence?: unknown`.

- [ ] **Step 1: Write failing identity tests**

```ts
assert.notEqual(
  buildAiCouncilPromptIdentityHash({ ...base, reportEvidenceHash: "a".repeat(64) }),
  buildAiCouncilPromptIdentityHash({ ...base, reportEvidenceHash: "b".repeat(64) }),
)
```

Also assert deterministic `stock.evidenceHash` remains untouched and v1 is not reused as the new identity version.

- [ ] **Step 2: Write failing packet/prompt semantic assertions**

Require source to contain these concepts:

```text
RESEARCH_REPORT_EVIDENCE
SOURCE OPINION
The deterministic QeoIndex policy remains the final decision authority
contradiction with deterministic price/volume/Wyckoff evidence
must not upgrade or downgrade the deterministic signal
```

- [ ] **Step 3: Write failing empty/unavailable identity tests**

Persisted `empty` has a real hash and participates in v2 identity. Unavailable/unpersisted is not attached, so `reportEvidenceHash` resolves to null.

- [ ] **Step 4: Run focused tests and verify RED**

```bash
node --test tests/ai-council-prompt-evidence.test.ts tests/ai-council-persistence.test.ts tests/ai-council-report-evidence.test.ts
```

Expected: FAIL on identity version/hash input/prompt version/report packet layer.

- [ ] **Step 5: Implement v2 identity resolution**

Read the optional hash from `stock.reportEvidence?.contextHash` and include it in the canonical identity input. Keep cache key format `qeo-council-<hash>` unchanged.

- [ ] **Step 6: Add report packet layer and anti-bias instructions**

```ts
...(stock.reportEvidence ? { reportEvidence: stock.reportEvidence } : {})
```

Add source-opinion/contradiction/final-authority wording for Bull, Bear, Risk and Chair. Do not create a new LLM request or scoring path.

- [ ] **Step 7: Re-run focused tests**

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

### Task 5: Load frozen provenance and render `Báo cáo liên quan`

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

- [ ] **Step 1: Write failing dashboard-data test**

Assert dashboard data queries `ai_council_report_evidence_snapshots` by debate run IDs and does not call selectors/current Research Report tables.

- [ ] **Step 2: Write failing UI contract**

Require:

```text
Research Reports
Báo cáo liên quan
Source opinion
/research/reports/
```

- [ ] **Step 3: Run focused test and verify RED**

```bash
node --test tests/ai-council-report-evidence-ui.test.ts
```

Expected: FAIL because snapshot provenance is not loaded/rendered.

- [ ] **Step 4: Load and normalize immutable snapshots**

Add a query beside raw/Notion audit queries:

```ts
supabase
  .from("ai_council_report_evidence_snapshots")
  .select("run_id,context_version,context_hash,status,context_payload,report_ids,analysis_ids,captured_at")
  .in("run_id", runIds)
```

Normalize related reports solely from frozen `context_payload.reports`; malformed payload yields an empty UI list, never a live recomputation.

- [ ] **Step 5: Extend Debate Card provenance and related links**

Render status/count/hash/captured time and compact related rows. Links must use:

```tsx
<Link href={`/research/reports/${report.reportId}`}>...</Link>
```

Do not duplicate full executive summary or PDF content.

- [ ] **Step 6: Re-run focused UI test**

```bash
node --test tests/ai-council-report-evidence-ui.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add modules/ai-council/debate-data.ts modules/ai-council/llm.ts app/insights/ai-council/debates/page.tsx tests/ai-council-report-evidence-ui.test.ts tests/test-contracts.json
git commit -m "feat(council): show related research reports"
```

---

### Task 6: Lock cross-module authority boundaries and quarantine semantics

**Files:**
- Modify: `modules/research-reports/README.md`
- Modify: `modules/ai-council/README.md`
- Modify: `tests/ai-council-report-evidence.test.ts`
- Modify: `tests/ai-council-persistence.test.ts`
- Modify: `tests/ai-council-research-context.test.ts`
- Verify unchanged: `modules/shared/supabase/database.types.ts`

**Interfaces:**
- Research Reports README states canonical DB-only all-ticker selector, exact limits, point-in-time identity and no provider/PDF runtime dependency.
- AI Council README states snapshot statuses/reuse/prompt identity v2/deterministic authority separation.
- Generated Database types remain unchanged until QEO-87 promotes pending Research Reports/QEO-86 schema.

- [ ] **Step 1: Add failing architecture-boundary assertions**

Scan AI Council runtime source and assert no import/reference to:

```text
modules/research-reports/providers/topi
pdfjs-dist
market_research_report_chunks
```

Allow only the stable selector through `modules/ai-council/report-evidence.ts`.

- [ ] **Step 2: Add failing deterministic-authority assertions**

Assert QEO-86 code does not update `ai_council_runs.evidence_hash`, `signal`, `council_score`, or `risk_status`, and UI still identifies deterministic result as final authority.

- [ ] **Step 3: Document exact selector/failure/quarantine semantics**

Document `3/90d`, `2/30d`, max 5, ~10k chars, exact analysis identity, source-opinion semantics, same-run snapshot reuse, and persistence-failure omission.

- [ ] **Step 4: Verify active generated types remain current and unchanged**

Run against active migrations:

```bash
pnpm db:replay:verify
pnpm db:types:verify
```

Expected: PASS with no QEO-86 pending table required in committed generated types. Do **not** run `pnpm db:types:generate` for the pending table and do not hand-edit `database.types.ts`.

- [ ] **Step 5: Run focused architecture tests**

```bash
node --test tests/ai-council-report-evidence.test.ts tests/ai-council-persistence.test.ts tests/ai-council-research-context.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add modules/research-reports/README.md modules/ai-council/README.md tests/ai-council-report-evidence.test.ts tests/ai-council-persistence.test.ts tests/ai-council-research-context.test.ts
git commit -m "docs(council): lock report evidence authority boundary"
```

---

### Task 7: Full regression, draft PR, Verify + DB Drift acceptance

**Files:**
- Modify only files required by genuine failures discovered in this gate.
- PR body references QEO-86 spec/plan and explicitly says production promotion/backfill remains QEO-87.

**Interfaces:**
- Final PR head is the sole acceptance SHA.
- No merge until Verify and DB Drift are green on that exact SHA.

- [ ] **Step 1: Run all focused QEO-86 suites**

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

- [ ] **Step 2: Run current contracts, lint and TypeScript**

```bash
pnpm test:current
pnpm lint:touched
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 3: Run production build**

```bash
pnpm build
```

Expected: PASS with `/insights/ai-council/debates` compiled successfully.

- [ ] **Step 4: Run DB reconciliation gates**

```bash
pnpm db:drift:verify
pnpm db:replay:verify
pnpm db:types:verify
pnpm test:db-drift
```

Expected: PASS. Active migration replay/types remain unchanged; pending QEO-86 SQL source contract remains quarantined for QEO-87 promotion.

- [ ] **Step 5: Create/update draft PR**

Title:

```text
QEO-86: feed curated Research Reports into AI Council
```

Body summarizes all-ticker selector, immutable per-run snapshot, prompt identity v2 + prompt v4, contradiction/source-opinion semantics, related links, unchanged deterministic `evidence_hash`, and QEO-87 production rollout ownership.

- [ ] **Step 6: Verify CI on exact final head**

Require successful repository **Verify** and **DB Drift Reconciliation** workflow runs on the PR's final SHA. Any later commit invalidates earlier green evidence.

- [ ] **Step 7: Review the five critical failure modes**

Explicitly inspect:

1. future analysis/mention leaking through `runAt` cutoff;
2. same-run retry reselecting newer reports;
3. unpersisted evidence entering the prompt;
4. report hash mutating deterministic Council identity/decision fields;
5. historical UI recomputing current reports instead of using frozen snapshot.

Expected: none present.

- [ ] **Step 8: Mark PR ready only after all gates are green**

Do not merge or mark Linear QEO-86 Done until final-head Verify + DB Drift evidence exists. Do not claim production deployment/runtime rollout; QEO-87 owns that acceptance.
