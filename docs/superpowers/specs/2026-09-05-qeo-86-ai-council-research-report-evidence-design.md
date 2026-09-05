# QEO-86 — Curated Research Report Evidence for AI Council

**Status:** Approved design
**Date:** 2026-09-05
**Issue:** QEO-86 — `[QEO-79][P7] Feed curated report evidence into AI Council + related report links`
**Base:** QEO-80/81/82/84/85 Research Reports foundation

## 1. Goal

Add published Research Reports as bounded, reproducible advisory evidence for AI Council LLM debates without changing deterministic Council scoring, signal, risk veto, or evidence identity.

The system must:

- select relevant report evidence deterministically for every AI Council ticker;
- preserve point-in-time integrity and exact historical provenance;
- freeze the exact report/analysis evidence used by each Council run;
- enrich Bull/Bear/Risk/Chair reasoning only;
- label broker recommendation/target data as source opinion;
- surface related-report links in AI Council views;
- degrade safely when no report is available or the selector fails;
- never fetch TOPI or PDFs from `modules/ai-council` at runtime.

## 2. Non-goals

QEO-86 does **not**:

- alter deterministic Council scoring or signal formulas;
- alter deterministic risk-veto authority;
- auto-upgrade/downgrade a Council signal from broker opinion;
- add auto-trading behavior;
- add another LLM call to judge broker reports;
- add vector search or embeddings;
- add global report chat;
- put raw/full PDF text into an AI Council prompt;
- replace the existing Notion Research Context system.

## 3. Locked architecture decisions

### 3.1 Rollout scope

Research Report evidence applies to **all AI Council tickers** immediately when eligible published report evidence exists.

This is intentionally separate from the existing Notion Research Context MSN pilot. Research Reports are canonical structured database evidence and do not inherit the Notion pilot gate.

### 3.2 Provenance architecture

Create a dedicated immutable Research Report evidence snapshot for each Council run rather than overloading `ai_council_llm_research_contexts` or changing `ai_council_runs.evidence_hash`.

The deterministic Council identity remains based on deterministic market evidence. Report evidence participates only in the LLM prompt/cache identity.

### 3.3 Authority separation

Two authority paths remain explicit:

```text
Rating + Wyckoff + deterministic market evidence
        ↓
Deterministic Council
        ↓
signal / score / risk authority
```

```text
Published Research Reports
        ↓
Deterministic bounded selector
        ↓
Immutable report evidence snapshot
        ↓
LLM semantic packet
        ↓
Bull / Bear / Risk / Chair advisory reasoning
```

Broker/source opinion may enrich explanation and dissent but cannot mutate deterministic authority.

## 4. Existing data contracts reused

QEO-86 consumes the canonical Research Reports tables created by QEO-80/81/85:

- `market_research_reports`
- `market_research_report_analyses`
- `market_research_report_ticker_mentions`
- existing page citation evidence from structured analysis/mentions

Important existing semantics:

- report metadata is provider-owned;
- analysis rows are versioned by `report_id + content_hash + analysis_version + prompt_version + model_route_key`;
- ticker mentions are tied to a concrete `analysis_id`;
- recommendations and target prices are explicitly source-opinion evidence;
- a report may later be reprocessed under a new content hash/analysis identity.

QEO-86 must therefore freeze a concrete eligible **analysis row**, not rely on the mutable current `market_research_reports.content_hash` for historical replay.

## 5. Research Reports selector API

The Research Reports module owns read-only selectors. `modules/ai-council` consumes selector output and must not import TOPI/PDF/parsing providers.

Initial public contract:

```ts
getRelevantReportEvidence({
  ticker,
  asOf,
  runAt,
  tickerLimit: 3,
  tickerLookbackDays: 90,
})

getRelevantMarketReportEvidence({
  asOf,
  runAt,
  categories: ["macro", "strategy"],
  marketLimit: 2,
  marketLookbackDays: 30,
})
```

Operational defaults:

- ticker-specific evidence: max **3 reports / 90 days**;
- market Macro/Strategy evidence: max **2 reports / 30 days**;
- total max before final prompt truncation: **5 reports**;
- dedupe by report/analysis identity if a report qualifies for both buckets.

These are testable operational constants, not investment rules.

## 6. Point-in-time eligibility

For a Council run with `asOf` and actual execution time `runAt`, evidence is eligible only when all relevant rows existed at that point in time.

Required filters:

1. `market_research_reports.publish_date <= asOf`;
2. `market_research_reports.created_at <= runAt`;
3. concrete `market_research_report_analyses.processed_at <= runAt`;
4. the analysis row is a valid completed/published analysis candidate for that report identity;
5. ticker-specific evidence has an explicit `market_research_report_ticker_mentions.ticker = requested ticker` tied to the selected `analysis_id`;
6. mention creation time must be `<= runAt` when the source schema exposes it;
7. future reports, future analysis revisions, and future mentions are excluded.

Historical replay uses the exact selected `analysis_id/content_hash/version` from the frozen snapshot. Later current report state must not alter a historical Council run.

## 7. Deterministic selection and ordering

No embedding, semantic search, or LLM ranking is used in QEO-86.

