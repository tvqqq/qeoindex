# QEO-81 — Research Report PDF Ingestion + AI Structured Analysis Design

Date: 2026-09-04
Issue: QEO-81
Parent: QEO-79
Depends on: QEO-80

## 1. Goal

Implement the report-processing stage that starts from normalized report metadata and produces auditable, page-grounded AI analysis suitable for later UI, Q&A, scheduler, and AI Council consumption.

Canonical processing flow:

`report metadata → secure PDF fetch → SHA-256 content hash → page text extraction → page-aware chunks → structured AI extraction → runtime validation → atomic persistence`

This design intentionally excludes user-facing pages, chat Q&A, cron orchestration, and AI Council consumption.

## 2. Architectural position

QEO-81 extends the `modules/research-reports` domain created by QEO-80. Third-party PDF handling and AI extraction remain internal to this module. Cross-domain consumers must continue to import only stable public entrypoints from `modules/research-reports/index.ts`.

The implementation is a stacked change on top of QEO-80 so the dependency is explicit. After QEO-80 merges, QEO-81 can be retargeted to `main` without changing its runtime design.

Expected internal structure:

```text
modules/
├── ai/
│   └── openai-response.ts
└── research-reports/
    ├── pdf/
    │   ├── secure-fetch.ts
    │   ├── parse.ts
    │   └── chunk.ts
    ├── analysis/
    │   ├── schema.ts
    │   ├── prompt.ts
    │   ├── openai.ts
    │   └── pipeline.ts
    ├── repository.ts
    └── index.ts
```

Only truly generic OpenAI response-envelope / usage parsing moves into `modules/ai/*`. AI Council-specific routing, fallback policy, debate semantics, evidence validation, and pricing policy remain under `modules/ai-council`.

## 3. PDF ingestion contract

### 3.1 Source URL validation

The fetcher accepts only the `pdf_url` already persisted for a report. It must fail closed before network access unless all conditions hold:

- scheme is `https`;
- host is on an explicit allowlist for approved report-CDN/provider hosts;
- credentials are absent from the URL;
- IP-literal, localhost, loopback, private-network, link-local, and metadata-service targets are rejected;
- redirect count is bounded;
- every redirect target is revalidated against the same rules.

The allowlist is configuration, not business logic embedded in parser code. The initial configured host set must include the actual TOPI/Wigroup CDN host required by QEO-79 fixtures, while remaining overrideable through environment/runtime configuration.

### 3.2 Download limits

The fetcher enforces:

- bounded request timeout;
- bounded redirect count;
- bounded maximum byte size;
- `application/pdf` content type, with a narrowly defined compatibility fallback only when the body has a valid PDF signature;
- streaming or bounded buffering so oversized files are rejected without retaining arbitrary unbounded content.

The result returns immutable bytes plus download metadata needed for audit. It never returns an arbitrary remote response object to downstream code.

### 3.3 Content identity

Immediately after download, compute SHA-256 over the exact PDF bytes. This `content_hash` is the content identity used for parsing and AI idempotency.

Provider metadata changes do not invalidate existing analysis when the PDF bytes are unchanged.

## 4. Page-aware PDF parsing

Use a local PDF parser based on PDF.js (`pdfjs-dist`) for text-native PDFs. The parser must extract pages in ascending page-number order and return a stable shape such as:

```ts
interface ParsedReportPage {
  pageNumber: number
  text: string
}
```

Whitespace may be normalized for readability, but the parser must avoid transformations that silently rewrite numbers, decimal separators, percentages, currency values, or table-like text.

The parser does not claim OCR capability in QEO-81.

### 4.1 Usable-text gate and status mapping

After parsing, classify the document:

- `parsed` when text volume/distribution is sufficient for grounded analysis;
- `needs_ocr` when pages exist but usable text is effectively absent or clearly image-only;
- `unsupported` for parser-level document shapes that cannot be handled reliably;
- `failed` for operational errors such as download/parser exceptions.

No AI call is allowed for `needs_ocr`, `unsupported`, or `failed` documents.

QEO-80's pending schema does not currently include `needs_ocr`. QEO-81 therefore adds a narrowly scoped pending schema delta so `market_research_reports.ingestion_status` accepts `needs_ocr`. For a scanned/image-only report:

