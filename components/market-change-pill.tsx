import { memo } from "react"
import { marketTonePill, type MarketTone } from "@/lib/market-tone"

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

  return (
    <span
      title={title}
      className={`inline-flex shrink-0 items-center justify-center rounded-full border font-mono font-bold leading-none ${marketTonePill(tone)} ${compact ? "min-w-[46px] px-1.5 py-0.5 text-[11.5px]" : "min-w-[56px] px-2 py-1 text-[12.5px]"}`}
    >
      {label}
    </span>
  )
})
