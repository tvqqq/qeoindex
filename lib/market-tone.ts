export type MarketTone = "up" | "down" | "ref" | "ceiling" | "floor"

export const MARKET_TONE_STYLES: Record<MarketTone, {
  text: string
  pill: string
  hex: string
}> = {
  up: {
    text: "text-up",
    pill: "border-emerald-500/30 bg-emerald-500/12 text-up shadow-[inset_0_1px_0_0_rgba(255,255,255,0.12)]",
    hex: "#22c98a",
  },
  down: {
    text: "text-down",
    pill: "border-rose-500/30 bg-rose-500/12 text-down shadow-[inset_0_1px_0_0_rgba(255,255,255,0.12)]",
    hex: "#ff4757",
  },
  ref: {
    text: "text-ref",
    pill: "border-amber-500/30 bg-amber-500/12 text-ref shadow-[inset_0_1px_0_0_rgba(255,255,255,0.12)]",
    hex: "#e2b93b",
  },
  ceiling: {
    text: "text-ceiling",
    pill: "border-purple-500/40 bg-purple-500/20 text-[#c084fc] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.2),0_0_12px_rgba(176,124,255,0.2)] font-black",
    hex: "#b07cff",
  },
  floor: {
    text: "text-floor",
    pill: "border-cyan-500/40 bg-cyan-500/20 text-[#22b8cf] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.2),0_0_12px_rgba(34,184,207,0.2)] font-black",
    hex: "#22b8cf",
  },
}

function finite(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value)
}

export function marketToneFromChange(value?: number | null): MarketTone {
  if (!finite(value)) return "ref"
  const val = value as number
  if (val >= 6.85) return "ceiling"
  if (val <= -6.85) return "floor"
  if (val > 0) return "up"
  if (val < 0) return "down"
  return "ref"
}

export function marketToneFromPrice({
  price,
  reference,
  ceiling,
  floor,
  changePercent,
}: {
  price?: number | null
  reference?: number | null
  ceiling?: number | null
  floor?: number | null
  changePercent?: number | null
}): MarketTone {
  if (!finite(price)) return "ref"
  const live = price as number
  const ref = finite(reference) ? (reference as number) : null
  const pct = finite(changePercent)
    ? (changePercent as number)
    : ref && ref > 0
      ? ((live - ref) / ref) * 100
      : null

  const epsilon = 1e-6

  // Ceiling: Must have strong gain (>= 6.85% or live >= ceiling with valid ref)
  if (pct !== null && pct >= 6.85) return "ceiling"
  if (finite(ceiling) && live >= (ceiling as number) - epsilon) {
    if (ref === null || live >= ref * 1.065) return "ceiling"
  }

  // Floor: Must have strong loss (<= -6.85% or live <= floor with valid ref)
  if (pct !== null && pct <= -6.85) return "floor"
  if (finite(floor) && live <= (floor as number) + epsilon) {
    if (ref === null || live <= ref * 0.935) return "floor"
  }

  if (ref !== null) {
    if (live > ref + epsilon) return "up"
    if (live < ref - epsilon) return "down"
    return "ref"
  }

  if (pct !== null) {
    if (pct > epsilon) return "up"
    if (pct < -epsilon) return "down"
  }

  return "ref"
}

export function marketToneText(tone: MarketTone) {
  return MARKET_TONE_STYLES[tone].text
}

export function marketTonePill(tone: MarketTone) {
  return MARKET_TONE_STYLES[tone].pill
}

export function marketToneHex(tone: MarketTone) {
  return MARKET_TONE_STYLES[tone].hex
}
