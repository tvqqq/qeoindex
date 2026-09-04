import { memo } from "react"
import { type MarketTone } from "@/modules/market/tone"

export const MarketChangePill = memo(function MarketChangePill({
  value,
  tone,
  compact = false,
  title,
  decimals = 1,
}: {
  value?: number | null
  tone: MarketTone
  compact?: boolean
  title?: string
  decimals?: number
}) {
  const label = typeof value === "number" && Number.isFinite(value)
    ? `${value > 0 ? "+" : ""}${value.toFixed(decimals)}%`
    : "—"

  let toneStyle = "text-muted-2 bg-white/5 border border-white/5"
  if (tone === "ceiling") {
    toneStyle = "text-purple-300 bg-purple-500/20 border border-purple-500/35 font-black shadow-[0_0_8px_rgba(168,85,247,0.2)]"
  } else if (tone === "floor") {
    toneStyle = "text-cyan-300 bg-cyan-500/20 border border-cyan-500/35 font-black shadow-[0_0_8px_rgba(6,182,212,0.2)]"
  } else if (tone === "up") {
    toneStyle = "text-emerald-400 bg-emerald-500/15 border border-emerald-500/25"
  } else if (tone === "down") {
    toneStyle = "text-rose-400 bg-rose-500/15 border border-rose-500/25"
  } else if (tone === "ref") {
    toneStyle = "text-amber-400 bg-amber-500/15 border border-amber-500/25"
  }

  return (
    <span
      title={title}
      className={`inline-flex shrink-0 items-center justify-center gap-1 font-mono ${
        compact ? "text-[12.5px] px-1.5 py-0.5" : "text-[13.5px] px-2 py-0.5"
      } font-extrabold rounded leading-tight select-none tracking-tight ${toneStyle}`}
    >
      {label}
    </span>
  )
})
