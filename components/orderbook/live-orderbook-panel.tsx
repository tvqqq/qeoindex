"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ExternalLink, GripVertical, Minus, RefreshCw, X } from "lucide-react"

type DepthLevel = { price: number; volume: number }
type TradeSide = "BUY" | "SELL" | "UNKNOWN"
type StreamTrade = { id: string; time: string; price: number; volume: number; side: TradeSide }
type StockQuote = { symbol: string; price: number; reference?: number; change?: number; changePercent: number; updatedAt: string }
type StreamState = "CONNECTING" | "LIVE" | "ERROR" | "CLOSED"
type ActivityTab = "trades" | "foreign"
type ForeignSnapshot = {
  symbol: string
  buyVolume: number | null
  sellVolume: number | null
  buyValue: number | null
  sellValue: number | null
  currentRoom: number | null
  totalRoom: number | null
  updatedAt: string
  sourceKeys: string[]
}
type ForeignFlowEvent = { id: string; time: string; side: "BUY" | "SELL"; volume: number; value: number | null }

const WIDTH = 720
const ROUND_LOT_MULTIPLIER = 100
const OPEN_PRICE_KEYS = ["openPrice", "openingPrice", "open", "openValue", "firstPrice"]
const STREAM_STALE_MS = 45_000
const FOREIGN_REFRESH_MS = 2_000

function number(value: unknown) {
  const result = typeof value === "number" ? value : Number(value)
  return Number.isFinite(result) ? result : 0
}

function firstPositive(data: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = number(data[key])
    if (value > 0) return value
  }
  return 0
}

function formatPrice(value?: number | null, allowNegative = false) {
  if (typeof value !== "number" || !Number.isFinite(value) || (!allowNegative && value <= 0)) return "—"
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 }).format(value)
}

function formatVolume(value?: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return "—"
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(value)
}

function formatMarketValue(value?: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—"
  const abs = Math.abs(value)
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(abs >= 10_000_000_000 ? 1 : 2)} tỷ`
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)} tr`
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(value)
}

function pctClass(value?: number) {
  if (typeof value !== "number") return "text-muted-2"
  if (value > 0) return "text-up"
  if (value < 0) return "text-down"
  return "text-ref"
}

function normalizeDepth(rows: unknown): DepthLevel[] {
  if (!Array.isArray(rows)) return []
  return rows
    .map((row: any) => ({
      price: number(row?.price),
      volume: number(row?.qtty ?? row?.quantity ?? row?.volume) * ROUND_LOT_MULTIPLIER,
    }))
    .filter((row) => row.price > 0 && row.volume >= 0)
}

function normalizeTime(value: unknown) {
  if (typeof value === "number") {
    const millis = value > 10_000_000_000 ? value : value * 1000
    return new Date(millis).toISOString()
  }
  if (value && typeof value === "object") {
    const seconds = number((value as any).Seconds ?? (value as any).seconds)
    const nanos = number((value as any).Nanos ?? (value as any).nanos)
    if (seconds > 0) return new Date((seconds + nanos / 1e9) * 1000).toISOString()
  }
  const text = String(value ?? "")
  const parsed = Date.parse(text)
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString()
}

function timeLabel(value: string) {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) return value || "—"
  return new Date(parsed).toLocaleTimeString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
}

function inferSide(rawSide: unknown, price: number, bids: DepthLevel[], asks: DepthLevel[]): TradeSide {
  const side = String(rawSide ?? "").toUpperCase()
  if (["BUY", "B", "MUA", "BU"].includes(side)) return "BUY"
  if (["SELL", "S", "BÁN", "BAN", "SD"].includes(side)) return "SELL"
  const bestBid = bids[0]?.price
  const bestAsk = asks[0]?.price
  if (bestAsk && price >= bestAsk) return "BUY"
  if (bestBid && price <= bestBid) return "SELL"
  return "UNKNOWN"
}

function sideMeta(side: TradeSide) {
  if (side === "BUY") return { label: "Mua*", className: "text-up" }
  if (side === "SELL") return { label: "Bán*", className: "text-down" }
  return { label: "—", className: "text-muted-2" }
}

