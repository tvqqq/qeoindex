# QEO-85 — Research Reports Daily Workflow, Idempotency, Pricing, and Admin Telemetry

**Issue:** QEO-85 — `[QEO-79][P6] Daily 07:05 Research Reports workflow + idempotency + Admin telemetry`  
**Date:** 2026-09-05  
**Status:** Approved design  
**Base:** `main` at `79bda783ecf12a6375f3baaba15dcf87653a248d`

## 1. Goal

Automate discovery and AI processing of market research reports every morning with production-grade scheduling, idempotency, failure isolation, cost control, and Admin observability.

The daily workflow must:

- start at **07:05 Asia/Ho_Chi_Minh every calendar day**, including weekends;
- discover TOPI reports without assuming contiguous or monotonically increasing external IDs;
- upsert new and changed metadata idempotently;
- fetch, hash, parse, analyze, and atomically publish eligible reports;
- prevent duplicate AI spend across reruns and concurrent daily/backfill executions;
- isolate report-level failures so one bad PDF does not fail the batch;
- record durable run, phase, report-attempt, model, token, and estimated-cost evidence;
- enforce bounded report/API/cost budgets;
- expose a separate confirmed Admin backfill path using the same processing and idempotency contracts.

Catalog/detail UI and AI Council selection logic remain out of scope.

## 2. Existing contracts to preserve

QEO-80/QEO-81 already provide the core domain and processing primitives:

- `market_research_reports` is unique on `(provider, external_report_id)`;
- PDF fetch is server-side and hash-based;
- the canonical analysis identity is `(report_id, content_hash, analysis_version, prompt_version, model_route_key)`;
- `processResearchReport()` skips a successful identical analysis before invoking AI;
- successful publish is atomic through `qeo_publish_research_report_analysis`;
- analysis rows already persist model and token audit fields;
- unsupported/needs-OCR states are explicit and do not require AI;
- `system_job_runs` supports `partial` and `system_job_phases` is the durable production control-plane evidence source.

QEO-85 adds orchestration and operational evidence around these contracts. It must not create a second analysis identity or a second publish path.

## 3. Scheduler architecture

### 3.1 Canonical owner

Use **Supabase `pg_cron`** as the scheduler owner.

Schedule:

```text
5 0 * * *
```

This is **00:05 UTC / 07:05 ICT every day**.

Do not add a Vercel Cron entry. The current deployment plan uses Vercel Hobby scheduling semantics for `signals.daily`, where minute-level execution is not guaranteed. QEO-85 explicitly requires 07:05, so Supabase `pg_cron` is the canonical minute-precise scheduler.

### 3.2 Trigger flow

```text
Supabase pg_cron
  -> security-definer trigger function
  -> Supabase Vault reads qeoindex_app_url + qeoindex_cron_secret
  -> net.http_post POST /api/research-reports/daily
  -> machine auth validation
  -> Vercel Workflow start
  -> researchReportsDailyWorkflow
```

Follow the existing EOD scheduler pattern:

- secrets are read from Vault at execution time;
- migration text never embeds credentials;
- the HTTP route starts the durable workflow and returns dispatch evidence;
- scheduler dispatch is not treated as execution success;
- `system_job_runs` and `system_job_phases` remain the execution truth.

Suggested scheduler name:

```text
research-reports-daily-0705-ict
```

Suggested job key:

```text
research_reports.daily
```

## 4. Job boundaries

Use two distinct Admin/control-plane job keys.

### 4.1 `research_reports.daily`

- provider: `supabase_pg_cron`
- schedule: 07:05 ICT daily
- schedule days: every day
- evidence: `system_job_runs`
- manual policy: `disabled`
- purpose: scheduled incremental discovery and processing

### 4.2 `research_reports.backfill`

- provider: `manual`
- no scheduler
- evidence: `system_job_runs`
- manual policy: `confirm`
- manual purpose: `recovery`
- Root Admin only through the existing Admin control plane
- requires a valid change reason and explicit confirmation

The backfill path must call the same orchestration core, processing core, lease acquisition, pricing calculator, and budget guard as the daily workflow. It must never bypass idempotency.

## 5. Workflow phases

Persist these phases in `system_job_phases`:

1. `DISCOVER`
2. `UPSERT_METADATA`
3. `FETCH_PARSE`
4. `AI_ANALYZE`
5. `PUBLISH`
6. `FINALIZE`

The implementation may process each report through fetch/parse/analyze/publish sequentially while updating phase summaries cumulatively. Phase names are the public operational contract even if the internal helper boundaries are more granular.

### 5.1 MVP execution model

Process reports **sequentially** in the durable workflow for QEO-85.

