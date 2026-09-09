# QEO-165 — Portfolio Command Center Implementation Plan

> **Execution:** use `superpowers:executing-plans` task-by-task and `superpowers:test-driven-development` for every behavior change. Do not skip RED evidence. Before completion use `superpowers:verification-before-completion` and `superpowers:requesting-code-review`.

**Goal:** Revamp `/portfolio` from a dense form/table-first screen into a card-first, decision-first Portfolio Command Center while preserving every authoritative Portfolio/Risk calculation, API, persistence boundary and domain semantic.

**Spec:** `docs/superpowers/specs/2026-09-09-qeo-165-portfolio-command-center-design.md`

**Architecture:** `PortfolioPage` remains the portfolio/transaction/market-price orchestrator. New files under `components/portfolio/revamp/` are presentation-only consumers of existing typed props/read models. Dense tables/forms remain available as explicit drill-down. No revamp component may create an alternate accounting/risk source of truth or issue its own data request.

**Tech:** Next.js 16.3, React 19, TypeScript 5.7, Tailwind CSS 4, existing `motion` dependency, Lucide React, Node `node:test`, existing GitHub Actions verification.

## Locked constraints

- No DB migration, generated DB type change or Portfolio/Risk API behavior change.
- Preserve AVCO/accounting, QEO-139 sizing, QEO-141 Active Risk, QEO-142 scorecard, QEO-158 external-flow normalization and QEO-159 concentration/diversification semantics.
- Preserve all five tabs: `Tài sản`, `Nhật ký`, `Phân bổ vốn`, `Hiệu suất`, `Theo dõi`.
- Preserve current dark purple/indigo identity and market up/down colors.
- Gamification is secondary presentation only. Never invent strength/weakness, attack/defense roles, rarity, conviction or probability.
- `components/portfolio/revamp/**` must contain no `fetch`, Supabase client or server action.
- No per-position/per-card request.
- Use existing `motion` only; add no animation package.
- `prefers-reduced-motion` remains authoritative.
- Important body/help text should normally be 14–16 px; do not add critical 9–11 px copy.
- QEO-144 full Playwright/browser acceptance stays paused until QEO-165 lands.

## Planned new presentation files

- `components/portfolio/revamp/portfolio-section-shell.tsx`
- `components/portfolio/revamp/portfolio-command-header.tsx`
- `components/portfolio/revamp/portfolio-command-actions.tsx`
- `components/portfolio/revamp/portfolio-battle-hud.tsx`
- `components/portfolio/revamp/portfolio-risk-state-strip.tsx`
- `components/portfolio/revamp/tactical-status.ts`
- `components/portfolio/revamp/position-battle-rail.tsx`
- `components/portfolio/revamp/tactical-position-card.tsx`
- `components/portfolio/revamp/portfolio-position-grid.tsx`
- `components/portfolio/revamp/war-room-stage-nav.tsx`
- `components/portfolio/revamp/battle-log-card.tsx`
- `components/portfolio/revamp/scouting-card.tsx`

## Planned deterministic tests

- `tests/portfolio/qeo165-command-center-ui.test.ts`
- `tests/portfolio/qeo165-tactical-position-ui.test.ts`
- `tests/portfolio/qeo165-guidance-ui.test.ts`
- `tests/portfolio/qeo165-war-room-ui.test.ts`
- `tests/portfolio/qeo165-battle-log-ui.test.ts`
- `tests/portfolio/qeo165-secondary-tabs-ui.test.ts`
- `tests/portfolio/qeo165-boundaries.test.ts`

---

## Task 1 — Lock presentation boundaries and shared primitives

**Create**
- `tests/portfolio/qeo165-command-center-ui.test.ts`
- `tests/portfolio/qeo165-boundaries.test.ts`
- `components/portfolio/revamp/portfolio-section-shell.tsx`
- `components/portfolio/revamp/tactical-status.ts`
- `.github/workflows/qeo165-preprod.yml`

**Modify**
- `tests/test-contracts.json`

### RED

Create boundary tests first. Required assertions:

