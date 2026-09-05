# research-reports module

## Contract

- Owns third-party research-report metadata normalization, secure PDF ingestion, page-local text extraction/chunking, grounded structured AI analysis, persistence boundaries, and grounded single-report Q&A.
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
- OCR implementation, vector search/embeddings, scheduler orchestration, UI consumption, and AI Council report selection remain separate follow-up responsibilities.

Cross-domain callers should import `processResearchReport`, `answerResearchReportQuestion`, `ResearchReportQaError`, and public types from `modules/research-reports/index.ts` instead of provider, prompt, PDF, retrieval, or OpenAI internals.
