# QEO-86 AI Council Research Report Evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Feed bounded, point-in-time Research Report evidence into every AI Council ticker's advisory LLM debate, freeze exact immutable provenance per Council run, and expose related-report links without changing deterministic Council authority.

**Architecture:** The Research Reports module owns deterministic selection from canonical report/analysis/mention rows. AI Council load-or-freezes one immutable snapshot per `ai_council_runs.id`, attaches only successfully persisted/reused `ready` or `empty` evidence to the first-class LLM packet, and incorporates the snapshot hash into a versioned LLM prompt identity while leaving `ai_council_runs.evidence_hash` unchanged. Historical debate audit/UI reads the frozen snapshot instead of recomputing current report state.

**Tech Stack:** Next.js 16.3, React 19, TypeScript 5.7, Supabase/PostgreSQL, OpenAI Responses-based AI Council router, Node test runner, pnpm 10.28.

**Spec:** `docs/superpowers/specs/2026-09-05-qeo-86-ai-council-research-report-evidence-design.md`

## Global Constraints

- Research Report evidence applies to **all AI Council tickers**; do not inherit the Notion `MSN` pilot gate.
- Ticker-specific selector default: max **3 reports / 90 days**.
- Macro/Strategy selector default: max **2 reports / 30 days**.
- Final Research Reports prompt payload: max **5 deduped reports** and approximately **10,000 characters total**.
- Selection is deterministic; no embedding, vector search, or LLM ranking.
- Eligibility requires `report.publish_date <= asOf`, `report.created_at <= runAt`, `analysis.processed_at <= runAt`, and ticker mention `created_at <= runAt` when ticker-specific.
- Historical evidence is keyed to exact `analysis_id + content_hash + analysis_version + prompt_version + model_route_key`; never replay from mutable `market_research_reports.content_hash`.
- Same `run_id` retry must reuse the existing snapshot without re-running selectors.
- Research Report evidence may enter an LLM prompt only after the corresponding snapshot has been successfully persisted or reused.
- Snapshot persistence failure fails open for Council execution but **must omit Research Report evidence** from the prompt.
- `ready` and `empty` persisted snapshots participate in LLM prompt identity; persisted `unavailable` and unpersisted failure states do not.
- Broker recommendations/targets are always `SOURCE OPINION`, not verified company facts.
- Contradictory broker narrative must be surfaced as contradiction; it cannot upgrade/downgrade deterministic signal, score, or risk veto.
- `ai_council_runs.evidence_hash` remains unchanged.
- Prompt identity contract version becomes `prompt-identity-v2-report-evidence`; do not silently change v1 semantics.
- Because the LLM packet/instructions change, bump `AI_COUNCIL_LLM_PROMPT_VERSION` from `llm-debate-v3-first-class-context` to `llm-debate-v4-research-report-evidence`.
- AI Council runtime must not import/call TOPI, PDF fetch, PDF parse, or Research Reports ingestion.
- Do not put raw/full PDF text or `market_research_report_chunks.content` into Council prompt or snapshot.
- QEO-80/85 Research Reports schema remains **quarantined** until QEO-87 rollout. QEO-86's snapshot SQL therefore stays under `supabase/pending-migrations/` and is not promoted into active `supabase/migrations/` here.
- `supabase db reset` and generated DB types reflect only active migrations. **Do not hand-edit or regenerate `modules/shared/supabase/database.types.ts` to include the pending QEO-86 table.** QEO-87 owns promotion and resulting generated-type change.
- Full Verify and DB Drift Reconciliation must pass on the final PR head; DB Drift must confirm the active migration ledger/types remain unchanged while the pending SQL contract is source-tested.

---

Implementation status is tracked by Git commits and PR checks. The approved task structure remains selector → snapshot → all-ticker hydration → prompt identity/semantics → dashboard/UI → boundary/docs → final verification.
