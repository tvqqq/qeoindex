"use client"

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  Activity,
  Camera,
  ChartNoAxesCombined,
  Check,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  Building2,
  Factory,
  Eye,
  EyeOff,
  Landmark,
  Layers,
  LayoutGrid,
  Loader2,
  RefreshCw,
  Search,
  Table2,
  PanelsTopLeft,
  ShoppingBag,
  Star,
  TrendingUp,
  Volume2,
  VolumeX,
} from "lucide-react"
import { MarketChangePill } from "@/components/market-change-pill"
import { IndexChartModal } from "@/components/index-chart/index-chart-modal"
import { marketToneFromChange } from "@/modules/market/tone"
import { BOARD_SECTOR_GROUPS } from "@/modules/market/sectors"
import { useOrderBooks } from "@/components/orderbook/orderbook-context"
import { LiveMoverCard, LiveStockRow, type LiveBoardStock, type LiveStockQuote } from "@/components/live-market-stock"
import { IndustryPriceboard } from "@/components/market-board/industry-priceboard"
import { MarketContextStrip } from "@/components/market-board/market-context-strip"
import { industryLabelForStock } from "@/modules/market/board/industry-priceboard"
import type { Vn30Membership } from "@/modules/market/board/vn30-membership-contract"
import { mergeFiveMinuteClose, normalizeEpochSeconds, normalizeMarketPrice, type IntradayPoint } from "@/modules/market/realtime/intraday-5m"
import { isTradingSessionOpen, isLunchBreak } from "@/modules/market/realtime/session-countdown"
import {
  getMarketUiPhase,
  MARKET_SESSION_RESET_EVENT,
  newSessionReferencePoint,
  shouldAcceptRealtimeMiniChart,
  shouldResetForNewTradingDay,
  type MarketUiPhase,
} from "@/modules/market/realtime/session-ui"
import { setSoundEnabled, playWhaleSound } from "@/modules/shared/ui/sound-engine"
import {
  restartDnseMarketStream,
  subscribeDnseMarketFrames,
  subscribeDnseMarketStreamState,
} from "@/modules/market/providers/dnse/market-stream"
import { captureMarketBoardScreenshot, copyBlobToClipboard } from "@/modules/shared/media/screenshot"
import {
  isProviderTimestampNotOlder,
  isSameVietnamSessionTimestamp,
  parseDnseForeignFrame,
  parseDnseMarketIndexFrame,
  type VerifiedSessionReference,
} from "@/modules/market/board/dnse-market-frame"
import {
  parseVnindexImpactPayload,
  type MarketImpactSnapshot,
} from "@/modules/market/board/market-context-contract"

export type BoardUniverseStock = LiveBoardStock
export type IndexQuote = {
  symbol: string
  value: number
  reference?: number
  change?: number
  changePercent?: number
  volume?: number
  valueTraded?: number
  advances?: number
  declines?: number
  unchanged?: number
  sourceAsOf?: string
  updatedAt: string
}
type BoardMode = "sector" | "movers"
type BoardView = "classic" | "industry"

const MARKET_UI_COMMIT_MS = 250
const MARKET_ORDERING_REFRESH_MS = 1000
const SSR_HISTORY_COVERAGE_MIN = 0.95
const EMPTY_HISTORY: number[] = []

type StreamState = "CONNECTING" | "LIVE" | "ERROR" | "CLOSED"
type IntradayHistoryResponse = {
  ok: boolean
  histories?: Record<string, { symbol: string; provider: "Yahoo" | null; points: IntradayPoint[]; reference: number | null; price: number | null; change: number | null; changePercent: number | null; lastBarAt: number | null; error: string | null }>
}
type IndexHistoryResponse = { ok: boolean; quotes?: Record<string, IndexQuote> }
type QuoteReconcileResponse = {
  ok: boolean
  quotes?: Record<string, {
    symbol: string
    price: number | null
    reference: number | null
    ceiling: number | null
    floor: number | null
    change: number | null
    changePercent: number | null
    volume: number | null
    foreignBuyVolume?: number | null
    foreignSellVolume?: number | null
    foreignBuyValue?: number | null
    foreignSellValue?: number | null
    foreignNetValue?: number | null
    foreignRoom?: number | null
  }>
  updatedAt?: string
}

const STOCK_REFERENCE_KEYS = ["referencePrice", "refPrice", "reference", "basicPrice", "previousClose", "prevClose", "priorClose"]
const WATCHLIST_KEY = "stockos:watchlist:v1"
const WATCHLIST_VISIBILITY_KEY = "qeoindex_show_watchlist"
const BOARD_VIEW_KEY = "qeoindex:market-board-view:v1"
const MARKET_CONTEXT_VISIBILITY_KEY = "qeoindex:market-context-visible:v1"
const INDUSTRY_PRICE_VOLUME_VISIBILITY_KEY = "qeoindex:industry-price-volume-visible:v1"

const SECTOR_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  bank: Landmark,
  securities: TrendingUp,
  consumer: ShoppingBag,
  "real-estate": Building2,
  "industrial-tech": Factory,
  other: Layers,
}

const SECTOR_BORDER_ACCENTS: Record<string, string> = {
  bank: "border-t-cyan-400",
  securities: "border-t-purple-400",
  consumer: "border-t-rose-400",
  "real-estate": "border-t-amber-400",
  "industrial-tech": "border-t-emerald-400",
  other: "border-t-indigo-400",
}

const SECTOR_ICON_BADGES: Record<string, string> = {
  bank: "bg-cyan-500/10 text-cyan-300 border-cyan-400/30",
  securities: "bg-purple-500/10 text-purple-300 border-purple-400/30",
  consumer: "bg-rose-500/10 text-rose-300 border-rose-400/30",
  "real-estate": "bg-amber-500/10 text-amber-300 border-amber-400/30",
  "industrial-tech": "bg-emerald-500/10 text-emerald-300 border-emerald-400/30",
  other: "bg-indigo-500/10 text-indigo-300 border-indigo-400/30",
}

function numeric(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function firstPositive(data: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = numeric(data[key])
    if (value > 0) return value
  }
  return 0
}

function vietnamSessionDay(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date)
}

function isCurrentSessionProviderTime(asOf: string, sessionDate: string) {
  const date = new Date(asOf)
  return isSameVietnamSessionTimestamp(asOf, sessionDate) && isTradingSessionOpen(date)
}

function normalizeIndexName(value: unknown) {
  const name = String(value ?? "").trim().toUpperCase().replace(/[-_ ]/g, "")
  if (name === "VNINDEX") return "VNINDEX"
  if (name === "VN30") return "VN30"
  if (name === "HNX" || name === "HNXINDEX") return "HNXINDEX"
  if (name === "UPCOM" || name === "UPCOMINDEX") return "UPCOMINDEX"
  return ""
}

function compareByPerformance(a: BoardUniverseStock, b: BoardUniverseStock, quotes: Record<string, LiveStockQuote | IndexQuote>) {
  const aq = quotes[a.ticker] as LiveStockQuote | undefined
  const bq = quotes[b.ticker] as LiveStockQuote | undefined
  const aValid = Boolean(aq && Number.isFinite(aq.price) && aq.price > 0 && Number.isFinite(aq.changePercent))
  const bValid = Boolean(bq && Number.isFinite(bq.price) && bq.price > 0 && Number.isFinite(bq.changePercent))
  if (aValid !== bValid) return aValid ? -1 : 1
  if (aValid && bValid && aq && bq && aq.changePercent !== bq.changePercent) return bq.changePercent - aq.changePercent
  if (aq && bq && aq.volume && bq.volume && bq.volume !== aq.volume) return bq.volume - aq.volume
  if (aq && !bq) return -1
  if (bq && !aq) return 1
  return a.rank - b.rank
}

const WatchlistSection = memo(function WatchlistSection({
  watchedStocks,
  quotes,
  priceHistoryCloses,
  whaleAlerts,
  onToggleWatch,
  onOpen,
  showCharts,
}: {
  watchedStocks: BoardUniverseStock[]
  quotes: Record<string, LiveStockQuote | IndexQuote | undefined>
  priceHistoryCloses: Record<string, number[]>
  whaleAlerts: Record<string, boolean>
  onToggleWatch: (ticker: string) => void
  onOpen: (ticker: string) => void
  showCharts: boolean
}) {
  if (watchedStocks.length === 0) return null
  return (
    <div className="mb-3 rounded-2xl border border-amber-500/25 bg-[#0b0f14] p-2.5">
      <div className="mb-2 flex items-center justify-between px-1">
        <div className="flex items-center gap-1.5">
          <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
          <span className="text-[11px] font-bold uppercase tracking-wider text-foreground">Danh sách theo dõi</span>
          <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-400">{watchedStocks.length}</span>
        </div>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-0.5 scrollbar-thin">
        {watchedStocks.map((stock) => (
          <div key={stock.ticker} className="min-w-[180px] max-w-[220px] flex-1 shrink-0">
            <LiveStockRow
              stock={stock}
              quote={quotes[stock.ticker] as LiveStockQuote | undefined}
              history={priceHistoryCloses[stock.ticker] ?? EMPTY_HISTORY}
              showChart={showCharts}
              onOpen={() => onOpen(stock.ticker)}
              isWatched
              isWhaleActive={Boolean(whaleAlerts[stock.ticker])}
              onToggleWatch={(event) => { event.stopPropagation(); onToggleWatch(stock.ticker) }}
            />
          </div>
        ))}
      </div>
    </div>
  )
})

