export interface IndustryPriceboardStock {
  ticker: string
  rank: number
  sector: string
  kfspSector?: string | null
}

export interface IndustryPriceboardQuote {
  price?: number | null
  reference?: number | null
  ceiling?: number | null
  floor?: number | null
  changePercent?: number | null
  volume?: number | null
}

export type IndustryPriceboardTone =
  | "up"
  | "down"
  | "unchanged"
  | "ceiling"
  | "floor"
  | "unavailable"

export const INDUSTRY_PRICEBOARD_DEFAULT_ORDER = ["Chứng khoán", "Bất động sản", "Ngân hàng"] as const

function cleanIndustry(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function industryKey(value: string) {
  return cleanIndustry(value).normalize("NFC").toLocaleLowerCase("vi-VN")
}

export function industryLabelForStock(stock: IndustryPriceboardStock) {
  return cleanIndustry(stock.kfspSector) || cleanIndustry(stock.sector) || "Chưa phân ngành"
}

export function defaultIndustryColumnOrder(industries: readonly string[]) {
  const labels = [...new Set(industries.map(cleanIndustry).filter(Boolean))]
  const preferred = INDUSTRY_PRICEBOARD_DEFAULT_ORDER.flatMap((label) => {
    const match = labels.find((candidate) => industryKey(candidate) === industryKey(label))
    return match ? [match] : []
  })
  const preferredSet = new Set(preferred)
  const remainder = labels
    .filter((label) => !preferredSet.has(label))
    .sort((a, b) => a.localeCompare(b, "vi", { sensitivity: "base" }))
  return [...preferred, ...remainder]
}

export function reconcileIndustryColumnOrder(saved: unknown, industries: readonly string[]) {
  const defaults = defaultIndustryColumnOrder(industries)
  if (!Array.isArray(saved)) return defaults

  const available = new Set(defaults)
  const seen = new Set<string>()
  const retained: string[] = []
  for (const item of saved) {
    if (typeof item !== "string") continue
    const label = item.trim()
    if (!label || !available.has(label) || seen.has(label)) continue
    retained.push(label)
    seen.add(label)
  }
  for (const label of defaults) {
    if (!seen.has(label)) retained.push(label)
  }
  return retained
}

export const INDUSTRY_ORDER_MAX_ITEMS = 120
export const INDUSTRY_ORDER_MAX_LABEL_LENGTH = 96

export function normalizeSavedIndustryOrder(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > INDUSTRY_ORDER_MAX_ITEMS) return null
  const result: string[] = []
  const seen = new Set<string>()
  for (const item of value) {
    if (typeof item !== "string") return null
    const label = item.trim()
    if (!label || label.length > INDUSTRY_ORDER_MAX_LABEL_LENGTH || seen.has(label)) return null
    seen.add(label)
    result.push(label)
  }
  return result
}

function settingsRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

export function readIndustryOrderFromSettings(settings: unknown): string[] | null {
  const board = settingsRecord(settingsRecord(settings).marketBoard)
  return normalizeSavedIndustryOrder(board.industryOrder)
}

export function mergeIndustryOrderIntoSettings(
  settings: unknown,
  order: readonly string[],
): Record<string, unknown> {
  const current = settingsRecord(settings)
  return {
    ...current,
    marketBoard: {
      ...settingsRecord(current.marketBoard),
      industryOrder: [...order],
    },
  }
}

export function moveIndustryColumn(order: readonly string[], source: string, target: string) {
  const from = order.indexOf(source)
  const to = order.indexOf(target)
  if (from < 0 || to < 0 || from === to) return [...order]
  const next = [...order]
  next.splice(from, 1)
  next.splice(to, 0, source)
  return next
}

export function moveIndustryColumnBy(order: readonly string[], source: string, offset: -1 | 1) {
  const from = order.indexOf(source)
  const to = from + offset
  if (from < 0 || to < 0 || to >= order.length) return [...order]
  const next = [...order]
  const [column] = next.splice(from, 1)
  next.splice(to, 0, column)
  return next
}

export type IndustryPriceboardLane = {
  industries: string[]
  units: number
}

export const INDUSTRY_PRICEBOARD_LANE_MAX_UNITS = 26

export function industryPriceboardCardUnits(stockCount: number) {
  const normalizedCount = Number.isFinite(stockCount) ? Math.max(0, Math.floor(stockCount)) : 0
  // Header + table labels consume roughly the same vertical space as three rows.
  return 3 + normalizedCount
}

export function packIndustryLanes(
  order: readonly string[],
  stocksByIndustry: ReadonlyMap<string, readonly IndustryPriceboardStock[]>,
  maxUnits = INDUSTRY_PRICEBOARD_LANE_MAX_UNITS,
) {
  const limit = Number.isFinite(maxUnits) && maxUnits > 0
    ? Math.max(1, Math.floor(maxUnits))
    : INDUSTRY_PRICEBOARD_LANE_MAX_UNITS
  const lanes: IndustryPriceboardLane[] = []
  let current: IndustryPriceboardLane | null = null

  for (const industry of order) {
    const stocks = stocksByIndustry.get(industry) ?? []
    if (stocks.length === 0) continue

    const units = industryPriceboardCardUnits(stocks.length)
    if (!current || (current.industries.length > 0 && current.units + units > limit)) {
      current = { industries: [], units: 0 }
      lanes.push(current)
    }

    current.industries.push(industry)
    current.units += units
  }

  return lanes
}

