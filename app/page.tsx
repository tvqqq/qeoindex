import { LandingLogin } from "@/components/auth/landing-login"
import { LiveMarketBoardV2, type BoardUniverseStock, type IndexQuote } from "@/components/live-market-board-v2"
import { OrderBookProvider } from "@/components/orderbook/orderbook-context"
import { OrderBookManager } from "@/components/orderbook/orderbook-manager"
import { TopNav } from "@/components/top-nav"
import { getServerAuthContext } from "@/lib/auth/server"
import { sectorForTicker } from "@/lib/market-sectors"
import { CANONICAL_UNIVERSE_STOCKS, CANONICAL_UNIVERSE_TICKERS } from "@/lib/wyckoff-universe"
import { getBoardOverviewSnapshotsFromSupabase } from "@/lib/supabase/orderbook"
import { isTradingSessionOpen, getMarketSessionStatus } from "@/lib/session-countdown"
import { fetchLiveBatchQuotes } from "@/lib/broker-live-quotes"
import { readThroughUiCache } from "@/lib/ui-data-cache"
import { getIntraday5mSnapshot } from "@/lib/intraday-5m-service"
import type { LiveStockQuote } from "@/components/live-market-stock"
import type { IntradayPoint } from "@/lib/intraday-5m"
import { getEodForeignRoom } from "@/lib/eod-shares"
import styles from "./market-board-performance.module.css"

export const dynamic = "force-dynamic"

const INITIAL_HISTORY_POINTS = 90
const BOARD_SSR_CACHE_NAMESPACE = "board-ssr-v3"

type InitialBoardData = {
  universe: BoardUniverseStock[]
  initialQuotes: Record<string, LiveStockQuote | IndexQuote>
  initialHistories: Record<string, IntradayPoint[]>
}

function isInitialBoardData(value: unknown): value is InitialBoardData {
  if (!value || typeof value !== "object") return false
  const d = value as Partial<InitialBoardData>
  return Array.isArray(d.universe) && typeof d.initialQuotes === "object" && typeof d.initialHistories === "object"
}

function vietnamDateKey(now: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now)
}

