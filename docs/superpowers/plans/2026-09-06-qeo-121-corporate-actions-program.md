# QEO-121 Corporate Actions Program Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver free-source corporate-action ingestion, deterministic adjustment factors, EOD v4 activation/maintenance, atomic adjusted-Daily consumer cutover and Stock Detail event UX without mixing price bases or adding a new EOD business phase.

**Architecture:** Execute each subsystem through its own review/production gate. The dependency chain is intentionally linearized: source evidence → normalized actions → factors → adjusted-Daily shadow → EOD maintenance/activation → canonical consumer cutover → chart/tab UX acceptance.

**Tech Stack:** TypeScript/Next.js, Supabase/PostgreSQL, Vercel Workflow, Lightweight Charts.

**Spec:** `docs/superpowers/specs/2026-09-06-corporate-actions-adjusted-chart-design.md`

## Global Constraints

- Do not implement paid FiinGroup before QEO-122 free-source NO-GO.
- Preserve raw/provider Daily evidence; no silent table-semantics repurposing.
- Future events are UI-visible immediately but do not activate historical price adjustment before canonical ex-date.
- Every shadow/active ticker appends the latest completed adjusted Daily session in EOD even when corporate-action lineage is unchanged.
- Historical adjusted rebuild is change-driven only.
- `1W/1M/1Q/1Y` derive only from canonical selected `1D` after cutover.
- Exact DB readback is required before counting persistence/rebuild success.
- Keep exactly seven EOD v4 business phases.
- Every new `tests/*.test.ts` file must be registered in `tests/test-contracts.json`; prefer existing canonical tests when they already own the invariant.

---

## Execution order

- [ ] **1. QEO-122 — free-source spike**

Plan: `docs/superpowers/plans/2026-09-06-qeo-122-free-corporate-action-source-spike.md`

Terminal gate: explicit GO/NO-GO. Stop the program on NO-GO and reopen source authority decision before any production schema.

- [ ] **2. QEO-123 — canonical event schema + ingestion**

Plan: `docs/superpowers/plans/2026-09-06-qeo-123-corporate-action-canonical-storage.md`

Terminal gate: VHM event evidence round-trips with provenance, multi-action source notice identity and RLS/mutation boundaries verified.

- [ ] **3. QEO-124 — adjustment factor engine**

Plan: `docs/superpowers/plans/2026-09-06-qeo-124-adjustment-engine.md`

Terminal gate: deterministic VHM factor series matches golden benchmark lineage without any consumer cutover.

- [ ] **4. QEO-129 — adjusted-Daily shadow foundation**

Plan: `docs/superpowers/plans/2026-09-06-qeo-129-adjusted-daily-shadow.md`

Terminal gate: VHM adjusted history is complete/readback-verified in `shadow`, raw evidence unchanged, no production consumer switched.

- [ ] **5. QEO-126 — EOD v4 event/factor/adjusted-Daily maintenance**

Plan: `docs/superpowers/plans/2026-09-06-qeo-126-eod-corporate-actions.md`

Terminal gate: future event sync has no early historical adjustment; every shadow/active ticker receives idempotent current-session adjusted maintenance; activated/amended lineage rebuilds only affected historical ranges with exact readback.

- [ ] **6. QEO-125 — atomic canonical Daily consumer cutover + staged canonical-200 rollout**

Plan: `docs/superpowers/plans/2026-09-06-qeo-125-adjusted-daily-cutover.md`

Terminal gate: Chart, Wyckoff and AI Council share the same per-ticker canonical Daily basis; VHM week 13–17/10/2025 reaches adjusted H≈63.31 / L≈55.18 within tolerance; canonical-200 rollout report exposes active/shadow-blocked/ambiguous/unresolved counts.

- [ ] **7A. QEO-127 — chart event markers**

Plan: `docs/superpowers/plans/2026-09-06-qeo-127-chart-corporate-action-markers.md`

Development may begin after QEO-123 read API stabilizes; production acceptance additionally requires QEO-126 future-event sync behavior.

- [ ] **7B. QEO-128 — Stock Detail corporate-actions tab**

Plan: `docs/superpowers/plans/2026-09-06-qeo-128-stock-detail-corporate-actions-tab.md`

Development may run in parallel with QEO-127 after normalized read-model stability; production acceptance uses canonical QEO-126 event state and QEO-127 marker-time identity.

- [ ] **8. QEO-98 release gate**

Require production visual/data acceptance across adjusted Daily, higher timeframes, Chart/Wyckoff/AI Council basis parity, chart event markers and Stock Detail corporate-actions tab.

## Cross-cutting preflight before execution

- [ ] Reconcile open PR #340/QEO-106 before QEO-124/QEO-129/QEO-125 implementation. Preserve its semantic-invalid/readback lessons, but do not let legacy Yahoo-adjusted repair become canonical factor authority.
- [ ] At the start of every implementation PR, re-read current `main`, the target Linear issue and production migration ledger; other project work is active concurrently.
- [ ] Schema plans use their exact repository migration versions and explicit `supabase/migration-equivalence.json` mapping when production timestamps differ.
- [ ] Use an isolated worktree/branch per issue execution.
- [ ] Do not combine source spike, schema, factor engine, shadow store, EOD, cutover and UI into one PR.
- [ ] Before claiming an issue Done, run the issue-specific production acceptance plus fresh Verify/DB Drift gates relevant to its touched surface.
