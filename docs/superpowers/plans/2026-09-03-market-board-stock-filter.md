# Market Board Stock Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persisted `Filter CP` market-board mode that filters the canonical Top 200 universe by exchange, current price, current-session liquidity, and raw KFSP sector while reducing DNSE realtime stock subscriptions to only the active filtered symbols.

**Architecture:** Keep filtering and daily cache validation in pure helpers under `modules/market/board/`, persist only normalized criteria in the existing per-user `user_preferences.settings` JSON, and reuse the existing SSR quote/universe model. The client board derives an active stock-symbol set from mode; the WebSocket effect reconnects whenever that set changes, while a bounded authenticated quote-reconcile endpoint refreshes reactivated symbols before full-universe mode is treated as synchronized.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5.7, Supabase auth/RLS, DNSE browser WebSocket, existing VPS broker batch quote fetcher, Node built-in test runner.

**Spec:** `docs/superpowers/specs/2026-09-03-market-board-stock-filter-design.md`

## Global Constraints

- Filter universe is the existing canonical Top 200 board universe only.
- Persist criteria at `user_preferences.settings.marketBoard.stockFilter`; do not create a new table.
- Daily resolved ticker cache key identity is user + Vietnam date + canonical `runId` + normalized-filter hash.
- Price predicate uses latest valid board quote at Apply time with `lastClose` fallback; positive liquidity predicate uses current-session cumulative quote volume and has no historical fallback.
- Resolved ticker membership is frozen until Apply/recompute; matched ticker quotes remain realtime.
- In Filter CP mode, stock WS channels contain only filtered tickers; VNINDEX/VN30/HNX/UPCOM index channels remain realtime.
- Returning to Tất cả/Top Movers must restore full-universe subscription and reconcile reactivated quote snapshots.
- Preserve ref-backed quote/history stores, `MARKET_UI_COMMIT_MS = 250`, and `MARKET_ORDERING_REFRESH_MS = 1000`.
- Do not introduce N+1 DB/data-source reads.
- Keep changes scoped to this feature; no unrelated market-board refactor.

---

### Task 1: Pure stock-filter domain and daily cache

**Files:**
- Create: `modules/market/board/stock-filter.ts`
- Modify/Test: `tests/market-board-visual-contract.test.ts`

**Interfaces:**
- Produces:
  - `type BoardExchange = "HOSE" | "HNX" | "UPCOM"`
  - `interface StockFilterCriteriaV1 { version: 1; exchanges: BoardExchange[]; minPriceVnd: number | null; minVolumeShares: number | null; sectors: string[]; updatedAt: string }`
  - `interface FilterableBoardStock { ticker: string; exchange: string; kfspSector: string; lastClose?: number | null }`
  - `interface FilterQuote { price?: number | null; volume?: number | null }`
  - `normalizeStockFilterCriteria(input, availableSectors, nowIso?): StockFilterCriteriaV1 | null`
  - `defaultStockFilterCriteria(availableSectors, nowIso?): StockFilterCriteriaV1`
  - `filterBoardTickers(stocks, quotes, criteria): string[]`
  - `stockFilterHash(criteria): string`
  - `type StockFilterDailyCacheV1`
  - `isValidDailyFilterCache(value, expected): value is StockFilterDailyCacheV1`
  - `readStockFilterFromSettings(settings, availableSectors): StockFilterCriteriaV1 | null`
  - `mergeStockFilterIntoSettings(settings, criteria): Record<string, unknown>`

- [ ] **Step 1: Write failing helper tests**

Add Node tests that import the not-yet-existing helper and assert:

```ts
const sectors = ["Ngân hàng", "Bất động sản"]
const stocks = [
  { ticker: "VCB", exchange: "HOSE", kfspSector: "Ngân hàng", lastClose: 80 },
  { ticker: "SHB", exchange: "HNX", kfspSector: "Ngân hàng", lastClose: 12 },
  { ticker: "CEO", exchange: "HNX", kfspSector: "Bất động sản", lastClose: 18 },
]
const quotes = {
  VCB: { price: 81, volume: 1_500_000 },
  SHB: { price: 12.5, volume: 8_000_000 },
  CEO: { price: 19, volume: 900_000 },
}
```

