import { memo } from "react"
import { type MarketTone } from "@/lib/market-tone"

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

  let toneStyle = "text-muted-2 bg-white/5"
  if (tone === "ceiling") {
    toneStyle = "text-purple-400 bg-purple-500/15 border border-purple-500/20 font-black shadow-[0_0_8px_rgba(168,85,247,0.15)]"
  } else if (tone === "floor") {
    toneStyle = "text-cyan-400 bg-cyan-500/15 border border-cyan-500/20 font-black shadow-[0_0_8px_rgba(6,182,212,0.15)]"
  } else if (tone === "up") {
    toneStyle = "text-emerald-400 bg-emerald-500/10"
  } else if (tone === "down") {
    toneStyle = "text-rose-400 bg-rose-500/10"
  } else if (tone === "ref") {
    toneStyle = "text-amber-400 bg-amber-500/10"
  }

  return (
    <span
      title={title}
      className={`inline-flex shrink-0 items-center justify-center gap-1 font-mono text-xs font-bold px-1.5 py-0.5 rounded leading-none select-none ${toneStyle}`}
    >
      {label}
    </span>
  )
})
