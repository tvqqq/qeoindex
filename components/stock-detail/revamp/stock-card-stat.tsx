import type { ReactNode } from "react"

import { cn } from "@/modules/shared/ui/cn"

interface StockCardStatProps {
  label: string
  value: ReactNode
  detail?: string
  className?: string
}

export function StockCardStat({ label, value, detail, className }: StockCardStatProps) {
  return (
    <div
      className={cn(
        "group/stat relative overflow-hidden rounded-2xl border border-white/[0.07] bg-black/20 px-3 py-2.5",
        "transition-colors hover:border-white/[0.13] hover:bg-white/[0.035]",
        className,
      )}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-3 top-0 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent opacity-0 transition-opacity group-hover/stat:opacity-100"
      />
      <div className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-500">{label}</div>
      <div className="mt-1 truncate font-mono text-sm font-black text-slate-100 sm:text-[15px]">{value}</div>
      {detail ? <div className="mt-0.5 truncate text-[9px] text-slate-600">{detail}</div> : null}
    </div>
  )
}