```ts
const files = readdirSync("components/portfolio/revamp", { recursive: true })
  .filter((name) => String(name).endsWith(".ts") || String(name).endsWith(".tsx"))
  .map((name) => `components/portfolio/revamp/${String(name)}`)

for (const file of files) {
  const source = readFileSync(file, "utf8")
  assert.doesNotMatch(source, /\bfetch\s*\(/)
  assert.doesNotMatch(source, /createClient\s*\(/)
  assert.doesNotMatch(source, /supabase/i)
}
```

And source-contract expectations:

```ts
assert.match(shell, /PortfolioSectionShell/)
assert.match(status, /resolveTacticalPositionState/)
assert.match(status, /MISSING_STOP/)
assert.doesNotMatch(status, /rarity|conviction|attack|defense|mạnh|yếu/i)
```

Register both tests in `tests/test-contracts.json`. Create a minimal read-only QEO-165 PR workflow that runs them. Observe RED because the revamp primitives do not yet exist.

### GREEN

Implement:

```ts
export type TacticalPositionState =
  | "BREACH"
  | "WARNING"
  | "UNKNOWN"
  | "MISSING_STOP"
  | "PROFIT"
  | "LOSS"
  | "FLAT"

export function resolveTacticalPositionState(input: {
  unrealizedPnl: number
  stopLoss: number | null
  authoritativeRiskState?: "BREACH" | "WARNING" | "UNKNOWN" | null
}): TacticalPositionState {
  if (input.authoritativeRiskState) return input.authoritativeRiskState
  if (input.stopLoss == null) return "MISSING_STOP"
  if (input.unrealizedPnl > 0) return "PROFIT"
  if (input.unrealizedPnl < 0) return "LOSS"
  return "FLAT"
}
```

Important: P/L is only a display status; it must never generate a risk state.

Implement `PortfolioSectionShell` as a semantic `<section>` with title/description/action slots and presentational tone. No hook, context or data fetch.

### Verify

```bash
node --test tests/portfolio/qeo165-command-center-ui.test.ts tests/portfolio/qeo165-boundaries.test.ts
pnpm test:manifest
```

Commit:

```bash
git commit -m "feat(QEO-165): establish portfolio command UI boundaries"
```

---

## Task 2 — Command header, Battle HUD and canonical risk strip

**Create**
- `components/portfolio/revamp/portfolio-command-header.tsx`
- `components/portfolio/revamp/portfolio-command-actions.tsx`
- `components/portfolio/revamp/portfolio-battle-hud.tsx`
- `components/portfolio/revamp/portfolio-risk-state-strip.tsx`

**Modify**
- `components/portfolio/portfolio-page.tsx`
- `components/portfolio/portfolio-summary-bar.tsx`
- `components/portfolio/risk-engine/portfolio-risk-dashboard-core.tsx`
- `tests/portfolio/qeo165-command-center-ui.test.ts`

### Interfaces

`PortfolioBattleHud` keeps the existing summary inputs:

```ts
{
  positions: PortfolioPosition[]
  currentPrices: Record<string, number>
  loading?: boolean
}
```

`PortfolioCommandActions` receives callbacks only:

```ts
{
  onGuidance: () => void
  onRefresh: () => void
  onAddTransaction: () => void
  refreshing?: boolean
}
```

`PortfolioRiskStateStrip` receives exactly the existing `PortfolioRiskReadModel` and reads canonical fields; it does not derive its own risk model.

### RED

Extend `qeo165-command-center-ui.test.ts` to require:

```ts
assert.match(page, /PortfolioCommandHeader/)
assert.match(page, /PortfolioBattleHud/)
assert.match(hud, /Tổng tài sản \(NAV\)/)
assert.match(hud, /text-(?:3xl|4xl)/)
assert.match(riskCore, /PortfolioRiskStateStrip/)
assert.match(strip, /concentration\.summary\.overallStatus/)
assert.doesNotMatch(strip, /fetch\s*\(/)
```

Observe RED before creating the new components.

### GREEN

Move, do not rewrite, existing summary math into `PortfolioBattleHud`:

```ts
const currentPrice = currentPrices[pos.ticker] ?? pos.avgCost
const marketValue = currentPrice * pos.openQty
const invested = pos.avgCost * pos.openQty
const unrealized = (currentPrice - pos.avgCost) * pos.openQty
```

