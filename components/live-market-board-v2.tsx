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
type IndexHistoryResponse = { ok: boolean; quotes?: Record<string, IndexQuote> }

const INDEXES = ["VNINDEX", "VN30", "HNXINDEX", "UPCOMINDEX"]
const INDEX_LABELS: Record<string, string> = { VNINDEX: "VN-INDEX", VN30: "VN30", HNXINDEX: "HNX-INDEX", UPCOMINDEX: "UPCOM-INDEX" }
const INDEX_CHANNELS = ["VNINDEX", "VN30", "HNX", "UPCOM"]
const STOCK_REFERENCE_KEYS = ["referencePrice", "refPrice", "reference", "basicPrice", "previousClose", "prevClose", "priorClose"]
const INDEX_REFERENCE_KEYS = ["referenceIndex", "referenceValue", "reference", "previousClose", "prevClose", "priorClose"]
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
  const dailyReferences = useRef<Record<string, number>>({})
  const indexReferences = useRef<Record<string, number>>({})
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
            setQuotes((current) => {
              const previous = current[symbol] as IndexQuote | undefined
              const previousDerivedReference = previous && typeof previous.change === "number" ? previous.value - previous.change : 0
              const reference = indexReferences.current[symbol] || previousDerivedReference
              if (reference > 0) indexReferences.current[symbol] = reference
              const change = reference > 0 ? value - reference : previous?.change
              const changePercent = reference > 0 ? ((value - reference) / reference) * 100 : previous?.changePercent ?? 0
              return { ...current, [symbol]: { symbol, value, change, changePercent, updatedAt: receivedAt } }
            })
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
  const displayQuotes = useMemo(() => {
    const next = { ...quotes }
    for (const stock of universe) {
      if (next[stock.ticker]) continue
      const history = priceHistory[stock.ticker] ?? []
      const price = history.at(-1)?.close ?? stock.lastClose
      if (!price || price <= 0) continue
      const priorNotionClose = stock.lastCloseDate && stock.lastCloseDate < sessionDay.current ? stock.lastClose : null
      const reference = dailyReferences.current[stock.ticker] ?? priorNotionClose ?? price
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
  }, [priceHistory, quotes, universe])
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
  const openBook = useCallback((ticker: string) => openOrderBook(`board:${ticker}`, ticker), [openOrderBook])
  const reconnect = useCallback(() => setReconnectKey((key) => key + 1), [])

  return <div className="flex h-full min-h-0 flex-col bg-background">
    <IndexStrip quotes={quotes} />
    <div className="flex flex-wrap items-center gap-2 border-b border-border bg-panel px-3 py-2.5">
      <div className="relative min-w-[210px] flex-1 md:max-w-[320px]"><Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm mã trong Top 100..." className="h-8 w-full rounded-md border border-border bg-background pl-8 pr-3 text-xs outline-none" /></div>
      <select value={selectedSector} onChange={(event) => setSelectedSector(event.target.value)} className="h-8 rounded-md border border-border bg-background px-2 text-xs"><option>Tất cả</option>{SECTOR_ORDER.map((sector) => <option key={sector}>{sector}</option>)}</select>
      <div className="flex items-center rounded-md border border-border bg-background p-0.5"><button onClick={() => setMode("sector")} className={`flex h-7 items-center gap-1.5 rounded px-2 text-[11px] ${mode === "sector" ? "bg-panel-2" : "text-muted-2"}`}><LayoutGrid className="h-3.5 w-3.5" />{BOARD_SECTOR_GROUPS.length} nhóm ngành</button><button onClick={() => setMode("movers")} className={`flex h-7 items-center gap-1.5 rounded px-2 text-[11px] ${mode === "movers" ? "bg-panel-2" : "text-muted-2"}`}><ChartNoAxesCombined className="h-3.5 w-3.5" />Top movers</button></div>
      <div className="ml-auto flex items-center gap-3 text-[11px]">{streamState === "LIVE" ? <span className="flex items-center gap-1.5 text-up"><Wifi className="h-3.5 w-3.5" />DNSE WebSocket · LIVE · {liveCount}/{universe.length}</span> : <span className="flex items-center gap-1.5 text-ref"><WifiOff className="h-3.5 w-3.5" />DNSE · {streamState === "CONNECTING" ? "đang kết nối" : "đang tự khôi phục"}</span>}<button onClick={reconnect} className="rounded-md border border-border p-1.5" aria-label="Kết nối lại DNSE" title="Kết nối lại DNSE"><RefreshCw className={`h-3.5 w-3.5 ${streamState === "CONNECTING" ? "animate-spin" : ""}`} /></button></div>
    </div>
    {streamState !== "LIVE" ? <div className="flex items-start gap-2 border-b border-ref/30 bg-ref/5 px-4 py-2.5 text-xs"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-ref" /><span>Bảng điện tự giữ kết nối DNSE và tự reconnect khi stale/mất mạng. {streamError ? `Lỗi gần nhất: ${streamError}` : "Đang chờ stream DNSE."}</span></div> : null}
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border px-4 py-2 text-[11px] text-muted-2"><span className="flex items-center gap-1.5"><Activity className="h-3.5 w-3.5" />Top 100 HOSE · Yahoo 5m + DNSE live</span><span>Tăng <b className="text-up">{advances}</b></span><span>Giảm <b className="text-down">{declines}</b></span><span>Có giá <b className="text-foreground">{pricedCount}</b>/{universe.length}</span><span>History <b className="text-foreground">{historyCount}</b>/{universe.length}</span>{lastMessageAt ? <span className="ml-auto">DNSE {new Date(lastMessageAt).toLocaleTimeString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}</span> : null}</div>
    <div className="min-h-0 flex-1 overflow-auto p-2">{mode === "sector" ? <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">{grouped.map(({ key, label, stocks }) => {
      const sectorQuotes = stocks.map((stock) => displayQuotes[stock.ticker] as LiveStockQuote | undefined).filter(Boolean) as LiveStockQuote[]
      const avg = sectorQuotes.length ? sectorQuotes.reduce((sum, quote) => sum + quote.changePercent, 0) / sectorQuotes.length : undefined
      const avgTone = marketToneFromChange(avg)
      return <section key={key} className="flex min-h-[260px] min-w-0 flex-col overflow-hidden rounded-xl border border-brand/20 bg-panel"><header className="relative flex h-[72px] shrink-0 items-center justify-between gap-2 overflow-hidden border-b border-brand/25 bg-gradient-to-r from-brand/15 via-brand/5 to-transparent px-3 py-2.5 before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-brand"><div className="min-w-0"><h2 className="line-clamp-2 text-[13px] font-extrabold leading-[1.15] text-foreground">{label}</h2><p className="mt-1.5 inline-flex rounded-full border border-brand/20 bg-background/60 px-2 py-0.5 text-[10px] font-semibold text-muted-2">{stocks.length} mã</p></div>{typeof avg === "number" ? <MarketChangePill value={avg} tone={avgTone} compact title="Biến động trung bình nhóm" /> : null}</header><div className="flex-1 space-y-2 overflow-y-auto p-2">{stocks.length ? stocks.map((stock) => <LiveStockRow key={stock.ticker} stock={stock} quote={displayQuotes[stock.ticker] as LiveStockQuote | undefined} history={(priceHistory[stock.ticker] ?? []).map((point) => point.close)} onOpen={() => openBook(stock.ticker)} />) : <div className="px-2 py-5 text-center text-[10px] text-muted">Không có mã phù hợp bộ lọc</div>}</div></section>
    })}</div> : <div className="mx-auto grid max-w-[1500px] grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-3">{movers.map((stock) => <LiveMoverCard key={stock.ticker} stock={stock} quote={displayQuotes[stock.ticker] as LiveStockQuote | undefined} history={(priceHistory[stock.ticker] ?? []).map((point) => point.close)} onOpen={() => openBook(stock.ticker)} />)}</div>}</div>
  </div>
}