# QEO-121 Corporate Actions Program Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver free-source corporate-action ingestion, deterministic adjustment factors, EOD v4 activation, adjusted Daily cutover and Stock Detail event UX without mixing price bases or adding a new EOD business phase.

**Architecture:** Execute each subsystem through its dedicated plan and production acceptance gate. Data authority flows source evidence → normalized actions → derived factors → adjusted Daily → EOD activation/cutover → chart/tab consumers; later tasks consume only stable outputs from earlier tasks.

**Tech Stack:** TypeScript/Next.js, Supabase/PostgreSQL, Vercel Workflow, Lightweight Charts.

**Spec:** `docs/superpowers/specs/2026-09-06-corporate-actions-adjusted-chart-design.md`

## Global Constraints

- Do not implement paid FiinGroup before QEO-122 free-source NO-GO.
- Preserve raw/provider Daily evidence; no silent table-semantics repurposing.
- Future events are UI-visible immediately but do not activate historical price adjustment before canonical ex-date.
- `1W/1M/1Q/1Y` derive only from adjusted `1D` after cutover.
- Exact DB readback is required before counting persistence/rebuild success.
- Keep seven EOD v4 operator phases.

---

## Execution order

- [ ] **1. QEO-122 — free-source spike**

Plan: `docs/superpowers/plans/2026-09-06-qeo-122-free-corporate-action-source-spike.md`

Terminal gate: explicit GO/NO-GO. Stop the program on NO-GO and reopen source decision.

- [ ] **2. QEO-123 — canonical event schema + ingestion**

Plan: `docs/superpowers/plans/2026-09-06-qeo-123-corporate-action-canonical-storage.md`

Terminal gate: VHM event evidence round-trips with provenance, RLS/mutation boundaries verified.

- [ ] **3. QEO-124 — adjustment factor engine**

Plan: `docs/superpowers/plans/2026-09-06-qeo-124-adjustment-engine.md`

Terminal gate: deterministic VHM factor series matches golden benchmark lineage without chart cutover.

- [ ] **4. QEO-126 — EOD v4 sync/activation**

Plan: `docs/superpowers/plans/2026-09-06-qeo-126-eod-corporate-actions.md`

Terminal gate: future event sync is idempotent/no early adjustment; on/after ex-date activation rebuilds only affected ticker/range and downstream waits for readback.

- [ ] **5. QEO-125 — adjusted Daily boundary + staged cutover**

Plan: `docs/superpowers/plans/2026-09-06-qeo-125-adjusted-daily-cutover.md`

Terminal gate: VHM golden week 13–17/10/2025 reaches adjusted H≈63.31 / L≈55.18 within tolerance, then staged canonical-200 report has explicit unresolved/blocked counts.

- [ ] **6A. QEO-127 — chart event markers**

Plan: `docs/superpowers/plans/2026-09-06-qeo-127-chart-corporate-action-markers.md`

May begin after QEO-123 read API stabilizes; production acceptance should use QEO-126 future-event behavior.

- [ ] **6B. QEO-128 — Stock Detail corporate-actions tab**

Plan: `docs/superpowers/plans/2026-09-06-qeo-128-stock-detail-corporate-actions-tab.md`

May run in parallel with QEO-127 after normalized read model is stable.

- [ ] **7. QEO-98 release gate**

Require production visual/data acceptance across adjusted Daily, higher timeframes, chart markers and Stock Detail event tab.

## Cross-cutting preflight before execution

- [ ] Reconcile open PR #340/QEO-106 before implementing QEO-124/QEO-125. Keep its semantic-invalid/readback lessons, but do not let legacy Yahoo-adjusted repair become canonical factor authority.
- [ ] Confirm current main and production migration ledger before every schema task.
- [ ] Use isolated worktree/branch per plan execution.
- [ ] Do not combine schema, engine, EOD and UI into one PR; each plan ends at a meaningful review/production gate.