Required assertions:

- default criteria select all 3 exchanges and all available sectors;
- normalization removes unsupported exchanges/sectors, deduplicates values, and turns zero numeric thresholds into `null`;
- invalid/empty exchange or sector selection returns `null`;
- combined HOSE + price > 20 + volume > 1,000,000 + Banking returns only `VCB`;
- positive volume threshold rejects a ticker with missing volume;
- missing live price may use valid `lastClose` for the price predicate;
- `stockFilterHash` is stable for semantically identical normalized criteria and ignores `updatedAt`;
- daily cache rejects wrong user/date/run/hash and symbols outside current universe;
- preference merge preserves unrelated settings keys.

- [ ] **Step 2: Run the board contract test and confirm RED**

Run:

```bash
node --test tests/market-board-visual-contract.test.ts
```

Expected: FAIL because `modules/market/board/stock-filter.ts` does not exist / exported helpers are missing.

- [ ] **Step 3: Implement the minimal pure helper**

Implement normalization/filter/cache/preferences functions without React, browser globals, Supabase, or network calls. Use stable sorted arrays when hashing; a deterministic short string hash is sufficient because the value is cache identity, not a security primitive.

- [ ] **Step 4: Run the test and confirm GREEN**

```bash
node --test tests/market-board-visual-contract.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add modules/market/board/stock-filter.ts tests/market-board-visual-contract.test.ts
git commit -m "feat: add market board stock filter domain"
```

---

### Task 2: Persist filter criteria and add bounded quote reconciliation API

**Files:**
- Create: `app/api/me/market-board-filter/route.ts`
- Create: `app/api/market/quotes/route.ts`
- Modify/Test: `tests/market-board-visual-contract.test.ts`

**Interfaces:**
- Consumes Task 1 helpers.
- Produces:
  - `GET /api/me/market-board-filter -> { ok: true, criteria: StockFilterCriteriaV1 | null }`
  - `PUT /api/me/market-board-filter` with normalized criteria body.
  - `POST /api/market/quotes` body `{ symbols: string[] }` -> `{ ok: true, quotes: Record<string, LiveBatchQuote>, updatedAt: string }`.

- [ ] **Step 1: Write failing API contract tests**

Source-level contract assertions must verify the new routes:

- call `requireApiUser()` before reading/writing user data;
- filter route loads canonical sectors before normalizing saved criteria;
- filter write reads existing `user_preferences.settings`, calls `mergeStockFilterIntoSettings`, checks the encoded merged JSON remains <= 16 KiB, and upserts only the caller's `user_id`;
- quotes route loads `getCanonicalUniverse()`, rejects non-array/duplicate/unsupported symbols and requests above `MARKET_UNIVERSE_MAX_SIZE`, and calls `fetchLiveBatchQuotes` only with canonical requested symbols;
- both routes return `Cache-Control: no-store` to the browser.

- [ ] **Step 2: Run contract test and confirm RED**

```bash
node --test tests/market-board-visual-contract.test.ts
```

Expected: FAIL because both route files are absent.

- [ ] **Step 3: Implement persistence route**

Use `requireApiUser`, `getCanonicalUniverse`, and Task 1 helpers. GET returns validated saved criteria. PUT validates `body.criteria`, merges into the existing settings object, size-checks the merged JSON, and upserts `{ user_id, settings }`.

- [ ] **Step 4: Implement quote-reconcile route**

Require auth, normalize uppercase unique symbols, validate them against the canonical universe, enforce the canonical max-size bound, call the existing `fetchLiveBatchQuotes(symbols)` once, and return the result without provider fan-out per symbol.

- [ ] **Step 5: Run contract test and confirm GREEN**