### 7.1 Ticker-specific bucket

Qualification requires explicit ticker mention.

Ordering:

```text
explicit ticker mention
→ newest publish_date
→ newest eligible analysis processed_at
→ report_id deterministic tie-break
→ analysis_id deterministic tie-break
```

Apply `tickerLimit` after ordering.

### 7.2 Market bucket

Only categories `macro` and `strategy` are eligible by default.

Ordering:

```text
category priority: macro → strategy
→ newest publish_date
→ newest eligible analysis processed_at
→ report_id deterministic tie-break
→ analysis_id deterministic tie-break
```

Apply `marketLimit` after ordering.

### 7.3 Dedupe

When the same report/analysis qualifies for both buckets, include it once. Prefer preserving the ticker-specific role metadata while also retaining market/category metadata in the snapshot payload.

## 8. Curated prompt payload

Do not send report chunks or full PDF text to AI Council.

Each selected report contributes a compact structured representation containing only fields needed for reasoning/provenance, such as:

- report ID and analysis ID;
- title;
- source/provider;
- publish date;
- category;
- executive summary;
- relevant ticker stance if present;
- recommendation and target price, explicitly tagged `SOURCE OPINION`;
- concise rationale;
- bounded cited evidence snippets with page numbers;
- key catalysts/risks where useful;
- analysis/content/prompt/model-route versions.

Initial Research Reports prompt budget: approximately **10,000 characters total** across the final selected set. Truncation must be deterministic and preserve provenance fields before optional prose.

## 9. Immutable snapshot schema

Add a dedicated table, proposed name:

```text
ai_council_report_evidence_snapshots
```

One row per `ai_council_runs.id`.

Required columns:

```text
run_id             uuid primary key / FK → ai_council_runs(id)
ticker             text
as_of_date         date
context_version    text
context_hash       sha256
status             ready | empty | unavailable
context_payload    jsonb bounded immutable payload
report_ids         jsonb array of exact selected report IDs
analysis_ids       jsonb array of exact selected analysis IDs
captured_at        timestamptz
```

Security/immutability:

- authenticated: read only;
- service role: insert/read;
- anon: no access;
- DB trigger rejects updates;
- index `(ticker, as_of_date desc, captured_at desc)`;
- snapshot payload is immutable audit evidence.

### 9.1 `ready`

At least one eligible report is frozen.

### 9.2 `empty`

Selector ran successfully but no eligible report existed. Persist an empty snapshot with `report_ids=[]` and `analysis_ids=[]`.

This is required to distinguish a valid historical absence from a selector outage.

### 9.3 `unavailable`

Selector/database hydration failed. Persist bounded failure state/evidence where possible and allow Council LLM execution to continue without report evidence.

## 10. Frozen snapshot payload

The immutable payload must contain enough data to reconstruct what the prompt saw without querying mutable current rows.

For each report freeze at least:

```text
report_id
analysis_id
provider
source_name
title
publish_date
category
analysis.content_hash
analysis_version
prompt_version
model_route_key
processed_at
ticker mention + stance when applicable
recommendation / target price as source_opinion
bounded rationale
bounded citation page/snippet data
```

The snapshot-level `context_hash` is SHA-256 over a canonicalized versioned payload.

If the same provider report is reprocessed later with a different `content_hash` or `analysis_id`, old snapshots remain unchanged while new Council runs may select the new eligible analysis.

## 11. AI Council prompt identity

Do **not** change `ai_council_runs.evidence_hash`.

Extend the LLM prompt identity input with:

```ts
reportEvidenceHash?: string | null
```

Prompt identity becomes:

```text
deterministic evidence hash
+ raw LLM evidence hash
+ Notion research context hash
+ Research Reports context hash
+ Market Synthesis hash
+ prompt version
```

A changed Research Reports snapshot therefore changes LLM prompt/cache identity while leaving deterministic Council authority untouched.

Version the prompt identity contract if needed rather than silently changing an existing version's semantics.

## 12. Runtime integration

Hydrate/freeze Research Reports at the existing pre-debate evidence stage.

```text
Deterministic Council run created
          ↓
Raw LLM evidence freeze
          ↓
Notion research freeze — existing policy
          ↓
Research Reports selector — ALL tickers
          ↓
Immutable report evidence snapshot
          ↓
Market synthesis context
          ↓
Build semantic LLM packet
          ↓
Bull / Bear / Risk / Chair
```

`modules/ai-council` receives a stable object such as:

```ts
FrozenCouncilReportEvidence
```

It must not call TOPI, download PDFs, parse PDFs, or invoke Research Reports ingestion.

Failure semantics:

- selector succeeds with no reports → `empty`, debate continues unchanged;
- selector/database error → `unavailable`, debate continues without report evidence;
- deterministic Council output is never failed or modified because Research Reports are unavailable.

## 13. Prompt semantics and anti-bias contract

Add a dedicated semantic packet section, conceptually:

```text
RESEARCH_REPORT_EVIDENCE
Authority: ADVISORY / SOURCE OPINION ONLY
May enrich reasoning.
Must not modify deterministic Council authority.
```