Reasons:

- deterministic AI-request and USD budget enforcement;
- no concurrent mutation of run summaries;
- simpler lease behavior;
- predictable TOPI/PDF/OpenAI pressure;
- lower operational complexity for the first scheduled rollout.

Parallel report processing is out of scope unless a later issue adds concurrency-safe budget reservations.

## 6. Discovery strategy

### 6.1 Do not stop on the first known ID

The current TOPI adapter can stop as soon as it encounters a known external report ID. QEO-85 must strengthen this behavior because TOPI can reorder entries or expose non-contiguous IDs.

Daily discovery must combine:

- known external IDs;
- publish-date recency;
- page composition;
- bounded pagination.

A single known ID is not a safe boundary.

### 6.2 Safe boundary

Discovery may stop when one of these conditions is met:

- response page is shorter than the requested page size;
- max page budget is reached;
- a full page is entirely composed of already-known reports older than the recent-rescan window;
- provider explicitly returns no rows.

The implementation should keep enough recent overlap to discover changed/reordered reports instead of only collecting never-seen IDs.

### 6.3 Daily limits

Defaults:

- page size: **15**
- max pages: **8**
- maximum discovered metadata rows considered: **120**
- maximum report processing candidates per run: **20**

Reaching a safety boundary with eligible work still deferred produces a `partial` run, not `succeeded`.

## 7. Metadata idempotency and changed reports

Upsert all discovered recent records by `(provider, external_report_id)`.

The daily workflow must distinguish, for telemetry:

- new report;
- metadata changed;
- existing unchanged.

A report may need re-processing when its PDF URL/content changes even when its external ID is unchanged. The PDF content hash is the authoritative content identity for AI processing.

Old `ready` analysis data must never be deleted or hidden just because a later provider/PDF/OpenAI attempt fails.

## 8. AI idempotency and concurrency lease

### 8.1 Why the existing unique analysis constraint is insufficient

The existing canonical unique identity prevents duplicate successful rows, but two concurrent workflows can both:

1. hash the same PDF;
2. check for an existing analysis;
3. find none;
4. both spend tokens;
5. race at publish.

QEO-85 must prevent the double spend before the model call.

### 8.2 Lease identity

Acquire an analysis lease keyed by:

```text
report_id
+ content_hash
+ analysis_version
+ prompt_version
+ model_route_key
```

Acquire the lease after fetch/hash and before the first OpenAI request.

Outcomes:

- successful identical analysis already exists -> `skipped_existing`, no AI;
- active lease owned by another run -> `skipped_concurrent`, no AI;
- no active lease -> acquire and proceed;
- expired lease -> bounded takeover is allowed;
- terminal success/failure releases or terminalizes the lease according to the persistence design.

Daily and backfill share this lease table/contract.

### 8.3 Lease safety

The lease must have an expiry/heartbeat strategy so a crashed workflow cannot block the report forever. Takeover must be atomic in PostgreSQL; do not implement a read-then-write race in application code.

## 9. Report attempt ledger

Add a durable operational ledger, suggested table:

```text
market_research_report_run_items
```

Each row associates a `system_job_runs.id` with one report attempt.

Required identity:

```text
unique (run_id, report_id)
```

Suggested fields:

- `id`
- `run_id`
- `job_key`
- `report_id`
- `provider`
- `external_report_id`
- `publish_date`
- `content_hash`
- `outcome`
- `terminal_stage`
- `error_code`
- `error_message`
- `attempted_models` JSON array
- `ai_request_count`
- `input_tokens`
- `cached_input_tokens`
- `cache_write_tokens`
- `output_tokens`
- `reasoning_tokens`
- `total_tokens`
- `estimated_cost_usd`
- `pricing_version`
- `started_at`
- `finished_at`
- `duration_ms`
- `created_at`
- `updated_at`

Valid outcomes should cover at least:

- `ready`
- `skipped_existing`
- `skipped_concurrent`
- `needs_ocr`
- `unsupported`
- `failed`
- `deferred_budget`
- `deferred_report_limit`

The ledger is operational evidence, not a replacement for canonical analysis rows.

It must persist usage even when an AI request consumed tokens but the report later failed validation, retry, fallback, or publish.

## 10. OpenAI usage and pricing calculator

### 10.1 Required usage fields

Responses API usage for GPT-5.6 includes:

- `input_tokens`
- `input_tokens_details.cached_tokens`
- `input_tokens_details.cache_write_tokens`
- `output_tokens`
- `output_tokens_details.reasoning_tokens`
- `total_tokens`

QEO-85 must extend the current response inspection/audit path to persist `cache_write_tokens` as well.

