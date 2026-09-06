# QEO-122 Free Corporate-Action Source Spike Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove whether a free authoritative Vietnam corporate-action source can supply enough stable event evidence to support QeoIndex canonical corporate actions without FiinGroup.

**Architecture:** Treat this as a throwaway/source-validation spike only. Fetch VSDC/VSD public event pages server-side, normalize them into an in-memory probe shape, validate ex-date derivation against the canonical Vietnam trading calendar, and publish evidence + GO/NO-GO without changing production schema or chart data.

**Tech Stack:** Node.js/TypeScript, built-in `fetch`, existing Vietnam trading-calendar helpers, repository scripts/tests, Markdown evidence.

**Spec:** `docs/superpowers/specs/2026-09-06-corporate-actions-adjusted-chart-design.md`

## Global Constraints

- FiinGroup remains out of implementation scope unless this spike returns NO-GO.
- No production database migration or canonical Daily rewrite.
- Do not silently infer `ex_date`; every derived date must carry derivation method + calendar version.
- Validate VHM golden history plus representative HOSE/HNX/UPCOM cases.
- Preserve exact source URL/event identity in evidence.

---

### Task 1: Add a throwaway VSDC event probe

**Files:**
- Create: `scripts/probes/qeo122-vsdc-corporate-actions.ts`
- Create: `tests/qeo-122-vsdc-probe.test.ts`

**Interfaces:**
- Consumes: public VSDC/VSD event-detail URLs and `isVietnamSecuritiesTradingDateKey()` from `modules/market/calendar`.
- Produces: `probeVsdcCorporateAction(url): Promise<ProbeCorporateAction>` used only by the spike/test.

```ts
type ProbeCorporateAction = {
  sourceUrl: string
  ticker: string
  isin: string | null
  exchange: "HOSE" | "HNX" | "UPCOM" | "UNKNOWN"
  actionType: "cash_dividend" | "stock_dividend" | "rights_issue" | "other"
  recordDate: string | null
  cashPerShare: number | null
  stockRatio: string | null
  rightsRatio: string | null
  subscriptionPrice: number | null
  rawTextHash: string
}
```

- [ ] **Step 1: Write parser fixtures/tests first**

Add deterministic HTML snippets for VHM cash dividend, VHM stock dividend, HNX cash dividend, UPCOM cash dividend and one rights issue. Assert normalized numeric values and dates exactly.

- [ ] **Step 2: Run the targeted test and verify RED**

Run:

```bash
pnpm exec tsx --test tests/qeo-122-vsdc-probe.test.ts
```

Expected: FAIL because `scripts/probes/qeo122-vsdc-corporate-actions.ts` does not exist.

- [ ] **Step 3: Implement the minimal parser/probe**

Implement explicit label-based extraction; do not use position-only scraping. Hash the fetched body with SHA-256 for evidence identity.

- [ ] **Step 4: Run fixture tests GREEN**

Run the same command. Expected: all QEO-122 fixture assertions pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/probes/qeo122-vsdc-corporate-actions.ts tests/qeo-122-vsdc-probe.test.ts
git commit -m "test(QEO-122): probe free VSDC corporate actions"
```

### Task 2: Validate historical `ex_date` derivation

**Files:**
- Create: `scripts/probes/qeo122-ex-date-derivation.ts`
- Modify: `tests/qeo-122-vsdc-probe.test.ts`

**Interfaces:**
- Consumes: normalized `recordDate`, exchange trading calendar, settlement-regime table embedded in the probe.
- Produces: `deriveProbeExDate(recordDate, exchange, regime): { exDate: string; method: string } | null`.

- [ ] **Step 1: Add RED cases for 2021, 2022 and 2026 VHM events**

Require explicit expected ex-dates from independently verified historical event evidence. Include a case that must return `null` when the settlement regime cannot be proven.

- [ ] **Step 2: Implement a bounded historical settlement regime map**

Use explicit date intervals, not a single modern `recordDate - 1 trading day` assumption. The function must walk the existing Vietnam trading calendar and return `null` outside proven regimes.

- [ ] **Step 3: Run tests GREEN**

```bash
pnpm exec tsx --test tests/qeo-122-vsdc-probe.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add scripts/probes/qeo122-ex-date-derivation.ts tests/qeo-122-vsdc-probe.test.ts
git commit -m "test(QEO-122): validate historical ex-date derivation"
```

### Task 3: Run live-source matrix and record operational constraints

**Files:**
- Create: `docs/db/evidence/qeo122-free-corporate-action-source-2026-09-06.md`

**Interfaces:**
- Consumes: live public source pages.
- Produces: reproducible GO/NO-GO evidence; no runtime dependency.

- [ ] **Step 1: Probe VHM golden events live**

Run the probe for the approved VHM event URLs and record HTTP status, normalized fields, source body hash and parser result.

- [ ] **Step 2: Probe cross-exchange matrix**

At minimum: one HOSE issuer, one HNX issuer, one UPCOM issuer; include cash dividend plus at least one stock/right issue where available.

- [ ] **Step 3: Measure operational stability**

Run each URL twice. Record redirect behavior, response content-type, obvious bot/rate-limit response, and whether the same event yields stable normalized identity/hash when unchanged.

- [ ] **Step 4: Write GO/NO-GO evidence**

The evidence document must include this decision table:

```text
historical coverage      PASS/FAIL
cash terms               PASS/FAIL
stock/split terms        PASS/FAIL
rights terms             PASS/FAIL
ex-date determinism      PASS/FAIL
amendment identity       PASS/FAIL
HOSE/HNX/UPCOM coverage  PASS/FAIL
operational accessibility PASS/FAIL
```

GO requires every required row to PASS. Otherwise QEO-122 is NO-GO and the next-source/paid-source decision is reopened explicitly.

- [ ] **Step 5: Commit**

```bash
git add docs/db/evidence/qeo122-free-corporate-action-source-2026-09-06.md
git commit -m "docs(QEO-122): record free source GO-NO-GO evidence"
```

### Task 4: Close the spike without leaking probe code into production

**Files:**
- Modify: `scripts/probes/qeo122-vsdc-corporate-actions.ts`
- Modify: `docs/db/evidence/qeo122-free-corporate-action-source-2026-09-06.md`

- [ ] **Step 1: Mark probe code explicitly non-production**

Add a module comment stating the parser is a spike and must not be imported from `app/`, `modules/`, `workflows/`, or `supabase/` runtime code.

- [ ] **Step 2: Run repository verification**

```bash
pnpm test:core
pnpm lint
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 3: Update Linear QEO-122**

Attach the evidence commit/PR and set GO or NO-GO. Only a GO unblocks QEO-123.

- [ ] **Step 4: Commit any final evidence wording**

```bash
git add scripts/probes/qeo122-vsdc-corporate-actions.ts docs/db/evidence/qeo122-free-corporate-action-source-2026-09-06.md
git commit -m "docs(QEO-122): finalize free source decision"
```