async function loadInitialBoardDataCanonical(now: Date): Promise<InitialBoardData> {
  const currentDay = vietnamDateKey(now)
  const [snapshots, liveQuotes, intraday5m] = await Promise.all([
    getBoardOverviewSnapshotsFromSupabase(),
    fetchLiveBatchQuotes(CANONICAL_UNIVERSE_TICKERS),
    getIntraday5mSnapshot(CANONICAL_UNIVERSE_TICKERS, now),
  ])

  const cachedRowsBySymbol = intraday5m?.rows
    ? Object.fromEntries(intraday5m.rows.map((row) => [row.symbol, row]))
    : null

  const universe: BoardUniverseStock[] = CANONICAL_UNIVERSE_STOCKS.map((stock) => {
    const snap = snapshots[stock.ticker]
    const live = liveQuotes[stock.ticker]
    const cachedRow = cachedRowsBySymbol?.[stock.ticker]
    const lastClosePrice = live?.price || snap?.latest_price || cachedRow?.price || snap?.reference_price || null
    return {
      ticker: stock.ticker,
      rank: stock.rank,
      sector: sectorForTicker(stock.ticker),
      marketCapT: stock.marketCapT,
      lastClose: lastClosePrice,
      lastCloseDate: snap?.session_date || "",
    }
  })

  const initialQuotes: Record<string, LiveStockQuote | IndexQuote> = {}
  const initialHistories: Record<string, IntradayPoint[]> = {}

  for (const stock of universe) {
    const snap = snapshots[stock.ticker]
    const live = liveQuotes[stock.ticker]
    const cachedRow = cachedRowsBySymbol?.[stock.ticker]

    let intraday: IntradayPoint[] = []
    if (cachedRow?.points && cachedRow.points.length > 0) {
      intraday = cachedRow.points.slice(-INITIAL_HISTORY_POINTS)
    } else if (Array.isArray(snap?.intraday_1m) && snap?.session_date === currentDay && snap.intraday_1m.length > 0) {
      intraday = (snap.intraday_1m as unknown as IntradayPoint[]).slice(-INITIAL_HISTORY_POINTS)
    }

    const lastBarClose = intraday.length > 0 ? (intraday[intraday.length - 1].close ?? (intraday[intraday.length - 1] as any)?.c) : null
    const firstBarOpen = intraday.length > 0 ? ((intraday[0] as any)?.open ?? (intraday[0] as any)?.o ?? intraday[0]?.close) : null

    const latestPrice = live?.price || snap?.latest_price || cachedRow?.price || snap?.reference_price || lastBarClose || firstBarOpen
    const ref = live?.reference || snap?.reference_price || cachedRow?.reference || firstBarOpen || latestPrice

    if (latestPrice && latestPrice > 0 && ref && ref > 0) {
      const change = live?.change ?? (latestPrice - ref)
      const changePercent = live?.changePercent ?? ((change / ref) * 100)
      initialQuotes[stock.ticker] = {
        symbol: stock.ticker,
        price: latestPrice,
        reference: ref,
        ceiling: live?.ceiling ?? snap?.ceiling_price ?? Math.round(ref * 1.07 * 100) / 100,
        floor: live?.floor ?? snap?.floor_price ?? Math.round(ref * 0.93 * 100) / 100,
        change,
        changePercent,
        volume: live?.volume || snap?.total_volume || 0,
        foreignNetValue: live?.foreignNetValue ?? (snap?.foreign_flow as any)?.foreignNetValue,
        foreignBuyValue: live?.foreignBuyValue ?? (snap?.foreign_flow as any)?.totalBuyValue,
        foreignSellValue: live?.foreignSellValue ?? (snap?.foreign_flow as any)?.totalSellValue,
        foreignBuyVolume: live?.foreignBuyVolume ?? (snap?.foreign_flow as any)?.totalBuyVolume,
        foreignSellVolume: live?.foreignSellVolume ?? (snap?.foreign_flow as any)?.totalSellVolume,
        foreignRoom: live?.foreignRoom ?? (snap?.foreign_flow as any)?.foreignRoom ?? getEodForeignRoom(stock.ticker) ?? null,
        updatedAt: snap?.updated_at || new Date().toISOString(),
      }
      if (intraday.length > 0) {
        initialHistories[stock.ticker] = intraday
      }
    }
  }

  return { universe, initialQuotes, initialHistories }
}

export default async function Page() {
  const auth = await getServerAuthContext()
  if (!auth) return <LandingLogin />

  const now = new Date()
  const isSessionOpen = isTradingSessionOpen(now)
  const session = getMarketSessionStatus(now)
  const ttlSeconds = session.isLiveSession ? 4 : Math.min(session.ttlSeconds, 3600)
  const cacheKey = `ssr:${vietnamDateKey(now)}:${session.cacheBucketKey}`

  const { universe, initialQuotes, initialHistories } = await readThroughUiCache({
    namespace: BOARD_SSR_CACHE_NAMESPACE,
    key: cacheKey,
    tag: "board-ssr",
    name: "QeoIndex Board SSR Initial Data",
    ttlSeconds,
    validate: isInitialBoardData,
    load: () => loadInitialBoardDataCanonical(now),
  })

  return (
    <OrderBookProvider>
      <div data-market-board className={`${styles.performanceSurface} flex h-screen flex-col overflow-hidden bg-background`}>
        <TopNav />
        <main className="min-h-0 flex-1">
          <LiveMarketBoardV2
            universe={universe}
            initialQuotes={initialQuotes}
            initialHistories={initialHistories}
            isSessionOpen={isSessionOpen}
          />
        </main>
        <OrderBookManager />
      </div>
    </OrderBookProvider>
  )
}
