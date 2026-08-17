"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Activity, ChartNoAxesCombined, CircleAlert, LayoutGrid, RefreshCw, Search, Wifi, WifiOff } from "lucide-react"
import { MarketChangePill } from "@/components/market-change-pill"
import { BOARD_SECTOR_GROUPS, SECTOR_ORDER } from "@/lib/market-sectors"
import { marketToneFromChange, marketToneText } from "@/lib/market-tone"
import { useOrderBooks } from "@/components/orderbook/orderbook-context"
import { LiveMoverCard, LiveStockRow, formatBoardPrice, type LiveBoardStock, type LiveStockQuote } from "@/components/live-market-stock"
import { mergeFiveMinuteClose, normalizeEpochSeconds, normalizeMarketPrice, type IntradayPoint } from "@/lib/intraday-5m"

export type BoardUniverseStock = LiveBoardStock
type IndexQuote = { symbol: string; value: number; change?: number; changePercent: number; updatedAt: string }
type BoardMode = "sector" | "movers"
type StreamState = "CONNECTING" | "LIVE" | "ERROR" | "CLOSED"
type DnseAuthPayload = { action: string; api_key: string; signature: string; timestamp: number; nonce: string }
type DnseAuthResponse = { ok: boolean; url?: string; auth?: DnseAuthPayload; message?: string }
type IntradayHistoryResponse = {
  ok: boolean
  histories?: Record<string, { symbol: string; provider: "Yahoo" | null; points: IntradayPoint[]; reference: number | null; price: number | null; change: number | null; changePercent: number | null; lastBarAt: number | null; error: string | null }>
}

const INDEXES = ["VNINDEX", "VN30", "HNXINDEX", "UPCOMINDEX"]
const INDEX_LABELS: Record<string, string> = { VNINDEX: "VN-INDEX", VN30: "VN30", HNXINDEX: "HNX-INDEX", UPCOMINDEX: "UPCOM-INDEX" }
const INDEX_CHANNELS = ["VNINDEX", "VN30", "HNX", "UPCOM"]
const OPEN_PRICE_KEYS = ["openPrice", "openingPrice", "open", "openValue", "firstPrice"]
const INDEX_OPEN_KEYS = ["openIndex", "openingIndex", "openIndexValue", "openValue", "open"]
const STREAM_STALE_MS = 60_000

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

