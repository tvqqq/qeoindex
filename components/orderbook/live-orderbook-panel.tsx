"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ExternalLink, GripVertical, Minus, RefreshCw, X } from "lucide-react"

type DepthLevel = { price: number; volume: number }
type TradeSide = "BUY" | "SELL" | "UNKNOWN"
type StreamTrade = { id: string; time: string; price: number; volume: number; side: TradeSide }
type StockQuote = { symbol: string; price: number; reference?: number; change?: number; changePercent: number; updatedAt: string }
type StreamState = "CONNECTING" | "LIVE" | "ERROR" | "CLOSED"

const WIDTH = 720

function number(value: unknown) {
  const result = typeof value === "number" ? value : Number(value)
  return Number.isFinite(result) ? result : 0
}

function formatPrice(value?: number | null, allowNegative = false) {
  if (typeof value !== "number" || !Number.isFinite(value) || (!allowNegative && value <= 0)) return "—"
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 }).format(value)
}

function formatVolume(value?: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return "—"
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
    .map((row: any) => ({ price: number(row?.price), volume: number(row?.qtty ?? row?.quantity ?? row?.volume) }))
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

function nextQuote(symbol: string, data: any, current: StockQuote | null): StockQuote | null {
  const price = number(data?.matchPrice ?? data?.price ?? data?.lastPrice) || current?.price || 0
  const reference = number(data?.referencePrice ?? data?.refPrice ?? data?.basicPrice ?? data?.reference) || current?.reference || 0
  if (price <= 0) return current
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

  useEffect(() => {
    let disposed = false
    let socket: WebSocket | null = null
    let reconnectTimer: number | null = null
    let attempts = 0

    setState("CONNECTING")
    setError("")

    const connect = async () => {
      try {
        const authResponse = await fetch("/api/market/stream-auth", { cache: "no-store", headers: { Accept: "application/json" } })
        const authJson = await authResponse.json()
        if (!authResponse.ok || !authJson.ok) throw new Error(authJson.message ?? `Stream auth ${authResponse.status}`)
        if (disposed) return

        socket = new WebSocket(authJson.url)
        socket.onmessage = (event) => {
          if (disposed || typeof event.data !== "string") return
          let data: any
          try { data = JSON.parse(event.data) } catch { return }

          const action = data?.action ?? data?.a
          if (action === "ping") {
            if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ action: "pong", timestamp: data?.timestamp }))
            return
          }
          if (action === "auth_success") {
            setState("LIVE")
            attempts = 0
            socket?.send(JSON.stringify({
              action: "subscribe",
              channels: [
                { name: "tick.G1.json", symbols: [symbol] },
                { name: "top_price.G1.json", symbols: [symbol] },
                { name: "tick_extra.G1.json", symbols: [symbol] },
              ],
            }))
            return
          }
          if (action === "auth_error" || action === "error") {
            setState("ERROR")
            setError(data?.message ?? data?.msg ?? "DNSE stream authentication failed")
            return
          }
          if (data?.session_id || data?.sid || action === "welcome") {
            socket?.send(JSON.stringify(authJson.auth))
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
            return
          }

          if (data?.T === "t") {
            setQuote((current) => nextQuote(symbol, data, current))
            setUpdatedAt(new Date().toISOString())
            return
          }

          if (data?.T === "te") {
            const price = number(data?.matchPrice)
            const volume = number(data?.matchQtty)
            setQuote((current) => nextQuote(symbol, data, current))
            setUpdatedAt(new Date().toISOString())
            if (price <= 0 || volume <= 0) return
            const time = normalizeTime(data?.time)
            const trade: StreamTrade = {
              id: `${time}-${price}-${volume}-${String(data?.side ?? "")}-${Math.random().toString(36).slice(2, 7)}`,
              time,
              price,
              volume,
              side: inferSide(data?.side, price, depthRef.current.bids, depthRef.current.asks),
            }
            setTrades((current) => [trade, ...current].slice(0, 60))
          }
        }

        socket.onopen = () => setState("CONNECTING")
        socket.onerror = () => {
          if (!disposed) {
            setState("ERROR")
            setError("Không kết nối được DNSE WebSocket từ trình duyệt.")
          }
        }
        socket.onclose = () => {
          if (disposed) return
          setState("CLOSED")
          if (attempts < 4) {
            attempts += 1
            reconnectTimer = window.setTimeout(connect, Math.min(1000 * 2 ** attempts, 8000))
          }
        }
      } catch (nextError) {
        if (disposed) return
        setState("ERROR")
        setError(nextError instanceof Error ? nextError.message : String(nextError))
      }
    }

    connect()
    return () => {
      disposed = true
      if (reconnectTimer) window.clearTimeout(reconnectTimer)
      if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000, "popup closed")
    }
  }, [symbol, reconnectKey])

  return { state, bids, asks, trades, quote, updatedAt, error }
}

