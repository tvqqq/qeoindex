# research-reports module

## Contract

- Owns third-party research-report metadata normalization, secure PDF ingestion, page-local text extraction/chunking, grounded structured AI analysis, persistence boundaries, grounded single-report Q&A, and the browser-safe report-detail read model.
- TOPI transport is isolated behind `providers/topi.ts`; callers consume normalized `ResearchReportSourceRecord` values.
- Metadata persistence is idempotent on `(provider, external_report_id)` and intentionally does not overwrite PDF content hashes or AI-analysis state.
- PDF ingestion is HTTPS/allowlist/bounded and produces a stable content hash; text-native documents are parsed page-by-page and image-only/insufficient-text documents terminate as `needs_ocr` without an AI call.
- AI processing treats report text as untrusted data, validates strict structured output plus page-grounded ticker evidence, and uses route-aware analysis identity.
- Successful processing publishes chunks, analysis, ticker mentions, and terminal report status through one atomic service-role RPC. Failed processing updates only the current report state and does not delete prior successful evidence.
- Grounded single-report Q&A reads only the current report content hash and the chunk version from the latest successfully published analysis for that hash.
- The authenticated API uses a server-side service-role lexical RPC; browser clients do not invoke privileged retrieval directly.
- Page/chunk citations are projected from canonical retrieved evidence after fail-closed runtime validation.
- Chat history is request-scoped and bounded; there is no persistent chat storage.
- Broker recommendations, stances, and target prices remain source opinions. They are not verified company facts.
- Detail UI reads only browser-safe metadata, current persisted analysis, and ticker evidence; it does not expose raw `pdf_url`, provider payloads, or chunks.
- PDF bytes are served only through authenticated `GET /api/research-reports/[id]/pdf`, which resolves the stored report URL server-side and reuses the existing secure PDF fetch policy.
- Analysis, ticker, and Q&A citations share one page-navigation contract into the single-page PDF.js viewer.
- Detail-page load never triggers AI analysis or Q&A; the page renders persisted state only, and chat remains request-scoped/non-persistent.
- OCR implementation, vector search/embeddings, scheduler orchestration, catalog ownership, and AI Council report selection remain separate follow-up responsibilities.

Cross-domain callers should import `processResearchReport`, `answerResearchReportQuestion`, `ResearchReportQaError`, `getResearchReportDetail`, and public types from `modules/research-reports/index.ts` instead of provider, prompt, PDF, retrieval, repository, or OpenAI internals.