Keep the same four summary concepts: NAV/market value, unrealized P/L, realized P/L, open-position count. Increase primary metric hierarchy materially.

Turn `PortfolioSummaryBar` into a compatibility wrapper around `PortfolioBattleHud`; do not retain duplicate calculations.

Keep portfolio CRUD, dialog state, refresh and add-transaction callbacks inside `PortfolioPage`; command components only receive callbacks/nodes.

`PortfolioRiskStateStrip` may display only canonical values already present in the risk read model, including:

```ts
risk.riskState.state
risk.activeRisk.knownActiveRiskVnd
risk.activeRisk.activeRiskPercent
risk.activeRisk.remainingRiskBudgetVnd
risk.activeRisk.unknownRiskItemCount
risk.concentration.summary.overallStatus
```

Move the existing dense risk metrics/evidence/concentration/trade rows into an explicit disclosure labelled `Mở bảng rủi ro chi tiết`. Do not remove evidence.

### Verify

```bash
node --test tests/portfolio/qeo165-command-center-ui.test.ts tests/portfolio/qeo165-boundaries.test.ts
node --test tests/portfolio/qeo141-risk-ui.test.ts tests/portfolio/qeo159-concentration-ui.test.ts
```

Commit:

```bash
git commit -m "feat(QEO-165): add portfolio command HUD and risk strip"
```

---

## Task 3 — Tactical position cards and numeric battle rail

**Create**
- `tests/portfolio/qeo165-tactical-position-ui.test.ts`
- `components/portfolio/revamp/position-battle-rail.tsx`
- `components/portfolio/revamp/tactical-position-card.tsx`
- `components/portfolio/revamp/portfolio-position-grid.tsx`

**Modify**
- `components/portfolio/portfolio-page.tsx`
- `tests/test-contracts.json`

### Interface

```ts
export interface TacticalPositionCardData {
  ticker: string
  openQty: number
  avgCost: number
  currentPrice: number
  marketValue: number
  unrealizedPnl: number
  unrealizedPnlPct: number
  targetPrice: number | null
  stopLoss: number | null
}
```

The grid consumes the same canonical inputs as the existing positions table and no extra data source.

### RED

Require:

```ts
assert.match(page, /PortfolioPositionGrid/)
assert.match(page, /Chi tiết đội hình/)
assert.match(page, /PortfolioPositionsTable/)
assert.match(card, /\+ Lệnh/)
assert.match(card, /MISSING_STOP|THIẾU STOP/)
assert.match(rail, /STOP/)
assert.match(rail, /TARGET/)
assert.doesNotMatch(card, /rarity|conviction|tấn công|phòng thủ|mạnh|yếu/i)
```

Register test and observe RED.

### GREEN

`PositionBattleRail` is numeric visualization only:

```ts
const low = Math.min(stopLoss, targetPrice)
const high = Math.max(stopLoss, targetPrice)
const progress = high > low
  ? Math.max(0, Math.min(100, ((currentPrice - low) / (high - low)) * 100))
  : 50
```

It labels STOP / CURRENT / TARGET and never shows a probability or success percentage.

`PortfolioPositionGrid` keeps exact existing display math:

```ts
const currentPrice = currentPrices[pos.ticker] ?? pos.avgCost
const marketValue = currentPrice * pos.openQty
const unrealizedPnl = (currentPrice - pos.avgCost) * pos.openQty
const unrealizedPnlPct = pos.avgCost > 0
  ? ((currentPrice - pos.avgCost) / pos.avgCost) * 100
  : 0
```

`TacticalPositionCard` displays ticker, quantity, current/avg price, market value, P/L VND/%, target, stop and factual status. Primary mutation action is only `+ Lệnh`, forwarding the existing callback.

Target Tài sản order:

```text
PortfolioBattleHud
PortfolioRiskDashboard
PortfolioPositionGrid
PortfolioAllocationChart
<details>Chi tiết đội hình -> PortfolioPositionsTable</details>
```

### Verify