Rules for all debate roles:

- recommendation/target price is broker/source opinion, not verified company fact;
- Research Reports may support or challenge an argument but cannot change deterministic `signal`, `score`, or risk-veto output;
- if report narrative conflicts with price/volume/Wyckoff/deterministic evidence, explicitly state the contradiction;
- do not resolve contradiction by automatically preferring broker narrative;
- do not imply institution/broker opinion is ground truth;
- absence of report evidence is neutral and must not degrade Council execution.

Example required behavior:

```text
Deterministic signal: REDUCE
Broker report: BUY, target 120

Allowed:
"Broker/source opinion remains constructive, but this conflicts with current
price/volume and deterministic evidence; the Council's REDUCE authority is unchanged."

Not allowed:
"Broker says BUY, therefore Council should upgrade to BUY."
```

## 14. LLM evidence packet integration

Extend the existing first-class semantic packet rather than creating a parallel prompt path.

Research Report evidence must be available to:

- Bull role;
- Bear role;
- Risk role;
- Chair role.

Risk should specifically surface conflicts between report opinion and deterministic/market evidence. Chair should preserve the deterministic authority statement when disagreement exists.

No new standalone AI call is introduced.

## 15. Debate dashboard / UI

Reuse the existing AI Council Debate Card and Evidence Provenance surface.

### 15.1 Evidence Provenance

Add a Research Reports provenance card showing, when present:

- snapshot status;
- selected report count;
- short `context_hash`;
- captured time/version.

Historical UI must read the immutable snapshot, not recompute the selector.

### 15.2 `Báo cáo liên quan`

Each Debate Card may show a compact related-reports section with:

- title;
- source;
- publish date;
- category;
- ticker stance when present;
- `Source opinion` badge when recommendation/target exists;
- link `/research/reports/[reportId]`.

Do not duplicate the full report summary. QEO-84 report detail page remains the progressive-disclosure destination.

## 16. Versioning and historical integrity

If a report later changes/reprocesses:

```text
same report_id
new content_hash / analysis_id
```

then:

- historical Council snapshot retains the old `analysis_id/content_hash` and old curated payload;
- new Council run may select the newer eligible analysis;
- the two snapshots have different `context_hash` values;
- the two LLM prompt identities differ;
- historical debate evidence is never hindsight-rewritten.

## 17. Testing / acceptance gates

Implementation follows TDD and must cover at least:

1. all-ticker rollout; no inherited MSN pilot gate;
2. ticker selector max `3 / 90d`;
3. macro/strategy selector max `2 / 30d`;
4. deterministic ordering and dedupe;
5. future `publish_date` excluded;
6. report not yet created at `runAt` excluded;
7. analysis processed after `runAt` excluded;
8. historical selection freezes the exact eligible analysis row;
9. later reprocessing does not mutate old snapshot;
10. successful no-match freezes `status=empty` and debate continues;
11. selector/storage failure freezes/records `unavailable` where possible and debate continues;
12. Research Reports `context_hash` participates in LLM prompt identity;
13. deterministic `ai_council_runs.evidence_hash` remains unchanged;
14. contradictory bullish broker report vs deterministic bearish/REDUCE preserves contradiction semantics and deterministic authority;
15. `modules/ai-council` has no TOPI/PDF runtime dependency;
16. prompt contains no full PDF/raw chunk dump;
17. related-report links resolve to `/research/reports/[id]`;
18. historical UI reads frozen snapshot rather than recomputing current selector;
19. snapshot table RLS/immutability is enforced;
20. generated Supabase types remain current;
21. full Verify passes;
22. DB Drift Reconciliation passes because schema changes are required.

## 18. Failure and degradation policy

Research Reports are advisory context, therefore failure must fail open for AI Council execution while remaining auditable.

- `ready`: include frozen evidence;
- `empty`: include explicit empty evidence state;
- `unavailable`: omit report evidence from prompt, preserve deterministic and other LLM evidence layers, record limitation/provenance;
- never hide or rewrite older Council evidence because current report processing fails;
- never fetch provider/PDF data synchronously as a fallback inside AI Council.

## 19. Implementation boundaries

Expected components:

- Research Reports deterministic selector module;
- AI Council report-evidence freeze/snapshot adapter;
- schema migration + generated types;
- prompt identity extension/versioning;
- first-class semantic packet integration;
- debate data/dashboard provenance loading;
- compact `Báo cáo liên quan` UI;
- focused selector/snapshot/prompt/UI/DB contract tests.

Avoid unrelated refactors. Reuse existing canonicalization/hash, immutable-context, Supabase and dashboard patterns where practical.

## 20. Definition of done

QEO-86 is complete only when:

- every AI Council ticker can consume eligible Research Reports;
- selection is deterministic, bounded and point-in-time safe;
- exact report/analysis provenance is immutable per Council run;
- report evidence affects only advisory LLM reasoning;
- deterministic authority remains unchanged;
- contradictions are surfaced rather than broker opinion being promoted;
- related report links are visible from Council debate UI;
- empty/unavailable evidence does not fail Council;
- tests, TypeScript, production build, Verify and DB Drift all pass on the final PR head.
