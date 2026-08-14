"use client"

import { LayoutGrid, TrendingDown, TrendingUp } from "lucide-react"
import { MarketChangePill } from "@/components/market-change-pill"
import { useIndices } from "@/lib/use-market"
import { formatSigned } from "@/lib/market-data"
import { marketToneFromChange, marketToneText } from "@/lib/market-tone"

export function IndexBar() {
  const indices = useIndices()

  return (
    <div className="flex items-center justify-between border-b border-border bg-panel px-4 py-2.5">
      <div className="flex items-center gap-8">
        {indices.map((idx) => {
          const tone = marketToneFromChange(idx.changePct)
          const color = marketToneText(tone)
          const up = idx.change >= 0
          const Icon = up ? TrendingUp : TrendingDown
          return (
            <div key={idx.name} className="flex flex-col">
              <span className="text-[10px] font-medium uppercase tracking-wide text-muted">{idx.name}</span>
              <div className="mt-1 flex items-center gap-1.5">
                <span className={`font-mono text-sm font-semibold ${color}`}>{idx.value.toFixed(2)}</span>
                <Icon className={`h-3 w-3 ${color}`} aria-hidden="true" />
                <span className={`font-mono text-xs ${color}`}>{formatSigned(idx.change)}</span>
                <MarketChangePill value={idx.changePct} tone={tone} compact />
              </div>
            </div>
          )
        })}
      </div>
      <button
        type="button"
        aria-label="Tùy chọn hiển thị"
        className="rounded-md p-1.5 text-muted-2 transition-colors hover:bg-panel-2 hover:text-foreground"
      >
        <LayoutGrid className="h-4 w-4" />
      </button>
    </div>
  )
}
