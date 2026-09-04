"use client"

import { GROUPS, marketStore } from "@/modules/market/data"
import { StockCell } from "@/components/stock-cell"

const HEADER_PCT: Record<string, number> = {
  vn30: 0.2,
  bds: 0.2,
  chung: 2.2,
  bank: 0.2,
  thep: 1.1,
  daukhi: 0.5,
  banle: 2.6,
  baohiem: -1.5,
  bdskcn: 0.1,
  congnghe: 0.4,
}

function GroupColumn({ name, label }: { name: string; label: string }) {
  const keys = marketStore.getGroupKeys(name)
  const pct = HEADER_PCT[name] ?? 0
  const pctClass = pct > 0 ? "text-up" : pct < 0 ? "text-down" : "text-ref"

  return (
    <section className="flex h-full w-[236px] shrink-0 flex-col rounded-lg border border-border bg-panel">
      <header className="flex items-center justify-between border-b border-border px-3 py-2.5">
        <h2 className="text-sm font-semibold text-foreground">{label}</h2>
        <span className={`font-mono text-xs font-medium ${pctClass}`}>
          {(pct > 0 ? "+" : "") + pct.toFixed(1) + "%"}
        </span>
      </header>
      <div className="flex-1 overflow-y-auto px-1.5 py-1.5">
        <div className="flex flex-col gap-0.5">
          {keys.map((k) => (
            <StockCell key={k} stockKey={k} />
          ))}
        </div>
      </div>
    </section>
  )
}

export function Board() {
  return (
    <div className="flex h-full gap-2.5 overflow-x-auto px-2.5 pb-2.5">
      {GROUPS.map((g) => (
        <GroupColumn key={g.name} name={g.name} label={g.label} />
      ))}
    </div>
  )
}
