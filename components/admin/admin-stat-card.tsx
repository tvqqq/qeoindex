import type { ReactNode } from "react"

export interface AdminStatCardProps {
  label: string
  value: string | number
  subValue?: string
  icon: ReactNode
  tone?: "emerald" | "amber" | "rose" | "purple" | "cyan" | "default"
}

const TONE_STYLES = {
  emerald: {
    icon: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
    glow: "from-emerald-500/20 via-transparent to-transparent",
    accent: "text-emerald-400",
  },
  amber: {
    icon: "border-amber-500/30 bg-amber-500/10 text-amber-400",
    glow: "from-amber-500/20 via-transparent to-transparent",
    accent: "text-amber-400",
  },
  rose: {
    icon: "border-rose-500/30 bg-rose-500/10 text-rose-400",
    glow: "from-rose-500/20 via-transparent to-transparent",
    accent: "text-rose-400",
  },
  purple: {
    icon: "border-purple-500/30 bg-purple-500/10 text-purple-400",
    glow: "from-purple-500/20 via-transparent to-transparent",
    accent: "text-purple-400",
  },
  cyan: {
    icon: "border-cyan-500/30 bg-cyan-500/10 text-cyan-400",
    glow: "from-cyan-500/20 via-transparent to-transparent",
    accent: "text-cyan-400",
  },
  default: {
    icon: "border-white/[0.08] bg-white/[0.03] text-slate-400",
    glow: "from-white/[0.05] via-transparent to-transparent",
    accent: "text-slate-400",
  },
}

export function AdminStatCard({ label, value, subValue, icon, tone = "default" }: AdminStatCardProps) {
  const currentTone = TONE_STYLES[tone]

  return (
    <div className="relative flex flex-col justify-between overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0c1017] p-4.5 sm:p-5 transition-colors hover:border-white/[0.14]">
      {/* Top subtle tone line */}
      <div className={`absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r ${currentTone.glow}`} />

      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{label}</span>
        <div className={`flex h-8.5 w-8.5 items-center justify-center rounded-xl border ${currentTone.icon}`}>
          {icon}
        </div>
      </div>

      <div className="mt-3.5">
        <div className="font-mono text-2xl font-bold tracking-tight text-white sm:text-3xl">{value}</div>
        {subValue ? (
          <p className="mt-1.5 text-xs text-slate-400 flex items-center gap-1.5 font-sans">
            {subValue}
          </p>
        ) : null}
      </div>
    </div>
  )
}
