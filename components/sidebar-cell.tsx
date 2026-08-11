"use client"

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

export function SidebarCell({ stockKey }: { stockKey: string }) {
  const s = useStock(stockKey)
  const { open } = useOrderBooks()
  const color = HEX[s.trend]
  const text = TEXT[s.trend]

  return (
    <button
      type="button"
      onClick={() => open(stockKey, s.symbol)}
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-transform hover:translate-x-0.5"
      style={{ boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${color} 55%, transparent)` }}
    >
      <div className="flex w-[42px] shrink-0 flex-col">
        <span className="text-xs font-semibold leading-tight text-foreground">{s.symbol}</span>
        <span className="font-mono text-[9px] leading-tight text-muted">{formatVolume(s.volume)}</span>
      </div>
      <div className="flex flex-1 justify-center">
        <Sparkline data={s.history} refValue={s.refPrice} color={color} width={58} height={24} showDot />
      </div>
      <div className="flex w-[46px] shrink-0 flex-col items-end">
        <span className={`text-xs font-semibold leading-tight ${text}`}>{formatPct(s.changePct)}</span>
        <span className={`font-mono text-[9px] leading-tight ${text}`}>{formatPrice(s.price)}</span>
      </div>
    </button>
  )
}
