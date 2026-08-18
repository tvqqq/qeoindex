"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Activity, ChartNoAxesCombined, ChevronUp, CircleAlert, LayoutGrid, RefreshCw, Search, Star } from "lucide-react"
import { MarketChangePill } from "@/components/market-change-pill"
import { BOARD_SECTOR_GROUPS, SECTOR_ORDER } from "@/lib/market-sectors"
import { marketToneFromChange, marketToneText } from "@/lib/market-tone"
import { useOrderBooks } from "@/components/orderbook/orderbook-context"
import { LiveMoverCard, LiveStockRow, formatBoardPrice, type LiveBoardStock, type LiveStockQuote } from "@/components/live-market-stock"
import { mergeFiveMinuteClose, normalizeEpochSeconds, normalizeMarketPrice, type IntradayPoint } from "@/lib/intraday-5m"

export type BoardUniverseStock = LiveBoardStock
type IndexQuote = {
  symbol: string
  value: number
  change?: number
  changePercent: number
  volume?: number
  valueTraded?: number
  updatedAt: string
}
type BoardMode = "sector" | "movers"

function formatCompactVolume(value?: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return "—"
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)} tỷ`
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 1 : 2)} tr`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)} k`
  return value.toLocaleString("vi-VN")
}

function formatMarketValue(value?: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return "—"
  const abs = Math.abs(value)
  if (abs >= 1_000_000_000) {
    const billions = value / 1_000_000_000
    return `${new Intl.NumberFormat("vi-VN", { maximumFractionDigits: billions >= 1000 ? 0 : 1 }).format(billions)} tỷ`
  }
  if (abs >= 1_000_000) {
    const millions = value / 1_000_000
    return `${new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 }).format(millions)} tr`
  }
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(value)
}
type StreamState = "CONNECTING" | "LIVE" | "ERROR" | "CLOSED"
type DnseAuthPayload = { action: string; api_key: string; signature: string; timestamp: number; nonce: string }
type DnseAuthResponse = { ok: boolean; url?: string; auth?: DnseAuthPayload; message?: string }
type IntradayHistoryResponse = {
  ok: boolean
  histories?: Record<string, { symbol: string; provider: "Yahoo" | null; points: IntradayPoint[]; reference: number | null; price: number | null; change: number | null; changePercent: number | null; lastBarAt: number | null; error: string | null }>
}
type IndexHistoryResponse = { ok: boolean; quotes?: Record<string, IndexQuote> }

const INDEXES = ["VNINDEX", "VN30", "HNXINDEX", "UPCOMINDEX"]
const INDEX_LABELS: Record<string, string> = { VNINDEX: "VN-INDEX", VN30: "VN30", HNXINDEX: "HNX-INDEX", UPCOMINDEX: "UPCOM-INDEX" }
const INDEX_CHANNELS = ["VNINDEX", "VN30", "HNX", "UPCOM"]
const STOCK_REFERENCE_KEYS = ["referencePrice", "refPrice", "reference", "basicPrice", "previousClose", "prevClose", "priorClose"]
const INDEX_REFERENCE_KEYS = ["referenceIndex", "referenceValue", "reference", "previousClose", "prevClose", "priorClose"]
const STREAM_STALE_MS = 60_000
const WATCHLIST_KEY = "stockos:watchlist:v1"

const SECTOR_EMOJIS: Record<string, string> = {
  bank: "🏦",
  securities: "📈",
  consumer: "🛍️",
  "real-estate": "🏢",
  "industrial-tech": "⚡",
  other: "🌐",
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
  if (aq && bq) {
    if (bq.changePercent !== aq.changePercent) return bq.changePercent - aq.changePercent
    if (bq.volume && aq.volume && bq.volume !== aq.volume) return bq.volume - aq.volume
    return a.rank - b.rank
  }
  if (aq) return -1
  if (bq) return 1
  return a.rank - b.rank
}

function currentSessionIdentifier(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Ho_Chi_Minh",
    weekday: "short",
    hour12: false,
    hour: "2-digit",
  }).formatToParts(date)
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? ""
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0)
  const isTradingDay = weekday !== "Sat" && weekday !== "Sun"
  const isPastOpen = hour >= 9
  return `${vietnamSessionDay(date)}:${isTradingDay && isPastOpen ? "OPEN" : "PRE"}`
}

function WatchlistSection({
  stocks,
  quotes,
  priceHistory,
  watchlist,
  onToggleWatch,
  onOpen,
}: {
  stocks: BoardUniverseStock[]
  quotes: Record<string, LiveStockQuote | IndexQuote>
  priceHistory: Record<string, IntradayPoint[]>
  watchlist: Set<string>
  onToggleWatch: (ticker: string) => void
  onOpen: (ticker: string) => void
}) {
  if (watchlist.size === 0) return null
  const watched = stocks.filter((s) => watchlist.has(s.ticker))
  if (watched.length === 0) return null
  return (
    <div className="mb-2 rounded-lg border border-amber-500/20 bg-panel/85 p-2 shadow-sm">
      <div className="mb-1.5 flex items-center justify-between px-0.5">
        <div className="flex items-center gap-1.5">
          <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
          <span className="text-[11px] font-bold uppercase tracking-wider text-foreground">Danh sách theo dõi</span>
          <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-1.5 py-0.2 text-[10px] font-semibold text-amber-400">{watched.length}</span>
        </div>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-0.5 scrollbar-thin">
        {watched.map((stock) => (
          <div key={stock.ticker} className="min-w-[180px] max-w-[220px] flex-1 shrink-0">
            <LiveStockRow
              stock={stock}
              quote={quotes[stock.ticker] as LiveStockQuote | undefined}
              history={(priceHistory[stock.ticker] ?? []).map((p) => p.close)}
              onOpen={() => onOpen(stock.ticker)}
              isWatched
              onToggleWatch={(e) => { e.stopPropagation(); onToggleWatch(stock.ticker) }}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

function IndexStrip({ quotes }: { quotes: Record<string, LiveStockQuote | IndexQuote> }) {
  return (
    <div className="grid grid-cols-2 divide-x divide-border border-b border-border bg-[#141515] text-xs sm:grid-cols-4">
      {INDEXES.map((symbol) => {
        const quote = quotes[symbol] as IndexQuote | undefined
        const tone = marketToneFromChange(quote?.changePercent)
        const text = quote ? marketToneText(tone) : "text-muted-2"
        return (
          <div key={symbol} className="flex items-center justify-between px-3 py-1.5 font-mono">
            <span className="text-[10px] font-bold tracking-wider text-muted uppercase font-sans">{INDEX_LABELS[symbol]}</span>
            <div className="flex items-center gap-1.5">
              <span className={`text-xs font-extrabold ${text}`}>{formatBoardPrice(quote?.value)}</span>
              {quote ? <MarketChangePill value={quote.changePercent} tone={tone} compact /> : null}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function FloatingMarketStatus({
  streamState,
  streamError,
  liveCount,
  pricedCount,
  historyCount,
  universeLength,
  advances,
  declines,
  lastMessageAt,
  onReconnect,
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
  onReconnect: () => void
}) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="fixed bottom-3 right-3 z-30 flex flex-col items-end select-none">
      {expanded ? (
        <div className="mb-2 w-72 rounded-xl border border-border-strong bg-[#141515]/95 p-3 shadow-2xl backdrop-blur-md text-xs space-y-2.5 animate-in fade-in slide-in-from-bottom-2 duration-150">
          <div className="flex items-center justify-between border-b border-border/60 pb-1.5">
            <span className="font-bold text-foreground flex items-center gap-1.5">
              <Activity className="h-3.5 w-3.5 text-brand" />
              <span>Trạng thái Hệ thống</span>
            </span>
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="text-muted-2 hover:text-foreground text-[10px]"
            >
              Đóng ✕
            </button>
          </div>

          <div className="space-y-1.5 font-mono text-[11px] text-muted-2">
            <div className="flex justify-between">
              <span>Nguồn dữ liệu:</span>
              <span className="text-foreground font-sans">Yahoo 5m + DNSE</span>
            </div>
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
              <span>WS Feed live:</span>
              <span className="text-foreground font-bold">{liveCount}/{universeLength}</span>
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
            <div className="rounded bg-ref/10 border border-ref/30 p-1.5 text-[10px] text-ref leading-tight">
              {streamError}
            </div>
          ) : null}

          <button
            type="button"
            onClick={onReconnect}
            className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-border bg-panel-2 py-1.5 text-[11px] font-semibold text-foreground hover:bg-panel transition-colors"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${streamState === "CONNECTING" ? "animate-spin text-ref" : ""}`} />
            <span>Kết nối lại DNSE Feed</span>
          </button>
        </div>
      ) : null}

      {/* Floating Compact Pill Badge */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-2 rounded-full border border-border-strong bg-[#141515]/90 px-3 py-1.5 shadow-xl backdrop-blur-md text-[11px] hover:bg-[#1a1c1b] transition-all"
        title="Bấm để xem chi tiết trạng thái hệ thống"
      >
        <span
          className={`h-2 w-2 rounded-full ${
            streamState === "LIVE" ? "bg-up animate-pulse" : streamState === "CONNECTING" ? "bg-ref" : "bg-down"
          }`}
        />
        <span className="font-semibold text-foreground">
          {streamState === "LIVE" ? "DNSE LIVE" : streamState === "CONNECTING" ? "Đang kết nối" : "Mất kết nối"}
        </span>
        <span className="text-muted-2">·</span>
        <span className="font-mono text-up font-bold">▲{advances}</span>
        <span className="font-mono text-down font-bold">▼{declines}</span>
        <ChevronUp className={`h-3 w-3 text-muted-2 transition-transform duration-150 ${expanded ? "rotate-180" : ""}`} />
      </button>
    </div>
  )
}