function nextQuote(symbol: string, data: Record<string, unknown>, current: StockQuote | null): StockQuote | null {
  const price = firstPositive(data, ["matchPrice", "price", "lastPrice"]) || current?.price || 0
  if (price <= 0) return current
  const explicitOpen = firstPositive(data, OPEN_PRICE_KEYS)
  const reference = explicitOpen || current?.reference || price
  const change = reference > 0 ? price - reference : current?.change
  const changePercent = reference > 0 ? ((price - reference) / reference) * 100 : current?.changePercent ?? 0
  return {
    symbol,
    price,
    reference: reference || undefined,
    change,
    changePercent,
    updatedAt: new Date().toISOString(),
  }
}

function useDnseOrderBookStream(symbol: string, reconnectKey: number) {
  const [state, setState] = useState<StreamState>("CONNECTING")
  const [bids, setBids] = useState<DepthLevel[]>([])
  const [asks, setAsks] = useState<DepthLevel[]>([])
  const [trades, setTrades] = useState<StreamTrade[]>([])
  const [quote, setQuote] = useState<StockQuote | null>(null)
  const [updatedAt, setUpdatedAt] = useState("")
  const [error, setError] = useState("")
  const depthRef = useRef<{ bids: DepthLevel[]; asks: DepthLevel[] }>({ bids: [], asks: [] })
  const lastFrameAt = useRef(Date.now())

  useEffect(() => {
    let disposed = false
    let socket: WebSocket | null = null
    let reconnectTimer: number | null = null
    let pingTimer: number | null = null
    let watchdogTimer: number | null = null
    let attempts = 0

    setState("CONNECTING")
    setError("")

    const clearConnectionTimers = () => {
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
      const base = Math.min(650 * 2 ** Math.min(attempts - 1, 4), 8_000)
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null
        void connect()
      }, base + Math.floor(Math.random() * 400))
    }

    const forceReconnect = (reason: string) => {
      if (disposed) return
      clearConnectionTimers()
      if (socket && socket.readyState < WebSocket.CLOSING) {
        try { socket.close(4000, reason.slice(0, 120)) } catch { scheduleReconnect() }
      } else {
        scheduleReconnect()
      }
    }

    const connect = async () => {
      clearReconnectTimer()
      clearConnectionTimers()
      if (disposed) return
      setState("CONNECTING")
      lastFrameAt.current = Date.now()
      try {
        const authResponse = await fetch("/api/market/stream-auth", { cache: "no-store", headers: { Accept: "application/json" } })
        const authJson = await authResponse.json()
        if (!authResponse.ok || !authJson.ok || !authJson.url || !authJson.auth) throw new Error(authJson.message ?? `Stream auth ${authResponse.status}`)
        if (disposed) return

        socket = new WebSocket(authJson.url)
        socket.onopen = () => {
          lastFrameAt.current = Date.now()
          setState("CONNECTING")
        }
        socket.onmessage = (event) => {
          if (disposed || typeof event.data !== "string") return
          lastFrameAt.current = Date.now()
          let data: any
          try { data = JSON.parse(event.data) } catch { return }

          const action = data?.action ?? data?.a
          if (action === "ping") {
            if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ action: "pong", timestamp: data?.timestamp }))
            return
          }
          if (data?.session_id || data?.sid || action === "welcome") {
            socket?.send(JSON.stringify(authJson.auth))
            return
          }
          if (action === "auth_success") {
            setState("LIVE")
            setError("")
            attempts = 0
            socket?.send(JSON.stringify({
              action: "subscribe",
              channels: [
                { name: "tick.G1.json", symbols: [symbol] },
                { name: "top_price.G1.json", symbols: [symbol] },
                { name: "tick_extra.G1.json", symbols: [symbol] },
              ],
            }))
            pingTimer = window.setInterval(() => {
              if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ action: "ping", timestamp: Date.now() }))
            }, 15_000)
            watchdogTimer = window.setInterval(() => {
              if (socket?.readyState === WebSocket.OPEN && Date.now() - lastFrameAt.current > STREAM_STALE_MS) {
                setError("DNSE WS im lặng quá 45 giây; đang tự reconnect.")
                forceReconnect("stale orderbook stream")
              }
            }, 7_500)
            return
          }
          if (action === "auth_error" || action === "error") {
            setState("ERROR")
            setError(data?.message ?? data?.msg ?? "DNSE stream authentication failed")
            forceReconnect("orderbook auth/subscription error")
            return
          }

          const ticker = String(data?.symbol ?? "").toUpperCase()
          if (ticker !== symbol) return

          if (data?.T === "q") {
            const nextBids = normalizeDepth(data?.bid).sort((a, b) => b.price - a.price)
            const nextAsks = normalizeDepth(data?.offer).sort((a, b) => a.price - b.price)
            depthRef.current = { bids: nextBids, asks: nextAsks }
            setBids(nextBids)
            setAsks(nextAsks)
            setQuote((current) => nextQuote(symbol, data, current))
            setUpdatedAt(new Date().toISOString())
            setError("")
            return
          }

          if (data?.T === "t") {
            setQuote((current) => nextQuote(symbol, data, current))
            setUpdatedAt(new Date().toISOString())
            setError("")
            return
          }

          if (data?.T === "te") {
            const price = number(data?.matchPrice)
            const volume = number(data?.matchQtty) * ROUND_LOT_MULTIPLIER
            setQuote((current) => nextQuote(symbol, data, current))
            setUpdatedAt(new Date().toISOString())
            setError("")
            if (price <= 0 || volume <= 0) return
            const time = normalizeTime(data?.time)
            const trade: StreamTrade = {
              id: `${time}-${price}-${volume}-${String(data?.side ?? "")}-${Math.random().toString(36).slice(2, 7)}`,
              time,
              price,
              volume,
              side: inferSide(data?.side, price, depthRef.current.bids, depthRef.current.asks),
            }
            setTrades((current) => [trade, ...current].slice(0, 80))
          }
        }

        socket.onerror = () => {
          if (!disposed) {
            setState("ERROR")
            setError("DNSE WebSocket gặp lỗi; đang tự kết nối lại.")
            forceReconnect("orderbook websocket error")
          }
        }
        socket.onclose = () => {
          clearConnectionTimers()
          if (disposed) return
          setState("CLOSED")
          scheduleReconnect()
        }
      } catch (nextError) {
        if (disposed) return
        setState("ERROR")
        setError(nextError instanceof Error ? nextError.message : String(nextError))
        scheduleReconnect()
      }
    }

    const recoverIfNeeded = () => {
      if (document.visibilityState !== "visible") return
      if (!socket || socket.readyState !== WebSocket.OPEN || Date.now() - lastFrameAt.current > STREAM_STALE_MS) {
        forceReconnect("popup resumed")
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
      clearConnectionTimers()
      document.removeEventListener("visibilitychange", onVisibilityChange)
      window.removeEventListener("online", onOnline)
      if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000, "popup closed")
    }
  }, [symbol, reconnectKey])

  return { state, bids, asks, trades, quote, updatedAt, error }
}

