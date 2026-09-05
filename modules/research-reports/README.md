# research-reports module

## Contract

- Owns third-party research-report metadata normalization, secure PDF ingestion, page-local text extraction/chunking, grounded structured AI analysis, persistence boundaries, grounded single-report Q&A, the browser-safe report-detail read model, QEO-85 daily/backfill orchestration, and the QEO-86 bounded AI Council evidence-selection boundary.
- TOPI transport is isolated behind `providers/topi.ts`; callers consume normalized `ResearchReportSourceRecord` values. Discovery is bounded, tolerates reordered/non-contiguous provider IDs, supports explicit backfill dates, and retries only transient provider failures.
- Metadata persistence is idempotent on `(provider, external_report_id)` and intentionally does not overwrite PDF content hashes or AI-analysis state.
- PDF ingestion is HTTPS/allowlist/bounded and produces a stable content hash; text-native documents are parsed page-by-page and image-only/insufficient-text documents terminate as `needs_ocr` without an AI call.
- AI processing treats report text as untrusted data, validates strict structured output plus page-grounded ticker evidence, and uses route-aware analysis identity.
- Successful processing publishes chunks, analysis, ticker mentions, and terminal report status through one atomic service-role RPC. Failed processing updates only the current report state and does not delete prior successful evidence.
- A pre-AI analysis lease serializes identical `(report, content hash, analysis version, prompt version, model route)` work across overlapping workflows. A successful identical rerun is skipped before AI spend.
- Each daily/backfill run has a cumulative safety budget of at most 20 OpenAI request attempts and USD 1 estimated cost. Request-level audit includes fallback, incomplete retry, validation repair, and unknown/lost-response usage without fabricating cost.
- Report-level transient failures are retried a bounded number of times. `needs_ocr` and `unsupported` are deterministic terminal outcomes and are never placed in an infinite retry loop.
- QEO-85 daily automation is owned by Supabase `pg_cron` `research-reports-daily-0705-ict` at `5 0 * * *` UTC (07:05 ICT every calendar day). The cron calls authenticated `POST /api/research-reports/daily`, which starts the durable workflow; Vercel Cron is not the schedule owner.
- `research_reports.daily` is scheduler-only. `research_reports.backfill` is a separate Root Admin confirmed recovery action with a required change reason, optional explicit `fromDate/toDate` range bounded to 90 days, and `maxReports` bounded to 1–100. Backfill uses the same hash identity, lease, AI budget, and publication rules and has no `force` idempotency bypass.
- Durable operational evidence is written to `system_job_runs`, the six aggregate phases `DISCOVER`, `UPSERT_METADATA`, `FETCH_PARSE`, `AI_ANALYZE`, `PUBLISH`, `FINALIZE`, plus `market_research_report_run_items`. Parent runs can finish `partial` while isolated report failures continue through the batch.
- Admin reads scheduler reconciliation plus run summaries, including discovered/new/changed/processed/failed/deferred counts, duration, model(s), input/output/reasoning/total tokens, estimated cost, and unknown-usage attempts.
- Grounded single-report Q&A reads only the current report content hash and the chunk version from the latest successfully published analysis for that hash.
- The authenticated API uses a server-side service-role lexical RPC; browser clients do not invoke privileged retrieval directly.
- Page/chunk citations are projected from canonical retrieved evidence after fail-closed runtime validation.
- Chat history is request-scoped and bounded; there is no persistent chat storage.
- Broker recommendations, stances, forecasts, valuations, and target prices are SOURCE OPINION. They are not verified company facts and cannot override deterministic AI Council authority.
- Detail UI reads only browser-safe metadata, current persisted analysis, and ticker evidence; it does not expose raw `pdf_url`, provider payloads, or chunks.
- PDF bytes are served only through authenticated `GET /api/research-reports/[id]/pdf`, which resolves the stored report URL server-side and reuses the existing secure PDF fetch policy.
- Analysis, ticker, and Q&A citations share one page-navigation contract into the single-page PDF.js viewer.
- Detail-page load never triggers AI analysis or Q&A; the page renders persisted state only, and chat remains request-scoped/non-persistent.

## QEO-86 AI Council evidence

- Council selection is deterministic, bounded, and point-in-time: ticker evidence is limited to the newest eligible reports within the approved window, market evidence is separately bounded, and only analyses that existed by the Council `runAt` are eligible.
- The Council boundary consumes curated report metadata and grounded analysis only. It never invokes TOPI/PDF ingestion and never sends raw PDF chunks to the Council prompt.
- Before any report evidence can enter the advisory LLM prompt, the exact selection is frozen per Council run as an immutable snapshot with one of `ready`, `empty`, or `unavailable` status.
- Same-run retries reuse the frozen snapshot. Historical Debate UI reads that historical snapshot and never recomputes the selector against newer Research Reports.
- Persisted `ready` and `empty` snapshots participate in prompt identity through their frozen context hash. `unavailable` or unpersisted evidence does not perturb prompt identity and is omitted from prompt evidence.
- Research Report evidence remains advisory SOURCE OPINION. Contradictions with deterministic price, trend, liquidity, flow, Wyckoff, or risk evidence must be surfaced rather than silently resolved in favor of broker narrative.
- QEO-86 keeps the snapshot migration pending and quarantined. QEO-87 owns migration promotion, generated Database types, rollout verification, and production activation.
- OCR implementation and vector search/embeddings remain separate follow-up responsibilities.

Cross-domain callers should import `processResearchReport`, `answerResearchReportQuestion`, `ResearchReportQaError`, `getResearchReportDetail`, `selectCouncilReportEvidence`, and public types from `modules/research-reports/index.ts` instead of provider, prompt, PDF, retrieval, repository, Council-selector, or OpenAI internals.
