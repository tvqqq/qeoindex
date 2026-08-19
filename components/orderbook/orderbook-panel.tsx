"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { GripVertical, X } from "lucide-react"
import {
  formatPct,
  formatPrice,
  formatVolume,
  generateOrderBook,
  type OrderBook,
  type Trend,
} from "@/lib/market-data"
import { useStock } from "@/lib/use-market"
import { Sparkline } from "@/components/sparkline"
import { StockLogo } from "@/components/stock-logo"

const HEX: Record<Trend, string> = {
  up: "#22c98a",
  down: "#ff4757",
  ceiling: "#b07cff",
  floor: "#22b8cf",
  ref: "#e2b93b",
}
const TEXT: Record<Trend, string> = {
  up: "text-up",
  down: "text-down",
  ceiling: "text-ceiling",
  floor: "text-[#22b8cf]",
  ref: "text-ref",
}

const WIDTH = 300

export function OrderBookPanel({
  stockKey,
  index,
  z,
  onClose,
  onFocus,
}: {
  stockKey: string
  index: number
  z: number
  onClose: () => void
  onFocus: () => void
}) {
  const s = useStock(stockKey)
  const color = HEX[s.trend]
  const text = TEXT[s.trend]

  const [pos, setPos] = useState(() => ({
    x: 120 + index * 34,
    y: 96 + index * 34,
  }))
  const drag = useRef<{ dx: number; dy: number } | null>(null)

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      onFocus()
      drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y }
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    },
    [pos.x, pos.y, onFocus],
  )
  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!drag.current) return
    const x = Math.max(0, Math.min(window.innerWidth - WIDTH, e.clientX - drag.current.dx))
    const y = Math.max(0, Math.min(window.innerHeight - 120, e.clientY - drag.current.dy))
    setPos({ x, y })
  }, [])
  const onPointerUp = useCallback(() => {
    drag.current = null
  }, [])

  // orderbook regenerates on price change and on its own jitter timer
  const [book, setBook] = useState<OrderBook>(() => generateOrderBook(s, 1))
  useEffect(() => {
    setBook(generateOrderBook(s))
  }, [s.price])
  useEffect(() => {
    const id = setInterval(() => setBook(generateOrderBook(s)), 900)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.symbol, s.price])

  const maxVol = Math.max(1, ...book.asks.map((r) => r.volume), ...book.bids.map((r) => r.volume))

  return (
    <div
      className="absolute flex w-[300px] flex-col overflow-hidden rounded-lg border border-border-strong bg-panel shadow-2xl shadow-black/60"
      style={{ left: pos.x, top: pos.y, zIndex: z }}
      onPointerDown={onFocus}
    >
      {/* header (drag handle) */}
      <div
        className="flex cursor-grab items-center gap-2 border-b border-border bg-panel-2 px-3 py-2 active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <GripVertical className="h-3.5 w-3.5 text-muted" />
        <StockLogo symbol={s.symbol} size={22} className="shrink-0" />
        <span className="text-sm font-bold text-foreground">{s.symbol}</span>
        <span className={`font-mono text-sm font-semibold ${text}`}>{formatPrice(s.price)}</span>
        <span className={`font-mono text-xs ${text}`}>{formatPct(s.changePct)}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label={`Đóng sổ lệnh ${s.symbol}`}
          className="ml-auto rounded p-1 text-muted-2 transition-colors hover:bg-panel hover:text-down"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* live price chart */}
      <div className="border-b border-border px-2 pt-2">
        <Sparkline data={s.history} refValue={s.refPrice} color={color} width={276} height={56} fill strokeWidth={1.6} />
        <div className="flex justify-between pb-1.5 pt-1 font-mono text-[10px] text-muted">
          <span>
            Sàn <span className="text-[#22b8cf]">{formatPrice(s.floor)}</span>
          </span>
          <span>
            TC <span className="text-ref">{formatPrice(s.refPrice)}</span>
          </span>
          <span>
            Trần <span className="text-ceiling">{formatPrice(s.ceiling)}</span>
          </span>
        </div>
      </div>

      {/* orderbook ladder */}
      <div className="px-2 py-2">
        <div className="mb-1 grid grid-cols-3 px-1 text-[10px] font-medium uppercase tracking-wide text-muted">
          <span>Giá mua</span>
          <span className="text-center">KL</span>
          <span className="text-right">Giá bán</span>
        </div>

        {/* asks */}
        <div className="flex flex-col gap-px">
          {book.asks.map((row) => (
            <LadderRow key={"a" + row.price} price={row.price} volume={row.volume} max={maxVol} side="ask" />
          ))}
        </div>

        <div className="my-1 flex items-center justify-center gap-2 rounded bg-panel-2 py-1">
          <span className={`font-mono text-xs font-semibold ${text}`}>{formatPrice(s.price)}</span>
          <span className="font-mono text-[10px] text-muted">KL {formatVolume(s.volume)}</span>
        </div>

        {/* bids */}
        <div className="flex flex-col gap-px">
          {book.bids.map((row) => (
            <LadderRow key={"b" + row.price} price={row.price} volume={row.volume} max={maxVol} side="bid" />
          ))}
        </div>
      </div>
    </div>
  )
}

function LadderRow({
  price,
  volume,
  max,
  side,
}: {
  price: number
  volume: number
  max: number
  side: "bid" | "ask"
}) {
  const pctW = (volume / max) * 100
  const isBid = side === "bid"
  const color = isBid ? "var(--color-up)" : "var(--color-down)"
  const text = isBid ? "text-up" : "text-down"

  return (
    <div className="relative grid grid-cols-3 items-center overflow-hidden rounded-sm px-1 py-[3px] font-mono text-[11px]">
      <span
        className="absolute inset-y-0 right-0"
        style={{ width: `${pctW}%`, background: `color-mix(in srgb, ${color} 16%, transparent)` }}
        aria-hidden="true"
      />
      <span className={`relative ${isBid ? text : "text-muted-2"}`}>{isBid ? formatPrice(price) : ""}</span>
      <span className="relative text-center text-foreground">{formatVolume(volume)}</span>
      <span className={`relative text-right ${!isBid ? text : "text-muted-2"}`}>
        {!isBid ? formatPrice(price) : ""}
      </span>
    </div>
  )
}