function useDnseForeignTrading(symbol: string) {
  const [snapshot, setSnapshot] = useState<ForeignSnapshot | null>(null)
  const [events, setEvents] = useState<ForeignFlowEvent[]>([])
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(true)
  const previousRef = useRef<ForeignSnapshot | null>(null)

  useEffect(() => {
    let disposed = false
    let timer: number | null = null
    let inFlight = false
    previousRef.current = null
    setSnapshot(null)
    setEvents([])
    setError("")
    setLoading(true)

    const load = async () => {
      if (disposed || inFlight || document.visibilityState === "hidden") return
      inFlight = true
      try {
        const response = await fetch(`/api/market/foreign?symbol=${encodeURIComponent(symbol)}`, {
          cache: "no-store",
          headers: { Accept: "application/json" },
        })
        const payload = await response.json() as { ok?: boolean; snapshot?: ForeignSnapshot; message?: string }
        if (!response.ok || !payload.ok || !payload.snapshot) throw new Error(payload.message ?? `DNSE foreign ${response.status}`)
        if (disposed) return

        const next = payload.snapshot
        const previous = previousRef.current
        if (previous) {
          const nextEvents: ForeignFlowEvent[] = []
          const buyDelta = next.buyVolume !== null && previous.buyVolume !== null ? next.buyVolume - previous.buyVolume : 0
          const sellDelta = next.sellVolume !== null && previous.sellVolume !== null ? next.sellVolume - previous.sellVolume : 0
          const buyValueDelta = next.buyValue !== null && previous.buyValue !== null ? next.buyValue - previous.buyValue : null
          const sellValueDelta = next.sellValue !== null && previous.sellValue !== null ? next.sellValue - previous.sellValue : null
          if (buyDelta > 0) nextEvents.push({ id: `${next.updatedAt}-BUY-${buyDelta}`, time: next.updatedAt, side: "BUY", volume: buyDelta, value: buyValueDelta !== null && buyValueDelta > 0 ? buyValueDelta : null })
          if (sellDelta > 0) nextEvents.push({ id: `${next.updatedAt}-SELL-${sellDelta}`, time: next.updatedAt, side: "SELL", volume: sellDelta, value: sellValueDelta !== null && sellValueDelta > 0 ? sellValueDelta : null })
          if (nextEvents.length) setEvents((current) => [...nextEvents, ...current].slice(0, 80))
        }
        previousRef.current = next
        setSnapshot(next)
        setError("")
        setLoading(false)
      } catch (nextError) {
        if (!disposed) {
          setError(nextError instanceof Error ? nextError.message : String(nextError))
          setLoading(false)
        }
      } finally {
        inFlight = false
      }
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void load()
    }
    document.addEventListener("visibilitychange", onVisibilityChange)
    void load()
    timer = window.setInterval(() => void load(), FOREIGN_REFRESH_MS)

    return () => {
      disposed = true
      if (timer) window.clearInterval(timer)
      document.removeEventListener("visibilitychange", onVisibilityChange)
    }
  }, [symbol])

  return { snapshot, events, error, loading }
}

