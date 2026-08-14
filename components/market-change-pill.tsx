import { marketTonePill, type MarketTone } from "@/lib/market-tone"

export function MarketChangePill({
  value,
  tone,
  compact = false,
  title,
}: {
  value?: number | null
  tone: MarketTone
  compact?: boolean
  title?: string
}) {
  const label = typeof value === "number" && Number.isFinite(value)
    ? `${value > 0 ? "+" : ""}${value.toFixed(2)}%`
    : "—"

  return (
    <span
      title={title}
      className={`inline-flex shrink-0 items-center justify-center rounded-full border font-mono font-bold leading-none ${marketTonePill(tone)} ${compact ? "min-w-[48px] px-1.5 py-1 text-[10px]" : "min-w-[58px] px-2 py-1.5 text-[11px]"}`}
    >
      {label}
    </span>
  )
}
