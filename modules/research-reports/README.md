# research-reports module

## Contract

- Owns third-party research-report metadata normalization, secure PDF ingestion, page-local text extraction/chunking, grounded structured AI analysis, and persistence boundaries.
- TOPI transport is isolated behind `providers/topi.ts`; callers consume normalized `ResearchReportSourceRecord` values.
- Metadata persistence is idempotent on `(provider, external_report_id)` and intentionally does not overwrite PDF content hashes or AI-analysis state.
- PDF ingestion is HTTPS/allowlist/bounded and produces a stable content hash; text-native documents are parsed page-by-page and image-only/insufficient-text documents terminate as `needs_ocr` without an AI call.
- AI processing treats report text as untrusted data, validates strict structured output plus page-grounded ticker evidence, and uses route-aware analysis identity.
- Successful processing publishes chunks, analysis, ticker mentions, and terminal report status through one atomic service-role RPC. Failed processing updates only the current report state and does not delete prior successful evidence.
- Broker recommendations, stances, and target prices remain source opinions. They are not verified company facts.
- OCR implementation, Q&A/vector search, scheduler orchestration, UI consumption, and AI Council report selection remain separate follow-up responsibilities.

Cross-domain callers should import `processResearchReport` and public types from `modules/research-reports/index.ts` instead of provider, prompt, PDF, or OpenAI internals.
