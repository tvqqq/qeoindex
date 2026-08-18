export type MarketTone = "up" | "down" | "ref" | "ceiling" | "floor"

export const MARKET_TONE_STYLES: Record<MarketTone, {
  text: string
  pill: string
  hex: string
}> = {
  up: {
    text: "text-up",
    pill: "border-up/30 bg-up/12 text-up",
    hex: "#22c98a",
  },
  down: {
    text: "text-down",
    pill: "border-down/30 bg-down/12 text-down",
    hex: "#f2495c",
  },
  ref: {
    text: "text-ref",
    pill: "border-ref/35 bg-ref/12 text-ref",
    hex: "#e2b93b",
  },
  ceiling: {
    text: "text-ceiling",
    pill: "border-ceiling/35 bg-ceiling/12 text-ceiling",
    hex: "#b07cff",
  },
  floor: {
    text: "text-floor",
    pill: "border-floor/35 bg-floor/12 text-floor",
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
}: {
  price?: number | null
  reference?: number | null
  ceiling?: number | null
  floor?: number | null
}): MarketTone {
  if (!finite(price)) return "ref"
  const live = price as number
  const epsilon = 1e-6
  if (finite(ceiling) && live >= (ceiling as number) - epsilon) return "ceiling"
  if (finite(floor) && live <= (floor as number) + epsilon) return "floor"
  if (!finite(reference)) return "ref"
  if (live > (reference as number) + epsilon) return "up"
  if (live < (reference as number) - epsilon) return "down"
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