`reasoning_tokens` are a subset of output tokens and are shown separately for audit. They are **not billed a second time**.

### 10.2 Pinned pricing table

Pricing must be versioned in code, not fetched at runtime.

Initial pricing version:

```text
openai-gpt-5.6-standard-2026-09-05
```

Standard API text-token rates per 1M tokens:

| Model | Input | Cached input | Cache write | Output |
| --- | ---: | ---: | ---: | ---: |
| `gpt-5.6-luna` | $0.20 | $0.02 | $0.25 | $1.20 |
| `gpt-5.6-terra` | $2.00 | $0.20 | $2.50 | $12.00 |

Cache-write price is 1.25x the uncached input rate.

For requests with **more than 272K input tokens**, apply the current GPT-5.6 long-context multiplier to the full request:

- input/cached/cache-write rates: **2x**;
- output rate: **1.5x**.

The calculator must be pure and testable.

### 10.3 Actual cost formula

Derive billable uncached input without double-counting detailed categories:

```text
uncached_input = max(0, input_tokens - cached_input_tokens - cache_write_tokens)

cost =
  uncached_input * input_rate
  + cached_input_tokens * cached_input_rate
  + cache_write_tokens * cache_write_rate
  + output_tokens * output_rate
```

Apply the long-context multiplier when the actual input token count crosses the threshold.

Persist cost as **estimated USD from API-reported usage**. It is operational estimation, not an OpenAI invoice.

### 10.4 Canonical successful analysis audit

Extend the canonical `market_research_report_analyses` audit data so successful report analysis stores:

- `cache_write_tokens`;
- populated `estimated_cost_usd`;
- populated `pricing_version`.

Existing fields remain intact.

### 10.5 Multi-request report cost

Repair, incomplete retry, and fallback requests are separate billable requests.

The report-attempt ledger must aggregate all actual usage across all attempted requests/models, including failed requests that returned a valid usage envelope.

## 11. AI request and USD budget enforcement

### 11.1 Hard limits per workflow invocation

Defaults for both daily and backfill:

- maximum report candidates processed: **20**;
- maximum actual OpenAI Responses requests: **20**;
- maximum estimated AI cost: **$1.00 USD**.

The request counter counts every provider request, including:

- initial model call;
- incomplete retry;
- validation repair;
- fallback model call.

It does not count reports.

### 11.2 Pre-request guard

Check budget **before every OpenAI request**, including repair/retry/fallback.

A provider request may begin only when both conditions hold:

- another AI request is allowed by the 20-request limit;
- a conservative worst-case reservation for the next request fits in the remaining USD budget.

### 11.3 Conservative reservation

The preflight reservation must not require an external tokenizer call.

Use a deterministic conservative upper bound for billable input based on the UTF-8 byte length of all model-visible request text (instructions, document input, and structured-output schema). Treat one byte as at most one input token for reservation purposes.

For reservation:

- price the full estimated input at the more expensive cache-write/input rate applicable to the selected model;
- reserve the configured `max_output_tokens` at the output rate;
- if the conservative input upper bound crosses 272K, apply the long-context multipliers;
- do not reserve fallback Terra while starting a Luna request, but re-run the guard using Terra rates before any fallback request.

This intentionally over-reserves rather than allowing runaway spend.

### 11.4 Actual accounting

After each response with usage data:

- calculate actual estimated USD using the pinned pricing table;
- persist/accumulate usage immediately in the run-item evidence;
- increment the actual AI request counter;
- reduce the remaining run budget.

If a provider call cannot return usage because transport failed before a response, record the request attempt but cost remains unknown/zero for estimated accounting; telemetry must distinguish this from a confirmed zero-token response.

### 11.5 Exhaustion semantics

If request-count or USD budget blocks remaining eligible work:

- mark those reports `deferred_budget` where materialized;
- set run summary `budget_exhausted=true`;
- persist `budget_reason` (`ai_request_limit` or `estimated_cost_limit`);
- finish the parent run as `partial`.

The guard is intended to prevent a request that would exceed the $1 budget under conservative reservation. `cost_overrun_usd` remains available as defensive telemetry if actual provider accounting exceeds the preflight reservation because of an unexpected billing/schema change.

## 12. Retry policy

Use bounded retry/backoff for transient failures.

### 12.1 TOPI

Retry transient transport, 429, and 5xx failures up to **3 attempts** with bounded exponential backoff.

A total TOPI discovery outage means the core workflow could not run and the parent run is `failed`.

### 12.2 PDF fetch

Retry transient transport, 429, and 5xx failures up to **3 attempts**.

A bad PDF affects that report only; continue with remaining reports.

### 12.3 OpenAI

