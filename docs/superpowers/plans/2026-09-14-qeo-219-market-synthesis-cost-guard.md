# QEO-219 Market Synthesis Cost Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore Market Synthesis under the existing $0.03 per-run model budget after leadership evidence expanded, without weakening cost enforcement or EOD fault isolation.

**Architecture:** Keep the existing Terra model and hard cost cap. Bound leadership evidence with a deterministic category-balanced sampler, bump the prompt contract, and add a pure cost planner that reserves request-envelope input overhead then derives an affordable `max_output_tokens`. Persist sanitized preflight telemetry inside the existing immutable evidence manifest so production failures are diagnosable without adding a schema migration.

**Tech Stack:** TypeScript, Node test runner, Supabase Edge Functions/Responses API, GitHub Actions.

**Spec:** Linear QEO-219.

## Global Constraints

- Preserve `MAX_COST_USD = 0.03`; do not raise the budget.
- Preserve EOD fault isolation: Market Synthesis failure must not break canonical publish or the rest of AI Council.
- Keep Edge Function machine authentication and idempotent claim semantics unchanged.
- No secrets or secret-bearing values in telemetry.
- Source changes happen on the QEO-219 feature branch; production release remains merge-once-to-`main`.

---

### Task 1: RED coverage for bounded leadership and cost planning

**Files:**
- Modify: `tests/market-ai-conclusion.test.ts`
- Create later in Task 2: `supabase/functions/_shared/market-ai-cost-guard.ts`

**Interfaces:**
- Consumes: existing `buildMarketAiEvidencePacket()` from app + Edge shared contracts.
- Produces: expected `planMarketAiCostGuard()` behavior and a category-balanced bounded leadership packet contract.

- [ ] **Step 1: Add a 30-leader fixture covering `index_down`, `index_up`, and `top_volume`.**
- [ ] **Step 2: Assert the packet keeps all three categories while bounding leadership facts to 12.**
- [ ] **Step 3: Add a RED import/assertion for `planMarketAiCostGuard()` proving a Sep-14-sized prompt at Terra $2/$12 stays at or below $0.03 by reducing output tokens rather than rejecting the run.**
- [ ] **Step 4: Push the test-only commit and confirm GitHub Actions fails for the expected missing behavior/helper.**

### Task 2: Implement deterministic bounded evidence + budget planner

**Files:**
- Modify: `modules/research/market-insight/ai-conclusion.ts`
- Modify: `supabase/functions/_shared/market-ai-conclusion.ts`
- Create: `supabase/functions/_shared/market-ai-cost-guard.ts`
- Modify: `supabase/functions/market-ai-conclusion/index.ts`

**Interfaces:**
- Produces: `planMarketAiCostGuard({ promptChars, requestedMaxOutputTokens, inputTokenReserve, maxCostUsd, pricing })` returning prompt estimate, guarded input estimate, selected output cap, and preflight estimated cost.
- Produces: category-balanced leader selection with max 12 facts, filling unused category quota deterministically when fewer categories are available.

- [ ] **Step 1: Implement balanced leader selection in both packet builders and bump `MARKET_AI_PROMPT_VERSION` from v9 to v10.**
- [ ] **Step 2: Implement pure cost planner using the existing `ceil(prompt.length / 3)` estimate plus a fixed 700-token request-envelope reserve.**
- [ ] **Step 3: Derive `max_output_tokens` from remaining budget, capped by the existing 1,800-token ceiling; fail closed only when the affordable output floor is below 1,200 tokens.**
- [ ] **Step 4: Pass the planned output cap into the Responses API call and keep post-call actual-cost validation unchanged.**
- [ ] **Step 5: Add sanitized `costGuard` telemetry to the claimed evidence manifest: model, configured rates, budget, prompt chars/token estimate, reserve, requested/selected output cap, and preflight estimate.**

### Task 3: Contract and documentation updates

**Files:**
- Modify: `tests/market-ai-conclusion.test.ts`
- Modify: `docs/HANDOVER.md` only if the active operational contract currently documents Market Synthesis internals that materially change.

- [ ] **Step 1: Update static Edge Function contract assertions for dynamic `max_output_tokens`, v10 prompt, and cost telemetry.**
- [ ] **Step 2: Keep app/Edge packet byte-equivalence test green.**
- [ ] **Step 3: Review active docs and update only if required; do not rewrite historical plans.**

### Task 4: Exact-head CI and production acceptance

**Files:**
- No additional source files unless CI reveals a real regression.

- [ ] **Step 1: Push implementation and wait for exact-head `Verify` plus relevant EOD/DB workflows.**
- [ ] **Step 2: Review PR diff for scope, secrets, and unchanged $0.03 budget.**
- [ ] **Step 3: Merge once to `main` only after green CI.**
- [ ] **Step 4: Deploy the updated `market-ai-conclusion` Edge Function to production because Edge Function source changed.**
- [ ] **Step 5: Manually dispatch the 2026-09-14 session against prompt v10; verify a new terminal row succeeds under $0.03 with populated input/output/cost and `costGuard` preflight telemetry.**
- [ ] **Step 6: Verify canonical EOD data remains intact and no duplicate Council/publish side effects occur.**
- [ ] **Step 7: Record production evidence in QEO-219 and mark Done only if acceptance is met.**
