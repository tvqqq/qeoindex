# QEO-122 Free Corporate-Action Source Spike Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove whether a free authoritative Vietnam corporate-action source can supply stable event evidence for QeoIndex without FiinGroup.

**Architecture:** This is a source-validation spike only. Fetch VSDC/VSD public event pages from a script, normalize into an in-memory probe shape, validate historical ex-date derivation against the canonical Vietnam trading calendar, and publish GO/NO-GO evidence. No production module imports the probe.

**Tech Stack:** Node.js/TypeScript, built-in `fetch`, existing Vietnam trading-calendar helpers, canonical repository test manifest, Markdown evidence.

**Spec:** `docs/superpowers/specs/2026-09-06-corporate-actions-adjusted-chart-design.md`

## Global Constraints

- FiinGroup remains out of implementation scope unless this spike returns NO-GO.
- No production database migration or canonical Daily rewrite.
- Do not silently infer `ex_date`; every derived date carries derivation method + calendar version.
- Validate VHM golden history plus representative HOSE/HNX/UPCOM cases.
- Preserve exact source URL/event identity and source-body hash in evidence.
- One source notice may contain multiple action components; the spike must preserve that fact for QEO-123.

---

### Task 1: Add a throwaway VSDC event probe with deterministic fixtures

**Files:**
- Create: `scripts/probes/qeo122-vsdc-corporate-actions.ts`
- Create: `tests/qeo-122-vsdc-probe.test.ts`
- Modify: `tests/test-contracts.json`

**Interfaces:**

```ts
type ProbeCorporateActionComponent = {
  actionType: "cash_dividend" | "stock_dividend" | "rights_issue" | "other"
  cashPerShare: number | null
  stockRatio: string | null
  rightsRatio: string | null
  subscriptionPrice: number | null
}

type ProbeCorporateActionNotice = {
  sourceUrl: string
  sourceEventId: string
  ticker: string
  isin: string | null
  exchange: "HOSE" | "HNX" | "UPCOM" | "UNKNOWN"
  recordDate: string | null
  components: ProbeCorporateActionComponent[]
  rawTextHash: string
}
```

- [ ] **Step 1: Register `tests/qeo-122-vsdc-probe.test.ts` in `tests/test-contracts.json`**

Owner `market-data`; invariant: free-source probe preserves exact terms, multi-action notices and fail-closed ex-date evidence without becoming runtime authority.

- [ ] **Step 2: Add RED fixture cases**

Include VHM cash dividend, VHM stock dividend, VHM 2021 combined cash+stock notice, one HNX cash notice, one UPCOM cash notice and one rights issue with subscription price.

- [ ] **Step 3: Verify RED**

```bash
pnpm exec tsx --test tests/qeo-122-vsdc-probe.test.ts
```

Expected: FAIL because the probe module does not exist.

- [ ] **Step 4: Implement minimal label-based parser**

Do not use position-only scraping. Hash fetched body with SHA-256. Return multiple `components` for a combined notice.

- [ ] **Step 5: Run fixture test GREEN and commit**

```bash
git add scripts/probes/qeo122-vsdc-corporate-actions.ts tests/qeo-122-vsdc-probe.test.ts tests/test-contracts.json
git commit -m "test(QEO-122): probe free VSDC corporate actions"
```

### Task 2: Validate historical `ex_date` derivation

**Files:**
- Create: `scripts/probes/qeo122-ex-date-derivation.ts`
- Modify: `tests/qeo-122-vsdc-probe.test.ts`

**Interfaces:**

```ts
export function deriveProbeExDate(input: {
  recordDate: string
  exchange: "HOSE" | "HNX" | "UPCOM"
  regimeVersion: string
}): { exDate: string; method: string; calendarVersion: string } | null
```

- [ ] **Step 1: Add RED cases for verified VHM 2021, 2022 and 2026 events**
- [ ] **Step 2: Add RED unknown-regime case** — must return `null`, never modern-rule guess.
- [ ] **Step 3: Implement explicit historical settlement-regime intervals and walk the existing Vietnam trading calendar**
- [ ] **Step 4: GREEN targeted test and commit**

### Task 3: Run live-source matrix and operational probe

**Files:**
- Create: `docs/db/evidence/qeo122-free-corporate-action-source-2026-09-06.md`

- [ ] **Step 1: Probe all approved VHM golden event URLs live** — record HTTP status, redirect chain, content-type, normalized notice/components, source body hash.
- [ ] **Step 2: Probe at least one HOSE, one HNX and one UPCOM issuer** — include cash plus stock/right cases required by the source gate.
- [ ] **Step 3: Fetch every source twice** — record stable identity/hash behavior, obvious bot/rate-limit response and latency/error class.
- [ ] **Step 4: Test amendment identity** — use a known amended/duplicate notice if source history exposes one; otherwise the gate is FAIL rather than assumed PASS.
- [ ] **Step 5: Commit live-source evidence**

### Task 4: Make explicit GO/NO-GO decision

**Files:**
- Modify: `docs/db/evidence/qeo122-free-corporate-action-source-2026-09-06.md`
- Modify: `scripts/probes/qeo122-vsdc-corporate-actions.ts`

Decision table must contain:

```text
historical retained-scope coverage PASS/FAIL
cash terms                        PASS/FAIL
stock/split terms                 PASS/FAIL
rights terms                      PASS/FAIL
multi-action notice identity      PASS/FAIL
ex-date determinism               PASS/FAIL
amendment identity                PASS/FAIL
HOSE/HNX/UPCOM coverage           PASS/FAIL
operational accessibility         PASS/FAIL
```

GO requires every required row PASS. Any required FAIL => QEO-122 NO-GO and source decision reopens before QEO-123.

- [ ] **Step 1: Add module comment that probe is non-production and forbidden from runtime imports**
- [ ] **Step 2: Run canonical verification**

```bash
pnpm exec tsx --test tests/qeo-122-vsdc-probe.test.ts
pnpm test:current
pnpm typecheck
```

- [ ] **Step 3: Update Linear QEO-122 with evidence and GO/NO-GO**
- [ ] **Step 4: Commit final decision**

```bash
git add scripts/probes/qeo122-vsdc-corporate-actions.ts docs/db/evidence/qeo122-free-corporate-action-source-2026-09-06.md
git commit -m "docs(QEO-122): finalize free source decision"
```