export function LiveOrderBookPanel({ stockKey, symbol, index, z, onClose, onFocus }: { stockKey: string; symbol: string; index: number; z: number; onClose: () => void; onFocus: () => void }) {
  const [minimized, setMinimized] = useState(false)
  const [reconnectKey, setReconnectKey] = useState(0)
  const [pos, setPos] = useState(() => ({ x: 28 + (index % 4) * 48, y: 78 + (index % 5) * 38 }))
  const drag = useRef<{ dx: number; dy: number } | null>(null)
  const stream = useDnseOrderBookStream(symbol, reconnectKey)
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
        <div className="mb-2 flex items-center gap-2 text-[11px] text-muted-2"><span className={`h-2 w-2 rounded-full ${stream.state === "LIVE" ? "bg-up" : stream.state === "CONNECTING" ? "bg-warning" : "bg-down"}`} /><span>DNSE WebSocket · {stream.state === "LIVE" ? "Live" : stream.state === "CONNECTING" ? "Đang kết nối" : "Mất kết nối"}</span>{stream.updatedAt ? <span className="ml-auto">{timeLabel(stream.updatedAt)}</span> : null}</div>
        <div className="grid grid-cols-[1fr_120px_120px_1fr] gap-x-4 text-xs text-muted-2"><span>KL mua</span><span className="text-right">Giá mua</span><span>Giá bán</span><span className="text-right">KL bán</span></div>
        <div className="mt-2 space-y-1.5 font-mono text-sm">{rows.map(({ bid, ask }, rowIndex) => <div key={rowIndex} className="grid grid-cols-[1fr_120px_120px_1fr] gap-x-4"><span className="text-foreground">{formatVolume(bid?.volume)}</span><span className="text-right text-up">{formatPrice(bid?.price)}</span><span className="text-down">{formatPrice(ask?.price)}</span><span className="text-right text-foreground">{formatVolume(ask?.volume)}</span></div>)}</div>
        <div className="mt-4 flex items-center justify-between text-sm font-semibold"><span className="text-up">{depthTotal > 0 ? `${buyPct.toFixed(0)}%` : "—"}</span><span className="text-down">{depthTotal > 0 ? `${sellPct.toFixed(0)}%` : "—"}</span></div>
        <div className="mt-1 flex h-2 overflow-hidden rounded-full bg-panel-2"><div className="bg-up" style={{ width: `${depthTotal > 0 ? buyPct : 0}%` }} /><div className="bg-down" style={{ width: `${depthTotal > 0 ? sellPct : 0}%` }} /></div>
        <div className="mt-1 flex justify-between text-xs text-muted-2"><span>Mua</span><span>Bán</span></div>
      </div>

      <div className="px-4 py-3">
        <div className="mb-2 flex items-center gap-3"><span className="rounded-full bg-blue-500/15 px-3 py-1 text-xs font-semibold text-blue-400">Khớp lệnh</span><span className="text-[11px] text-muted-2">tick_extra.G1</span></div>
        {stream.error ? <div className="mb-3 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">{stream.error}</div> : null}
        {stream.trades.length ? <div><div className="grid grid-cols-[120px_1fr_150px_80px] border-b border-border pb-2 text-xs text-muted-2"><span>Thời gian</span><span className="text-right">Khối lượng</span><span className="text-right">Giá</span><span className="text-right">M/B</span></div><div className="max-h-[300px] overflow-y-auto">{stream.trades.map((trade) => { const meta = sideMeta(trade.side); return <div key={trade.id} className="grid grid-cols-[120px_1fr_150px_80px] border-b border-border/40 py-1.5 font-mono text-sm last:border-0"><span className="text-muted-2">{timeLabel(trade.time)}</span><span className="text-right font-semibold text-foreground">{formatVolume(trade.volume)}</span><span className={`text-right font-semibold ${trade.side === "BUY" ? "text-up" : trade.side === "SELL" ? "text-down" : "text-foreground"}`}>{formatPrice(trade.price)}</span><span className={`text-right font-semibold ${meta.className}`} title="Mua/Bán có dấu * khi suy ra từ vị trí giá so với best bid/ask.">{meta.label}</span></div> })}</div></div> : <div className="rounded-lg border border-border bg-panel-2/40 px-3 py-6 text-center text-xs text-muted-2">{stream.state === "CONNECTING" ? "Đang kết nối luồng khớp lệnh..." : "Chờ giao dịch mới từ DNSE stream."}</div>}
        <p className="mt-3 text-[10px] leading-4 text-muted">* Nếu provider không cung cấp nhãn aggressor dạng chữ, Mua/Bán được suy ra từ giá khớp so với best bid/ask tại thời điểm nhận tick; đây là suy luận microstructure, không phải trường dữ liệu xác nhận.</p>
      </div>
    </div> : null}
  </section>
}