export function LiveOrderBookPanel({ stockKey, symbol, index, z, onClose, onFocus }: { stockKey: string; symbol: string; index: number; z: number; onClose: () => void; onFocus: () => void }) {
  const [minimized, setMinimized] = useState(false)
  const [activityTab, setActivityTab] = useState<ActivityTab>("trades")
  const [reconnectKey, setReconnectKey] = useState(0)
  const [pos, setPos] = useState(() => ({ x: 28 + (index % 4) * 48, y: 78 + (index % 5) * 38 }))
  const drag = useRef<{ dx: number; dy: number } | null>(null)
  const stream = useDnseOrderBookStream(symbol, reconnectKey)
  const foreign = useDnseForeignTrading(symbol)
  const quote = stream.quote

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLElement>) => {
    onFocus()
    const target = event.target instanceof HTMLElement ? event.target : null
    if (target?.closest("button, a, [data-no-drag]")) return
    drag.current = { dx: event.clientX - pos.x, dy: event.clientY - pos.y }
    event.currentTarget.setPointerCapture(event.pointerId)
  }, [onFocus, pos.x, pos.y])

  const onPointerMove = useCallback((event: React.PointerEvent) => {
    if (!drag.current) return
    setPos({
      x: Math.max(0, Math.min(Math.max(0, window.innerWidth - Math.min(WIDTH, window.innerWidth)), event.clientX - drag.current.dx)),
      y: Math.max(0, Math.min(Math.max(0, window.innerHeight - 60), event.clientY - drag.current.dy)),
    })
  }, [])

  const onPointerUp = useCallback(() => { drag.current = null }, [])
  const topBids = stream.bids.slice(0, 3)
  const topAsks = stream.asks.slice(0, 3)
  const bidTotal = stream.bids.reduce((sum, row) => sum + row.volume, 0)
  const askTotal = stream.asks.reduce((sum, row) => sum + row.volume, 0)
  const depthTotal = bidTotal + askTotal
  const buyPct = depthTotal > 0 ? (bidTotal / depthTotal) * 100 : 50
  const sellPct = 100 - buyPct
  const rows = useMemo(() => Array.from({ length: 3 }, (_, i) => ({ bid: topBids[i], ask: topAsks[i] })), [topBids, topAsks])
  const color = pctClass(quote?.changePercent)
  const foreignNetVolume = foreign.snapshot?.buyVolume !== null && foreign.snapshot?.buyVolume !== undefined && foreign.snapshot?.sellVolume !== null && foreign.snapshot?.sellVolume !== undefined
    ? foreign.snapshot.buyVolume - foreign.snapshot.sellVolume
    : null
  const foreignNetValue = foreign.snapshot?.buyValue !== null && foreign.snapshot?.buyValue !== undefined && foreign.snapshot?.sellValue !== null && foreign.snapshot?.sellValue !== undefined
    ? foreign.snapshot.buyValue - foreign.snapshot.sellValue
    : null

  return <section className="pointer-events-auto absolute flex max-h-[calc(100vh-24px)] w-[min(720px,calc(100vw-16px))] flex-col overflow-hidden rounded-xl border border-border-strong bg-[#171918] shadow-2xl shadow-black/70" style={{ left: pos.x, top: pos.y, zIndex: z }} onPointerDown={onFocus} data-orderbook={stockKey}>
    <header className="flex cursor-grab select-none items-center gap-2 border-b border-border bg-[#1d1f1e] px-3 py-2 active:cursor-grabbing" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
      <GripVertical className="h-4 w-4 text-muted" /><span className="text-[11px] text-muted-2">Sổ lệnh</span><span className="ml-2 text-base font-bold text-foreground">{symbol}</span>
      <span className={`ml-auto font-mono text-base font-bold ${color}`}>{formatPrice(quote?.price)}</span>
      {quote ? <span className={`font-mono text-sm font-semibold ${color}`}>{typeof quote.change === "number" ? `${quote.change > 0 ? "+" : ""}${formatPrice(quote.change, true)} ` : ""}{quote.changePercent > 0 ? "+" : ""}{quote.changePercent.toFixed(2)}%</span> : null}
      <button type="button" aria-label="Kết nối lại sổ lệnh" title="Kết nối lại" onClick={(event) => { event.stopPropagation(); setReconnectKey((key) => key + 1) }} className="rounded p-1.5 text-muted-2 hover:bg-panel-2 hover:text-foreground"><RefreshCw className={`h-4 w-4 ${stream.state === "CONNECTING" ? "animate-spin" : ""}`} /></button>
      <a href={`/research/${symbol.toLowerCase()}`} aria-label={`Mở phân tích ${symbol}`} title="Mở phân tích" onClick={(event) => event.stopPropagation()} className="rounded p-1.5 text-muted-2 hover:bg-panel-2 hover:text-foreground"><ExternalLink className="h-4 w-4" /></a>
      <button type="button" aria-label={minimized ? "Mở rộng sổ lệnh" : "Thu gọn sổ lệnh"} title={minimized ? "Mở rộng" : "Thu gọn"} onClick={(event) => { event.stopPropagation(); setMinimized((value) => !value) }} className="rounded p-1.5 text-muted-2 hover:bg-panel-2 hover:text-foreground"><Minus className="h-4 w-4" /></button>
      <button type="button" aria-label="Đóng sổ lệnh" title="Đóng" onClick={(event) => { event.stopPropagation(); onClose() }} className="rounded p-1.5 text-muted-2 hover:bg-panel-2 hover:text-down"><X className="h-4 w-4" /></button>
    </header>

    {!minimized ? <div className="min-h-0 flex-1 overflow-auto">
      <div className="border-b border-border px-4 py-3">
        <div className="mb-2 flex items-center gap-2 text-[11px] text-muted-2"><span className={`h-2 w-2 rounded-full ${stream.state === "LIVE" ? "bg-up" : stream.state === "CONNECTING" ? "bg-warning" : "bg-down"}`} /><span>DNSE WebSocket · {stream.state === "LIVE" ? "Live · keep-alive" : stream.state === "CONNECTING" ? "Đang kết nối" : "Đang tự khôi phục"}</span>{stream.updatedAt ? <span className="ml-auto">{timeLabel(stream.updatedAt)}</span> : null}</div>
        <div className="grid grid-cols-[1fr_120px_120px_1fr] gap-x-4 text-xs text-muted-2"><span>KL mua</span><span className="text-right">Giá mua</span><span>Giá bán</span><span className="text-right">KL bán</span></div>
        <div className="mt-2 space-y-1.5 font-mono text-sm">{rows.map(({ bid, ask }, rowIndex) => <div key={rowIndex} className="grid grid-cols-[1fr_120px_120px_1fr] gap-x-4"><span className="text-foreground">{formatVolume(bid?.volume)}</span><span className="text-right text-up">{formatPrice(bid?.price)}</span><span className="text-down">{formatPrice(ask?.price)}</span><span className="text-right text-foreground">{formatVolume(ask?.volume)}</span></div>)}</div>
        <div className="mt-4 flex items-center justify-between text-sm font-semibold"><span className="text-up">{depthTotal > 0 ? `${buyPct.toFixed(0)}%` : "—"}</span><span className="text-down">{depthTotal > 0 ? `${sellPct.toFixed(0)}%` : "—"}</span></div>
        <div className="mt-1 flex h-2 overflow-hidden rounded-full bg-panel-2"><div className="bg-up" style={{ width: `${depthTotal > 0 ? buyPct : 0}%` }} /><div className="bg-down" style={{ width: `${depthTotal > 0 ? sellPct : 0}%` }} /></div>
        <div className="mt-1 flex justify-between text-xs text-muted-2"><span>Mua</span><span>Bán</span></div>
        <div className="mt-2 text-[10px] text-muted">Khối lượng DNSE round-lot được quy đổi ×100 sang số cổ phiếu.</div>
      </div>

      <div className="px-4 py-3">
        <div className="mb-3 flex items-center gap-2">
          <button type="button" onClick={() => setActivityTab("trades")} className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${activityTab === "trades" ? "bg-blue-500/15 text-blue-400" : "text-muted-2 hover:bg-panel-2"}`}>Khớp lệnh</button>
          <button type="button" onClick={() => setActivityTab("foreign")} className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${activityTab === "foreign" ? "bg-blue-500/15 text-blue-400" : "text-muted-2 hover:bg-panel-2"}`}>Nước ngoài</button>
          <span className="ml-auto text-[11px] text-muted-2">{activityTab === "trades" ? "tick_extra.G1 · WS" : "DNSE foreign-trading · 2s"}</span>
        </div>

        {activityTab === "trades" ? <>
          {stream.error && stream.state !== "LIVE" ? <div className="mb-3 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">{stream.error}</div> : null}
          {stream.trades.length ? <div><div className="grid grid-cols-[120px_1fr_150px_80px] border-b border-border pb-2 text-xs text-muted-2"><span>Thời gian</span><span className="text-right">Khối lượng</span><span className="text-right">Giá</span><span className="text-right">M/B</span></div><div className="max-h-[300px] overflow-y-auto">{stream.trades.map((trade) => { const meta = sideMeta(trade.side); return <div key={trade.id} className="grid grid-cols-[120px_1fr_150px_80px] border-b border-border/40 py-1.5 font-mono text-sm last:border-0"><span className="text-muted-2">{timeLabel(trade.time)}</span><span className="text-right font-semibold text-foreground">{formatVolume(trade.volume)}</span><span className={`text-right font-semibold ${trade.side === "BUY" ? "text-up" : trade.side === "SELL" ? "text-down" : "text-foreground"}`}>{formatPrice(trade.price)}</span><span className={`text-right font-semibold ${meta.className}`} title="Mua/Bán có dấu * khi suy ra từ vị trí giá so với best bid/ask.">{meta.label}</span></div> })}</div></div> : <div className="rounded-lg border border-border bg-panel-2/40 px-3 py-6 text-center text-xs text-muted-2">{stream.state === "CONNECTING" ? "Đang kết nối luồng khớp lệnh..." : "Chờ giao dịch mới từ DNSE stream."}</div>}
          <p className="mt-3 text-[10px] leading-4 text-muted">* Nếu provider không cung cấp nhãn aggressor dạng chữ, Mua/Bán được suy ra từ giá khớp so với best bid/ask tại thời điểm nhận tick; đây là suy luận microstructure, không phải trường dữ liệu xác nhận.</p>
        </> : <>
          {foreign.error ? <div className="mb-3 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">NĐTNN: {foreign.error}</div> : null}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-lg border border-border bg-panel-2/35 px-3 py-2"><div className="text-[10px] text-muted-2">NN mua</div><div className="mt-1 font-mono text-sm font-bold text-up">{formatVolume(foreign.snapshot?.buyVolume)}</div>{foreign.snapshot?.buyValue !== null && foreign.snapshot?.buyValue !== undefined ? <div className="mt-0.5 text-[10px] text-muted-2">{formatMarketValue(foreign.snapshot.buyValue)}</div> : null}</div>
            <div className="rounded-lg border border-border bg-panel-2/35 px-3 py-2"><div className="text-[10px] text-muted-2">NN bán</div><div className="mt-1 font-mono text-sm font-bold text-down">{formatVolume(foreign.snapshot?.sellVolume)}</div>{foreign.snapshot?.sellValue !== null && foreign.snapshot?.sellValue !== undefined ? <div className="mt-0.5 text-[10px] text-muted-2">{formatMarketValue(foreign.snapshot.sellValue)}</div> : null}</div>
            <div className="rounded-lg border border-border bg-panel-2/35 px-3 py-2"><div className="text-[10px] text-muted-2">Ròng</div><div className={`mt-1 font-mono text-sm font-bold ${foreignNetVolume === null ? "text-muted-2" : foreignNetVolume > 0 ? "text-up" : foreignNetVolume < 0 ? "text-down" : "text-ref"}`}>{foreignNetVolume === null ? "—" : `${foreignNetVolume > 0 ? "+" : ""}${formatVolume(foreignNetVolume)}`}</div>{foreignNetValue !== null ? <div className="mt-0.5 text-[10px] text-muted-2">{foreignNetValue > 0 ? "+" : ""}{formatMarketValue(foreignNetValue)}</div> : null}</div>
            <div className="rounded-lg border border-border bg-panel-2/35 px-3 py-2"><div className="text-[10px] text-muted-2">Room còn lại</div><div className="mt-1 font-mono text-sm font-bold text-foreground">{formatVolume(foreign.snapshot?.currentRoom)}</div>{foreign.snapshot?.totalRoom !== null && foreign.snapshot?.totalRoom !== undefined ? <div className="mt-0.5 text-[10px] text-muted-2">Tổng {formatVolume(foreign.snapshot.totalRoom)}</div> : null}</div>
          </div>

          <div className="mt-3 flex items-center justify-between text-[10px] text-muted-2"><span>Biến động mua/bán mới được suy ra từ delta snapshot DNSE mỗi 2 giây.</span>{foreign.snapshot?.updatedAt ? <span>{timeLabel(foreign.snapshot.updatedAt)}</span> : null}</div>
          {foreign.events.length ? <div className="mt-2"><div className="grid grid-cols-[120px_80px_1fr_130px] border-b border-border pb-2 text-xs text-muted-2"><span>Thời gian</span><span>M/B</span><span className="text-right">Khối lượng mới</span><span className="text-right">Giá trị mới</span></div><div className="max-h-[260px] overflow-y-auto">{foreign.events.map((event) => <div key={event.id} className="grid grid-cols-[120px_80px_1fr_130px] border-b border-border/40 py-1.5 font-mono text-sm last:border-0"><span className="text-muted-2">{timeLabel(event.time)}</span><span className={event.side === "BUY" ? "font-semibold text-up" : "font-semibold text-down"}>{event.side === "BUY" ? "Mua" : "Bán"}</span><span className="text-right font-semibold text-foreground">{formatVolume(event.volume)}</span><span className="text-right text-muted-2">{formatMarketValue(event.value)}</span></div>)}</div></div> : <div className="mt-2 rounded-lg border border-border bg-panel-2/40 px-3 py-5 text-center text-xs text-muted-2">{foreign.loading ? "Đang tải dữ liệu NĐT nước ngoài từ DNSE..." : foreign.snapshot ? "Đã có snapshot. Chờ thay đổi mua/bán mới để tạo tape realtime." : "Chưa có dữ liệu NĐT nước ngoài."}</div>}
          <p className="mt-3 text-[10px] leading-4 text-muted">DNSE OpenAPI hiện cung cấp endpoint foreign-trading dạng snapshot. Tab này refresh 2 giây và hiển thị phần tăng thêm giữa hai snapshot; không gán một giao dịch khớp cụ thể cho NĐTNN khi provider không cung cấp cờ xác nhận ở từng tick.</p>
        </>}
      </div>
    </div> : null}
  </section>
}