```bash
node --test tests/portfolio/qeo165-tactical-position-ui.test.ts tests/portfolio/qeo165-command-center-ui.test.ts
node --test tests/portfolio/qeo141-risk-ui.test.ts tests/portfolio/qeo159-concentration-ui.test.ts
pnpm test:current
```

Commit:

```bash
git commit -m "feat(QEO-165): make tactical cards the primary holdings view"
```

---

## Task 4 — Redesign Guidance as the Field Manual

**Create**
- `tests/portfolio/qeo165-guidance-ui.test.ts`

**Modify**
- `components/portfolio/portfolio-guidance-dialog.tsx`
- `tests/test-contracts.json`

Keep `PortfolioGuidanceDialogProps` unchanged.

### RED

Require:

```ts
assert.match(source, /max-w-(?:4xl|5xl)/)
assert.match(source, /Field Manual|Cẩm nang/i)
assert.match(source, /text-(?:sm|base)/)
assert.doesNotMatch(source, /text-\[11px\]/)
assert.doesNotMatch(source, /Tối thiểu R:R = 1:2\.5/)
assert.doesNotMatch(source, /bắt buộc.*1-2%|Vi phạm là bán ngay/i)
```

Current implementation should RED because it is `max-w-2xl` and contains tiny/universal guidance.

### GREEN

Desktop: `max-w-5xl`, stable header, optional chapter navigation, scrollable chapter content, body `text-sm sm:text-base`.

Mobile: near-full viewport sheet/dialog with comfortable body size and tappable chapter navigation.

Rewrite guidance to match current domain semantics: risk values come from the user's current Money Management Plan and explicit planned-trade inputs. Any numeric example must be labelled as an example, not a silent product default. Do not reintroduce mandatory 1–2%, R:R 1:2.5 or automatic 5–7% stop rules.

### Verify

```bash
node --test tests/portfolio/qeo165-guidance-ui.test.ts tests/portfolio/qeo138-risk-plan-ui.test.ts
```

Commit:

```bash
git commit -m "feat(QEO-165): redesign portfolio guidance as field manual"
```

---

## Task 5 — Progressive War Room for capital allocation

**Create**
- `tests/portfolio/qeo165-war-room-ui.test.ts`
- `components/portfolio/revamp/war-room-stage-nav.tsx`

**Modify**
- `components/portfolio/portfolio-capital-allocation.tsx`
- `components/portfolio/portfolio-page.tsx`
- `tests/test-contracts.json`

### Interface

```ts
export type WarRoomStage = "capacity" | "current" | "sizing" | "simulation"

export interface WarRoomStageNavProps {
  stage: WarRoomStage
  onStageChange: (stage: WarRoomStage) => void
}
```

Keep all existing state/calculation owners unchanged, including `manualAccountEquityVnd`, `plannedTrades`, `useRiskSizingContext`, `buildPortfolioAllocationSnapshot` and `simulatePlannedTrades`.

### RED

Require `WarRoomStageNav`, labels `Quân lực`, `Lệnh dự kiến`, `Dàn quân`, `Simulation`, and continued presence of existing four planning components. Keep QEO-139 mutation-boundary assertion that `TradeSizeAdvisor` does not perform direct POST persistence.

### GREEN

Add local presentation state only:

```ts
const [stage, setStage] = useState<WarRoomStage>("capacity")
```

Stage mapping:

```text
capacity   -> PortfolioAllocationAdvisor
current    -> PortfolioCurrentState
sizing     -> TradeSizeAdvisor
simulation -> CombinedPortfolioSimulation
```

Keep a compact Account Equity / estimated cash / planned-trade summary visible while switching stages.

In `PortfolioPage`, place `PortfolioRiskPlan` behind disclosure `Kế hoạch quản trị vốn nâng cao`, preserving the same `portfolioId` and version/persistence semantics.

### Verify

```bash
node --test tests/portfolio/qeo165-war-room-ui.test.ts
node --test tests/portfolio/qeo139-trade-size-ui.test.ts tests/portfolio/qeo139-planned-trade-simulation.test.ts tests/portfolio/qeo159-override-audit.test.ts tests/portfolio/qeo159-concentration-projection.test.ts
```

Commit:

```bash
git commit -m "feat(QEO-165): turn capital allocation into a progressive war room"
```

---

