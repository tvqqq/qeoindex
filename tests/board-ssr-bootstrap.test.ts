import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { build } from "esbuild"
import test from "node:test"

import { readFirstValidCacheValue } from "../modules/shared/cache/io-budget.ts"

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

test("a stalled cache read returns within its budget and does not start later cache reads", async () => {
  let laterReads = 0
  const startedAt = Date.now()
  const snapshot = await readFirstValidCacheValue([
    {
      read: () => new Promise<unknown>(() => {}),
      validate: (value): value is string => typeof value === "string",
    },
    {
      read: () => {
        laterReads += 1
        return "cached"
      },
      validate: (value): value is string => typeof value === "string",
    },
  ], 35)

  assert.equal(snapshot, null)
  assert.equal(laterReads, 0)
  assert.ok(Date.now() - startedAt < 500, "a never-settling read must not hold the caller past its budget")
})

test("omitting a cache I/O budget preserves sequential fallback across cache misses", async () => {
  const snapshot = await readFirstValidCacheValue([
    {
      read: () => new Promise<unknown>((resolve) => setTimeout(() => resolve(undefined), 15)),
      validate: (value): value is string => typeof value === "string",
    },
    {
      read: () => "cached",
      validate: (value): value is string => typeof value === "string",
    },
  ])

  assert.equal(snapshot, "cached")
})