function IndexStrip({ quotes }: { quotes: Record<string, LiveStockQuote | IndexQuote> }) {
  return <div className="grid grid-cols-2 gap-px border-b border-border bg-border md:grid-cols-4">{INDEXES.map((symbol) => {
    const quote = quotes[symbol] as IndexQuote | undefined
    const tone = marketToneFromChange(quote?.changePercent)
    const text = quote ? marketToneText(tone) : "text-muted-2"
    return <div key={symbol} className="bg-panel px-4 py-2.5"><div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">{INDEX_LABELS[symbol]}</div><div className="mt-1 flex items-center gap-2"><span className={`font-mono text-sm font-bold ${text}`}>{formatBoardPrice(quote?.value)}</span>{quote ? <MarketChangePill value={quote.changePercent} tone={tone} compact /> : null}</div></div>
  })}</div>
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
  const openingReferences = useRef<Record<string, number>>({})
  const indexOpeningReferences = useRef<Record<string, number>>({})
  const sessionDay = useRef(vietnamSessionDay())
  const lastFrameAt = useRef(0)

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
            if (!history?.price || !history.reference || current[symbol]) continue
            openingReferences.current[symbol] = history.reference
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
    let disposed = false
    let socket: WebSocket | null = null
    let reconnectTimer: number | null = null
    let pingTimer: number | null = null
    let watchdogTimer: number | null = null
    let attempts = 0

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
      closeConnectionTimers()
      if (socket && socket.readyState < WebSocket.CLOSING) {
        try { socket.close(4000, reason.slice(0, 120)) } catch { scheduleReconnect() }
      } else {
        scheduleReconnect()
      }
    }

    const connect = async () => {
      clearReconnectTimer()
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
          let data: Record<string, unknown>
          try { data = JSON.parse(event.data) as Record<string, unknown> } catch { return }

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
          const currentSessionDay = vietnamSessionDay(now)
          if (sessionDay.current !== currentSessionDay) {
            sessionDay.current = currentSessionDay
            openingReferences.current = {}
            indexOpeningReferences.current = {}
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
            const explicitOpen = firstPositive(data, OPEN_PRICE_KEYS)
            if (explicitOpen > 0) openingReferences.current[ticker] = explicitOpen
            else if (!openingReferences.current[ticker]) openingReferences.current[ticker] = price
            const reference = openingReferences.current[ticker]
            const ceiling = firstPositive(data, ["ceilingPrice", "ceiling"])
            const floor = firstPositive(data, ["floorPrice", "floor"])
            const change = reference > 0 ? price - reference : undefined
            const changePercent = reference > 0 ? ((price - reference) / reference) * 100 : 0
            setQuotes((current) => ({
              ...current,
              [ticker]: {
                symbol: ticker,
                price,
                reference: reference || undefined,
                ceiling: ceiling || undefined,
                floor: floor || undefined,
                change,
                changePercent,
                volume: totalVolume || (current[ticker] as LiveStockQuote | undefined)?.volume,
                updatedAt: receivedAt,
              },
            }))
            setLastMessageAt(receivedAt)
            setStreamError("")
            return
          }

          if (type === "q" && data.symbol) {
            const ticker = String(data.symbol).toUpperCase()
            if (!trackedSymbols.has(ticker)) return
            const explicitOpen = firstPositive(data, OPEN_PRICE_KEYS)
            if (explicitOpen > 0) openingReferences.current[ticker] = explicitOpen
            const ceiling = firstPositive(data, ["ceilingPrice", "ceiling"])
            const floor = firstPositive(data, ["floorPrice", "floor"])
            const price = firstPositive(data, ["matchPrice", "price", "lastPrice"])
            setQuotes((current) => {
              const previous = current[ticker] as LiveStockQuote | undefined
              const livePrice = price || previous?.price
              if (!livePrice) return current
              if (!openingReferences.current[ticker]) openingReferences.current[ticker] = previous?.reference || livePrice
              const reference = openingReferences.current[ticker]
              return {
                ...current,
                [ticker]: {
                  symbol: ticker,
                  price: livePrice,
                  reference,
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
            const explicitOpen = firstPositive(data, INDEX_OPEN_KEYS)
            if (explicitOpen > 0) indexOpeningReferences.current[symbol] = explicitOpen
            else if (!indexOpeningReferences.current[symbol]) indexOpeningReferences.current[symbol] = value
            const reference = indexOpeningReferences.current[symbol]
            const change = reference > 0 ? value - reference : undefined
            const changePercent = reference > 0 ? ((value - reference) / reference) * 100 : 0
            setQuotes((current) => ({ ...current, [symbol]: { symbol, value, change, changePercent, updatedAt: receivedAt } }))
            setLastMessageAt(receivedAt)
            setStreamError("")
          }
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
      closeConnectionTimers()
      document.removeEventListener("visibilitychange", onVisibilityChange)
      window.removeEventListener("online", onOnline)
      if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000, "board closed")
    }
  }, [symbolKey, reconnectKey, pushFiveMinuteClose, symbolList, trackedSymbols])

  const normalizedQuery = query.trim().toUpperCase()
  const filtered = useMemo(() => universe.filter((stock) => (!normalizedQuery || stock.ticker.includes(normalizedQuery)) && (selectedSector === "Tất cả" || stock.sector === selectedSector)), [universe, normalizedQuery, selectedSector])
  const movers = useMemo(() => [...filtered].sort((a, b) => compareByPerformance(a, b, quotes)), [filtered, quotes])
  const grouped = useMemo(() => BOARD_SECTOR_GROUPS.map((group) => ({
    ...group,
    stocks: filtered.filter((stock) => group.sectors.some((sector) => sector === stock.sector)).sort((a, b) => compareByPerformance(a, b, quotes)),
  })), [filtered, quotes])
  const liveCount = universe.filter((stock) => quotes[stock.ticker]).length
  const historyCount = universe.filter((stock) => (priceHistory[stock.ticker]?.length ?? 0) > 1).length
  const advances = universe.filter((stock) => ((quotes[stock.ticker] as LiveStockQuote | undefined)?.changePercent ?? 0) > 0).length
  const declines = universe.filter((stock) => ((quotes[stock.ticker] as LiveStockQuote | undefined)?.changePercent ?? 0) < 0).length
  const openBook = useCallback((ticker: string) => openOrderBook(`board:${ticker}`, ticker), [openOrderBook])
  const reconnect = useCallback(() => setReconnectKey((key) => key + 1), [])

  return <div className="flex h-full min-h-0 flex-col bg-background">
    <IndexStrip quotes={quotes} />
    <div className="flex flex-wrap items-center gap-2 border-b border-border bg-panel px-3 py-2.5">
      <div className="relative min-w-[210px] flex-1 md:max-w-[320px]"><Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm mã trong Top 50..." className="h-8 w-full rounded-md border border-border bg-background pl-8 pr-3 text-xs outline-none" /></div>
      <select value={selectedSector} onChange={(event) => setSelectedSector(event.target.value)} className="h-8 rounded-md border border-border bg-background px-2 text-xs"><option>Tất cả</option>{SECTOR_ORDER.map((sector) => <option key={sector}>{sector}</option>)}</select>
      <div className="flex items-center rounded-md border border-border bg-background p-0.5"><button onClick={() => setMode("sector")} className={`flex h-7 items-center gap-1.5 rounded px-2 text-[11px] ${mode === "sector" ? "bg-panel-2" : "text-muted-2"}`}><LayoutGrid className="h-3.5 w-3.5" />7 nhóm ngành</button><button onClick={() => setMode("movers")} className={`flex h-7 items-center gap-1.5 rounded px-2 text-[11px] ${mode === "movers" ? "bg-panel-2" : "text-muted-2"}`}><ChartNoAxesCombined className="h-3.5 w-3.5" />Top movers</button></div>
      <div className="ml-auto flex items-center gap-3 text-[11px]">{streamState === "LIVE" ? <span className="flex items-center gap-1.5 text-up"><Wifi className="h-3.5 w-3.5" />DNSE WebSocket · LIVE · {liveCount}/50</span> : <span className="flex items-center gap-1.5 text-ref"><WifiOff className="h-3.5 w-3.5" />DNSE · {streamState === "CONNECTING" ? "đang kết nối" : "đang tự khôi phục"}</span>}<button onClick={reconnect} className="rounded-md border border-border p-1.5" aria-label="Kết nối lại DNSE" title="Kết nối lại DNSE"><RefreshCw className={`h-3.5 w-3.5 ${streamState === "CONNECTING" ? "animate-spin" : ""}`} /></button></div>
    </div>
    {streamState !== "LIVE" ? <div className="flex items-start gap-2 border-b border-ref/30 bg-ref/5 px-4 py-2.5 text-xs"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-ref" /><span>Bảng điện tự giữ kết nối DNSE và tự reconnect khi stale/mất mạng. {streamError ? `Lỗi gần nhất: ${streamError}` : "Đang chờ stream DNSE."}</span></div> : null}
    <div className="flex items-center gap-4 border-b border-border px-4 py-2 text-[11px] text-muted-2"><span className="flex items-center gap-1.5"><Activity className="h-3.5 w-3.5" />Top 50 · Yahoo 5m + DNSE live</span><span>Tăng <b className="text-up">{advances}</b></span><span>Giảm <b className="text-down">{declines}</b></span><span>Có giá <b className="text-foreground">{liveCount}</b>/50</span><span>History <b className="text-foreground">{historyCount}</b>/50</span>{lastMessageAt ? <span className="ml-auto">DNSE {new Date(lastMessageAt).toLocaleTimeString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}</span> : null}</div>
    <div className="min-h-0 flex-1 overflow-auto p-2">{mode === "sector" ? <div className="grid min-w-[1260px] grid-cols-7 gap-2" style={{ gridTemplateColumns: "repeat(7, minmax(176px, 1fr))" }}>{grouped.map(({ key, label, stocks }) => {
      const sectorQuotes = stocks.map((stock) => quotes[stock.ticker] as LiveStockQuote | undefined).filter(Boolean) as LiveStockQuote[]
      const avg = sectorQuotes.length ? sectorQuotes.reduce((sum, quote) => sum + quote.changePercent, 0) / sectorQuotes.length : undefined
      const avgTone = marketToneFromChange(avg)
      return <section key={key} className="flex min-h-[260px] min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-panel"><header className="flex min-h-[58px] items-center justify-between gap-2 border-b border-border px-2.5 py-2"><div className="min-w-0"><h2 className="text-[12px] font-bold leading-[1.15] text-foreground">{label}</h2><p className="mt-1 text-[10px] text-muted-2">{stocks.length} mã</p></div>{typeof avg === "number" ? <MarketChangePill value={avg} tone={avgTone} compact title="Biến động trung bình nhóm" /> : null}</header><div className="flex-1 space-y-1.5 overflow-y-auto p-1.5">{stocks.length ? stocks.map((stock) => <LiveStockRow key={stock.ticker} stock={stock} quote={quotes[stock.ticker] as LiveStockQuote | undefined} history={(priceHistory[stock.ticker] ?? []).map((point) => point.close)} onOpen={() => openBook(stock.ticker)} />) : <div className="px-2 py-5 text-center text-[10px] text-muted">Không có mã phù hợp bộ lọc</div>}</div></section>
    })}</div> : <div className="mx-auto grid max-w-[1500px] grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-3">{movers.map((stock) => <LiveMoverCard key={stock.ticker} stock={stock} quote={quotes[stock.ticker] as LiveStockQuote | undefined} history={(priceHistory[stock.ticker] ?? []).map((point) => point.close)} onOpen={() => openBook(stock.ticker)} />)}</div>}</div>
  </div>
}
