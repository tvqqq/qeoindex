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
- successful analysis rows are versioned by `report_id + content_hash + analysis_version + prompt_version + model_route_key`;
- ticker mentions are tied to a concrete `analysis_id`;
- recommendations and target prices are explicitly source-opinion evidence;
- a report may later be reprocessed under a new content hash/analysis identity;
- old successful analysis evidence remains canonical even when later ingestion/reprocessing fails.

QEO-86 must therefore freeze a concrete eligible **analysis row**, not rely on the mutable current `market_research_reports.content_hash` or current report processing status for historical replay.

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
4. the concrete analysis row is a successful canonical analysis record for that report identity;
5. ticker-specific evidence has an explicit `market_research_report_ticker_mentions.ticker = requested ticker` tied to the selected `analysis_id`;
6. `market_research_report_ticker_mentions.created_at <= runAt`;
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

When the same report/analysis qualifies for both buckets, include it once. Preserve ticker-specific role metadata while retaining market/category metadata in the snapshot payload.

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

Add a dedicated table:

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

### 9.1 Freeze/reuse contract

The freeze function must first load by `run_id`.

- If a snapshot already exists, return it unchanged with `reused=true` and **do not re-run the selector**.
- If none exists, select point-in-time evidence, canonicalize it, compute `context_hash`, then persist exactly one immutable row.
- Same-run retry/replay must therefore use the original frozen evidence even if newer reports or analyses appeared after the first attempt.

A Council prompt may consume Research Report evidence **only after the corresponding immutable snapshot has been successfully persisted or reused**.

If selection succeeds but snapshot persistence fails, the Council debate may continue, but the unpersisted report evidence must be omitted from the prompt. This prevents an unauditable prompt from influencing advisory output.

### 9.2 `ready`

At least one eligible report is frozen and successfully persisted.

### 9.3 `empty`

Selector ran successfully but no eligible report existed. Persist an empty snapshot with `report_ids=[]` and `analysis_ids=[]`.

This is required to distinguish a valid historical absence from a selector outage.

### 9.4 `unavailable`

Selector/database hydration failed. If the snapshot store is still writable, persist a versioned bounded `unavailable` payload with empty report/analysis lists and a deterministic context hash. Council continues without report evidence.

If snapshot persistence itself fails, do not claim persisted provenance and do not include Research Report evidence in the prompt.

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

Because this changes the identity contract, bump the identity version explicitly from the existing `prompt-identity-v1` to a new version, proposed:

```text
prompt-identity-v2-report-evidence
```

Do not silently change `prompt-identity-v1` semantics.

For `ready` and `empty` snapshots, include the frozen Research Reports `context_hash` in the new identity. `empty` therefore remains a reproducible explicit evidence state. For an unpersisted/unavailable snapshot, omit the report hash from prompt identity and omit report evidence from the prompt.

A changed persisted Research Reports snapshot changes LLM prompt/cache identity while leaving deterministic Council authority untouched.

## 12. Runtime integration

Hydrate/freeze Research Reports at the existing pre-debate evidence stage.

```text
Deterministic Council run created
          ↓
Raw LLM evidence freeze
          ↓
Notion research freeze — existing policy
          ↓
Research Reports snapshot load-or-freeze — ALL tickers
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

Failure/retry semantics:

- existing snapshot for `run_id` → reuse unchanged; never reselect;
- selector succeeds with no reports → persist `empty`, debate continues unchanged;
- selector/database query fails but snapshot can be persisted → persist `unavailable`, debate continues without report evidence;
- snapshot persistence fails → omit report evidence and continue debate with existing deterministic/raw/Notion/market layers;
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

Add a Research Reports provenance card showing, when persisted:

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
- same-run retry reuses the old snapshot and does not select the new analysis;
- a new Council run may select the newer eligible analysis;
- the snapshots have different `context_hash` values;
- the LLM prompt identities differ;
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
8. mention created after `runAt` excluded;
9. historical selection freezes the exact eligible analysis row;
10. later reprocessing does not mutate old snapshot;
11. same `run_id` retry reuses the existing snapshot without reselection;
12. successful no-match freezes `status=empty` and debate continues;
13. selector failure freezes `unavailable` when persistence works and debate continues;
14. snapshot persistence failure causes report evidence to be omitted from the prompt;
15. Research Reports `context_hash` participates in the new LLM prompt identity;
16. prompt identity version is bumped; v1 semantics are not silently changed;
17. deterministic `ai_council_runs.evidence_hash` remains unchanged;
18. contradictory bullish broker report vs deterministic bearish/REDUCE preserves contradiction semantics and deterministic authority;
19. `modules/ai-council` has no TOPI/PDF runtime dependency;
20. prompt contains no full PDF/raw chunk dump;
21. related-report links resolve to `/research/reports/[id]`;
22. historical UI reads frozen snapshot rather than recomputing current selector;
23. snapshot table RLS/immutability is enforced;
24. generated Supabase types remain current;
25. full Verify passes;
26. DB Drift Reconciliation passes because schema changes are required.

## 18. Failure and degradation policy

Research Reports are advisory context, therefore failure must fail open for AI Council execution while remaining auditable.

- `ready`: include successfully persisted/reused frozen evidence;
- `empty`: include explicit persisted empty evidence state;
- `unavailable`: omit report evidence from prompt, preserve deterministic and other LLM evidence layers, record persisted limitation/provenance when possible;
- snapshot persistence failure: omit report evidence entirely rather than use unauditable evidence;
- never hide or rewrite older Council evidence because current report processing fails;
- never fetch provider/PDF data synchronously as a fallback inside AI Council.

## 19. Implementation boundaries

Expected components:

- Research Reports deterministic selector module;
- AI Council report-evidence load-or-freeze snapshot adapter;
- schema migration + generated types;
- prompt identity v2 extension;
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
- same-run retries reuse frozen evidence;
- no unpersisted Research Report evidence can enter a Council prompt;
- report evidence affects only advisory LLM reasoning;
- deterministic authority remains unchanged;
- contradictions are surfaced rather than broker opinion being promoted;
- related report links are visible from Council debate UI;
- empty/unavailable evidence does not fail Council;
- tests, TypeScript, production build, Verify and DB Drift all pass on the final PR head.
