# research-reports module

## Contract

- Owns third-party research-report metadata normalization and persistence boundaries.
- TOPI transport is isolated behind `providers/topi.ts`; callers consume normalized `ResearchReportSourceRecord` values.
- Metadata persistence is idempotent on `(provider, external_report_id)` and intentionally does not overwrite PDF content hashes or AI-analysis state.
- Broker recommendations and target prices remain source opinions. They are not verified company facts.
- PDF download/parsing, AI analysis, Q&A, scheduler orchestration, and AI Council selection are separate follow-up responsibilities.

Cross-domain callers should import from `modules/research-reports/index.ts` instead of provider internals.