- `ingestion_status = 'needs_ocr'`;
- `analysis_status = 'unsupported'` for QEO-81, because no supported analysis path is available yet;
- the record remains eligible for a future OCR/vision feature to explicitly reprocess it.

This is a product state, not an operational exception, so it must not enter an infinite retry loop.

## 5. Chunking contract

Chunks are retrieval/evidence units, not arbitrary token slices. Every chunk keeps:

- `report_id`;
- `content_hash`;
- `page_number`;
- deterministic `chunk_index` within the page;
- normalized text;
- `chunk_hash`;
- `chunk_version`.

Chunking must never merge text from two pages into one chunk. This keeps page citations deterministic for QEO-81 and prepares QEO-82 Q&A without requiring a redesign.

QEO-81 adds `chunk_version` to the pending schema before the report schema is promoted to production. Chunk generation is deterministic for a fixed chunk version. A future material chunking change increments the version rather than silently overwriting evidence identity.

## 6. Structured AI analysis

### 6.1 Output shape

The model returns strict structured data containing at minimum:

- `executive_summary`;
- `key_points[]`;
- `market_view` / `sector_outlook` when explicitly supported by the report;
- `catalysts[]`;
- `risks[]`;
- `ticker_mentions[]` with:
  - `ticker`;
  - `stance`: `positive | negative | neutral | mixed`;
  - optional recommendation text;
  - optional target price;
  - optional target currency;
  - concise rationale;
  - evidence references containing page numbers and short evidence snippets;
- confidence / data-quality flags.

The API request uses strict JSON-schema structured output. Runtime validation still runs after provider schema validation so repository-specific evidence invariants are enforced before persistence.

### 6.2 Evidence invariants

For every ticker mention:

- recommendation text derived from report body requires page evidence;
- target price derived from report body requires page evidence;
- stance requires at least one supporting page reference;
- cited page numbers must exist in the parsed document;
- evidence snippets must be short and grounded in the cited page text;
- target price is `null` when absent; the model must never infer or synthesize one;
- currency is `null` when not stated or not safely derivable from the cited report text.

Provider metadata from QEO-80 may remain available separately as `topi_metadata` evidence. It must not be silently presented as report-body extraction.

### 6.3 Prompt-injection boundary

PDF text is untrusted document content. System/developer extraction instructions explicitly state that document text cannot change tools, policies, output schema, allowed evidence, or task instructions.

The model receives only the document content required for the extraction task and no unnecessary secrets. QEO-81 persists final structured conclusions and evidence, not hidden chain-of-thought.

## 7. Model route and shared AI infrastructure

The research-report model is configurable through environment/runtime configuration. The database stores requested and actual response model values but does not encode a model ID as a data-schema invariant.

QEO-81 introduces a small shared `modules/ai/openai-response.ts` boundary only for generic response-envelope concerns such as:

- response ID;
- actual response model;
- input/cached/output/reasoning/total token usage;
- incomplete-response inspection where generic;
- safe structured-output text extraction if it is provider-generic.

Existing AI Council imports are updated with regression coverage so its observable behavior is unchanged.

Pricing logic is shared only if the existing implementation can be extracted without importing Council-specific policy. Otherwise QEO-81 persists token telemetry and a nullable cost field until a genuinely shared pricing boundary is introduced.

## 8. Idempotency and versioning

The successful-analysis identity is:

`report_id + content_hash + analysis_version + prompt_version + requested_model_route`

Before calling AI, the pipeline checks whether a successful analysis already exists for that identity. If yes, the pipeline returns the existing result and performs zero additional AI calls.

Reprocessing is intentional when any of these change:

- PDF `content_hash`;
- `analysis_version`;
- `prompt_version`;
- configured requested model route.

A metadata-only refresh with unchanged `content_hash` does not trigger AI reprocessing.

## 9. Persistence and consistency

QEO-80 already defines report, analysis, ticker-mention, and chunk tables. QEO-81 uses those contracts and adds only the schema changes explicitly required by this design: `needs_ocr`, `chunk_version`, and the atomic publish function described below.

Persistence order:

1. download and hash outside the database transaction;
2. parse and build deterministic chunks;
3. check successful-analysis idempotency;
4. call AI when required;
5. validate structured output and citations;
6. atomically publish content hash, chunks, analysis, ticker mentions, and terminal report statuses through one service-role-only Postgres RPC transaction;
7. return the published analysis identity to the caller.

The RPC is the only path that publishes a successful analysis bundle. It must:

- run in one database transaction;
- use the existing unique constraints as idempotency backstops;
- reject mismatched `report_id`/`content_hash` inputs;
- write chunks, analysis, and ticker mentions consistently;
- update the report's terminal ingestion/analysis status only after all analysis evidence writes succeed;
- be executable by `service_role` only; authenticated clients remain read-only.

Operational stage/status updates before final publication may use ordinary server-side repository writes, but they must never make an incomplete analysis appear `ready`.

A failed report must not corrupt previously successful analysis rows. A retry may resume from durable content/chunk state when identity matches.

## 10. Retry and failure policy

Retries are bounded and classified.

Retryable examples:

- transient provider/CDN 429/5xx;
- network timeout/abort;
- transient AI 429/5xx;
- supported incomplete structured response where the existing generic bounded-output retry contract applies.

Non-retryable examples:

- disallowed PDF host/scheme;
- oversized file;
- invalid document type;
- scanned document requiring OCR;
- structured output that repeatedly violates evidence invariants after one bounded repair attempt.

No infinite retry is allowed inside the report pipeline.

## 11. Telemetry

For each AI analysis attempt persist or return enough data for the existing Admin usage aggregation pattern:

- requested model;
- actual response model;
- response ID;
- input tokens;
- cached input tokens;
- output tokens;
- reasoning tokens;
- total tokens;
- latency;
- nullable estimated cost;
- pricing version when a shared pricing implementation is available;
- prompt version;
- analysis version.

Operational errors are truncated/sanitized before persistence and must not include API keys or full sensitive request bodies.

## 12. Testing strategy

QEO-81 is implemented test-first.

Required tests:

1. Text-native multi-page fixture parses in page order with stable page numbers.
2. Empty/image-only fixture returns `needs_ocr`, maps analysis to unsupported, and makes zero AI calls.
3. URL validation rejects non-HTTPS, unapproved hosts, IP/private-network targets, and unsafe redirects.
4. Fetch rejects excessive size and invalid content type/signature.
5. Chunking never crosses page boundaries, is deterministic, and carries `chunk_version`.
6. Strict structured schema rejects malformed field shapes.
7. Ticker stance/recommendation/target extracted from report body requires valid page evidence.
8. Missing target price remains `null`.
9. Citation page outside the parsed page set is rejected.
10. Evidence snippet not grounded in cited page text is rejected.
11. Prompt-injection text embedded in the PDF remains document data and does not alter extraction instructions/output contract.
12. Second run with identical content/version/model route performs zero additional AI calls.
13. Atomic publish rollback prevents a partial analysis bundle from becoming visible/ready.
14. One report failure leaves previously successful records valid and retryable.
15. AI Council regression tests pass after shared OpenAI helper extraction.
16. RLS/RPC contracts prove authenticated users cannot execute the publish function.
17. TypeScript, touched lint, current contracts, production build, DB drift/replay/contracts remain green as applicable.

Fixtures should be synthetic or repository-safe. Do not commit copyrighted third-party research PDFs unless the repository is licensed to redistribute them.

## 13. Acceptance mapping

- Page ordering/citations: sections 4, 5, 6.2, test cases 1/7/9/10.
- Structured-schema rejection: section 6, test case 6.
- No target hallucination: section 6.2, test case 8.
- Scanned/empty PDF graceful failure: section 4.1, test case 2.
- Bounded retry and isolated report failure: sections 9–10, test case 14.
- Zero-cost rerun for identical identity: section 8, test case 12.
- Token/model/cost telemetry compatibility: section 11.
- Prompt-injection defense: section 6.3, test case 11.
- Atomic evidence publication: section 9, test cases 13/16.

## 14. Out of scope

- OCR/vision fallback implementation;
- report catalog/detail UI;
- in-report Q&A;
- daily scheduler/backfill orchestration;
- AI Council report selection/consumption;
- semantic embeddings/vector retrieval.

These remain owned by later QEO-79 child issues.
