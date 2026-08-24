import type { ReactNode } from "react"

export interface AdminStatCardProps {
  label: string
  value: string | number
  subValue?: string
  icon: ReactNode
  tone?: "emerald" | "amber" | "rose" | "purple" | "cyan" | "default"
}

const TONE_STYLES = {
  emerald: "border-emerald-500/25 bg-emerald-500/10 text-emerald-400",
  amber: "border-amber-500/25 bg-amber-500/10 text-amber-400",
  rose: "border-rose-500/25 bg-rose-500/10 text-rose-400",
  purple: "border-purple-500/25 bg-purple-500/10 text-purple-400",
  cyan: "border-cyan-500/25 bg-cyan-500/10 text-cyan-400",
  default: "border-white/[0.08] bg-white/[0.03] text-slate-400",
}

export function AdminStatCard({ label, value, subValue, icon, tone = "default" }: AdminStatCardProps) {
  const iconStyle = TONE_STYLES[tone]

  return (
    <div className="flex flex-col justify-between rounded-xl border border-white/[0.08] bg-[#0c1016] p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-slate-400">{label}</span>
        <div className={`flex h-8 w-8 items-center justify-center rounded-lg border ${iconStyle}`}>
          {icon}
        </div>
      </div>
      <div className="mt-3">
        <div className="font-mono text-2xl font-bold tracking-tight text-white">{value}</div>
        {subValue ? <p className="mt-1 text-[11px] text-slate-400">{subValue}</p> : null}
      </div>
    </div>
  )
}
