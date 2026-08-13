"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ExternalLink, GripVertical, Minus, RefreshCw, X } from "lucide-react"

interface StockQuote {
  symbol: string
  price: number
  reference?: number
  ceiling?: number
  floor?: number
  change?: number
  changePercent: number
  volume?: number
  updatedAt: string
}

interface DepthLevel {
  price: number
  volume: number
}

interface MarketTrade {
  id: string
  time: string
  price: number
  volume: number
  side: "BUY" | "SELL" | "UNKNOWN"
}

interface MarketSnapshot {
  symbol: string
  bids: DepthLevel[]
  asks: DepthLevel[]
  trades: MarketTrade[]
  provider: string
  updatedAt: string
  partial: boolean
  warnings: string[]
}

const WIDTH = 720

function formatPrice(value?: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return "—"
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

function tradeSideLabel(side: MarketTrade["side"]) {
  if (side === "BUY") return { label: "Mua", className: "text-up" }
  if (side === "SELL") return { label: "Bán", className: "text-down" }
  return { label: "—", className: "text-muted-2" }
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

export function OrderBookPanel({
  stockKey,
  symbol,
  index,
  z,
  onClose,
  onFocus,
}: {
  stockKey: string
  symbol: string
  index: number
  z: number
  onClose: () => void
  onFocus: () => void
}) {
  const [quote, setQuote] = useState<StockQuote | null>(null)
  const [snapshot, setSnapshot] = useState<MarketSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [minimized, setMinimized] = useState(false)
  const [error, setError] = useState("")
  const [pos, setPos] = useState(() => ({
    x: 36 + (index % 4) * 42,
    y: 84 + (index % 5) * 34,
  }))
  const drag = useRef<{ dx: number; dy: number } | null>(null)

  const refresh = useCallback(async () => {
    const [quoteResult, bookResult] = await Promise.allSettled([
      fetch(`/api/finhay/quote?symbols=${encodeURIComponent(symbol)}`, { cache: "no-store" }).then(async (res) => {
        if (!res.ok) throw new Error(`Finhay quote ${res.status}`)
        return res.json()
      }),
      fetch(`/api/market/orderbook?symbol=${encodeURIComponent(symbol)}`, { cache: "no-store" }).then(async (res) => {
        const json = await res.json()
        if (!res.ok || !json.ok) throw new Error(json.message ?? `Orderbook ${res.status}`)
        return json
      }),
    ])

    if (quoteResult.status === "fulfilled") {
      const next = quoteResult.value?.quotes?.[symbol] as StockQuote | undefined
      if (next) setQuote(next)
    }

    if (bookResult.status === "fulfilled") {
      setSnapshot(bookResult.value.snapshot)
      setError("")
    } else {
      setError(bookResult.reason instanceof Error ? bookResult.reason.message : String(bookResult.reason))
    }
    setLoading(false)
  }, [symbol])

  useEffect(() => {
    refresh()
    const timer = window.setInterval(refresh, 3_000)
    return () => window.clearInterval(timer)
  }, [refresh])

  const onPointerDown = useCallback((event: React.PointerEvent) => {
    onFocus()
    drag.current = { dx: event.clientX - pos.x, dy: event.clientY - pos.y }
    ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  }, [onFocus, pos.x, pos.y])

  const onPointerMove = useCallback((event: React.PointerEvent) => {
    if (!drag.current) return
    const maxX = Math.max(0, window.innerWidth - Math.min(WIDTH, window.innerWidth))
    const maxY = Math.max(0, window.innerHeight - 60)
    setPos({
      x: Math.max(0, Math.min(maxX, event.clientX - drag.current.dx)),
      y: Math.max(0, Math.min(maxY, event.clientY - drag.current.dy)),
    })
  }, [])

  const onPointerUp = useCallback(() => {
    drag.current = null
  }, [])

  const topBids = snapshot?.bids.slice(0, 3) ?? []
  const topAsks = snapshot?.asks.slice(0, 3) ?? []
  const bidTotal = topBids.reduce((sum, row) => sum + row.volume, 0)
  const askTotal = topAsks.reduce((sum, row) => sum + row.volume, 0)
  const depthTotal = bidTotal + askTotal
  const buyPct = depthTotal > 0 ? (bidTotal / depthTotal) * 100 : 50
  const sellPct = 100 - buyPct
  const color = pctClass(quote?.changePercent)
  const lastUpdated = snapshot?.updatedAt || quote?.updatedAt

  const rows = useMemo(() => Array.from({ length: 3 }, (_, i) => ({
    bid: topBids[i],
    ask: topAsks[i],
  })), [topBids, topAsks])

  return (
    <section
      className="pointer-events-auto absolute flex max-h-[calc(100vh-24px)] w-[min(720px,calc(100vw-16px))] flex-col overflow-hidden rounded-xl border border-border-strong bg-[#171918] shadow-2xl shadow-black/70"
      style={{ left: pos.x, top: pos.y, zIndex: z, minHeight: minimized ? undefined : 340 }}
      onPointerDown={onFocus}
      data-orderbook={stockKey}
    >
      <header
        className="flex cursor-grab select-none items-center gap-2 border-b border-border bg-[#1d1f1e] px-3 py-2 active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <GripVertical className="h-4 w-4 text-muted" />
        <span className="text-[11px] text-muted-2">Sổ lệnh</span>
        <span className="ml-2 text-base font-bold text-foreground">{symbol}</span>
        <span className={`ml-auto font-mono text-base font-bold ${color}`}>{formatPrice(quote?.price)}</span>
        {quote ? (
          <span className={`font-mono text-sm font-semibold ${color}`}>
            {quote.change && quote.change > 0 ? "+" : ""}{formatPrice(quote.change)} · {quote.changePercent > 0 ? "+" : ""}{quote.changePercent.toFixed(2)}%
          </span>
        ) : null}
        <button type="button" onClick={(event) => { event.stopPropagation(); refresh() }} className="rounded p-1.5 text-muted-2 hover:bg-panel-2 hover:text-foreground" aria-label={`Làm mới ${symbol}`}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </button>
        <a href={`/research/${symbol.toLowerCase()}`} onClick={(event) => event.stopPropagation()} className="rounded p-1.5 text-muted-2 hover:bg-panel-2 hover:text-foreground" aria-label={`Mở phân tích ${symbol}`}>
          <ExternalLink className="h-4 w-4" />
        </a>
        <button type="button" onClick={(event) => { event.stopPropagation(); setMinimized((value) => !value) }} className="rounded p-1.5 text-muted-2 hover:bg-panel-2 hover:text-foreground" aria-label={minimized ? "Mở rộng" : "Thu nhỏ"}>
          <Minus className="h-4 w-4" />
        </button>
        <button type="button" onClick={(event) => { event.stopPropagation(); onClose() }} className="rounded p-1.5 text-muted-2 hover:bg-panel-2 hover:text-down" aria-label={`Đóng sổ lệnh ${symbol}`}>
          <X className="h-4 w-4" />
        </button>
      </header>

      {!minimized ? (
        <div className="min-h-0 flex-1 overflow-auto">
          <div className="border-b border-border px-4 py-3">
            <div className="grid grid-cols-[1fr_120px_120px_1fr] gap-x-4 text-xs text-muted-2">
              <span>KL mua</span>
              <span className="text-right">Giá mua</span>
              <span>Giá bán</span>
              <span className="text-right">KL bán</span>
            </div>
            <div className="mt-2 space-y-1.5 font-mono text-sm">
              {rows.map(({ bid, ask }, index) => (
                <div key={index} className="grid grid-cols-[1fr_120px_120px_1fr] gap-x-4">
                  <span className="text-foreground">{formatVolume(bid?.volume)}</span>
                  <span className="text-right text-up">{formatPrice(bid?.price)}</span>
                  <span className="text-down">{formatPrice(ask?.price)}</span>
                  <span className="text-right text-foreground">{formatVolume(ask?.volume)}</span>
                </div>
              ))}
            </div>

            <div className="mt-4 flex items-center justify-between text-sm font-semibold">
              <span className="text-up">{depthTotal > 0 ? `${buyPct.toFixed(0)}%` : "—"}</span>
              <span className="text-down">{depthTotal > 0 ? `${sellPct.toFixed(0)}%` : "—"}</span>
            </div>
            <div className="mt-1 flex h-2 overflow-hidden rounded-full bg-panel-2">
              <div className="bg-up" style={{ width: `${depthTotal > 0 ? buyPct : 0}%` }} />
              <div className="bg-down" style={{ width: `${depthTotal > 0 ? sellPct : 0}%` }} />
            </div>
            <div className="mt-1 flex justify-between text-xs text-muted-2"><span>Mua</span><span>Bán</span></div>
          </div>

          <div className="px-4 py-3">
            <div className="mb-2 flex items-center gap-3">
              <span className="rounded-full bg-blue-500/15 px-3 py-1 text-xs font-semibold text-blue-400">Khớp lệnh</span>
              <span className="text-[11px] text-muted-2">Nguồn: {snapshot?.provider ?? "DNSE OpenAPI"}</span>
              {lastUpdated ? <span className="ml-auto text-[11px] text-muted-2">Cập nhật {timeLabel(lastUpdated)}</span> : null}
            </div>

            {error ? (
              <div className="rounded-lg border border-warning/30 bg-warning/5 px-3 py-3 text-xs text-warning">
                Không lấy được dữ liệu sổ lệnh thực tế: {error}
              </div>
            ) : snapshot?.trades.length ? (
              <div>
                <div className="grid grid-cols-[120px_1fr_150px_80px] border-b border-border pb-2 text-xs text-muted-2">
                  <span>Thời gian</span><span className="text-right">Khối lượng</span><span className="text-right">Giá</span><span className="text-right">M/B</span>
                </div>
                <div className="max-h-[300px] overflow-y-auto">
                  {snapshot.trades.map((trade) => {
                    const side = tradeSideLabel(trade.side)
                    return (
                      <div key={trade.id} className="grid grid-cols-[120px_1fr_150px_80px] border-b border-border/40 py-1.5 font-mono text-sm last:border-0">
                        <span className="text-muted-2">{timeLabel(trade.time)}</span>
                        <span className="text-right font-semibold text-foreground">{formatVolume(trade.volume)}</span>
                        <span className={`text-right font-semibold ${trade.side === "SELL" ? "text-down" : trade.side === "BUY" ? "text-up" : "text-foreground"}`}>{formatPrice(trade.price)}</span>
                        <span className={`text-right font-semibold ${side.className}`}>{side.label}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-border bg-panel-2/40 px-3 py-6 text-center text-xs text-muted-2">
                {loading ? "Đang tải dữ liệu sổ lệnh..." : "Chưa có dữ liệu khớp lệnh từ provider."}
              </div>
            )}

            {snapshot?.partial && snapshot.warnings.length ? (
              <details className="mt-3 text-[10px] text-muted-2">
                <summary className="cursor-pointer">Chi tiết giới hạn dữ liệu</summary>
                <ul className="mt-1 list-disc space-y-1 pl-4">
                  {snapshot.warnings.slice(0, 3).map((warning, index) => <li key={index}>{warning}</li>)}
                </ul>
              </details>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  )
}
