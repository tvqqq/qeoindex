# QEO-174 Stock Strategy Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `/insights/[ticker]` into a stock strategy-card experience without changing any chart, AI Council, watchlist or financial data semantics.

**Architecture:** Preserve `StockDetailWorkstation` as the orchestration owner and preserve the public `StockCompanyHeader` integration contract. Add small presentation primitives under `components/stock-detail/revamp/`; the header composes them using existing `StockDetailData`, while the workstation receives only non-semantic atmosphere/background styling.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind CSS 4, `motion/react`, Lucide icons, Node test runner.

**Spec:** `docs/superpowers/specs/2026-09-09-qeo-174-stock-strategy-card-design.md`

## Global Constraints

- Presentation-only: no API, DB, chart-data or AI Council contract changes.
- No synthetic stock score, rarity or recommendation.
- Preserve the `StockCompanyHeader` export and existing workstation component wiring.
- Use existing `motion/react`; add no dependency.
- Respect `prefers-reduced-motion` through `useReducedMotion()`.

---

### Task 1: Add deterministic card helpers and Price Arena

**Files:**
- Create: `components/stock-detail/revamp/stock-card-metrics.ts`
- Create: `components/stock-detail/revamp/stock-card-stat.tsx`
- Create: `components/stock-detail/revamp/stock-price-arena.tsx`
- Test: `tests/stock-detail/qeo174-strategy-card-ui.test.ts`

**Interfaces:**
- `rangePosition(value, floor, ceiling): number` returns a finite clamped percentage in `[0, 100]`.
- `formatCompactNumber(value): string` displays factual compact values without inventing data.
- `StockCardStat` renders a label/value/detail metric cell.
- `StockPriceArena` consumes floor/ref/low/current/high/ceiling values and renders the factual range rail.

- [ ] **Step 1: Write the failing UI contract**

Create `tests/stock-detail/qeo174-strategy-card-ui.test.ts` that requires the new helper/presentation files and asserts bounded range logic, factual card labels and no synthetic rarity/power labels.

- [ ] **Step 2: Run RED**

Run:

```bash
node --test tests/stock-detail/qeo174-strategy-card-ui.test.ts
```

Expected: FAIL because `components/stock-detail/revamp/stock-card-metrics.ts` and the new presentation files do not exist yet.

- [ ] **Step 3: Implement minimal helpers/primitives**

Implement finite range normalization, compact formatting, metric cell and Price Arena using only caller-provided values.

- [ ] **Step 4: Run targeted test**

```bash
node --test tests/stock-detail/qeo174-strategy-card-ui.test.ts
```

Expected: helper/primitives assertions pass.

### Task 2: Convert StockCompanyHeader into the strategy-card hero

**Files:**
- Modify: `components/stock-detail/stock-company-header.tsx`
- Test: `tests/stock-detail/qeo174-strategy-card-ui.test.ts`

**Interfaces:**
- Keep `export function StockCompanyHeader({ data }: { data: StockDetailData })` unchanged.
- Consume the Task 1 primitives without fetching additional data.

- [ ] **Step 1: Extend failing contract**

Require markers for `data-qeo174-strategy-card`, factual `CARD STATS`, optional rank, `useReducedMotion`, bookmark/share behavior and the new Price Arena.

- [ ] **Step 2: Verify RED**

Run the targeted Node test and confirm it fails against the old conventional header.

- [ ] **Step 3: Implement the hero**

Use `LazyMotion`, `domAnimation`, `m` and `useReducedMotion`; preserve existing stock identity, price colors and actions; add factual P/E, P/B, ROE, EPS, volume and market-cap stat cells plus Price Arena.

- [ ] **Step 4: Verify GREEN**

Run the targeted QEO-174 test and existing `tests/stock-identity-header.test.ts`.

### Task 3: Add workstation atmosphere without touching orchestration

**Files:**
- Modify: `components/stock-detail/stock-detail-workstation.tsx`
- Test: `tests/stock-detail/qeo174-strategy-card-ui.test.ts`

**Interfaces:**
- Do not change ticker cache/navigation/chart-maximize logic.
- Do not change child component props.

- [ ] **Step 1: Add failing contract**

Assert the workstation exposes `data-qeo174-workstation` and keeps all five stock-detail child surfaces.

- [ ] **Step 2: Verify RED**

Run the QEO-174 test and confirm the marker/style contract is absent.

- [ ] **Step 3: Implement atmosphere**

Add low-contrast radial/linear background layers and the QEO-174 data marker while preserving existing layout classes and loading overlay behavior.

- [ ] **Step 4: Verify regression contracts**

Run:

```bash
node --test tests/stock-detail/qeo174-strategy-card-ui.test.ts
node --test tests/stock-identity-header.test.ts
node --test tests/stock-tradingview-chart-v2.test.ts
pnpm typecheck
```

Expected: PASS.

### Task 4: PR hardening

**Files:**
- Create: `.github/workflows/qeo174-preprod.yml`

- [ ] **Step 1: Add PR-only workflow**

Trigger on stock-detail/QEO-174 paths and run install, targeted UI contract, existing identity regression test and typecheck.

- [ ] **Step 2: Inspect PR diff**

Confirm no API, DB, module data, chart engine or AI Council files changed.

- [ ] **Step 3: Final verification**

Require the QEO-174 workflow and repository checks to be green before marking the Linear issue done.
