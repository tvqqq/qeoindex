"use client"

import { MarketChangePill } from "@/components/market-change-pill"
import { formatPrice, formatVolume } from "@/lib/market-data"
import { marketToneHex, marketToneText, type MarketTone } from "@/lib/market-tone"
import { useStock } from "@/lib/use-market"
import { useOrderBooks } from "@/components/orderbook/orderbook-context"
import { Sparkline } from "@/components/sparkline"

export function SidebarCell({ stockKey }: { stockKey: string }) {
  const s = useStock(stockKey)
  const { open } = useOrderBooks()
  const tone = s.trend as MarketTone
  const color = marketToneHex(tone)
  const text = marketToneText(tone)

  return (
    <button
      type="button"
      onClick={() => open(stockKey, s.symbol)}
      className="flex w-full items-center gap-2 rounded-lg border border-border/60 bg-cell/60 px-2 py-2 text-left transition-all hover:border-border-strong hover:bg-panel-2/75"
      style={{ boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${color} 28%, transparent)` }}
    >
      <div className="flex w-[44px] shrink-0 flex-col">
        <span className="text-[13px] font-bold leading-tight text-foreground">{s.symbol}</span>
        <span className="mt-1 font-mono text-[9px] leading-tight text-muted-2">{formatVolume(s.volume)}</span>
      </div>
      <div className="flex flex-1 justify-center overflow-hidden">
        <Sparkline data={s.history} refValue={s.refPrice} color={color} width={62} height={26} strokeWidth={1.7} showDot />
      </div>
      <div className="flex w-[62px] shrink-0 flex-col items-end gap-1">
        <span className={`font-mono text-[10px] font-bold leading-tight ${text}`}>{formatPrice(s.price)}</span>
        <MarketChangePill value={s.changePct} tone={tone} compact />
      </div>
    </button>
  )
}