function isValidPrice(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
}

export function hasValidPriceboardQuote(quote?: IndustryPriceboardQuote | null): quote is IndustryPriceboardQuote & { price: number; changePercent: number } {
  return Boolean(
    quote &&
      isValidPrice(quote.price) &&
      typeof quote.changePercent === "number" &&
      Number.isFinite(quote.changePercent),
  )
}

export function sortIndustryStocksByPerformance<T extends IndustryPriceboardStock>(
  stocks: readonly T[],
  quotes: Readonly<Record<string, IndustryPriceboardQuote | undefined>>,
) {
  return [...stocks].sort((a, b) => {
    const aq = quotes[a.ticker]
    const bq = quotes[b.ticker]
    const aValid = hasValidPriceboardQuote(aq)
    const bValid = hasValidPriceboardQuote(bq)
    if (aValid !== bValid) return aValid ? -1 : 1
    if (aValid && bValid) {
      const aChange = aq?.changePercent
      const bChange = bq?.changePercent
      if (typeof aChange === "number" && typeof bChange === "number" && aChange !== bChange) {
        return bChange - aChange
      }
    }

    const aVolume = aq?.volume
    const bVolume = bq?.volume
    if (typeof aVolume === "number" && Number.isFinite(aVolume) && typeof bVolume === "number" && Number.isFinite(bVolume) && aVolume !== bVolume) {
      return bVolume - aVolume
    }
    return a.rank - b.rank || a.ticker.localeCompare(b.ticker)
  })
}

export function averagePriceboardChange(
  stocks: readonly IndustryPriceboardStock[],
  quotes: Readonly<Record<string, IndustryPriceboardQuote | undefined>>,
) {
  const changes = stocks
    .map((stock) => quotes[stock.ticker])
    .filter(hasValidPriceboardQuote)
    .map((quote) => quote.changePercent)
  if (changes.length === 0) return null
  return changes.reduce((sum, change) => sum + change, 0) / changes.length
}

export function industryPriceboardBreadth(
  stocks: readonly IndustryPriceboardStock[],
  quotes: Readonly<Record<string, IndustryPriceboardQuote | undefined>>,
) {
  let up = 0
  let unchanged = 0
  let down = 0
  let unavailable = 0
  for (const stock of stocks) {
    const quote = quotes[stock.ticker]
    // Invalid or missing provider quotes must not count as unchanged.
    if (!hasValidPriceboardQuote(quote)) {
      unavailable += 1
    } else if (quote.changePercent > 0) {
      up += 1
    } else if (quote.changePercent < 0) {
      down += 1
    } else {
      unchanged += 1
    }
  }
  return { up, unchanged, down, unavailable }
}

function marketPrice(value: unknown) {
  if (!isValidPrice(value)) return null
  return value > 1000 ? value / 1000 : value
}

function matchesOfficialLimit(price: number, limit: unknown, reference: unknown, direction: "ceiling" | "floor") {
  const normalizedPrice = marketPrice(price)
  const normalizedLimit = marketPrice(limit)
  const normalizedReference = marketPrice(reference)
  if (normalizedPrice === null || normalizedLimit === null) return false
  if (normalizedReference !== null) {
    if (direction === "ceiling" && normalizedLimit <= normalizedReference) return false
    if (direction === "floor" && normalizedLimit >= normalizedReference) return false
  }
  return Math.abs(normalizedPrice - normalizedLimit) <= 0.000001
}

export function industryPriceboardTone(quote?: IndustryPriceboardQuote | null): IndustryPriceboardTone {
  if (!quote || !isValidPrice(quote.price)) return "unavailable"
  if (matchesOfficialLimit(quote.price, quote.ceiling, quote.reference, "ceiling")) return "ceiling"
  if (matchesOfficialLimit(quote.price, quote.floor, quote.reference, "floor")) return "floor"
  if (typeof quote.changePercent !== "number" || !Number.isFinite(quote.changePercent)) return "unavailable"
  if (quote.changePercent > 0) return "up"
  if (quote.changePercent < 0) return "down"
  return "unchanged"
}

export function industryPriceboardChangeIntensity(changePercent: number) {
  if (!Number.isFinite(changePercent)) return 0
  const magnitude = Math.abs(changePercent)
  // Within ±1% use a quiet neutral ramp; 0% stays closest to the board surface.
  if (magnitude <= 1) return 0.018 + magnitude * 0.062
  // Beyond 1% reveal the directional tone, capped at 7% for HOSE/HNX/UPCOM.
  return 0.12 + Math.min(1, (magnitude - 1) / 6) * 0.48
}

export function industryPriceboardBackground(quote?: IndustryPriceboardQuote | null) {
  const tone = industryPriceboardTone(quote)
  if (tone === "ceiling") return "rgba(176, 124, 255, 0.48)"
  if (tone === "floor") return "rgba(34, 184, 207, 0.48)"
  if (tone === "unavailable") return "rgba(255, 255, 255, 0.035)"

  const change = quote?.changePercent ?? 0
  const alpha = industryPriceboardChangeIntensity(change)
  if (tone === "unchanged" || Math.abs(change) <= 1) {
    return `rgba(255, 255, 255, ${alpha.toFixed(3)})`
  }
  return tone === "up"
    ? `rgba(34, 201, 138, ${alpha.toFixed(3)})`
    : `rgba(255, 71, 87, ${alpha.toFixed(3)})`
}
