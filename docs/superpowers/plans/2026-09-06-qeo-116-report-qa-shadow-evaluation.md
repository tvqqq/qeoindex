# QEO-116 Research Report Q&A — Shadow Evaluation Gate

## Scope

This document defines the QEO-116 rollout gate for **report-specific** Research Report Q&A only.

It does not define Stock/Ticker cross-report retrieval and it does not authorize any PostgreSQL chunk/FTS cleanup. Those remain outside QEO-116.

## Invariants that must not regress

1. The requested report resolves to one exact current identity:
   - `report_id`
   - `content_hash`
   - `chunk_version`
   - selected `analysis_id`
2. Qdrant is a derived ranking/index layer, never citation authority.
3. Qdrant report retrieval uses the deterministic `REPORT` partition plus exact provenance filters.
4. Qdrant text/page metadata is never passed through as canonical evidence.
5. Qdrant-ranked chunk IDs are hydrated from PostgreSQL using exact report/hash/chunk-version filters.
6. Any row that fails exact canonical hydration is discarded.
7. The model may cite only evidence IDs included in the bounded canonical evidence passed to the model.
8. Zero valid evidence preserves the QEO-82 `not_found`/fail-closed contract.
9. Qdrant unavailable or empty in rollout mode keeps bounded PostgreSQL FTS fallback.

## Runtime rollout modes

`RESEARCH_REPORT_QA_RETRIEVAL_MODE`:

| Mode | User-visible retrieval | Hybrid behavior |
|---|---|---|
| `lexical` | PostgreSQL FTS | disabled |
| `shadow` | PostgreSQL FTS | runs for comparison only |
| `hybrid` | hydrated hybrid when valid | bounded FTS fallback on unavailable/empty |

The API route defaults to `shadow` while the service defaults to `lexical` when no rollout dependency is provided, preserving QEO-82 behavior for existing direct callers/tests.

## Shadow metric contract

Runtime shadow/hybrid comparison emits IDs/counts/timing only; report content, questions, history, prompts and evidence text are not logged.

Per request:

- `mode`
- `selected`
- `fallbackUsed`
- `lexicalCount`
- `lexicalMs`
- `hybridPointCount` — Qdrant candidates before PostgreSQL hydration
- `hybridCanonicalCount` — exact canonical rows returned by hydration before evidence budget
- `hybridCount` — canonical hybrid rows remaining after evidence budget
- `hybridRetrievalMs`
- `hybridHydrationMs`
- `hybridResolutionRatio = hybridCanonicalCount / hybridPointCount`
- `overlapCount`
- `overlapRatio`
- `hybridStatus`

`hybridResolutionRatio` intentionally uses the pre-budget canonical count so normal character-budget truncation is not misclassified as provenance/hydration loss.

## Labeled benchmark design

QEO-116 evaluation must use manually labeled canonical chunk IDs for the **exact report version under test**. The evaluator rejects cases without `expectedChunkIds` and rejects duplicate case IDs rather than fabricating recall.

Every benchmark should contain both categories:

### 1. `lexical_anchor`

Protect the strengths of PostgreSQL FTS and Vietnamese financial exact terms/numbers.

Representative query patterns include:

- `giá mục tiêu 110.000`
- `EV/EBITDA 2027F`
- `P/E`
- `ROE`
- `doanh thu`
- `LNST`
- ticker / company / broker names
- exact price, percentage and valuation anchors

The concrete labels must come from the tested report; these examples are query-shape guidance, not ground truth.

### 2. `semantic_paraphrase`

Measure the main reason to add vector retrieval: meaning-preserving wording that may have weak lexical overlap.

Representative query patterns include:

- `Định giá này dựa trên những giả định nào?`
- `Điều gì khiến bên phân tích cho rằng biên lợi nhuận sẽ cải thiện?`
- `Luận điểm nào có thể làm khuyến nghị này sai?`
- `Yếu tố nào đóng góp chính vào mức định giá mới?`

Again, expected chunk IDs must be manually labeled from canonical report evidence.

## Offline evaluator

`modules/research-reports/qa/evaluation.ts` consumes labeled cases and reports:

- overall lexical Hit Rate and Recall;
- overall hybrid Hit Rate and Recall;
- lexical-anchor recall by retrieval strategy;
- semantic-paraphrase recall by retrieval strategy;
- non-regression flags;
- canonical resolution rate;
- citation-validity scoring coverage/pass rate;
- answer-quality scoring coverage/pass rate;
- lexical, Qdrant retrieval and canonical hydration average latency.

The evaluator is deterministic and performs no DB, Qdrant or LLM calls. It does not generate labels or grade answer quality automatically.

## Cutover gate: `shadow` → `hybrid`

Do **not** switch production to `hybrid` until an actual shadow benchmark (not a unit-test fixture) documents all of the following:

| Gate | Required evidence |
|---|---|
| Exact report/version isolation | no cross-report or historical-version evidence |
| Canonical resolution | `100%` for accepted Qdrant candidates used by the benchmark |
| Citation validity | all benchmark answers scored; no invalid citation |
| Lexical anchors | hybrid recall is non-regressive vs FTS |
| Semantic paraphrases | hybrid recall improves or is at least non-regressive vs FTS |
| Overall recall | hybrid is non-regressive vs FTS |
| Answer quality | all benchmark answers reviewed; no grounding regression |
| Fallback | Qdrant unavailable/empty demonstrably falls back to bounded FTS |
| Latency | FTS vs hybrid retrieval + hydration is measured and documented before cutover |
| Exact-head verification | repository Verify must run/pass on the final cutover SHA |

QEO-116 does not invent a latency threshold that is absent from the issue acceptance. Record the measured distribution during shadow operation and explicitly accept the runtime trade-off before changing the environment mode. Broader p50/p95 production SLO evaluation belongs to QEO-119.

## Evidence record for a real evaluation run

Store, at minimum:

- git SHA;
- environment / Qdrant collection version;
- report IDs and exact content/chunk/analysis versions;
- number of benchmark cases by category;
- labeled expected canonical chunk IDs;
- lexical returned chunk IDs;
- hydrated hybrid returned chunk IDs;
- Qdrant candidate count and canonical hydration count;
- retrieval/hydration latency;
- citation-validity judgement;
- answer-quality judgement;
- evaluator aggregate output;
- final cutover decision and reviewer.

Do not store report text in generic telemetry merely to compute these metrics.

## Current status

Implementation supports `shadow`, exact provenance filtering, PostgreSQL canonical hydration and bounded FTS fallback. A deterministic evaluator exists and has unit fixtures covering lexical non-regression plus semantic improvement.

Those fixtures verify evaluator behavior only. They are **not** production shadow evidence and must not be used to authorize `RESEARCH_REPORT_QA_RETRIEVAL_MODE=hybrid`.
