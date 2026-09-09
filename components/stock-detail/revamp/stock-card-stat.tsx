import type { ReactNode } from "react"

import { cn } from "@/modules/shared/ui/cn"

interface StockCardStatProps {
  label: string
  value: ReactNode
  className?: string
}

export function StockCardStat({ label, value, className }: StockCardStatProps) {
  return (
    <div className={cn("min-w-0 border-l border-white/[0.08] px-3 py-1.5", className)}>
      <div className="truncate text-[8px] font-black uppercase tracking-[0.16em] text-slate-500">{label}</div>
      <div className="mt-0.5 truncate font-mono text-[13px] font-black leading-tight text-slate-100 sm:text-sm">{value}</div>
    </div>
  )
}