const FloatingMarketStatus = memo(function FloatingMarketStatus({
  streamState,
  streamError,
  liveCount,
  pricedCount,
  historyCount,
  universeLength,
  advances,
  declines,
  lastMessageAt,
  soundEnabled,
  isLunch,
  sessionOpen,
  onToggleSound,
  onReconnect,
  onCaptureScreenshot,
  isCapturing,
  copiedToast,
}: {
  streamState: StreamState
  streamError: string
  liveCount: number
  pricedCount: number
  historyCount: number
  universeLength: number
  advances: number
  declines: number
  lastMessageAt: string
  soundEnabled: boolean
  isLunch?: boolean
  sessionOpen?: boolean
  onToggleSound: () => void
  onReconnect: () => void
  onCaptureScreenshot: () => void
  isCapturing?: boolean
  copiedToast?: boolean
}) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="fixed bottom-3 right-3 z-30 flex flex-col items-end select-none" data-screenshot-exclude="true">
      {copiedToast ? (
        <div className="mb-2 flex items-center gap-2 rounded-full border border-emerald-500/40 bg-[#091811]/95 px-3.5 py-1.5 text-xs text-emerald-300 shadow-[0_10px_30px_rgba(16,185,129,0.35),inset_0_1px_0_0_rgba(255,255,255,0.2)] backdrop-blur-2xl animate-in fade-in slide-in-from-bottom-2 duration-200 select-none">
          <Check className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
          <span className="font-semibold">Đã sao chép ảnh bảng điện vào Clipboard!</span>
        </div>
      ) : null}

      {expanded ? (
        <div className="mb-2 w-72 rounded-2xl border border-white/[0.12] bg-[#0b0f14]/95 p-3.5 shadow-[0_20px_60px_rgba(0,0,0,0.9),inset_0_1px_0_0_rgba(255,255,255,0.12)] backdrop-blur-2xl text-xs space-y-2.5 animate-in fade-in slide-in-from-bottom-2 duration-150">
          <div className="flex items-center justify-between border-b border-white/[0.08] pb-2">
            <span className="font-bold text-foreground flex items-center gap-1.5">
              <Activity className="h-3.5 w-3.5 text-brand" />
              <span>Trạng thái Hệ thống</span>
            </span>
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="text-muted-2 hover:text-foreground text-[10px] px-1.5 py-0.5 rounded-full hover:bg-white/[0.06] transition-colors"
            >
              Đóng ✕
            </button>
          </div>

          <div className="space-y-1.5 font-mono text-[11px] text-muted-2">
            <div className="flex justify-between">
              <span>Độ rộng TT:</span>
              <span>
                <b className="text-up">▲ {advances}</b> · <b className="text-down">▼ {declines}</b>
              </span>
            </div>
            <div className="flex justify-between">
              <span>Có giá / Top 100:</span>
              <span className="text-foreground font-bold">{pricedCount}/{universeLength}</span>
            </div>
            <div className="flex justify-between">
              <span>Biểu đồ nến:</span>
              <span className="text-foreground">{historyCount}/{universeLength}</span>
            </div>
            <div className="flex justify-between">
              <span>Realtime relay:</span>
              <span className={`font-bold ${isLunch ? "text-amber-400 font-sans" : "text-foreground"}`}>
                {isLunch ? "Giờ nghỉ trưa (Tạm dừng)" : `${liveCount}/${universeLength}`}
              </span>
            </div>
            {lastMessageAt ? (
              <div className="flex justify-between">
                <span>Cập nhật cuối:</span>
                <span className="text-foreground">
                  {new Date(lastMessageAt).toLocaleTimeString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}
                </span>
              </div>
            ) : null}
          </div>

          {streamError ? (
            <div className="rounded-xl bg-ref/10 border border-ref/30 p-2 text-[10px] text-ref leading-tight">
              {streamError}
            </div>
          ) : null}

          <button
            type="button"
            onClick={onReconnect}
            className="w-full flex items-center justify-center gap-1.5 rounded-xl border border-white/[0.08] bg-white/[0.04] py-1.5 text-[11px] font-semibold text-foreground hover:bg-white/[0.08] transition-colors shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)]"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${streamState === "CONNECTING" ? "animate-spin text-ref" : ""}`} />
            <span>Kết nối lại Realtime Feed</span>
          </button>
        </div>
      ) : null}

      <div className="flex items-center gap-1 rounded-full border border-white/[0.12] bg-[#0c1015]/90 pl-1.5 pr-3 py-1 shadow-[0_12px_36px_rgba(0,0,0,0.75),inset_0_1px_0_0_rgba(255,255,255,0.12)] backdrop-blur-2xl text-[11px]">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onToggleSound()
          }}
          className={`flex h-6 w-6 items-center justify-center rounded-full transition-all ${
            soundEnabled
              ? "bg-amber-500/20 text-amber-300 hover:bg-amber-500/30"
              : "text-muted-2 hover:text-foreground hover:bg-white/[0.08]"
          }`}
          title={soundEnabled ? "Âm thanh Lệnh Cá Mập: Đang BẬT (Click để tắt)" : "Âm thanh Lệnh Cá Mập: Đang TẮT (Click để bật)"}
        >
          {soundEnabled ? <Volume2 className="h-3.5 w-3.5 text-amber-400" /> : <VolumeX className="h-3.5 w-3.5" />}
        </button>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onCaptureScreenshot()
          }}
          disabled={isCapturing}
          className={`flex h-6 w-6 items-center justify-center rounded-full transition-all ${
            copiedToast
              ? "bg-emerald-500/25 text-emerald-300 shadow-[0_0_10px_rgba(16,185,129,0.4)]"
              : isCapturing
                ? "bg-white/[0.08] text-white animate-pulse cursor-wait"
                : "text-muted-2 hover:text-foreground hover:bg-white/[0.08]"
          }`}
          title="Chụp ảnh toàn bộ bảng điện (Tự động kèm logo chìm QeoIndex và sao chép vào Clipboard)"
        >
          {copiedToast ? (
            <Check className="h-3.5 w-3.5 text-emerald-400" />
          ) : isCapturing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-400" />
          ) : (
            <Camera className="h-3.5 w-3.5" />
          )}
        </button>

        <span className="h-3 w-[1px] bg-white/[0.12]" />

        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-2 pl-1 hover:opacity-90 transition-opacity"
          title={isLunch ? "Đang trong giờ nghỉ trưa (11:30 - 13:00) — Tạm dừng cập nhật giá & nến" : "Bấm để xem chi tiết trạng thái hệ thống"}
        >
          <span
            className={`h-2 w-2 rounded-full ${
              isLunch
                ? "bg-amber-400"
                : streamState === "LIVE"
                  ? "bg-up animate-pulse"
                  : streamState === "CONNECTING"
                    ? "bg-ref"
                    : streamState === "CLOSED"
                      ? "bg-white/40"
                      : "bg-down"
            }`}
          />
          <span className="font-semibold text-foreground">
            {isLunch
              ? "Giờ nghỉ trưa"
              : streamState === "LIVE"
                ? "REALTIME LIVE"
                : streamState === "CONNECTING"
                  ? "Đang kết nối"
                  : streamState === "CLOSED" || !sessionOpen
                    ? "Ngoài giờ giao dịch realtime"
                    : "Mất kết nối"}
          </span>
          <span className="text-muted-2">·</span>
          <span className="font-mono text-up font-bold">▲{advances}</span>
          <span className="font-mono text-down font-bold">▼{declines}</span>
          <ChevronUp className={`h-3 w-3 text-muted-2 transition-transform duration-150 ${expanded ? "rotate-180" : ""}`} />
        </button>
      </div>
    </div>
  )
})

function extractInitialRefs(quotes?: Record<string, LiveStockQuote | IndexQuote>): Record<string, number> {
  const refs: Record<string, number> = {}
  if (!quotes) return refs
  for (const [sym, q] of Object.entries(quotes)) {
    if (q && "reference" in q && typeof q.reference === "number" && q.reference > 0) {
      refs[sym] = q.reference
    }
  }
  return refs
}

export function LiveMarketBoard({
  universe,
  canonicalUniverse,
  initialQuotes,
  initialHistories,
  isSessionOpen,
  userId = "anonymous",
  vn30Membership = null,
}: {
  universe: BoardUniverseStock[]
  canonicalUniverse?: BoardUniverseStock[]
  initialQuotes?: Record<string, LiveStockQuote | IndexQuote>
  initialHistories?: Record<string, IntradayPoint[]>
  isSessionOpen?: boolean
  userId?: string
  vn30Membership?: Vn30Membership | null
}) {
  const [sessionOpen, setSessionOpen] = useState<boolean>(() => isSessionOpen ?? isTradingSessionOpen())
  const [isLunch, setIsLunch] = useState<boolean>(() => isLunchBreak())
  const [indexChartOpen, setIndexChartOpen] = useState(false)
  const [realtimeImpact, setRealtimeImpact] = useState<MarketImpactSnapshot | null>(null)
  const { open: openOrderBook } = useOrderBooks()
  const [quotes, setQuotes] = useState<Record<string, LiveStockQuote | IndexQuote>>(() => {
    const initial: Record<string, LiveStockQuote | IndexQuote> = initialQuotes ? { ...initialQuotes } : {}
    for (const stock of universe) {
      if (!initial[stock.ticker] && stock.lastClose && stock.lastClose > 0) {
        initial[stock.ticker] = {
          symbol: stock.ticker,
          price: stock.lastClose,
          reference: stock.lastClose,
          change: 0,
          changePercent: Number.NaN,
          volume: 0,
          updatedAt: stock.lastCloseDate || new Date().toISOString(),
        }
      }
    }
    return initial
  })
  const [orderingQuotes, setOrderingQuotes] = useState<Record<string, LiveStockQuote | IndexQuote>>(() => quotes)
  const [streamState, setStreamState] = useState<StreamState>(() => sessionOpen ? "CONNECTING" : "CLOSED")
  const [streamError, setStreamError] = useState("")
  const [lastMessageAt, setLastMessageAt] = useState("")
  const [reconnectKey, setReconnectKey] = useState(0)
  const [historyReloadKey, setHistoryReloadKey] = useState(0)
  const [quoteReloadKey, setQuoteReloadKey] = useState(0)
  const [marketUiPhase, setMarketUiPhase] = useState<MarketUiPhase>(() => getMarketUiPhase())
  const [showSessionOpenAlert, setShowSessionOpenAlert] = useState(false)
  const [query, setQuery] = useState("")
  const [mode, setMode] = useState<BoardMode>("sector")
  const boardViewStorageKey = `${BOARD_VIEW_KEY}:${userId}`
  const marketContextVisibilityStorageKey = `${MARKET_CONTEXT_VISIBILITY_KEY}:${userId}`
  const industryPriceVolumeStorageKey = `${INDUSTRY_PRICE_VOLUME_VISIBILITY_KEY}:${userId}`
  const [boardView, setBoardView] = useState<BoardView>("classic")
  const [boardViewHydratedKey, setBoardViewHydratedKey] = useState<string | null>(null)
  const [showMarketContext, setShowMarketContext] = useState(true)
  const [marketContextVisibilityHydratedKey, setMarketContextVisibilityHydratedKey] = useState<string | null>(null)
  const [showIndustryPriceVolume, setShowIndustryPriceVolume] = useState(true)
  const [industryPriceVolumeHydratedKey, setIndustryPriceVolumeHydratedKey] = useState<string | null>(null)
  const [showWatchlist, setShowWatchlist] = useState(true)
  const [showWatchlistHydrated, setShowWatchlistHydrated] = useState(false)
  const [priceHistory, setPriceHistory] = useState<Record<string, IntradayPoint[]>>(() => initialHistories ? { ...initialHistories } : {})
  const [whaleAlerts, setWhaleAlerts] = useState<Record<string, boolean>>({})

  useEffect(() => {
    try {
      const stored = localStorage.getItem(boardViewStorageKey)
      setBoardView(stored === "industry" ? "industry" : "classic")
    } catch {
      setBoardView("classic")
    } finally {
      setBoardViewHydratedKey(boardViewStorageKey)
    }
  }, [boardViewStorageKey])

  useEffect(() => {
    if (boardViewHydratedKey !== boardViewStorageKey) return
    try { localStorage.setItem(boardViewStorageKey, boardView) } catch { /* current view remains usable */ }
  }, [boardView, boardViewHydratedKey, boardViewStorageKey])

  useEffect(() => {
    try {
      setShowMarketContext(localStorage.getItem(marketContextVisibilityStorageKey) !== "false")
    } catch {
      setShowMarketContext(true)
    } finally {
      setMarketContextVisibilityHydratedKey(marketContextVisibilityStorageKey)
    }
  }, [marketContextVisibilityStorageKey])

  useEffect(() => {
    if (marketContextVisibilityHydratedKey !== marketContextVisibilityStorageKey) return
    try { localStorage.setItem(marketContextVisibilityStorageKey, String(showMarketContext)) } catch { /* current visibility remains usable */ }
  }, [marketContextVisibilityHydratedKey, marketContextVisibilityStorageKey, showMarketContext])

  useEffect(() => {
    try {
      setShowIndustryPriceVolume(localStorage.getItem(industryPriceVolumeStorageKey) !== "false")
    } catch {
      setShowIndustryPriceVolume(true)
    } finally {
      setIndustryPriceVolumeHydratedKey(industryPriceVolumeStorageKey)
    }
  }, [industryPriceVolumeStorageKey])

  useEffect(() => {
    if (industryPriceVolumeHydratedKey !== industryPriceVolumeStorageKey) return
    try { localStorage.setItem(industryPriceVolumeStorageKey, String(showIndustryPriceVolume)) } catch { /* current visibility remains usable */ }
  }, [industryPriceVolumeHydratedKey, industryPriceVolumeStorageKey, showIndustryPriceVolume])

  useEffect(() => {
    try {
      setShowWatchlist(localStorage.getItem(WATCHLIST_VISIBILITY_KEY) !== "false")
    } catch {
      setShowWatchlist(true)
    } finally {
      setShowWatchlistHydrated(true)
    }
  }, [])

  useEffect(() => {
    if (!showWatchlistHydrated) return
    try { localStorage.setItem(WATCHLIST_VISIBILITY_KEY, String(showWatchlist)) } catch { /* current view remains usable */ }
  }, [showWatchlist, showWatchlistHydrated])

  const [soundEnabled, setSoundEnabledState] = useState<boolean>(() => {
    try {
      return typeof window !== "undefined" && localStorage.getItem("qeoindex_sound_fx_enabled") === "true"
    } catch {
      return false
    }
  })

  const boardContainerRef = useRef<HTMLDivElement>(null)
  const [isCapturing, setIsCapturing] = useState(false)
  const [copiedToast, setCopiedToast] = useState(false)
  const [showFlash, setShowFlash] = useState(false)

  const handleCaptureScreenshot = useCallback(async () => {
    if (isCapturing || !boardContainerRef.current) return
    setIsCapturing(true)
    setShowFlash(true)
    try {
      const blob = await captureMarketBoardScreenshot(boardContainerRef.current, { pixelRatio: 2 })
      if (blob) {
        await copyBlobToClipboard(blob)
        setCopiedToast(true)
        setTimeout(() => setCopiedToast(false), 3000)
      }
    } catch (err) {
      console.error("Screenshot capture error:", err)
    } finally {
      setIsCapturing(false)
    }
  }, [isCapturing])

  const quotesRef = useRef<Record<string, LiveStockQuote | IndexQuote>>({ ...quotes })
  const priceHistoryRef = useRef<Record<string, IntradayPoint[]>>({ ...priceHistory })
  const latestCommittedQuotesRef = useRef(quotes)
  const quotesDirtyRef = useRef(false)
  const historyDirtyRef = useRef(false)
  const marketUiCommitTimer = useRef<number | null>(null)
  const marketOrderingTimer = useRef<number | null>(null)
  const lastOrderingRefreshAt = useRef(0)
  const lastMessageAtRef = useRef("")
  const whaleTimeouts = useRef<Record<string, NodeJS.Timeout>>({})
  const dailyReferences = useRef<Record<string, number>>(extractInitialRefs(initialQuotes))
  const indexReferences = useRef<Record<string, VerifiedSessionReference>>({})
  const realtimeImpactRef = useRef<MarketImpactSnapshot | null>(null)
  const marketUiPhaseRef = useRef<MarketUiPhase>(marketUiPhase)
  const sessionOpenAlertTimer = useRef<number | null>(null)
  const eodReloadTimers = useRef<number[]>([])
  const didResetCurrentAto = useRef(false)
  const activeSessionDayRef = useRef(vietnamSessionDay())

  const scheduleMarketOrderingRefresh = useCallback((snapshot: Record<string, LiveStockQuote | IndexQuote>) => {
    latestCommittedQuotesRef.current = snapshot
    const now = Date.now()
    const elapsed = now - lastOrderingRefreshAt.current

    if (elapsed >= MARKET_ORDERING_REFRESH_MS) {
      if (marketOrderingTimer.current !== null) {
        window.clearTimeout(marketOrderingTimer.current)
        marketOrderingTimer.current = null
      }
      lastOrderingRefreshAt.current = now
      setOrderingQuotes(snapshot)
      return
    }

    if (marketOrderingTimer.current !== null) return
    marketOrderingTimer.current = window.setTimeout(() => {
      marketOrderingTimer.current = null
      lastOrderingRefreshAt.current = Date.now()
      setOrderingQuotes(latestCommittedQuotesRef.current)
    }, MARKET_ORDERING_REFRESH_MS - elapsed)
  }, [])

  const scheduleMarketUiCommit = useCallback(() => {
    if (marketUiCommitTimer.current !== null) return
    marketUiCommitTimer.current = window.setTimeout(() => {
      marketUiCommitTimer.current = null

      if (quotesDirtyRef.current) {
        quotesDirtyRef.current = false
        const quoteSnapshot = { ...quotesRef.current }
        setQuotes(quoteSnapshot)
        scheduleMarketOrderingRefresh(quoteSnapshot)
      }

      if (historyDirtyRef.current) {
        historyDirtyRef.current = false
        setPriceHistory({ ...priceHistoryRef.current })
      }

      const messageAt = lastMessageAtRef.current
      if (messageAt) {
        setLastMessageAt((previous) => previous === messageAt ? previous : messageAt)
      }
    }, MARKET_UI_COMMIT_MS)
  }, [scheduleMarketOrderingRefresh])

  const updateLiveQuote = useCallback((
    symbol: string,
    updater: (current: LiveStockQuote | IndexQuote | undefined) => LiveStockQuote | IndexQuote | undefined,
  ) => {
    const current = quotesRef.current[symbol]
    const next = updater(current)
    if (!next || next === current) return
    quotesRef.current[symbol] = next
    quotesDirtyRef.current = true
    scheduleMarketUiCommit()
  }, [scheduleMarketUiCommit])

  const updateLiveHistory = useCallback((
    ticker: string,
    updater: (current: IntradayPoint[]) => IntradayPoint[],
  ) => {
    const current = priceHistoryRef.current[ticker] ?? []
    const next = updater(current)
    if (next === current) return
    priceHistoryRef.current[ticker] = next
    historyDirtyRef.current = true
    scheduleMarketUiCommit()
  }, [scheduleMarketUiCommit])

  const resetForNewTradingSession = useCallback((now = new Date(), notify = true) => {
    didResetCurrentAto.current = true
    const nextSessionDay = vietnamSessionDay(now)
    const isTradingDayRollover = activeSessionDayRef.current !== nextSessionDay
    activeSessionDayRef.current = nextSessionDay
    indexReferences.current = {}
    realtimeImpactRef.current = null
    setRealtimeImpact(null)
    const resetQuotes: Record<string, LiveStockQuote | IndexQuote> = {}
    for (const [symbol, current] of Object.entries(quotesRef.current)) {
      if ("value" in current) {
        const reference = current.value > 0 ? current.value : current.reference || 0
        resetQuotes[symbol] = {
          ...current,
          value: reference > 0 ? reference : current.value,
          reference: undefined,
          change: undefined,
          changePercent: undefined,
          volume: undefined,
          valueTraded: undefined,
          advances: undefined,
          declines: undefined,
          unchanged: undefined,
          sourceAsOf: undefined,
          updatedAt: now.toISOString(),
        }
        continue
      }
      const fallback = universe.find((stock) => stock.ticker === symbol)?.lastClose
      const reference = isTradingDayRollover && current.price > 0
        ? current.price
        : current.reference || dailyReferences.current[symbol] || fallback || current.price || 0
      if (reference > 0) dailyReferences.current[symbol] = reference
      resetQuotes[symbol] = {
        ...current,
        price: reference,
        reference,
        ceiling: isTradingDayRollover ? undefined : current.ceiling,
        floor: isTradingDayRollover ? undefined : current.floor,
        change: 0,
        changePercent: 0,
        volume: 0,
        foreignBuyVolume: undefined,
        foreignSellVolume: undefined,
        foreignBuyValue: undefined,
        foreignSellValue: undefined,
        foreignNetValue: undefined,
        foreignUpdatedAt: undefined,
        foreignSessionDate: undefined,
        foreignSource: undefined,
        foreignReceivedAt: undefined,
        updatedAt: now.toISOString(),
      }
    }

    const resetHistory: Record<string, IntradayPoint[]> = {}
    for (const stock of universe) {
      const reference = dailyReferences.current[stock.ticker] || stock.lastClose || 0
      resetHistory[stock.ticker] = newSessionReferencePoint(reference, now)
    }
    quotesRef.current = resetQuotes
    latestCommittedQuotesRef.current = resetQuotes
    priceHistoryRef.current = resetHistory
    quotesDirtyRef.current = false
    historyDirtyRef.current = false
    setQuotes(resetQuotes)
    setOrderingQuotes(resetQuotes)
    setPriceHistory(resetHistory)
    setWhaleAlerts({})
    setLastMessageAt("")
    lastMessageAtRef.current = ""
    window.dispatchEvent(new CustomEvent(MARKET_SESSION_RESET_EVENT, {
      detail: { sessionDate: vietnamSessionDay(now) },
    }))
    setReconnectKey((key) => key + 1)
    setQuoteReloadKey((key) => key + 1)
    for (const timer of eodReloadTimers.current) window.clearTimeout(timer)
    eodReloadTimers.current = []
    if (notify) {
      setShowSessionOpenAlert(true)
      if (sessionOpenAlertTimer.current !== null) window.clearTimeout(sessionOpenAlertTimer.current)
      sessionOpenAlertTimer.current = window.setTimeout(() => setShowSessionOpenAlert(false), 8_000)
    }
  }, [universe])

  useEffect(() => {
    return () => {
      if (marketUiCommitTimer.current !== null) {
        window.clearTimeout(marketUiCommitTimer.current)
        marketUiCommitTimer.current = null
      }
      if (marketOrderingTimer.current !== null) {
        window.clearTimeout(marketOrderingTimer.current)
        marketOrderingTimer.current = null
      }
      if (sessionOpenAlertTimer.current !== null) window.clearTimeout(sessionOpenAlertTimer.current)
      for (const timer of eodReloadTimers.current) window.clearTimeout(timer)
      eodReloadTimers.current = []
    }
  }, [])

  const handleToggleSound = useCallback(() => {
    const next = !soundEnabled
    setSoundEnabled(next)
    setSoundEnabledState(next)
    if (next) {
      playWhaleSound("BUY")
    }
  }, [soundEnabled])

  const toggleShowWatchlist = useCallback(() => {
    if (!showWatchlistHydrated) return
    setShowWatchlist((previous) => !previous)
  }, [showWatchlistHydrated])

  const triggerWhaleAlert = useCallback((ticker: string) => {
    setWhaleAlerts((prev) => ({ ...prev, [ticker]: true }))
    if (whaleTimeouts.current[ticker]) {
      clearTimeout(whaleTimeouts.current[ticker])
    }
    whaleTimeouts.current[ticker] = setTimeout(() => {
      setWhaleAlerts((prev) => {
        if (!prev[ticker]) return prev
        const next = { ...prev }
        delete next[ticker]
        return next
      })
    }, 1500)
  }, [])

  const [watchlist, setWatchlist] = useState<Set<string>>(() => new Set<string>())
  const [watchlistHydrated, setWatchlistHydrated] = useState(false)

  useEffect(() => {
    try {
      const stored = localStorage.getItem(WATCHLIST_KEY)
      const parsed: unknown = stored ? JSON.parse(stored) : []
      const validSymbols = Array.isArray(parsed)
        ? parsed.filter((symbol): symbol is string => typeof symbol === "string" && /^[A-Z0-9]{1,12}$/.test(symbol))
        : []
      setWatchlist(new Set(validSymbols))
    } catch {
      setWatchlist(new Set())
    } finally {
      setWatchlistHydrated(true)
    }
  }, [])

  useEffect(() => {
    if (!watchlistHydrated) return
    try { localStorage.setItem(WATCHLIST_KEY, JSON.stringify([...watchlist])) } catch { /* ignore */ }
  }, [watchlist, watchlistHydrated])

  const toggleWatch = useCallback((ticker: string) => {
    if (!watchlistHydrated) return
    setWatchlist((prev) => {
      const updated = new Set(prev)
      if (updated.has(ticker)) updated.delete(ticker)
      else updated.add(ticker)
      return updated
    })
  }, [watchlistHydrated])

  const fullCanonicalUniverse = canonicalUniverse ?? universe
  const canonicalSymbols = useMemo(() => fullCanonicalUniverse.map((stock) => stock.ticker), [fullCanonicalUniverse])
  const canonicalTrackedSymbols = useMemo(() => new Set(canonicalSymbols), [canonicalSymbols])
  const symbolList = useMemo(() => universe.map((stock) => stock.ticker), [universe])
  const symbolKey = symbolList.join(",")
  const trackedSymbols = useMemo(() => new Set(symbolList), [symbolList])
  const hasSufficientSsrHistory = useMemo(() => {
    if (!initialHistories || symbolList.length === 0) return false
    let covered = 0
    for (const symbol of symbolList) {
      const points = initialHistories[symbol]
      if (points && points.length >= 2) covered += 1
    }
    return covered / symbolList.length >= SSR_HISTORY_COVERAGE_MIN
  }, [initialHistories, symbolList])

  useEffect(() => {
    if (quoteReloadKey === 0 || symbolList.length === 0) return

    const controller = new AbortController()
    const requestedAt = Date.now()
    const requestedSessionDay = activeSessionDayRef.current
    let disposed = false

    void (async () => {
      try {
        const response = await fetch("/api/market/quotes", {
          method: "POST",
          cache: "no-store",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ symbols: symbolList }),
          signal: controller.signal,
        })
        const payload = await response.json() as QuoteReconcileResponse
        if (
          disposed ||
          !response.ok ||
          !payload.ok ||
          !payload.quotes ||
          activeSessionDayRef.current !== requestedSessionDay
        ) return

        const currentQuotes = quotesRef.current
        const nextQuotes = { ...currentQuotes }
        const receivedAt = payload.updatedAt || new Date().toISOString()

        for (const symbol of symbolList) {
          const quote = payload.quotes[symbol]
          if (!quote) continue

          const existing = currentQuotes[symbol] as LiveStockQuote | undefined
          const reference = quote.reference && quote.reference > 0
            ? quote.reference
            : existing?.reference || dailyReferences.current[symbol] || 0
          if (reference > 0) dailyReferences.current[symbol] = reference

          const existingUpdatedAt = existing?.updatedAt ? Date.parse(existing.updatedAt) : 0
          const hasNewerLiveQuote = Number.isFinite(existingUpdatedAt) && existingUpdatedAt > requestedAt
          const hasCurrentSessionForeignEvidence = existing?.foreignSource === "DNSE Onidel WS"
            && existing.foreignSessionDate === requestedSessionDay
          const price = hasNewerLiveQuote
            ? existing?.price
            : quote.price && quote.price > 0 ? quote.price : existing?.price || reference
          if (!price || price <= 0) continue

          const change = reference > 0 ? price - reference : (quote.change ?? existing?.change ?? 0)
          const changePercent = reference > 0
            ? (change / reference) * 100
            : (quote.changePercent ?? existing?.changePercent ?? 0)

          nextQuotes[symbol] = {
            ...(existing ?? {}),
            symbol,
            price,
            reference: reference || undefined,
            ceiling: quote.ceiling === null ? undefined : (quote.ceiling ?? existing?.ceiling),
            floor: quote.floor === null ? undefined : (quote.floor ?? existing?.floor),
            change,
            changePercent,
            volume: hasNewerLiveQuote ? existing?.volume : (quote.volume ?? existing?.volume),
            foreignBuyVolume: hasCurrentSessionForeignEvidence ? existing?.foreignBuyVolume : (hasNewerLiveQuote ? existing?.foreignBuyVolume : (quote.foreignBuyVolume ?? existing?.foreignBuyVolume)),
            foreignSellVolume: hasCurrentSessionForeignEvidence ? existing?.foreignSellVolume : (hasNewerLiveQuote ? existing?.foreignSellVolume : (quote.foreignSellVolume ?? existing?.foreignSellVolume)),
            foreignBuyValue: hasCurrentSessionForeignEvidence ? existing?.foreignBuyValue : (hasNewerLiveQuote ? existing?.foreignBuyValue : (quote.foreignBuyValue ?? existing?.foreignBuyValue)),
            foreignSellValue: hasCurrentSessionForeignEvidence ? existing?.foreignSellValue : (hasNewerLiveQuote ? existing?.foreignSellValue : (quote.foreignSellValue ?? existing?.foreignSellValue)),
            foreignNetValue: hasCurrentSessionForeignEvidence ? existing?.foreignNetValue : (hasNewerLiveQuote ? existing?.foreignNetValue : (quote.foreignNetValue ?? existing?.foreignNetValue)),
            foreignRoom: quote.foreignRoom ?? existing?.foreignRoom,
            updatedAt: hasNewerLiveQuote && existing?.updatedAt ? existing.updatedAt : receivedAt,
          }
        }

        quotesRef.current = nextQuotes
        latestCommittedQuotesRef.current = nextQuotes
        quotesDirtyRef.current = false
        lastOrderingRefreshAt.current = Date.now()
        if (marketOrderingTimer.current !== null) {
          window.clearTimeout(marketOrderingTimer.current)
          marketOrderingTimer.current = null
        }
        setQuotes(nextQuotes)
        setOrderingQuotes(nextQuotes)
      } catch (error) {
        if (!disposed && !(error instanceof DOMException && error.name === "AbortError")) {
          console.warn("Market board session quote reconcile unavailable", error)
        }
      }
    })()

    return () => {
      disposed = true
      controller.abort()
    }
  }, [quoteReloadKey, symbolList])

  useEffect(() => {
    if (!symbolList.length) return
    if (marketUiPhase === "ATO") return
    if (historyReloadKey === 0 && hasSufficientSsrHistory) return

    const controller = new AbortController()
    let disposed = false

    void (async () => {
      try {
        const response = await fetch(`/api/market/intraday?symbols=${encodeURIComponent(symbolKey)}`, {
          cache: "no-store",
          headers: { Accept: "application/json" },
          signal: controller.signal,
        })
        const payload = await response.json() as IntradayHistoryResponse
        if (disposed || !payload.histories || getMarketUiPhase() === "ATO") return
        const receivedAt = new Date().toISOString()
        const nextHistory: Record<string, IntradayPoint[]> = { ...priceHistoryRef.current }
        for (const symbol of symbolList) {
          const points = payload.histories?.[symbol]?.points?.filter((point) => Number.isFinite(point.time) && point.time > 0 && Number.isFinite(point.close) && point.close > 0) ?? []
          if (points.length) {
            nextHistory[symbol] = points.slice(-90)
          }
        }
        priceHistoryRef.current = { ...nextHistory }
        historyDirtyRef.current = false
        setPriceHistory(nextHistory)

        const currentQuotes = quotesRef.current
        const nextQuotes = { ...currentQuotes }
        for (const symbol of symbolList) {
          const history = payload.histories?.[symbol]
          if (!history?.reference) continue
          dailyReferences.current[symbol] = history.reference
          const existing = currentQuotes[symbol] as LiveStockQuote | undefined
          const ref = history.reference
          const hasLiveQuote = Boolean(
            existing &&
            existing.price &&
            existing.price > 0 &&
            (existing.price !== ref || (existing.volume && existing.volume > 0))
          )
          const price = hasLiveQuote ? (existing!.price) : (history.price || existing?.price || ref)
          const change = price - ref
          const changePercent = ref > 0 ? (change / ref) * 100 : (history.changePercent ?? 0)
          const volume = hasLiveQuote ? (existing!.volume || 0) : (existing?.volume || 0)
          nextQuotes[symbol] = {
            ...(existing ?? {}),
            symbol,
            price,
            reference: ref,
            change,
            changePercent,
            volume,
            updatedAt: hasLiveQuote && existing?.updatedAt ? existing.updatedAt : (history.lastBarAt ? new Date(history.lastBarAt * 1000).toISOString() : receivedAt),
          }
        }
        quotesRef.current = { ...nextQuotes }
        quotesDirtyRef.current = false
        latestCommittedQuotesRef.current = nextQuotes
        lastOrderingRefreshAt.current = Date.now()
        if (marketOrderingTimer.current !== null) {
          window.clearTimeout(marketOrderingTimer.current)
          marketOrderingTimer.current = null
        }
        setQuotes(nextQuotes)
        setOrderingQuotes(nextQuotes)
      } catch (error) {
        if (!disposed && !(error instanceof DOMException && error.name === "AbortError")) {
          console.warn("Market board 5m bootstrap unavailable", error)
        }
      }
    })()

    return () => {
      disposed = true
      controller.abort()
    }
  }, [symbolKey, historyReloadKey, symbolList, sessionOpen, hasSufficientSsrHistory, marketUiPhase])

  useEffect(() => {
    if (marketUiPhase === "ATO") return
    const controller = new AbortController()
    void (async () => {
      try {
        const response = await fetch("/api/market/indexes", { cache: "no-store", signal: controller.signal })
        const payload = await response.json() as IndexHistoryResponse
        if (!payload.quotes || getMarketUiPhase() === "ATO") return
        const current = quotesRef.current
        const next = { ...current }
        for (const [symbol, quote] of Object.entries(payload.quotes ?? {})) {
          const changedReference = typeof quote.change === "number"
            ? quote.value - quote.change
            : typeof quote.changePercent === "number" && Number.isFinite(quote.changePercent) && quote.changePercent !== -100
              ? quote.value / (1 + quote.changePercent / 100)
              : 0
          const derivedReference = Number.isFinite(changedReference) && changedReference > 0 ? changedReference : 0
          const existing = current[symbol] as IndexQuote | undefined
          const quoteSessionDate = vietnamSessionDay(new Date(quote.updatedAt))
          const hasCurrentLiveFrame = Boolean(existing?.sourceAsOf && isCurrentSessionProviderTime(existing.sourceAsOf, activeSessionDayRef.current))
          if (hasCurrentLiveFrame) continue
          if (derivedReference > 0 && quoteSessionDate === activeSessionDayRef.current) {
            indexReferences.current[symbol] = { value: derivedReference, sessionDate: quoteSessionDate }
          }
          if (existing?.value && derivedReference > 0) {
            next[symbol] = {
              ...existing,
              reference: derivedReference,
              change: existing.value - derivedReference,
              changePercent: ((existing.value - derivedReference) / derivedReference) * 100,
            }
          } else if (!existing) {
            next[symbol] = quote
          }
        }
        quotesRef.current = { ...next }
        quotesDirtyRef.current = false
        latestCommittedQuotesRef.current = next
        setQuotes(next)
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) console.warn("Index EOD bootstrap unavailable", error)
      }
    })()
    return () => controller.abort()
  }, [historyReloadKey, marketUiPhase])

  const pushFiveMinuteClose = useCallback((ticker: string, close: number, timestampSeconds: number) => {
    if (!shouldAcceptRealtimeMiniChart(timestampSeconds) || isLunchBreak(new Date(timestampSeconds * 1000))) return
    updateLiveHistory(ticker, (current) => {
      const normalizedClose = normalizeMarketPrice(close, current.at(-1)?.close)
      if (!normalizedClose) return current
      return mergeFiveMinuteClose(current, normalizedClose, timestampSeconds)
    })
  }, [updateLiveHistory])

  useEffect(() => {
    const checkSession = () => {
      const now = new Date()
      const isOpen = isTradingSessionOpen(now)
      const lunch = isLunchBreak(now)
      setSessionOpen((prev) => (prev !== isOpen ? isOpen : prev))
      setIsLunch((prev) => (prev !== lunch ? lunch : prev))

      const nextPhase = getMarketUiPhase(now)
      const needsTradingDayReset = shouldResetForNewTradingDay(activeSessionDayRef.current, now)
      const needsHistoryReloadAfterReset = needsTradingDayReset && nextPhase !== "ATO"

      if (needsTradingDayReset) {
        resetForNewTradingSession(now, nextPhase === "ATO")
        if (needsHistoryReloadAfterReset) setHistoryReloadKey((key) => key + 1)
      }

      if (marketUiPhaseRef.current !== nextPhase) {
        const previousPhase = marketUiPhaseRef.current
        marketUiPhaseRef.current = nextPhase
        setMarketUiPhase(nextPhase)
        if (nextPhase === "ATO") {
          if (!needsTradingDayReset) resetForNewTradingSession(now)
        } else if (nextPhase === "CONTINUOUS" || nextPhase === "EOD") {
          if (!needsHistoryReloadAfterReset) setHistoryReloadKey((key) => key + 1)
          if (nextPhase === "EOD") {
            for (const timer of eodReloadTimers.current) window.clearTimeout(timer)
            eodReloadTimers.current = [4 * 60_000, 14 * 60_000].map((delay) => window.setTimeout(() => {
              setHistoryReloadKey((key) => key + 1)
            }, delay))
          }
          if (previousPhase === "PRE_MARKET" && !needsTradingDayReset) setReconnectKey((key) => key + 1)
        } else if (nextPhase === "PRE_MARKET") {
          didResetCurrentAto.current = false
        }
      }
    }

    checkSession()
    const timer = window.setInterval(checkSession, 1000)
    const handleVisibility = () => { if (document.visibilityState === "visible") checkSession() }
    document.addEventListener("visibilitychange", handleVisibility)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener("visibilitychange", handleVisibility)
    }
  }, [resetForNewTradingSession])

  useEffect(() => {
    if (marketUiPhase !== "ATO" || didResetCurrentAto.current) return
    const mountReset = marketUiPhase === "ATO"
      ? window.setTimeout(() => resetForNewTradingSession(new Date(), false), 0)
      : null
    // Mount-only guard: a user entering during ATO must never hydrate yesterday's snapshot.
    return () => { if (mountReset !== null) window.clearTimeout(mountReset) }
  }, [marketUiPhase, resetForNewTradingSession])

  useEffect(() => {
    if (!sessionOpen) {
      setStreamState("CLOSED")
      setStreamError("")
      return
    }

    let disposed = false
    let messageQueue: string[] = []
    let messageFrame: number | null = null

    const flushMessageQueue = () => {
      messageFrame = null
      const queued = messageQueue
      messageQueue = []
      for (const raw of queued) {
        if (disposed) return
        let data: Record<string, unknown>
        try { data = JSON.parse(raw) as Record<string, unknown> } catch { continue }

        const now = new Date()
        const receivedAt = now.toISOString()
        lastMessageAtRef.current = receivedAt

        // Pause market data processing during lunch break (11:30 - 13:00)
        if (isLunchBreak(now)) {
          continue
        }

        const type = String(data.T ?? "")
        if (type === "b" && data.symbol) {
          const ticker = String(data.symbol).toUpperCase()
          if (!trackedSymbols.has(ticker)) continue
          const close = firstPositive(data, ["close", "c", "closePrice"])
          const timestamp = normalizeEpochSeconds(data.time ?? data.t ?? data.timestamp ?? data.ts, now.getTime() / 1000)
          if (close > 0) pushFiveMinuteClose(ticker, close, timestamp)
          continue
        }

        if (type === "t" && data.symbol) {
          const ticker = String(data.symbol).toUpperCase()
          if (!trackedSymbols.has(ticker)) continue
          const price = firstPositive(data, ["matchPrice", "price", "lastPrice"])
          if (price <= 0) continue
          const totalVolume = firstPositive(data, ["totalVolumeTraded", "totalVolume", "volume"])
          const matchVol = firstPositive(data, ["matchQtty", "matchVolume", "matchQuantity", "qtty", "q", "vol"])
          const normalizedPrice = price > 1000 ? price / 1000 : price
          const whaleThreshold = normalizedPrice >= 50 ? 30_000 : 50_000
          if (matchVol >= whaleThreshold) {
            triggerWhaleAlert(ticker)
          }

          const explicitReference = firstPositive(data, STOCK_REFERENCE_KEYS)
          const ceiling = firstPositive(data, ["ceilingPrice", "ceiling"])
          const floor = firstPositive(data, ["floorPrice", "floor"])
          updateLiveQuote(ticker, (currentQuote) => {
            const previous = currentQuote as LiveStockQuote | undefined
            const rawRef = explicitReference || dailyReferences.current[ticker] || previous?.reference || 0
            const rawReference = rawRef > 1000 ? rawRef / 1000 : rawRef
            const reference = normalizeMarketPrice(rawReference, price) ?? (rawReference > 1000 ? rawReference / 1000 : rawReference)
            if (reference > 0) dailyReferences.current[ticker] = reference
            const change = reference > 0 ? price - reference : previous?.change
            const changePercent = reference > 0 ? ((price - reference) / reference) * 100 : previous?.changePercent ?? 0
            return {
              ...previous,
              symbol: ticker,
              price,
              reference: reference || undefined,
              ceiling: ceiling ? (ceiling > 1000 ? ceiling / 1000 : ceiling) : previous?.ceiling,
              floor: floor ? (floor > 1000 ? floor / 1000 : floor) : previous?.floor,
              change,
              changePercent,
              volume: totalVolume || previous?.volume,
              updatedAt: receivedAt,
            }
          })
          continue
        }

        if (type === "q" && data.symbol) {
          const ticker = String(data.symbol).toUpperCase()
          if (!trackedSymbols.has(ticker)) continue
          const explicitReference = firstPositive(data, STOCK_REFERENCE_KEYS)
          const ceiling = firstPositive(data, ["ceilingPrice", "ceiling"])
          const floor = firstPositive(data, ["floorPrice", "floor"])
          const price = firstPositive(data, ["matchPrice", "price", "lastPrice"])
          updateLiveQuote(ticker, (currentQuote) => {
            const previous = currentQuote as LiveStockQuote | undefined
            const livePrice = price ? (price > 1000 ? price / 1000 : price) : previous?.price
            if (!livePrice) return previous
            const rawRef = explicitReference || dailyReferences.current[ticker] || previous?.reference || 0
            const rawReference = rawRef > 1000 ? rawRef / 1000 : rawRef
            const reference = normalizeMarketPrice(rawReference, livePrice) ?? (rawReference > 1000 ? rawReference / 1000 : rawReference)
            if (reference > 0) dailyReferences.current[ticker] = reference
            return {
              ...previous,
              symbol: ticker,
              price: livePrice,
              reference: reference || undefined,
              ceiling: ceiling ? (ceiling > 1000 ? ceiling / 1000 : ceiling) : previous?.ceiling,
              floor: floor ? (floor > 1000 ? floor / 1000 : floor) : previous?.floor,
              change: reference > 0 ? livePrice - reference : previous?.change,
              changePercent: reference > 0 ? ((livePrice - reference) / reference) * 100 : previous?.changePercent ?? 0,
              volume: previous?.volume,
              updatedAt: receivedAt,
            }
          })
          continue
        }

        if (type === "mi") {
          const symbol = normalizeIndexName(data.indexName ?? data.symbol)
          if (!symbol) continue
          const verifiedReference = indexReferences.current[symbol]
          const parsed = parseDnseMarketIndexFrame(data, verifiedReference)
          if (!parsed || parsed.sessionDate !== activeSessionDayRef.current || !isCurrentSessionProviderTime(parsed.asOf, activeSessionDayRef.current)) continue
          const currentIndex = quotesRef.current[symbol] as IndexQuote | undefined
          if (!isProviderTimestampNotOlder(parsed.asOf, currentIndex?.sourceAsOf)) continue
          updateLiveQuote(symbol, (currentQuote) => {
            const previous = currentQuote as IndexQuote | undefined
            if (!isProviderTimestampNotOlder(parsed.asOf, previous?.sourceAsOf)) return previous
            if (parsed.reference !== undefined) {
              indexReferences.current[symbol] = { value: parsed.reference, sessionDate: parsed.sessionDate }
            }
            return {
              ...previous,
              symbol,
              value: parsed.value,
              reference: parsed.reference,
              change: parsed.change,
              changePercent: parsed.changePercent,
              volume: parsed.volume ?? previous?.volume,
              valueTraded: parsed.valueTraded ?? previous?.valueTraded,
              sourceAsOf: parsed.asOf,
              updatedAt: parsed.asOf,
            }
          })
          continue
        }

        if (type === "f" && data.symbol) {
          const symbol = String(data.symbol).toUpperCase()
          if (!canonicalTrackedSymbols.has(symbol)) continue
          const parsed = parseDnseForeignFrame(data)
          if (!parsed || parsed.sessionDate !== activeSessionDayRef.current || !isCurrentSessionProviderTime(parsed.asOf, activeSessionDayRef.current)) continue
          const currentStock = quotesRef.current[symbol] as LiveStockQuote | undefined
          if (!isProviderTimestampNotOlder(parsed.asOf, currentStock?.foreignUpdatedAt)) continue

          updateLiveQuote(symbol, (currentQuote) => {
            const previous = currentQuote as LiveStockQuote | undefined
            if (!previous) return previous
            if (!isProviderTimestampNotOlder(parsed.asOf, previous.foreignUpdatedAt)) return previous
            const hasCompleteAmounts = parsed.buyValue !== undefined && parsed.sellValue !== undefined
            const nextBuyVolume = parsed.buyVolume ?? previous.foreignBuyVolume
            const nextSellVolume = parsed.sellVolume ?? previous.foreignSellVolume

            return {
              ...previous,
              ...(hasCompleteAmounts ? {
                foreignBuyValue: parsed.buyValue,
                foreignSellValue: parsed.sellValue,
                foreignNetValue: parsed.netValue,
                foreignUpdatedAt: parsed.asOf,
                foreignSessionDate: parsed.sessionDate,
                foreignSource: "DNSE Onidel WS",
                foreignReceivedAt: receivedAt,
              } : {}),
              foreignBuyVolume: nextBuyVolume,
              foreignSellVolume: nextSellVolume,
            }
          })
          continue
        }

        if (type === "index-impact" && String(data.symbol ?? "").toUpperCase() === "VNINDEX") {
          const snapshot = parseVnindexImpactPayload(data)
          if (!snapshot?.asOf || !isCurrentSessionProviderTime(snapshot.asOf, activeSessionDayRef.current)) continue
          const parsed = { ...snapshot, source: "DNSE Onidel WS · VNINDEX basket-influence" }
          if (!isProviderTimestampNotOlder(snapshot.asOf, realtimeImpactRef.current?.asOf)) continue
          realtimeImpactRef.current = parsed
          setRealtimeImpact(parsed)
        }
      }
    }

    const scheduleMessage = (raw: string) => {
      messageQueue.push(raw)
      if (messageFrame === null) messageFrame = window.requestAnimationFrame(flushMessageQueue)
    }

    const clearMessageQueue = () => {
      if (messageFrame !== null) window.cancelAnimationFrame(messageFrame)
      messageFrame = null
      messageQueue = []
    }

    const unsubscribeFrames = subscribeDnseMarketFrames((frame) => {
      if (disposed) return
      scheduleMessage(JSON.stringify(frame))
    })
    const unsubscribeState = subscribeDnseMarketStreamState((state) => {
      if (disposed) return
      setStreamState(state.status)
      setStreamError(state.error)
      if (state.lastMessageAt) {
        lastMessageAtRef.current = state.lastMessageAt
        setLastMessageAt((previous) => previous === state.lastMessageAt ? previous : state.lastMessageAt)
      }
    })

    return () => {
      disposed = true
      clearMessageQueue()
      unsubscribeFrames()
      unsubscribeState()
    }
  }, [reconnectKey, pushFiveMinuteClose, trackedSymbols, canonicalTrackedSymbols, sessionOpen, triggerWhaleAlert, updateLiveQuote, scheduleMarketUiCommit])

  const normalizedQuery = query.trim().toUpperCase()
  const currentSessionDay = useMemo(() => vietnamSessionDay(), [])
  const displayQuotes = useMemo(() => {
    let next: Record<string, LiveStockQuote | IndexQuote> | null = null
    for (const stock of universe) {
      if (quotes[stock.ticker]) continue
      const history = priceHistory[stock.ticker] ?? []
      const price = history.at(-1)?.close ?? stock.lastClose
      if (!price || price <= 0) continue
      const priorNotionClose = stock.lastCloseDate && stock.lastCloseDate < currentSessionDay ? stock.lastClose : null
      const reference = priorNotionClose ?? undefined
      if (!next) next = { ...quotes }
      next[stock.ticker] = {
        symbol: stock.ticker,
        price,
        reference,
        change: reference && reference > 0 ? price - reference : undefined,
        changePercent: reference && reference > 0 ? ((price - reference) / reference) * 100 : Number.NaN,
        updatedAt: stock.lastCloseDate ?? new Date().toISOString(),
      }
    }
    return next ?? quotes
  }, [currentSessionDay, priceHistory, quotes, universe])

  const priceHistoryCloses = useMemo(() => {
    const out: Record<string, number[]> = {}
    void marketUiPhase
    for (const [ticker, pts] of Object.entries(priceHistory)) {
      out[ticker] = pts.map((p) => p.close)
    }
    return out
  }, [priceHistory, marketUiPhase])

  const boardUniverse = universe
  const canonicalIndustries = useMemo(
    () => [...new Set(fullCanonicalUniverse.map(industryLabelForStock))],
    [fullCanonicalUniverse],
  )
  const filtered = useMemo(() => boardUniverse.filter((stock) => (!normalizedQuery || stock.ticker.includes(normalizedQuery))), [boardUniverse, normalizedQuery])
  const movers = useMemo(() => [...filtered].sort((a, b) => compareByPerformance(a, b, orderingQuotes)), [orderingQuotes, filtered])
  const watchedStocks = useMemo(() => {
    if (watchlist.size === 0) return []
    return universe.filter((stock) => watchlist.has(stock.ticker))
  }, [universe, watchlist])
  const watchedQuotes = useMemo(() => {
    if (watchedStocks.length === 0) return {}
    const visible: Record<string, LiveStockQuote | IndexQuote | undefined> = {}
    for (const stock of watchedStocks) visible[stock.ticker] = displayQuotes[stock.ticker]
    return visible
  }, [displayQuotes, watchedStocks])
  const grouped = useMemo(() => BOARD_SECTOR_GROUPS.map((group) => {
    const stocks = filtered
      .filter((stock) => group.sectors.some((sector) => sector === stock.sector))
      .sort((a, b) => compareByPerformance(a, b, orderingQuotes))
    const sectorQuotes = stocks
      .map((stock) => orderingQuotes[stock.ticker] as LiveStockQuote | undefined)
      .filter((quote): quote is LiveStockQuote => Boolean(quote && Number.isFinite(quote.changePercent)))
    const average = sectorQuotes.length
      ? sectorQuotes.reduce((sum, quote) => sum + quote.changePercent, 0) / sectorQuotes.length
      : undefined
    return { ...group, stocks, avg: average, avgTone: marketToneFromChange(average) }
  }), [filtered, orderingQuotes])

  const { liveCount, pricedCount, historyCount, advances, declines } = useMemo(() => {
    let live = 0
    let priced = 0
    let history = 0
    let adv = 0
    let dec = 0
    for (const stock of universe) {
      if (quotes[stock.ticker]) live++
      const dq = displayQuotes[stock.ticker] as LiveStockQuote | undefined
      if (dq) {
        priced++
        const pct = dq.changePercent ?? 0
        if (pct > 0) adv++
        else if (pct < 0) dec++
      }
      if ((priceHistory[stock.ticker]?.length ?? 0) > 1) history++
    }
    return { liveCount: live, pricedCount: priced, historyCount: history, advances: adv, declines: dec }
  }, [universe, quotes, displayQuotes, priceHistory])

  const openBook = useCallback(
    (ticker: string) => {
      const q = displayQuotes[ticker] as LiveStockQuote | undefined
      const s = universe.find((st) => st.ticker === ticker)
      const h = priceHistoryCloses[ticker] ?? EMPTY_HISTORY
      const rawRef = dailyReferences.current[ticker] || q?.reference || s?.lastClose
      const ref = rawRef ? (rawRef > 1000 ? rawRef / 1000 : rawRef) : undefined
      const rawPrice = q?.price || ref
      const price = rawPrice ? (rawPrice > 1000 ? rawPrice / 1000 : rawPrice) : undefined
      const rawCeil = q?.ceiling
      const ceiling = rawCeil ? (rawCeil > 1000 ? rawCeil / 1000 : rawCeil) : undefined
      const rawFloor = q?.floor
      const floor = rawFloor ? (rawFloor > 1000 ? rawFloor / 1000 : rawFloor) : undefined
      openOrderBook(`board:${ticker}`, ticker, {
        sector: s?.sector,
        price,
        reference: ref,
        ceiling,
        floor,
        changePercent: q?.changePercent,
        volume: q?.volume,
        foreignBuyVolume: q?.foreignBuyVolume,
        foreignSellVolume: q?.foreignSellVolume,
        foreignBuyValue: q?.foreignBuyValue,
        foreignSellValue: q?.foreignSellValue,
        foreignNetValue: q?.foreignNetValue,
        foreignRoom: q?.foreignRoom,
        history: h,
      })
    },
    [displayQuotes, universe, priceHistoryCloses, openOrderBook],
  )
  const reconnect = useCallback(() => {
    void restartDnseMarketStream()
    setReconnectKey((key) => key + 1)
  }, [])
  const openIndexChart = useCallback(() => setIndexChartOpen(true), [])

  const indexQuotes = useMemo<Record<string, IndexQuote | undefined>>(() => ({
    VNINDEX: quotes.VNINDEX as IndexQuote | undefined,
    VN30: quotes.VN30 as IndexQuote | undefined,
    HNXINDEX: quotes.HNXINDEX as IndexQuote | undefined,
    UPCOMINDEX: quotes.UPCOMINDEX as IndexQuote | undefined,
  }), [quotes.VNINDEX, quotes.VN30, quotes.HNXINDEX, quotes.UPCOMINDEX])

  return (
    <div ref={boardContainerRef} className="relative flex h-full min-h-0 flex-col bg-background">
      <div id="market-board-context-panel" hidden={!showMarketContext}>
        <MarketContextStrip
          indexQuotes={indexQuotes}
          stockQuotes={displayQuotes as Record<string, LiveStockQuote | undefined>}
          canonicalUniverse={fullCanonicalUniverse}
          realtimeImpact={realtimeImpact}
          onOpenIndexChart={openIndexChart}
        />
      </div>
      <IndexChartModal open={indexChartOpen} onOpenChange={setIndexChartOpen} />

      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.08] bg-[#090d12] px-3 py-1.5">
        <div className="flex items-center gap-2">
          <div role="tablist" aria-label="Kiểu bảng giá" className="flex items-center rounded-xl border border-white/[0.10] bg-[#0b0f14] p-0.5">
            {(["classic", "industry"] as const).map((view) => {
              const isSelected = boardView === view
              const label = view === "classic" ? "Bảng điện" : "Bảng ngành"
              const targetId = `market-board-view-${view}-tab`
              const ViewIcon = view === "classic" ? Table2 : PanelsTopLeft
              return (
                <button
                  key={view}
                  id={targetId}
                  type="button"
                  role="tab"
                  aria-selected={isSelected}
                  aria-controls="market-board-view-panel"
                  tabIndex={isSelected ? 0 : -1}
                  disabled={boardViewHydratedKey !== boardViewStorageKey}
                  onClick={() => setBoardView(view)}
                  onKeyDown={(event) => {
                    let nextView: BoardView | null = null
                    if (event.key === "ArrowRight" || event.key === "ArrowDown") nextView = view === "classic" ? "industry" : "classic"
                    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") nextView = view === "industry" ? "classic" : "industry"
                    else if (event.key === "Home") nextView = "classic"
                    else if (event.key === "End") nextView = "industry"
                    if (!nextView) return
                    event.preventDefault()
                    setBoardView(nextView)
                    document.getElementById(`market-board-view-${nextView}-tab`)?.focus()
                  }}
                  className={`flex h-8 items-center gap-1.5 rounded-lg px-3 text-[11px] font-semibold transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:outline-brand ${isSelected ? "border border-brand/40 bg-brand/[0.12] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]" : "text-muted-2 hover:bg-white/[0.04] hover:text-foreground"}`}
                >
                  <ViewIcon className={`h-3.5 w-3.5 ${isSelected ? "text-brand" : "text-muted-2"}`} />
                  <span>{label}</span>
                </button>
              )
            })}
          </div>

          <label
            className={`flex h-8 cursor-pointer select-none items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-semibold transition-colors ${showMarketContext ? "border-brand/35 bg-brand/[0.08] text-foreground" : "border-white/[0.10] bg-[#0b0f14] text-muted-2 hover:text-foreground"} ${marketContextVisibilityHydratedKey !== marketContextVisibilityStorageKey ? "cursor-wait opacity-60" : ""}`}
            title={showMarketContext ? "Ẩn các chỉ số thị trường để mở rộng bảng bên dưới" : "Hiện lại các chỉ số thị trường"}
          >
            <input
              type="checkbox"
              className="sr-only"
              checked={showMarketContext}
              disabled={marketContextVisibilityHydratedKey !== marketContextVisibilityStorageKey}
              onChange={(event) => setShowMarketContext(event.target.checked)}
              aria-controls="market-board-context-panel"
            />
            <span className={`flex h-4 w-4 items-center justify-center rounded border ${showMarketContext ? "border-brand/60 bg-brand/[0.16] text-brand" : "border-white/20 bg-white/[0.03] text-transparent"}`}>
              <Check className="h-3 w-3" />
            </span>
            <span>{showMarketContext ? "Ẩn chỉ số" : "Hiện chỉ số"}</span>
            {showMarketContext ? <ChevronUp className="h-3.5 w-3.5 text-brand" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-2" />}
          </label>

          {boardView === "industry" ? (
            <label
              className={`flex h-8 cursor-pointer select-none items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-semibold transition-colors ${showIndustryPriceVolume ? "border-white/[0.10] bg-[#0b0f14] text-muted-2 hover:text-foreground" : "border-brand/35 bg-brand/[0.08] text-foreground"} ${industryPriceVolumeHydratedKey !== industryPriceVolumeStorageKey ? "cursor-wait opacity-60" : ""}`}
              title={showIndustryPriceVolume ? "Ẩn cột Giá và KL để xem được nhiều ngành hơn" : "Hiện lại cột Giá và KL"}
            >
              <input
                type="checkbox"
                className="sr-only"
                checked={!showIndustryPriceVolume}
                disabled={industryPriceVolumeHydratedKey !== industryPriceVolumeStorageKey}
                onChange={(event) => setShowIndustryPriceVolume(!event.target.checked)}
                aria-controls="market-board-view-panel"
              />
              <span className={`flex h-4 w-4 items-center justify-center rounded border ${!showIndustryPriceVolume ? "border-brand/60 bg-brand/[0.16] text-brand" : "border-white/20 bg-white/[0.03] text-transparent"}`}>
                <Check className="h-3 w-3" />
              </span>
              <span>{showIndustryPriceVolume ? "Ẩn Giá/KL" : "Hiện Giá/KL"}</span>
              {showIndustryPriceVolume ? <EyeOff className="h-3.5 w-3.5 text-muted-2" /> : <Eye className="h-3.5 w-3.5 text-brand" />}
            </label>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          {boardView === "classic" ? (
            <button
              type="button"
              disabled={!showWatchlistHydrated}
              aria-pressed={showWatchlist}
              onClick={toggleShowWatchlist}
              className={`flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors disabled:cursor-wait ${showWatchlist ? "border-amber-400/35 bg-amber-400/10 text-amber-300" : "border-white/[0.10] bg-[#0b0f14] text-muted-2 hover:text-foreground"}`}
              title={showWatchlist ? "Ẩn danh sách theo dõi" : "Hiện danh sách theo dõi"}
            >
              <Star className={`h-3.5 w-3.5 ${showWatchlist ? "fill-amber-400 text-amber-400" : "text-muted-2"}`} />
              <span>Theo dõi</span>
              {watchlist.size > 0 ? <span className="rounded-full bg-white/[0.08] px-1.5 text-[10px] font-bold">{watchlist.size}</span> : null}
            </button>
          ) : null}

          <div className="relative min-w-[140px] sm:w-[180px]">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-2" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Tìm mã CP..."
              className="h-8 w-full rounded-full border border-white/[0.10] bg-[#0b0f14] pl-9 pr-3 text-xs text-foreground placeholder:text-muted outline-none transition-colors focus:border-brand/60"
            />
          </div>

          <div className="flex items-center rounded-full border border-white/[0.10] bg-[#0b0f14] p-0.5">
            <button
              onClick={() => setMode("sector")}
              className={`flex h-7 items-center gap-1.5 rounded-full px-3 text-[11px] font-medium transition-colors ${mode === "sector" ? "border border-white/[0.12] bg-white/[0.08] font-semibold text-white" : "text-muted-2 hover:text-foreground hover:bg-white/[0.04]"}`}
            >
              <LayoutGrid className="h-3 w-3" />
              <span>Tất cả</span>
            </button>
            <button
              onClick={() => setMode("movers")}
              className={`flex h-7 items-center gap-1.5 rounded-full px-3 text-[11px] font-medium transition-colors ${mode === "movers" ? "border border-white/[0.12] bg-white/[0.08] font-semibold text-white" : "text-muted-2 hover:text-foreground hover:bg-white/[0.04]"}`}
            >
              <ChartNoAxesCombined className="h-3 w-3" />
              <span>Top movers</span>
            </button>
          </div>
        </div>
      </div>
      {streamState !== "LIVE" && streamError ? (
        <div className="flex items-center gap-2 border-b border-ref/30 bg-[#0b0f14] px-3.5 py-1.5 text-xs text-ref">
          <CircleAlert className="h-3.5 w-3.5 shrink-0 text-ref" />
          <span>{streamError}</span>
        </div>
      ) : null}

      <div
        id="market-board-view-panel"
        role="tabpanel"
        aria-labelledby={boardView === "classic" ? "market-board-view-classic-tab" : "market-board-view-industry-tab"}
        tabIndex={0}
        className="min-h-0 flex-1 overflow-auto bg-[#06080a] px-2 py-2"
        data-market-board-screenshot-scroll
      >
        {boardView === "classic" && showWatchlist && watchedStocks.length > 0 ? (
          <WatchlistSection
            watchedStocks={watchedStocks}
            quotes={watchedQuotes}
            priceHistoryCloses={priceHistoryCloses}
            whaleAlerts={whaleAlerts}
            onToggleWatch={toggleWatch}
            onOpen={openBook}
            showCharts={marketUiPhase !== "ATO"}
          />
        ) : null}

        {mode === "sector" && boardView === "industry" ? (
          <IndustryPriceboard
            universe={fullCanonicalUniverse}
            visibleUniverse={filtered}
            canonicalIndustries={canonicalIndustries}
            displayQuotes={displayQuotes as Record<string, LiveStockQuote | undefined>}
            orderingQuotes={orderingQuotes}
            watchedSymbols={watchlist}
            onToggleWatch={toggleWatch}
            onOpen={openBook}
            userId={userId}
            canonicalSymbols={canonicalSymbols}
            vn30Membership={vn30Membership}
            showPriceVolume={showIndustryPriceVolume}
          />
        ) : mode === "sector" ? (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6" data-market-board-classic-grid>
            {grouped.map(({ key, label, stocks, avg, avgTone }) => {
              const SectorIcon = SECTOR_ICONS[key] ?? Layers
              return (
                <section
                  key={key}
                  data-market-board-sector-column
                  className={`flex min-w-0 flex-col rounded-2xl border border-white/[0.08] border-t-2 bg-[#0b0f14] transition-colors hover:border-white/[0.14] ${SECTOR_BORDER_ACCENTS[key] ?? "border-t-emerald-400"}`}
                >
                  <header className="relative flex h-[72px] shrink-0 items-center justify-between gap-2.5 overflow-hidden border-b border-white/[0.07] bg-white/[0.025] px-3.5 py-2 select-none">
                    <div className="flex min-w-0 flex-1 items-center gap-2.5">
                      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border ${SECTOR_ICON_BADGES[key] ?? "bg-emerald-500/10 text-emerald-300 border-emerald-400/30"}`}>
                        <SectorIcon className="h-4 w-4" />
                      </div>
                      <h2 className="min-w-0 select-none line-clamp-2 font-ticker text-xs font-extrabold tracking-tight text-foreground sm:text-sm" title={label}>
                        {label}
                      </h2>
                    </div>
                    <div className="shrink-0 pl-1 text-right">
                      {typeof avg === "number" && Number.isFinite(avg) ? (
                        <span
                          className={`font-ticker text-lg font-semibold leading-none tracking-tight sm:text-xl md:text-2xl ${
                            avgTone === "ceiling" ? "text-ceiling" : avgTone === "floor" ? "text-floor" : avgTone === "up" ? "text-up" : avgTone === "down" ? "text-down" : "text-ref"
                          }`}
                          title="Biến động trung bình ngành"
                        >
                          {avg > 0 ? "+" : ""}{avg.toFixed(1)}%
                        </span>
                      ) : <span className="font-mono text-base font-bold text-muted-2">—</span>}
                    </div>
                  </header>
                  <div className="space-y-1.5 p-1.5">
                    {stocks.length ? stocks.map((stock) => (
                      <LiveStockRow
                        key={stock.ticker}
                        stock={stock}
                        quote={displayQuotes[stock.ticker] as LiveStockQuote | undefined}
                        history={priceHistoryCloses[stock.ticker] ?? EMPTY_HISTORY}
                        showChart={marketUiPhase !== "ATO"}
                        onOpen={() => openBook(stock.ticker)}
                        isWatched={watchlist.has(stock.ticker)}
                        isWhaleActive={Boolean(whaleAlerts[stock.ticker])}
                        onToggleWatch={(event) => { event.stopPropagation(); toggleWatch(stock.ticker) }}
                      />
                    )) : <div className="py-4 text-center text-xs text-muted-2">Chưa có cổ phiếu</div>}
                  </div>
                </section>
              )
            })}
          </div>
        ) : (
          <div className="mx-auto grid max-w-[1500px] grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {movers.map((stock) => (
              <LiveMoverCard
                key={stock.ticker}
                stock={stock}
                quote={displayQuotes[stock.ticker] as LiveStockQuote | undefined}
                history={priceHistoryCloses[stock.ticker] ?? EMPTY_HISTORY}
                showChart={marketUiPhase !== "ATO"}
                onOpen={() => openBook(stock.ticker)}
                isWatched={watchlist.has(stock.ticker)}
                isWhaleActive={Boolean(whaleAlerts[stock.ticker])}
                onToggleWatch={(e) => {
                  e.stopPropagation()
                  toggleWatch(stock.ticker)
                }}
              />
            ))}
          </div>
        )}
      </div>

      {showSessionOpenAlert ? (
        <div
          role="status"
          aria-live="polite"
          className="fixed left-1/2 top-20 z-50 flex -translate-x-1/2 items-center gap-2 rounded-xl border border-emerald-400/40 bg-[#0b1713] px-4 py-3 text-sm font-semibold text-emerald-200 shadow-[0_10px_30px_rgba(0,0,0,0.45)] motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-2"
        >
          <CircleAlert className="h-4 w-4 shrink-0 text-emerald-400" />
          Phiên giao dịch mới đã bắt đầu — dữ liệu bảng điện vừa được reset.
        </div>
      ) : null}

      <FloatingMarketStatus
        streamState={streamState}
        streamError={streamError}
        liveCount={liveCount}
        pricedCount={pricedCount}
        historyCount={historyCount}
        universeLength={universe.length}
        advances={advances}
        declines={declines}
        lastMessageAt={lastMessageAt}
        soundEnabled={soundEnabled}
        isLunch={isLunch}
        sessionOpen={sessionOpen}
        onToggleSound={handleToggleSound}
        onReconnect={reconnect}
        onCaptureScreenshot={handleCaptureScreenshot}
        isCapturing={isCapturing}
        copiedToast={copiedToast}
      />

      {showFlash && (
        <div
          data-screenshot-exclude="true"
          className="fixed inset-0 z-50 pointer-events-none bg-white/75 backdrop-blur-sm animate-camera-flash select-none"
          onAnimationEnd={() => setShowFlash(false)}
        />
      )}
    </div>
  )
}
