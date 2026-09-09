export function rangePosition(value: number, floor: number, ceiling: number) {
  if (![value, floor, ceiling].every(Number.isFinite)) return 50
  const span = ceiling - floor
  if (span <= 0) return 50
  return Math.min(100, Math.max(0, ((value - floor) / span) * 100))
}

export function formatCompactNumber(value: number | null | undefined, digits = 1) {
  if (value == null || !Number.isFinite(value)) return "—"

  const abs = Math.abs(value)
  const compact = (divisor: number, suffix: string) => {
    const next = value / divisor
    const formatted = next.toLocaleString("vi-VN", {
      minimumFractionDigits: 0,
      maximumFractionDigits: digits,
    })
    return `${formatted}${suffix}`
  }

  if (abs >= 1_000_000_000_000) return compact(1_000_000_000_000, "T")
  if (abs >= 1_000_000_000) return compact(1_000_000_000, "B")
  if (abs >= 1_000_000) return compact(1_000_000, "M")
  if (abs >= 1_000) return compact(1_000, "K")

  return value.toLocaleString("vi-VN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  })
}