Keep QEO-81 bounded incomplete/repair/fallback behavior, but route every provider request through the QEO-85 budget guard and usage recorder.

Provider transport/429/5xx retries must remain bounded and must not bypass the 20-request/$1 limits.

### 12.4 Non-retryable

Do not repeatedly retry within the same run:

- `needs_ocr`;
- `unsupported`;
- deterministic parse failures;
- deterministic structured-output validation failures after the existing bounded repair path.

## 13. Parent run terminal semantics

### 13.1 `succeeded`

Use `succeeded` only when:

- the core workflow ran;
- all eligible work inside the safety envelope reached a non-error terminal state;
- there is no remaining work deferred because of max pages/reports/AI calls/USD budget.

Non-error report outcomes include:

- `ready`;
- `skipped_existing`;
- `skipped_concurrent`;
- `needs_ocr`;
- `unsupported`.

### 13.2 `partial`

Use `partial` when the core workflow ran but:

- one or more reports failed; or
- eligible work remains deferred by page/report/request/cost safety limits.

One bad PDF must therefore yield `partial` while allowing other reports to publish successfully.

### 13.3 `failed`

Use `failed` when the core workflow cannot execute meaningfully, such as:

- complete TOPI provider discovery outage after bounded retry;
- database/control-plane failure that prevents required run evidence;
- workflow initialization failure that prevents processing.

A provider outage must not delete or hide previously ready reports.

## 14. Run and phase summaries

`system_job_runs.summary` should contain sanitized aggregate fields only, including:

- discovery pages fetched;
- discovered count;
- new count;
- changed count;
- existing unchanged count;
- candidate count;
- processed count;
- ready count;
- skipped-existing count;
- skipped-concurrent count;
- needs-OCR count;
- unsupported count;
- failed count;
- deferred count;
- actual AI request count;
- attempted/actual model set;
- input tokens;
- cached input tokens;
- cache-write tokens;
- output tokens;
- reasoning tokens;
- total tokens;
- estimated cost USD;
- pricing version;
- cost budget USD;
- remaining estimated budget USD;
- budget exhausted flag/reason;
- cost overrun USD when non-zero.

Do not store raw PDF text, prompt contents, provider response payloads, API keys, or secrets in run/phase summaries.

## 15. Admin catalog and scheduler reconciliation

Add `research_reports.daily` and `research_reports.backfill` to the Admin job catalog/effective catalog.

`research_reports.daily` scheduler reconciliation must verify:

- scheduler owner is Supabase `pg_cron`;
- expected cron job name is `research-reports-daily-0705-ict`;
- expected schedule is `5 0 * * *`;
- execution is daily, including weekends.

The Admin scheduler status and execution status remain separate concepts.

## 16. Admin detail UI

Generalize the existing phase timeline so it is not hard-coded to EOD only. `research_reports.daily` and `research_reports.backfill` should display phase evidence from `system_job_phases`.

Latest-run telemetry must display:

- scheduler status;
- execution status;
- duration;
- discovered/new/changed/processed/ready/failed/deferred counts;
- model(s);
- AI request count;
- input tokens;
- cached input tokens;
- cache-write tokens;
- output tokens;
- reasoning tokens;
- total tokens;
- estimated USD;
- pricing version;
- $1 budget used/remaining;
- budget exhausted/reason;
- cost overrun when present.

The UI must clearly label cost as estimated from API usage.

## 17. Backfill contract

### 17.1 Parameters

`research_reports.backfill` accepts:

- `fromDate?: YYYY-MM-DD`
- `toDate?: YYYY-MM-DD`
- `maxReports: integer`

Defaults:

- `maxReports = 20`

Hard validation:

- `1 <= maxReports <= 100`;
- `fromDate <= toDate` when both are provided;
- maximum date span is **90 days**;
- invalid/malformed dates are rejected;
- confirmation is required;
- valid Admin change reason is required.

### 17.2 Backfill budgets

A backfill request with `maxReports=100` does **not** authorize 100 model calls.

Each invocation still uses:

- max 20 actual OpenAI requests;
- max $1 estimated AI spend;
- the same content-hash identity and analysis lease.

If more reports remain, the run becomes `partial` and the operator can explicitly launch another bounded backfill.

## 18. Security

- machine route uses the existing machine-auth boundary;
- scheduler credentials remain in Supabase Vault;
- Root Admin is required for manual backfill;
- backfill requires explicit confirmation and reason;
- service-role-only functions own privileged scheduler/lease mutations;
- errors and summaries are sanitized before persistence;
- no raw provider payload/PDF text/prompt/API key appears in Admin telemetry;
- RLS/grants follow the existing research-report and control-plane patterns.