## Task 6 — Battle Log for raw transaction history

**Create**
- `tests/portfolio/qeo165-battle-log-ui.test.ts`
- `components/portfolio/revamp/battle-log-card.tsx`

**Modify**
- `components/portfolio/portfolio-transaction-history.tsx`
- `components/portfolio/portfolio-page.tsx`
- `tests/test-contracts.json`

### Semantic boundary

`PortfolioTransactionHistory` owns `RawTransaction[]`, not normalized Trade outcomes. Therefore `BattleLogCard` may display factual transaction actions and existing provenance only. It must not label a raw fill `WIN`, `LOSS`, `OPEN`, `PARTIAL` or `CLOSED`.

### RED

Require:

```ts
assert.match(history, /BattleLogCard/)
assert.match(history, /Chi tiết giao dịch dạng bảng/)
assert.match(card, /transaction\.action/)
assert.match(card, /legacy_migration_status/)
assert.doesNotMatch(card, /\bWIN\b|\bLOSS\b|\bPARTIAL\b|\bCLOSED\b|\bOPEN\b/)
```

### GREEN

Create larger transaction cards showing ticker/date/action, quantity, price, fee, note/tags and existing legacy provenance. Reuse existing delete confirmation callbacks; do not add networking.

Keep ticker filters. Cards become primary history presentation; existing dense table moves into `<details>` labelled `Chi tiết giao dịch dạng bảng`.

Wrap the tab with `PortfolioSectionShell` titled `Battle Log · Nhật ký giao dịch`.

### Verify

Run exact known legacy regressions:

```bash
node --test \
  tests/portfolio/qeo165-battle-log-ui.test.ts \
  tests/portfolio/qeo137-legacy-transactions-context.test.ts \
  tests/portfolio/qeo143-legacy-ui.test.ts \
  tests/portfolio/qeo143-read-model-completeness.test.ts
```

Commit:

```bash
git commit -m "feat(QEO-165): present portfolio transactions as a battle log"
```

---

## Task 7 — Campaign Results and Scouting Board

**Create**
- `tests/portfolio/qeo165-secondary-tabs-ui.test.ts`
- `components/portfolio/revamp/scouting-card.tsx`

**Modify**
- `components/portfolio/performance/performance-dashboard.tsx`
- `components/portfolio/watchlist-panel.tsx`
- `components/portfolio/portfolio-page.tsx`
- `tests/test-contracts.json`

### Boundaries

- `PortfolioPerformanceDashboard` keeps its single canonical `usePortfolioPerformance(portfolioId)` ownership.
- `WatchlistPanel` keeps its existing API and its existing single quote-batch fetch keyed by all watchlist tickers.
- `ScoutingCard` receives already-loaded watchlist/quote data only and has no fetch.

### RED

Require performance title `Campaign Results` / `Kết quả chiến dịch`, continued single hook ownership and no direct performance fetch.

Require `ScoutingCard`, `Scouting Board`/`Trinh sát`, continued `tickersKey` batch behavior, no fetch in card, and no recommendation/conviction language.

### GREEN

Reframe performance hierarchy only; preserve scorecard/equity/ledger/benchmark/segments and filters. Keep sample-size/evidence warnings.

`ScoutingCard` shows factual ticker, note, current quote/change when present, alerts and tags; preserve chart link and existing remove callback. Never label a card as a buy recommendation.

Make card grid primary. Preserve the current dense inspection view under explicit `<details>` labelled exactly `Chi tiết Scouting Board`.

### Verify

```bash
node --test tests/portfolio/qeo165-secondary-tabs-ui.test.ts tests/portfolio/qeo142-performance-ui.test.ts
pnpm test:current
```

Commit:

```bash
git commit -m "feat(QEO-165): revamp performance and scouting presentation"
```

---

## Task 8 — Motion, responsive hardening and exact-head release gate

**Modify**
- `components/portfolio/portfolio-theme.module.css`
- only required `components/portfolio/revamp/*.tsx`
- `.github/workflows/qeo165-preprod.yml`
- QEO-165 tests as required

### RED hardening contracts

Verify reduced-motion and dependency boundaries:

```ts
const theme = read("components/portfolio/portfolio-theme.module.css")
const pkg = JSON.parse(read("package.json"))

assert.match(theme, /prefers-reduced-motion:\s*reduce/)
assert.equal(pkg.dependencies.motion != null, true)
assert.equal(pkg.dependencies["framer-motion"], undefined)
```

Also require comfortable tactical-card touch targets (`h-10`, `min-h-10` or equivalent) and textual status in addition to color.

### GREEN motion/responsive work

Use existing `motion` only for non-essential transform/opacity effects, for example subtle reveal and pointer hover lift. No continuous normal-state pulse, no looping market-direction animation and no effect that blocks input.

Responsive acceptance encoded in source/layout:
- 1 tactical card/row mobile;
- 2 tablet;
- 3–4 desktop when width permits;
- command actions wrap;
- only intentionally dense drill-down tables may horizontally scroll;
- Field Manual approaches full viewport on mobile;
- War Room stage navigation may horizontally scroll on narrow widths while active content remains full width.

### Final QEO-165 workflow

Expand `.github/workflows/qeo165-preprod.yml` to run:

```yaml
- run: node --test tests/portfolio/qeo165-*.test.ts
- run: node --test tests/portfolio/qeo138-risk-plan-ui.test.ts tests/portfolio/qeo139-trade-size-ui.test.ts tests/portfolio/qeo141-risk-ui.test.ts tests/portfolio/qeo142-performance-ui.test.ts tests/portfolio/qeo159-concentration-ui.test.ts tests/portfolio/qeo159-override-audit.test.ts
- run: pnpm test:manifest
- run: pnpm test:current
- run: pnpm lint:touched
- run: pnpm typecheck
- run: pnpm build
```

Do not add a QEO-165 migration/replay step because QEO-165 contains no DB changes. Canonical repository Verify/DB Drift workflows remain independently authoritative when triggered.

### Exact-head release verification

Before claiming complete require the same exact feature SHA to pass:

```bash
node --test tests/portfolio/qeo165-*.test.ts
pnpm test:manifest
pnpm test:current
pnpm lint:touched
pnpm typecheck
pnpm build
```

Also require exact-head success for relevant path-overlap gates: QEO-138, QEO-139, QEO-141, QEO-142, QEO-159 and canonical Verify. Never merge based on stale-success SHA.

### Changed-file audit

Confirm final diff contains:
- no `supabase/migrations/**`;
- no Portfolio/Risk `app/api/**` behavior change;
- no generated DB type change;
- no new animation dependency;
- no `fetch` under `components/portfolio/revamp/**`;
- all five tabs still present;
- no invented stock score/role/rarity/conviction semantics.

### Preview/manual visual review

This is a visual release check, not the postponed QEO-144 Playwright suite. Check desktop/mobile hierarchy, Field Manual readability, War Room state preservation, Battle Log delete interaction, performance filters, watchlist add/remove + batch quotes, and reduced-motion rendering. Any functional regression found here receives a deterministic RED test before the fix.

Commit hardening:

```bash
git commit -m "test(QEO-165): harden portfolio command center release gates"
```

Before merge invoke `verification-before-completion` and `requesting-code-review`, record exact-head CI/diff/preview evidence on QEO-165, then follow the normal merge + production-deploy acceptance flow.

After QEO-165 production acceptance, resume QEO-144 from its existing controlled-fixture branch, reconcile it with latest `main`, and make its Playwright/browser acceptance target the new UI rather than the retired layout.

---

## Plan self-review

- All approved spec areas are mapped to Tasks 1–8.
- No task creates DB/API/domain behavior or a second Portfolio/Risk fetch owner.
- Raw transaction Battle Log explicitly avoids invented normalized Trade states.
- Position/scouting cards explicitly avoid invented strength/role/rarity/conviction.
- All regression filenames in the plan are concrete; no conditional filename placeholders remain.
- Existing `motion` is the only animation dependency; the exact package-key assertion is `pkg.dependencies["framer-motion"]`.
- Dense watchlist inspection is explicitly preserved under `Chi tiết Scouting Board`.
- QEO-144 browser acceptance remains postponed by user instruction and resumes only after QEO-165 production acceptance.
