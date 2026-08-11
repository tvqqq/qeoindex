"use client"

import { useEffect, useRef, useState } from "react"
import { formatPct, formatPrice, formatVolume, type Trend } from "@/lib/market-data"
import { useStock } from "@/lib/use-market"
import { useOrderBooks } from "@/components/orderbook/orderbook-context"
import { Sparkline } from "@/components/sparkline"

const HEX: Record<Trend, string> = {
  up: "#22c98a",
  down: "#f2495c",
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

export function StockCell({ stockKey }: { stockKey: string }) {
  const s = useStock(stockKey)
  const { open, isOpen } = useOrderBooks()
  const selected = isOpen(stockKey)

  const [flash, setFlash] = useState<"" | "flash-up" | "flash-down">("")
  const prevPrice = useRef(s.price)

  useEffect(() => {
    if (s.price !== prevPrice.current) {
      setFlash(s.price > prevPrice.current ? "flash-up" : "flash-down")
      prevPrice.current = s.price
      const id = setTimeout(() => setFlash(""), 620)
      return () => clearTimeout(id)
    }
  }, [s.price, s.updatedAt])

  const color = HEX[s.trend]
  const text = TEXT[s.trend]

  return (
    <button
      type="button"
      onClick={() => open(stockKey, s.symbol)}
      aria-pressed={selected}
      className={[
        "group relative flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
        selected
          ? "bg-panel-2 ring-1 ring-inset"
          : "hover:bg-panel-2/70 ring-1 ring-inset ring-transparent",
        flash,
      ].join(" ")}
      style={selected ? { boxShadow: `inset 0 0 0 1px ${color}`, ["--tw-ring-color" as string]: color } : undefined}
    >
      {/* left: symbol + volume */}
      <div className="flex w-[52px] shrink-0 flex-col">
        <span className="text-[13px] font-semibold leading-tight text-foreground">{s.symbol}</span>
        <span className="font-mono text-[10px] leading-tight text-muted">{formatVolume(s.volume)}</span>
      </div>

      {/* middle: sparkline */}
      <div className="flex flex-1 items-center justify-center">
        <Sparkline data={s.history} refValue={s.refPrice} color={color} width={72} height={30} />
      </div>

      {/* right: pct + price */}
      <div className="flex w-[54px] shrink-0 flex-col items-end">
        <span className={`text-[13px] font-semibold leading-tight ${text}`}>{formatPct(s.changePct)}</span>
        <span className={`font-mono text-[10px] leading-tight ${text}`}>{formatPrice(s.price)}</span>
      </div>
    </button>
  )
}
