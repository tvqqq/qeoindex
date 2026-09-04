"use client"

import { useEffect, useRef, useState } from "react"
import { MarketChangePill } from "@/components/market-change-pill"
import { formatPrice, formatVolume } from "@/modules/market/data"
import { marketToneHex, marketToneText, type MarketTone } from "@/modules/market/tone"
import { useStock } from "@/modules/market/realtime/use-market"
import { useOrderBooks } from "@/components/orderbook/orderbook-context"
import { Sparkline } from "@/components/sparkline"

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

  const tone = s.trend as MarketTone
  const color = marketToneHex(tone)
  const text = marketToneText(tone)

  return (
    <button
      type="button"
      onClick={() => open(stockKey, s.symbol)}
      aria-pressed={selected}
      className={[
        "group relative flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors",
        selected
          ? "bg-panel-2 ring-1 ring-inset"
          : "hover:bg-panel-2/70 ring-1 ring-inset ring-transparent",
        flash,
      ].join(" ")}
      style={selected ? { boxShadow: `inset 0 0 0 1px ${color}`, ["--tw-ring-color" as string]: color } : undefined}
    >
      <div className="flex w-[54px] shrink-0 flex-col">
        <span className="text-[14px] font-bold leading-tight text-foreground">{s.symbol}</span>
        <span className="mt-1 font-mono text-[10px] leading-tight text-muted-2">{formatVolume(s.volume)}</span>
      </div>

      <div className="flex flex-1 items-center justify-center">
        <Sparkline data={s.history} refValue={s.refPrice} color={color} width={76} height={32} strokeWidth={1.8} showDot />
      </div>

      <div className="flex w-[68px] shrink-0 flex-col items-end gap-1.5">
        <span className={`font-mono text-[11px] font-bold leading-tight ${s.price ? "text-white" : "text-muted-2"}`}>{formatPrice(s.price)}</span>
        <MarketChangePill value={s.changePct} tone={tone} compact />
      </div>
    </button>
  )
}