```bash
node --test tests/market-board-visual-contract.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/api/me/market-board-filter/route.ts app/api/market/quotes/route.ts tests/market-board-visual-contract.test.ts
git commit -m "feat: persist board filters and reconcile quotes"
```

---

### Task 3: Add raw exchange/KFSP metadata and Filter CP modal

**Files:**
- Modify: `components/live-market-stock.tsx`
- Modify: `app/page.tsx`
- Create: `components/market-board/stock-filter-modal.tsx`
- Modify: `components/live-market-board-v2.tsx`
- Modify/Test: `tests/market-board-visual-contract.test.ts`

**Interfaces:**
- `LiveBoardStock` gains `exchange: string` and `kfspSector: string`.
- `LiveMarketBoardV2` gains required props `userId: string` and `universeRunId: string`.
- Modal props:

```ts
interface StockFilterModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  universe: BoardUniverseStock[]
  quotes: Record<string, LiveStockQuote | IndexQuote>
  initialCriteria: StockFilterCriteriaV1
  onApply: (criteria: StockFilterCriteriaV1, tickers: string[]) => void
  persistenceError?: string
}
```

- [ ] **Step 1: Write failing UI/source contract tests**

Assert source contains:

- third mode value `filter` and visible copy `Filter CP` beside `Tất cả` and `Top movers`;
- modal copy/controls for HOSE/HNX/UPCOM, `Giá cổ phiếu`, `Thanh khoản`, `Ngành nghề`, `Đã chọn`, `Hủy`, `Áp dụng`;
- `app/page.tsx` maps `canonical.stocks[].exchange` and raw `sector` to `exchange`/`kfspSector` and passes `auth.user.id` + `canonical.runId` to the board;
- board loads saved criteria from `/api/me/market-board-filter` and reads/writes daily localStorage cache scoped to user/date/run/hash;
- persistence save failure keeps local filter active and exposes an error message.

- [ ] **Step 2: Run board contract test and confirm RED**

```bash
node --test tests/market-board-visual-contract.test.ts
```

Expected: FAIL on missing Filter CP/modal/metadata contracts.

- [ ] **Step 3: Extend board metadata**

Add `exchange` and `kfspSector` to `LiveBoardStock`. In `app/page.tsx`, preserve existing grouped `sector` and also pass raw canonical metadata. Pass `userId={auth.user.id}` and `universeRunId={canonical.runId}`.

- [ ] **Step 4: Implement focused modal component**

Use existing dialog/input primitives. Default all exchanges/sectors selected; disable Apply if either selected set is empty. Compute preview with Task 1 filter helper and current passed quote snapshot. Numeric inputs accept blank/zero as no constraint.

- [ ] **Step 5: Integrate saved criteria and daily cache into board**

On mount, load persisted criteria. On Filter CP click: activate valid daily cache immediately when criteria exist; otherwise resolve against current refs and populate cache. First-time users open the modal. Apply updates `filteredTickers`, cache, active mode, then asynchronously persists criteria; persistence errors do not revert local state.

- [ ] **Step 6: Render filtered mode and empty state**

Use existing stock row/card components for the filtered universe. Keep search query layered on top of filter results. Show an explicit empty state when no ticker matches.

- [ ] **Step 7: Run board contract test and confirm GREEN**

```bash
node --test tests/market-board-visual-contract.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add app/page.tsx components/live-market-stock.tsx components/live-market-board-v2.tsx components/market-board/stock-filter-modal.tsx tests/market-board-visual-contract.test.ts
git commit -m "feat: add market board filter UI"
```

---

### Task 4: Scope DNSE subscriptions to active symbols and reconcile expansion

**Files:**
- Create: `modules/market/board/dnse-subscriptions.ts`
- Modify: `components/live-market-board-v2.tsx`
- Modify/Test: `tests/market-board-visual-contract.test.ts`

**Interfaces:**
- Produces:

```ts
export function activeBoardStockSymbols(
  mode: "sector" | "movers" | "filter",
  fullSymbols: readonly string[],
  filteredSymbols: readonly string[],
): string[]

export function buildDnseBoardChannels(stockSymbols: readonly string[]): Array<{
  name: string
  symbols?: string[]
}>
```