## 19. Database changes

QEO-85 is expected to require a reviewed migration for:

1. report-attempt ledger;
2. analysis-identity lease/acquire function;
3. `cache_write_tokens` on canonical analysis audit if not already present;
4. scheduler trigger function and `pg_cron` schedule;
5. indexes/constraints/RLS/grants required by the new tables/functions.

Use the repository's current reviewed/pending-migration workflow and regenerate database types as required by DB Drift.

Do not alter QEO-80/QEO-81 canonical uniqueness in a way that weakens existing idempotency.

## 20. Testing strategy

Implementation follows TDD.

Required automated coverage:

1. scheduler is exactly 07:05 ICT / `5 0 * * *` and includes weekends;
2. scheduler trigger reads URL/secret from Vault and does not embed credentials;
3. discovery survives provider reorder and does not stop at one known ID;
4. max 8 pages / 120 discovered rows is enforced;
5. repeated identical run causes zero second AI spend;
6. concurrent daily/backfill lease prevents double AI spend;
7. expired lease can be safely reclaimed;
8. pricing calculator covers Luna and Terra;
9. cached input and cache-write tokens are priced separately;
10. reasoning tokens are exposed but not double-billed;
11. >272K input applies long-context multipliers;
12. repair/incomplete/fallback requests aggregate token/cost usage;
13. actual OpenAI request count includes retries/repair/fallback;
14. 20-request guard blocks request 21;
15. $1 reservation guard blocks a request that cannot safely fit;
16. one failed PDF produces `partial` while other reports reach `ready`;
17. total TOPI outage produces `failed` and preserves old ready data;
18. `needs_ocr`/`unsupported` are non-error terminal outcomes and not retried in-run;
19. backfill date/range/maxReports validation;
20. backfill requires confirmation/reason and writes Admin audit evidence;
21. Admin catalog/scheduler reconciliation recognizes the daily job;
22. Admin detail renders phase/model/token/cost/budget evidence without sensitive payloads.

## 21. Required smoke fixture

Use a deterministic smoke fixture containing:

- 2 new reports;
- 1 existing identical report;
- 1 report whose PDF processing fails.

Expected first-run behavior:

- 2 new reports become ready when within budget;
- existing report is `skipped_existing` with zero AI spend;
- failed report records report-level error;
- parent run is `partial`;
- aggregate model/token/cost telemetry equals the successful/failed provider calls actually made.

Run the same fixture again.

Expected second-run behavior:

- previously ready identical reports do not re-spend AI tokens;
- existing identical report remains skipped;
- only retry-eligible failed work may consume new provider budget;
- no duplicate canonical analysis rows are created.

## 22. Verification and rollout gates

Before merge:

- targeted QEO-85 tests pass;
- full TypeScript/build/lint verification passes;
- DB Drift Reconciliation passes because QEO-85 changes migration/database types;
- PR diff contains no QEO-83 catalog/detail scope and no QEO-86 AI Council selection logic;
- scheduler source/config/reconciliation all agree on 07:05 ICT daily;
- pricing version and rates are tested and visible in Admin telemetry;
- repeated/concurrent idempotency tests prove no double AI spend.

QEO-87 remains responsible for the broader research-report E2E quality gate and production rollout. QEO-85 should provide the deterministic workflow and smoke-test hooks QEO-87 will consume.

## 23. Acceptance criteria mapping

| QEO-85 criterion | Design response |
| --- | --- |
| 07:05 ICT daily | Supabase `pg_cron` `5 0 * * *` |
| Same data twice does not duplicate/re-spend | content-hash identity + pre-AI lease + tests |
| One PDF fails, others finish | report isolation + parent `partial` |
| Provider outage telemetry, old data preserved | parent `failed` only for core outage; no destructive rollback |
| Correct run/phases success/partial/failure | explicit terminal-state rules |
| Admin model/token/cost | run-item usage ledger + pricing calculator + generalized phase UI |
| Safety max pages/reports/AI calls | 8 pages / 20 candidates / 20 actual AI requests |
| Cost safety | conservative pre-request reservation + $1/run ceiling |
| Manual/backfill tested/idempotent | separate confirmed job using same core/lease/budget |
| Smoke 2 new + 1 existing + 1 failed | mandatory deterministic fixture + rerun assertion |

## 24. Out of scope

- research report catalog/detail feature work from QEO-83/QEO-84;
- AI Council selection/ranking/evidence injection from QEO-86;
- broad production rollout/E2E ownership from QEO-87;
- OCR implementation;
- unbounded historical crawl;
- report processing concurrency optimization;
- live remote pricing lookup.
