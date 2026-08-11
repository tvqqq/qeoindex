"use client"

import { LayoutGrid, TrendingDown, TrendingUp } from "lucide-react"
import { useIndices } from "@/lib/use-market"
import { formatSigned } from "@/lib/market-data"

export function IndexBar() {
  const indices = useIndices()

  return (
    <div className="flex items-center justify-between border-b border-border bg-panel px-4 py-2.5">
      <div className="flex items-center gap-8">
        {indices.map((idx) => {
          const up = idx.change >= 0
          const color = up ? "text-up" : "text-down"
          const Icon = up ? TrendingUp : TrendingDown
          return (
            <div key={idx.name} className="flex flex-col">
              <span className="text-[10px] font-medium uppercase tracking-wide text-muted">{idx.name}</span>
              <div className="flex items-baseline gap-1.5">
                <span className={`font-mono text-sm font-semibold ${color}`}>{idx.value.toFixed(2)}</span>
                <Icon className={`h-3 w-3 ${color}`} aria-hidden="true" />
                <span className={`font-mono text-xs ${color}`}>{formatSigned(idx.change)}</span>
                <span className={`font-mono text-xs ${color}`}>
                  {(idx.changePct >= 0 ? "+" : "") + idx.changePct.toFixed(1)}%
                </span>
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