- [ ] **Step 1: Write failing subscription tests**

Assert:

- `activeBoardStockSymbols("filter", full, filtered)` returns only filtered symbols;
- sector/movers return the full universe;
- `buildDnseBoardChannels(["VCB"])` puts only VCB into tick/top-price/foreign stock channels and VCB + VN30F1M in OHLC;
- an empty filtered set does not accidentally subscribe the full universe and still includes index channels plus VN30F1M OHLC;
- board source builds the WS effect from `activeStockSymbols`, not full `symbolList`;
- watchlist membership is not appended to Filter CP WS symbols.

- [ ] **Step 2: Run board contract test and confirm RED**

```bash
node --test tests/market-board-visual-contract.test.ts
```

Expected: FAIL because subscription helper and active-symbol lifecycle are absent.

- [ ] **Step 3: Implement pure subscription helper**

Keep DNSE channel names exactly compatible with the current board: `tick.G1.json`, `top_price.G1.json`, `ohlc.1.json`, `foreign.G1.json`, and market-index channels for VNINDEX/VN30/HNX/UPCOM.

- [ ] **Step 4: Switch WS effect to active symbols**

Derive stable `activeStockSymbols`/key and tracked set. Make the existing socket effect depend on that key, so cleanup closes the old socket and the new connection subscribes only to the new set.

- [ ] **Step 5: Reconcile when expanding back to full universe**

Track the previous active-symbol set. When mode change expands the set, set stream state to CONNECTING, POST the full active symbols to `/api/market/quotes`, merge returned current quotes into `quotesRef`, schedule/publish a UI snapshot, then allow LIVE state. If reconcile fails, expose a stream error and keep existing reconnect behavior; do not silently subscribe full data while Filter CP remains selected.

- [ ] **Step 6: Run board contract test and confirm GREEN**

```bash
node --test tests/market-board-visual-contract.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add modules/market/board/dnse-subscriptions.ts components/live-market-board-v2.tsx tests/market-board-visual-contract.test.ts
git commit -m "perf: scope market board realtime subscriptions"
```

---

### Task 5: Regression verification and documentation

**Files:**
- Modify: `docs/market-board.md`
- Test: existing build/test suite

**Interfaces:** none; this task verifies the completed feature.

- [ ] **Step 1: Update market-board documentation**

Document Filter CP criteria semantics, daily freeze/cache behavior, per-user persistence, and active-symbol WS scoping. Explicitly note that Tất cả/Top Movers restore the full subscription with quote reconciliation.

- [ ] **Step 2: Run focused tests**

```bash
node --test tests/market-board-visual-contract.test.ts tests/auth-api-contract.test.ts tests/top-stocks-200-runtime-regression.test.ts
```

Expected: PASS, 0 failures.

- [ ] **Step 3: Run typecheck**

```bash
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 4: Lint touched feature files**

```bash
pnpm eslint app/page.tsx components/live-market-stock.tsx components/live-market-board-v2.tsx components/market-board/stock-filter-modal.tsx modules/market/board/stock-filter.ts modules/market/board/dnse-subscriptions.ts app/api/me/market-board-filter/route.ts app/api/market/quotes/route.ts tests/market-board-visual-contract.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run production build gate**

```bash
pnpm build
```

Expected: prebuild + Next production build PASS.

- [ ] **Step 6: Review diff for N+1 / subscription regressions**

Confirm by inspection:

- only one preferences read/write per explicit filter load/save;
- quote reconcile uses one bounded broker batch call;
- filter evaluation is local O(N) over <= canonical universe size;
- Filter CP stock WS payload contains exactly `filteredTickers`;
- returning to full mode restores exactly canonical symbols;
- index channels are always present.

- [ ] **Step 7: Commit docs/final fixes**

```bash
git add docs/market-board.md
git commit -m "docs: document market board stock filters"
```