test("the authenticated board renders through its cache-only history path without provider fan-out on miss", async () => {
  const moduleStubs: Record<string, string> = {
    "@/components/auth/landing-login": "export function LandingLogin() { return null }",
    "@/components/market-board/market-board-filter-shell": "export function MarketBoardFilterShell() { return null }",
    "@/components/market-universe-version-refresh": "export function MarketUniverseVersionRefresh() { return null }",
    "@/components/orderbook/orderbook-context": "export function OrderBookProvider() { return null }",
    "@/components/orderbook/orderbook-manager": "export function OrderBookManager() { return null }",
    "@/components/smoothui/market-board-transition": "export default function MarketBoardTransition() { return null }",
    "@/components/top-nav": "export function TopNav() { return null }",
    "@/modules/auth/server": "export const getServerAuthContext = (...args) => globalThis.__boardSsrMocks.getServerAuthContext(...args)",
    "@/modules/market/sectors": "export const boardSectorGroupForSector = (...args) => globalThis.__boardSsrMocks.boardSectorGroupForSector(...args); export const sectorForTicker = (...args) => globalThis.__boardSsrMocks.sectorForTicker(...args)",
    "@/modules/market/universe/index": "export const getCanonicalUniverse = (...args) => globalThis.__boardSsrMocks.getCanonicalUniverse(...args)",
    "@/modules/shared/supabase/board-overview": "export const getCanonicalBoardOverviewSnapshots = (...args) => globalThis.__boardSsrMocks.getCanonicalBoardOverviewSnapshots(...args)",
    "@/modules/market/realtime/session-countdown": "export const isTradingSessionOpen = (...args) => globalThis.__boardSsrMocks.isTradingSessionOpen(...args); export const getMarketSessionStatus = (...args) => globalThis.__boardSsrMocks.getMarketSessionStatus(...args)",
    "@/modules/market/realtime/broker-live-quotes": "export const fetchLiveBatchQuotes = (...args) => globalThis.__boardSsrMocks.fetchLiveBatchQuotes(...args)",
    "@/modules/shared/cache/ui-data-cache": "export const readThroughUiCache = (...args) => globalThis.__boardSsrMocks.readThroughUiCache(...args)",
    "@/modules/market/realtime/intraday-5m-service": "export const getCachedIntraday5mSnapshot = (...args) => globalThis.__boardSsrMocks.getCachedIntraday5mSnapshot(...args); export const getIntraday5mSnapshot = (...args) => globalThis.__boardSsrMocks.getIntraday5mSnapshot(...args)",
    "@/modules/market/realtime/session-ui": "export const miniChartPointsForDisplay = (...args) => globalThis.__boardSsrMocks.miniChartPointsForDisplay(...args)",
    "@/modules/eod/shares": "export const getEodForeignRoom = (...args) => globalThis.__boardSsrMocks.getEodForeignRoom(...args)",
    "@/modules/market/board/vn30-membership": "export const getVn30Membership = (...args) => globalThis.__boardSsrMocks.getVn30Membership(...args)",
    "@/modules/market/board/previous-session-volume": "export const getPreviousSessionVolumes = (...args) => globalThis.__boardSsrMocks.getPreviousSessionVolumes(...args)",
    "@/modules/market/board/industry-priceboard": "export const verifiedBoardSessionVolume = (quote, day) => quote?.volumeSessionDay === day && Number.isInteger(quote?.volume) && quote?.volume >= 0 && quote?.volumeAsOf ? quote : null",
    "../market-board-performance.module.css": "export default { performanceSurface: 'surface' }",
    "react/jsx-runtime": "export function jsx(type, props, key) { return { type, props, key } }; export const jsxs = jsx; export const Fragment = Symbol.for('react.fragment')",
  }

  const esbuildResult = await build({
    entryPoints: [new URL("../app/board/page.tsx", import.meta.url).pathname],
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
    target: "node22",
    jsx: "automatic",
    plugins: [{
      name: "board-page-test-stubs",
      setup(buildApi) {
        buildApi.onResolve({ filter: /.*/ }, (args) => args.kind === "entry-point"
          ? undefined
          : { path: args.path, namespace: "board-page-test-stubs" })
        buildApi.onLoad({ filter: /.*/, namespace: "board-page-test-stubs" }, (args) => {
          const contents = moduleStubs[args.path]
          if (!contents) throw new Error(`Missing board page test stub for ${args.path}`)
          return { contents, loader: "js" }
        })
      },
    }],
  })

  const boardPageModule = await import(`data:text/javascript;base64,${Buffer.from(esbuildResult.outputFiles[0].contents).toString("base64")}`)
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date())
  const historyPoints = [{ time: 1_797_000_000, close: 12.5 }]
  let cachedHistoryCalls = 0
  let providerHistoryCalls = 0
  const mocks = {
    getServerAuthContext: async () => ({ user: { id: "test-user" } }),
    boardSectorGroupForSector: () => ({ sectors: ["Technology"] }),
    sectorForTicker: () => "Technology",
    getCanonicalUniverse: async () => ({
      runId: "universe-test",
      stocks: [{ ticker: "ABC", rank: 1, sector: "Technology", exchange: "HOSE", averageVolume50d: 100, marketCapBillion: 1_000 }],
    }),
    getCanonicalBoardOverviewSnapshots: async () => ({
      ABC: { latest_price: 10, reference_price: 9, session_date: today, total_volume: 7, updated_at: new Date().toISOString(), intraday_1m: historyPoints },
    }),
    isTradingSessionOpen: () => false,
    getMarketSessionStatus: () => ({ isLiveSession: false, ttlSeconds: 60, cacheBucketKey: "closed" }),
    fetchLiveBatchQuotes: async () => ({ ABC: { price: 10.5, reference: 9.5, change: 1, changePercent: 10, volume: 3 } }),
    readThroughUiCache: async (options: { load: () => Promise<unknown> }) => options.load(),
    getCachedIntraday5mSnapshot: async () => {
      cachedHistoryCalls += 1
      return null
    },
    getIntraday5mSnapshot: async () => {
      providerHistoryCalls += 1
      throw new Error("SSR must not invoke provider history")
    },
    miniChartPointsForDisplay: (points: unknown[]) => points,
    getEodForeignRoom: () => null,
    getVn30Membership: async () => null,
    getPreviousSessionVolumes: async () => ({ ABC: 2 }),
  }
  const globalWithMocks = globalThis as typeof globalThis & { __boardSsrMocks?: typeof mocks }
  const previousMocks = globalWithMocks.__boardSsrMocks
  globalWithMocks.__boardSsrMocks = mocks
  let tree: unknown
  try {
    tree = await boardPageModule.default()
  } finally {
    if (previousMocks) globalWithMocks.__boardSsrMocks = previousMocks
    else delete globalWithMocks.__boardSsrMocks
  }
  const findElement = (node: unknown, name: string): { props: Record<string, any> } | null => {
    if (Array.isArray(node)) {
      for (const child of node) {
        const found = findElement(child, name)
        if (found) return found
      }
      return null
    }
    if (!node || typeof node !== "object") return null
    const element = node as { type?: unknown; props?: Record<string, unknown> }
    if (typeof element.type === "function" && element.type.name === name) {
      return { props: (element.props ?? {}) as Record<string, any> }
    }
    return findElement(element.props?.children, name)
  }

  const board = findElement(tree, "MarketBoardFilterShell")
  assert.ok(board)
  assert.equal(cachedHistoryCalls, 1)
  assert.equal(providerHistoryCalls, 0)
  assert.deepEqual(board.props.initialHistories.ABC, historyPoints, "same-day Supabase intraday history remains the miss fallback")
  assert.equal(board.props.initialQuotes.ABC.price, 10.5, "live quote precedence remains intact")
  assert.equal(board.props.initialQuotes.ABC.reference, 9.5, "live reference precedence remains intact")
  assert.equal(board.props.initialQuotes.ABC.volume, 7, "verified same-day volume beats timestamp-free VPS SSR volume")
  assert.equal(board.props.initialQuotes.ABC.volumeSessionDay, today)
  assert.equal(board.props.universe[0].previousSessionVolume, 2, "previous completed-session volume stays available on the SSR universe")
})

test("board SSR and VN30 cache calls opt into finite I/O budgets without changing other cache callers", () => {
  const page = source("app/board/page.tsx")
  const membership = source("modules/market/board/vn30-membership.ts")
  const uiCache = source("modules/shared/cache/ui-data-cache.ts")
  const intraday = source("modules/market/realtime/intraday-5m-service.ts")

  assert.match(page, /BOARD_SSR_CACHE_NAMESPACE = "board-ssr-v12"/)
  assert.match(page, /getCachedIntraday5mSnapshot\(tickers, now, \{ ioBudgetMs: BOARD_INTRADAY_CACHE_IO_BUDGET_MS \}\)/)
  assert.doesNotMatch(page, /getIntraday5mSnapshot/)
  assert.match(page, /ioBudgetMs: BOARD_CACHE_IO_BUDGET_MS/)
  assert.match(membership, /ioBudgetMs: options\.ioBudgetMs/)
  assert.match(uiCache, /ioBudgetMs\?: number/)
  assert.match(uiCache, /createIoBudget\(ioBudgetMs\)/)
  assert.match(intraday, /isUsableCachedIntradaySnapshot\(value, symbols, now\)/)
  assert.match(intraday, /isUsableLatestCachedIntradaySnapshot\(value, symbols, now\)/)
})