export function LiveMarketBoardV2({ universe }: { universe: BoardUniverseStock[] }) {
  const { open: openOrderBook } = useOrderBooks()
  const [quotes, setQuotes] = useState<Record<string, LiveStockQuote | IndexQuote>>({})
  const [streamState, setStreamState] = useState<StreamState>("CONNECTING")
  const [streamError, setStreamError] = useState("")
  const [lastMessageAt, setLastMessageAt] = useState("")
  const [reconnectKey, setReconnectKey] = useState(0)
  const [historyReloadKey, setHistoryReloadKey] = useState(0)
  const [query, setQuery] = useState("")
  const [selectedSector, setSelectedSector] = useState("Tất cả")
  const [mode, setMode] = useState<BoardMode>("sector")
  const [priceHistory, setPriceHistory] = useState<Record<string, IntradayPoint[]>>({})
  const dailyReferences = useRef<Record<string, number>>({})
  const indexReferences = useRef<Record<string, number>>({})
  const sessionIdentifier = useRef(currentSessionIdentifier())
  const lastFrameAt = useRef(0)

  const [watchlist, setWatchlist] = useState<Set<string>>(() => {
    try {
      const stored = typeof window !== "undefined" ? localStorage.getItem(WATCHLIST_KEY) : null
      return stored ? new Set<string>(JSON.parse(stored) as string[]) : new Set<string>()
    } catch {
      return new Set<string>()
    }
  })

  const toggleWatch = useCallback((ticker: string) => {
    setWatchlist((prev) => {
      const next = new Set(prev)
      if (next.has(ticker)) next.delete(ticker)
      else next.add(ticker)
      try { localStorage.setItem(WATCHLIST_KEY, JSON.stringify([...next])) } catch { /* ignore */ }
      return next
    })
  }, [])

  const symbolList = useMemo(() => universe.map((stock) => stock.ticker), [universe])
  const symbolKey = symbolList.join(",")
  const trackedSymbols = useMemo(() => new Set(symbolList), [symbolList])

  useEffect(() => {
    if (!symbolList.length) return
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
        if (disposed || !payload.histories) return
        const receivedAt = new Date().toISOString()
        setPriceHistory((current) => {
          const next = { ...current }
          for (const symbol of symbolList) {
            const points = payload.histories?.[symbol]?.points?.filter((point) => Number.isFinite(point.time) && point.time > 0 && Number.isFinite(point.close) && point.close > 0) ?? []
            if (points.length) {
              let merged = points.slice(-90)
              for (const point of current[symbol] ?? []) {
                merged = mergeFiveMinuteClose(merged, point.close, point.time)
              }
              next[symbol] = merged
            }
          }
          return next
        })
        setQuotes((current) => {
          const next = { ...current }
          for (const symbol of symbolList) {
            const history = payload.histories?.[symbol]
            if (!history?.price || !history.reference) continue
            dailyReferences.current[symbol] = history.reference
            const existing = current[symbol] as LiveStockQuote | undefined
            if (existing?.price) {
              next[symbol] = {
                ...existing,
                reference: history.reference,
                change: existing.price - history.reference,
                changePercent: ((existing.price - history.reference) / history.reference) * 100,
              }
              continue
            }
            next[symbol] = {
              symbol,
              price: history.price,
              reference: history.reference,
              change: history.change ?? undefined,
              changePercent: history.changePercent ?? 0,
              updatedAt: history.lastBarAt ? new Date(history.lastBarAt * 1000).toISOString() : receivedAt,
            }
          }
          return next
        })
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
  }, [symbolKey, historyReloadKey, symbolList])

  useEffect(() => {
    const controller = new AbortController()
    void (async () => {
      try {
        const response = await fetch("/api/market/indexes", { cache: "no-store", signal: controller.signal })
        const payload = await response.json() as IndexHistoryResponse
        if (!payload.quotes) return
        setQuotes((current) => {
          const next = { ...current }
          for (const [symbol, quote] of Object.entries(payload.quotes ?? {})) {
            const derivedReference = typeof quote.change === "number"
              ? quote.value - quote.change
              : quote.changePercent !== -100 ? quote.value / (1 + quote.changePercent / 100) : 0
            if (derivedReference > 0) indexReferences.current[symbol] = derivedReference
            const existing = current[symbol] as IndexQuote | undefined
            if (existing?.value && derivedReference > 0) {
              next[symbol] = {
                ...existing,
                change: existing.value - derivedReference,
                changePercent: ((existing.value - derivedReference) / derivedReference) * 100,
              }
            } else if (!existing) {
              next[symbol] = quote
            }
          }
          return next
        })
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) console.warn("Index EOD bootstrap unavailable", error)
      }
    })()
    return () => controller.abort()
  }, [historyReloadKey])

  const pushFiveMinuteClose = useCallback((ticker: string, close: number, timestampSeconds: number) => {
    setPriceHistory((previous) => {
      const current = previous[ticker] ?? []
      const normalizedClose = normalizeMarketPrice(close, current.at(-1)?.close)
      if (!normalizedClose) return previous
      const merged = mergeFiveMinuteClose(current, normalizedClose, timestampSeconds)
      if (merged === current) return previous
      return { ...previous, [ticker]: merged }
    })
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => {
      const nextSession = currentSessionIdentifier(new Date())
      if (sessionIdentifier.current !== nextSession) {
        sessionIdentifier.current = nextSession
        dailyReferences.current = {}
        indexReferences.current = {}
        setQuotes({})
        setPriceHistory({})
        setHistoryReloadKey((key) => key + 1)
      }
    }, 5_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    let disposed = false
    let socket: WebSocket | null = null
    let reconnectTimer: number | null = null
    let pingTimer: number | null = null
    let watchdogTimer: number | null = null
    let attempts = 0
    let messageQueue: Array<() => void> = []
    let messageFrame: number | null = null

    const flushMessageQueue = () => {
      messageFrame = null
      const queued = messageQueue
      messageQueue = []
      for (const process of queued) process()
    }

    const scheduleMessage = (process: () => void) => {
      messageQueue.push(process)
      if (messageFrame === null) messageFrame = window.requestAnimationFrame(flushMessageQueue)
    }

    const clearMessageQueue = () => {
      if (messageFrame !== null) window.cancelAnimationFrame(messageFrame)
      messageFrame = null
      messageQueue = []
    }

    const closeConnectionTimers = () => {
      if (pingTimer) window.clearInterval(pingTimer)
      if (watchdogTimer) window.clearInterval(watchdogTimer)
      pingTimer = null
      watchdogTimer = null
    }

    const clearReconnectTimer = () => {
      if (reconnectTimer) window.clearTimeout(reconnectTimer)
      reconnectTimer = null
    }

    const scheduleReconnect = () => {
      if (disposed || reconnectTimer) return
      attempts += 1
      const base = Math.min(750 * 2 ** Math.min(attempts - 1, 4), 10_000)
      const delay = base + Math.floor(Math.random() * 500)
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null
        void connect()
      }, delay)
    }

    const forceReconnect = (reason: string) => {
      if (disposed) return
      clearMessageQueue()
      closeConnectionTimers()
      if (socket && socket.readyState < WebSocket.CLOSING) {
        try { socket.close(4000, reason.slice(0, 120)) } catch { scheduleReconnect() }
      } else {
        scheduleReconnect()
      }
    }

    const connect = async () => {
      clearReconnectTimer()
      clearMessageQueue()
      closeConnectionTimers()
      if (disposed) return
      setStreamState("CONNECTING")
      lastFrameAt.current = Date.now()

      try {
        const response = await fetch("/api/market/stream-auth", { cache: "no-store", headers: { Accept: "application/json" } })
        const authJson = await response.json() as DnseAuthResponse
        if (!response.ok || !authJson.ok || !authJson.url || !authJson.auth) throw new Error(authJson.message ?? `DNSE stream auth ${response.status}`)
        if (disposed) return

        socket = new WebSocket(authJson.url)
        socket.onopen = () => {
          lastFrameAt.current = Date.now()
          setStreamState("CONNECTING")
        }
        socket.onmessage = (event) => {
          if (disposed || typeof event.data !== "string") return
          lastFrameAt.current = Date.now()
          const raw = event.data
          scheduleMessage(() => {
            if (disposed) return
            let data: Record<string, unknown>
            try { data = JSON.parse(raw) as Record<string, unknown> } catch { return }

            const action = String(data.action ?? data.a ?? "")
            if (action === "ping") {
              if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ action: "pong", timestamp: data.timestamp }))
              return
            }
            if (action === "welcome" || data.session_id || data.sid) {
              if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(authJson.auth))
              return
            }
            if (action === "auth_success") {
              attempts = 0
              setStreamState("LIVE")
              setStreamError("")
              socket?.send(JSON.stringify({
                action: "subscribe",
                channels: [
                  { name: "tick.G1.json", symbols: symbolList },
                  { name: "top_price.G1.json", symbols: symbolList },
                  { name: "ohlc.1.json", symbols: symbolList },
                  { name: "foreign.G1.json", symbols: symbolList },
                  ...INDEX_CHANNELS.map((name) => ({ name: `market_index.${name}.json` })),
                ],
              }))
              pingTimer = window.setInterval(() => {
                if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ action: "ping", timestamp: Date.now() }))
              }, 15_000)
              watchdogTimer = window.setInterval(() => {
                if (socket?.readyState === WebSocket.OPEN && Date.now() - lastFrameAt.current > STREAM_STALE_MS) {
                  setStreamError("Luồng DNSE im lặng quá 60 giây; đang tự kết nối lại.")
                  forceReconnect("stale DNSE stream")
                }
              }, 10_000)
              return
            }
            if (action === "auth_error" || action === "error") {
              const message = String(data.message ?? data.msg ?? "DNSE WebSocket error")
              setStreamState("ERROR")
              setStreamError(message)
              forceReconnect("DNSE auth/subscription error")
              return
            }

            const now = new Date()
            const receivedAt = now.toISOString()
            const currentSession = currentSessionIdentifier(now)
            if (sessionIdentifier.current !== currentSession) {
              sessionIdentifier.current = currentSession
              dailyReferences.current = {}
              indexReferences.current = {}
              setQuotes({})
              setPriceHistory({})
              setHistoryReloadKey((key) => key + 1)
            }

            const type = String(data.T ?? "")
            if (type === "b" && data.symbol) {
              const ticker = String(data.symbol).toUpperCase()
              if (!trackedSymbols.has(ticker)) return
              const close = firstPositive(data, ["close", "c", "closePrice"])
              const timestamp = normalizeEpochSeconds(data.time ?? data.t ?? data.timestamp ?? data.ts, now.getTime() / 1000)
              if (close > 0) pushFiveMinuteClose(ticker, close, timestamp)
              setLastMessageAt(receivedAt)
              setStreamError("")
              return
            }

            if (type === "t" && data.symbol) {
              const ticker = String(data.symbol).toUpperCase()
              if (!trackedSymbols.has(ticker)) return
              const price = firstPositive(data, ["matchPrice", "price", "lastPrice"])
              if (price <= 0) return
              const totalVolume = firstPositive(data, ["totalVolumeTraded", "totalVolume", "volume"])
              const explicitReference = firstPositive(data, STOCK_REFERENCE_KEYS)
              const ceiling = firstPositive(data, ["ceilingPrice", "ceiling"])
              const floor = firstPositive(data, ["floorPrice", "floor"])
              setQuotes((current) => {
                const previous = current[ticker] as LiveStockQuote | undefined
                const rawReference = explicitReference || dailyReferences.current[ticker] || previous?.reference || 0
                const reference = normalizeMarketPrice(rawReference, price) ?? rawReference
                if (reference > 0) dailyReferences.current[ticker] = reference
                const change = reference > 0 ? price - reference : previous?.change
                const changePercent = reference > 0 ? ((price - reference) / reference) * 100 : previous?.changePercent ?? 0
                return {
                  ...current,
                  [ticker]: {
                    ...previous,
                    symbol: ticker,
                    price,
                    reference: reference || undefined,
                    ceiling: ceiling || previous?.ceiling,
                    floor: floor || previous?.floor,
                    change,
                    changePercent,
                    volume: totalVolume || previous?.volume,
                    updatedAt: receivedAt,
                  },
                }
              })
              setLastMessageAt(receivedAt)
              setStreamError("")
              return
            }

            if (type === "q" && data.symbol) {
              const ticker = String(data.symbol).toUpperCase()
              if (!trackedSymbols.has(ticker)) return
              const explicitReference = firstPositive(data, STOCK_REFERENCE_KEYS)
              const ceiling = firstPositive(data, ["ceilingPrice", "ceiling"])
              const floor = firstPositive(data, ["floorPrice", "floor"])
              const price = firstPositive(data, ["matchPrice", "price", "lastPrice"])
              setQuotes((current) => {
                const previous = current[ticker] as LiveStockQuote | undefined
                const livePrice = price || previous?.price
                if (!livePrice) return current
                const rawReference = explicitReference || dailyReferences.current[ticker] || previous?.reference || 0
                const reference = normalizeMarketPrice(rawReference, livePrice) ?? rawReference
                if (reference > 0) dailyReferences.current[ticker] = reference
                return {
                  ...current,
                  [ticker]: {
                    ...previous,
                    symbol: ticker,
                    price: livePrice,
                    reference: reference || undefined,
                    ceiling: ceiling || previous?.ceiling,
                    floor: floor || previous?.floor,
                    change: reference > 0 ? livePrice - reference : previous?.change,
                    changePercent: reference > 0 ? ((livePrice - reference) / reference) * 100 : previous?.changePercent ?? 0,
                    volume: previous?.volume,
                    updatedAt: receivedAt,
                  },
                }
              })
              setLastMessageAt(receivedAt)
              setStreamError("")
              return
            }

            if (type === "mi") {
              const symbol = normalizeIndexName(data.indexName ?? data.symbol)
              const value = firstPositive(data, ["valueIndexes", "value", "indexValue"])
              if (!symbol || value <= 0) return
              const explicitReference = firstPositive(data, INDEX_REFERENCE_KEYS)
              if (explicitReference > 0) indexReferences.current[symbol] = explicitReference
              const vol = firstPositive(data, ["totalVolumeTraded", "totalVolume", "totalQtty", "allQtty", "vol", "v"])
              const rawVal = firstPositive(data, ["totalValueTraded", "totalValue", "totalAmount", "allValue", "val"])
              const val = rawVal > 0 ? (rawVal < 100_000 ? rawVal * 1_000_000_000 : rawVal < 100_000_000 ? rawVal * 1_000_000 : rawVal) : 0
              setQuotes((current) => {
                const previous = current[symbol] as IndexQuote | undefined
                const previousDerivedReference = previous && typeof previous.change === "number" ? previous.value - previous.change : 0
                const reference = indexReferences.current[symbol] || previousDerivedReference
                if (reference > 0) indexReferences.current[symbol] = reference
                const change = reference > 0 ? value - reference : previous?.change
                const changePercent = reference > 0 ? ((value - reference) / reference) * 100 : previous?.changePercent ?? 0
                return {
                  ...current,
                  [symbol]: {
                    symbol,
                    value,
                    change,
                    changePercent,
                    volume: vol || previous?.volume,
                    valueTraded: val || previous?.valueTraded,
                    updatedAt: receivedAt,
                  },
                }
              })
              setLastMessageAt(receivedAt)
              setStreamError("")
              return
            }

            if (type === "f" && data.symbol) {
              const symbol = String(data.symbol).toUpperCase()
              if (!trackedSymbols.has(symbol)) return
              const totalBuyVal = numeric(data.totalBuyTradedAmount ?? data.totalBuyValue ?? data.foreignBuyValue)
              const totalSellVal = numeric(data.totalSellTradedAmount ?? data.totalSellValue ?? data.foreignSellValue)
              const totalBuyVol = numeric(data.totalBuyVolume ?? data.totalBuyQtty ?? data.foreignBuyVolume)
              const totalSellVol = numeric(data.totalSellVolume ?? data.totalSellQtty ?? data.foreignSellVolume)
              const buyVal = numeric(data.buyTradedAmount)
              const sellVal = numeric(data.sellTradedAmount)
              const buyVol = numeric(data.buyVolume)
              const sellVol = numeric(data.sellVolume)

              setQuotes((current) => {
                const previous = current[symbol] as LiveStockQuote | undefined
                if (!previous) return current

                const prevBuyVal = previous.foreignBuyValue ?? 0
                const prevSellVal = previous.foreignSellValue ?? 0
                const nextBuyVal = totalBuyVal || (buyVal > 0 ? prevBuyVal + buyVal : prevBuyVal)
                const nextSellVal = totalSellVal || (sellVal > 0 ? prevSellVal + sellVal : prevSellVal)

                const prevBuyVol = previous.foreignBuyVolume ?? 0
                const prevSellVol = previous.foreignSellVolume ?? 0
                const nextBuyVol = totalBuyVol || (buyVol > 0 ? prevBuyVol + buyVol : prevBuyVol)
                const nextSellVol = totalSellVol || (sellVol > 0 ? prevSellVol + sellVol : prevSellVol)

                let foreignNetValue: number | undefined
                if (nextBuyVal > 0 || nextSellVal > 0) {
                  foreignNetValue = nextBuyVal - nextSellVal
                } else if (nextBuyVol > 0 || nextSellVol > 0) {
                  foreignNetValue = (nextBuyVol - nextSellVol) * (previous.price || 0)
                }

                return {
                  ...current,
                  [symbol]: {
                    ...previous,
                    foreignBuyValue: nextBuyVal || undefined,
                    foreignSellValue: nextSellVal || undefined,
                    foreignBuyVolume: nextBuyVol || undefined,
                    foreignSellVolume: nextSellVol || undefined,
                    foreignNetValue,
                    updatedAt: receivedAt,
                  },
                }
              })
              setLastMessageAt(receivedAt)
              setStreamError("")
              return
            }
          })
        }

        socket.onerror = () => {
          if (!disposed) {
            setStreamState("ERROR")
            setStreamError("Kết nối DNSE WebSocket gặp lỗi; đang tự khôi phục.")
            forceReconnect("DNSE websocket error")
          }
        }
        socket.onclose = () => {
          closeConnectionTimers()
          if (disposed) return
          setStreamState("CLOSED")
          scheduleReconnect()
        }
      } catch (error) {
        if (disposed) return
        setStreamState("ERROR")
        setStreamError(error instanceof Error ? error.message : String(error))
        scheduleReconnect()
      }
    }

    const recoverIfNeeded = () => {
      if (document.visibilityState !== "visible") return
      if (!socket || socket.readyState !== WebSocket.OPEN || Date.now() - lastFrameAt.current > STREAM_STALE_MS) {
        forceReconnect("browser resumed")
      }
    }
    const onVisibilityChange = () => recoverIfNeeded()
    const onOnline = () => recoverIfNeeded()
    document.addEventListener("visibilitychange", onVisibilityChange)
    window.addEventListener("online", onOnline)

    void connect()
    return () => {
      disposed = true
      clearReconnectTimer()
      clearMessageQueue()
      closeConnectionTimers()
      document.removeEventListener("visibilitychange", onVisibilityChange)
      window.removeEventListener("online", onOnline)
      if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000, "board closed")
    }
  }, [symbolKey, reconnectKey, pushFiveMinuteClose, symbolList, trackedSymbols])

  const normalizedQuery = query.trim().toUpperCase()
  const currentSessionDay = vietnamSessionDay()
  const displayQuotes = useMemo(() => {
    const next = { ...quotes }
    for (const stock of universe) {
      if (next[stock.ticker]) continue
      const history = priceHistory[stock.ticker] ?? []
      const price = history.at(-1)?.close ?? stock.lastClose
      if (!price || price <= 0) continue
      const priorNotionClose = stock.lastCloseDate && stock.lastCloseDate < currentSessionDay ? stock.lastClose : null
      const reference = priorNotionClose ?? price
      next[stock.ticker] = {
        symbol: stock.ticker,
        price,
        reference,
        change: price - reference,
        changePercent: reference > 0 ? ((price - reference) / reference) * 100 : 0,
        updatedAt: stock.lastCloseDate ?? new Date().toISOString(),
      }
    }
    return next
  }, [currentSessionDay, priceHistory, quotes, universe])
  const filtered = useMemo(() => universe.filter((stock) => (!normalizedQuery || stock.ticker.includes(normalizedQuery)) && (selectedSector === "Tất cả" || stock.sector === selectedSector)), [universe, normalizedQuery, selectedSector])
  const movers = useMemo(() => [...filtered].sort((a, b) => compareByPerformance(a, b, displayQuotes)), [displayQuotes, filtered])
  const grouped = useMemo(() => BOARD_SECTOR_GROUPS.map((group) => ({
    ...group,
    stocks: filtered.filter((stock) => group.sectors.some((sector) => sector === stock.sector)).sort((a, b) => compareByPerformance(a, b, displayQuotes)),
  })), [displayQuotes, filtered])
  const liveCount = universe.filter((stock) => quotes[stock.ticker]).length
  const pricedCount = universe.filter((stock) => displayQuotes[stock.ticker]).length
  const historyCount = universe.filter((stock) => (priceHistory[stock.ticker]?.length ?? 0) > 1).length
  const advances = universe.filter((stock) => ((displayQuotes[stock.ticker] as LiveStockQuote | undefined)?.changePercent ?? 0) > 0).length
  const declines = universe.filter((stock) => ((displayQuotes[stock.ticker] as LiveStockQuote | undefined)?.changePercent ?? 0) < 0).length
  const openBook = useCallback(
    (ticker: string) => {
      const q = displayQuotes[ticker] as LiveStockQuote | undefined
      const s = universe.find((st) => st.ticker === ticker)
      const h = (priceHistory[ticker] ?? []).map((p) => p.close)
      openOrderBook(`board:${ticker}`, ticker, {
        sector: s?.sector,
        price: q?.price,
        reference: q?.reference,
        ceiling: q?.ceiling,
        floor: q?.floor,
        changePercent: q?.changePercent,
        volume: q?.volume,
        history: h,
      })
    },
    [displayQuotes, universe, priceHistory, openOrderBook],
  )
  const reconnect = useCallback(() => setReconnectKey((key) => key + 1), [])
  const handleToggleWatch = useCallback((ticker: string) => toggleWatch(ticker), [toggleWatch])

  const { totalUniverseVolume, totalUniverseValue } = useMemo(() => {
    let vol = 0
    let val = 0
    for (const stock of universe) {
      const q = displayQuotes[stock.ticker] as LiveStockQuote | undefined
      if (q && q.volume && q.volume > 0) {
        vol += q.volume
        if (q.price && q.price > 0) {
          val += q.volume * q.price * 1000
        }
      }
    }
    return { totalUniverseVolume: vol, totalUniverseValue: val }
  }, [universe, displayQuotes])

  const vnindexQuote = quotes.VNINDEX as IndexQuote | undefined
  const vnindexVolume = vnindexQuote?.volume ?? (totalUniverseVolume > 0 ? totalUniverseVolume : undefined)
  const vnindexValue = vnindexQuote?.valueTraded ?? (totalUniverseValue > 0 ? totalUniverseValue : undefined)

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-background">
      <IndexStrip quotes={quotes} />

      {/* COMPACT TOP TOOLBAR */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-panel px-3 py-1.5">
        {/* VNINDEX Market Stats on the left (under VNINDEX and VN30 columns) */}
        <div className="flex items-center gap-3 font-mono text-xs">
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-muted font-sans font-medium">Tổng KL:</span>
            <span className="font-bold text-foreground">
              {vnindexVolume ? `${formatCompactVolume(vnindexVolume)} cp` : "—"}
            </span>
          </div>
          <div className="h-3 w-px bg-border/80" />
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-muted font-sans font-medium">Tổng GT:</span>
            <span className="font-bold text-foreground">
              {vnindexValue ? formatMarketValue(vnindexValue) : "—"}
            </span>
          </div>
        </div>

        {/* Search & Filters on the right */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[140px] sm:w-[180px]">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Tìm mã CP..."
              className="h-7 w-full rounded-md border border-border bg-background pl-8 pr-2.5 text-xs outline-none focus:border-brand"
            />
          </div>

          <select
            value={selectedSector}
            onChange={(event) => setSelectedSector(event.target.value)}
            className="h-7 rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none"
          >
            <option>Tất cả</option>
            {SECTOR_ORDER.map((sector) => (
              <option key={sector}>{sector}</option>
            ))}
          </select>

          <div className="flex items-center rounded-md border border-border bg-background p-0.5">
            <button
              onClick={() => setMode("sector")}
              className={`flex h-6 items-center gap-1 rounded px-2 text-[11px] font-medium transition-colors ${
                mode === "sector" ? "bg-panel-2 text-foreground font-semibold" : "text-muted-2 hover:text-foreground"
              }`}
            >
              <LayoutGrid className="h-3 w-3" />
              <span>{BOARD_SECTOR_GROUPS.length} nhóm</span>
            </button>
            <button
              onClick={() => setMode("movers")}
              className={`flex h-6 items-center gap-1 rounded px-2 text-[11px] font-medium transition-colors ${
                mode === "movers" ? "bg-panel-2 text-foreground font-semibold" : "text-muted-2 hover:text-foreground"
              }`}
            >
              <ChartNoAxesCombined className="h-3 w-3" />
              <span>Top movers</span>
            </button>
          </div>
        </div>
      </div>

      {streamState !== "LIVE" && streamError ? (
        <div className="flex items-center gap-2 border-b border-ref/30 bg-ref/5 px-3 py-1.5 text-xs text-ref">
          <CircleAlert className="h-3.5 w-3.5 shrink-0 text-ref" />
          <span>{streamError}</span>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto p-2">
        <WatchlistSection
          stocks={universe}
          quotes={displayQuotes}
          priceHistory={priceHistory}
          watchlist={watchlist}
          onToggleWatch={handleToggleWatch}
          onOpen={openBook}
        />
        {mode === "sector" ? (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            {grouped.map(({ key, label, stocks }) => {
              const sectorQuotes = stocks.map((stock) => displayQuotes[stock.ticker] as LiveStockQuote | undefined).filter(Boolean) as LiveStockQuote[]
              const avg = sectorQuotes.length ? sectorQuotes.reduce((sum, quote) => sum + quote.changePercent, 0) / sectorQuotes.length : undefined
              const avgTone = marketToneFromChange(avg)
              return (
                <section key={key} className="flex min-h-[260px] min-w-0 flex-col overflow-hidden rounded-xl border border-border/80 bg-panel hover:border-border-strong transition-colors">
                  <header className="relative flex h-[72px] shrink-0 items-center justify-between gap-2 overflow-hidden border-b border-border/70 bg-panel-2/50 px-2.5 py-2 before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-muted-2/40">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-sm shrink-0 leading-none opacity-80">{SECTOR_EMOJIS[key] ?? "📊"}</span>
                        <h2 className="truncate text-[12.5px] font-bold tracking-tight text-foreground/90" title={label}>
                          {label}
                        </h2>
                      </div>
                      <div className="mt-1.5 flex items-center gap-1.5">
                        <span className="inline-flex rounded-full border border-border/70 bg-background/60 px-2 py-0.5 font-mono text-[9.5px] font-medium text-muted-2">
                          {stocks.length} mã
                        </span>
                      </div>
                    </div>
                    {typeof avg === "number" ? <MarketChangePill value={avg} tone={avgTone} compact title="Biến động trung bình nhóm" /> : null}
                  </header>
                  <div className="flex-1 space-y-1.5 overflow-y-auto p-1.5">
                    {stocks.length ? (
                      stocks.map((stock) => (
                        <LiveStockRow
                          key={stock.ticker}
                          stock={stock}
                          quote={displayQuotes[stock.ticker] as LiveStockQuote | undefined}
                          history={(priceHistory[stock.ticker] ?? []).map((point) => point.close)}
                          onOpen={() => openBook(stock.ticker)}
                          isWatched={watchlist.has(stock.ticker)}
                          onToggleWatch={(e) => {
                            e.stopPropagation()
                            handleToggleWatch(stock.ticker)
                          }}
                        />
                      ))
                    ) : (
                      <div className="px-2 py-5 text-center text-[10px] text-muted">Không có mã phù hợp bộ lọc</div>
                    )}
                  </div>
                </section>
              )
            })}
          </div>
        ) : (
          <div className="mx-auto grid max-w-[1500px] grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-3">
            {movers.map((stock) => (
              <LiveMoverCard
                key={stock.ticker}
                stock={stock}
                quote={displayQuotes[stock.ticker] as LiveStockQuote | undefined}
                history={(priceHistory[stock.ticker] ?? []).map((point) => point.close)}
                onOpen={() => openBook(stock.ticker)}
                isWatched={watchlist.has(stock.ticker)}
                onToggleWatch={(e) => {
                  e.stopPropagation()
                  handleToggleWatch(stock.ticker)
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* FLOATING STATUS PILL AT BOTTOM RIGHT */}
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
        onReconnect={reconnect}
      />
    </div>
  )
}
