export type DnseMarketIndexQuote = {
  symbol: "VNINDEX" | "VN30" | "HNXINDEX" | "UPCOMINDEX"
  value: number
  reference?: number
  change?: number
  changePercent?: number
  volume?: number
  valueTraded?: number
  asOf: string
  sessionDate: string
}

export type DnseForeignSnapshot = {
  symbol: string
  buyValue?: number
  sellValue?: number
  buyVolume?: number
  sellVolume?: number
  netValue?: number
  asOf: string
  sessionDate: string
}

export type VerifiedSessionReference = { value: number; sessionDate: string }

export function isProviderTimestampNotOlder(candidate: string, previous: string | null | undefined) {
  const candidateMs = Date.parse(candidate)
  if (!Number.isFinite(candidateMs)) return false
  const previousMs = Date.parse(previous ?? "")
  return !Number.isFinite(previousMs) || candidateMs >= previousMs
}

const SESSION_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Ho_Chi_Minh",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
})

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value.trim()) : Number.NaN
  return Number.isFinite(parsed) ? parsed : null
}

function firstFinite(data: Record<string, unknown>, keys: readonly string[]): number | null {
  for (const key of keys) {
    const value = finiteNumber(data[key])
    if (value !== null) return value
  }
  return null
}

export function providerTimestamp(value: unknown): string | null {
  let timestampMs: number | null = null
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    timestampMs = value > 10_000_000_000 ? value : value * 1000
  } else if (value && typeof value === "object" && !Array.isArray(value)) {
    const data = value as Record<string, unknown>
    const seconds = finiteNumber(data.seconds ?? data.Seconds)
    const nanos = finiteNumber(data.nanos ?? data.Nanos ?? 0)
    if (seconds !== null && seconds > 0 && nanos !== null && nanos >= 0 && nanos < 1_000_000_000) {
      timestampMs = seconds * 1000 + nanos / 1_000_000
    }
  } else if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) timestampMs = parsed
  }

  if (timestampMs === null || !Number.isFinite(timestampMs)) return null
  const date = new Date(timestampMs)
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

function sessionDate(asOf: string) {
  return SESSION_DATE_FORMATTER.format(new Date(asOf))
}

export function isSameVietnamSessionTimestamp(asOf: string | null | undefined, expectedSessionDate: string, nowMs = Date.now()) {
  const sourceMs = Date.parse(asOf ?? "")
  return Boolean(
    expectedSessionDate
    && Number.isFinite(sourceMs)
    && sourceMs <= nowMs + 5_000
    && sessionDate(new Date(sourceMs).toISOString()) === expectedSessionDate,
  )
}

function normalizeIndexSymbol(value: unknown): DnseMarketIndexQuote["symbol"] | null {
  const symbol = String(value ?? "").trim().toUpperCase().replace(/[-_ ]/g, "")
  if (symbol === "VNINDEX") return "VNINDEX"
  if (symbol === "VN30") return "VN30"
  if (symbol === "HNX" || symbol === "HNXINDEX") return "HNXINDEX"
  if (symbol === "UPCOM" || symbol === "UPCOMINDEX") return "UPCOMINDEX"
  return null
}

const INDEX_REFERENCE_KEYS = [
  "priorValueIndexes",
  "referenceIndex",
  "referenceValue",
  "reference",
  "previousClose",
  "prevClose",
  "priorClose",
] as const

export function parseDnseMarketIndexFrame(
  frame: Record<string, unknown>,
  verifiedReference?: VerifiedSessionReference,
): DnseMarketIndexQuote | null {
  const symbol = normalizeIndexSymbol(frame.indexName ?? frame.symbol)
  const value = firstFinite(frame, ["valueIndexes", "value", "indexValue"])
  const asOf = providerTimestamp(frame.transactTime)
  if (!symbol || value === null || value <= 0 || !asOf) return null

  const currentSessionDate = sessionDate(asOf)
  const explicitReference = firstFinite(frame, INDEX_REFERENCE_KEYS)
  const validExplicitReference = explicitReference !== null && explicitReference > 0 ? explicitReference : undefined
  const validStoredReference = verifiedReference?.sessionDate === currentSessionDate
    && Number.isFinite(verifiedReference.value)
    && verifiedReference.value > 0
    ? verifiedReference.value
    : undefined
  const reference = validExplicitReference ?? validStoredReference

  const explicitChange = firstFinite(frame, ["changedValue"])
  const change = explicitChange ?? (reference !== undefined ? value - reference : undefined)
  const explicitChangePercent = firstFinite(frame, ["changedRatio"])
  const changePercent = explicitChangePercent
    ?? (reference !== undefined && change !== undefined ? (change / reference) * 100 : undefined)
  const volume = firstFinite(frame, ["totalVolumeTraded", "totalVolume", "totalQtty", "allQtty", "vol", "v"])
  const grossTradeAmount = finiteNumber(frame.grossTradeAmount)
  const scaledGrossTradeAmount = grossTradeAmount !== null && grossTradeAmount >= 0
    ? grossTradeAmount * 1_000_000_000
    : Number.NaN
  const valueTraded = Number.isFinite(scaledGrossTradeAmount) ? scaledGrossTradeAmount : undefined

  return {
    symbol,
    value,
    ...(reference !== undefined ? { reference } : {}),
    ...(change !== undefined ? { change } : {}),
    ...(changePercent !== undefined ? { changePercent } : {}),
    ...(volume !== null && volume >= 0 ? { volume } : {}),
    ...(valueTraded !== undefined ? { valueTraded } : {}),
    asOf,
    sessionDate: currentSessionDate,
  }
}

export function parseDnseForeignFrame(frame: Record<string, unknown>): DnseForeignSnapshot | null {
  const symbol = String(frame.symbol ?? "").trim().toUpperCase()
  const asOf = providerTimestamp(frame.multicastReceiveTime)
  if (!/^[A-Z0-9]{2,12}$/.test(symbol) || !asOf) return null

  const buyValue = firstFinite(frame, ["totalBuyTradedAmount", "buyTradedAmount"])
  const sellValue = firstFinite(frame, ["totalSellTradedAmount", "sellTradedAmount"])
  const buyVolume = firstFinite(frame, ["totalBuyVolume", "buyVolume"])
  const sellVolume = firstFinite(frame, ["totalSellVolume", "sellVolume"])
  if ([buyValue, sellValue, buyVolume, sellVolume].every((value) => value === null)) return null

  const safeBuyValue = buyValue !== null && buyValue >= 0 ? buyValue : undefined
  const safeSellValue = sellValue !== null && sellValue >= 0 ? sellValue : undefined
  const safeBuyVolume = buyVolume !== null && buyVolume >= 0 ? buyVolume : undefined
  const safeSellVolume = sellVolume !== null && sellVolume >= 0 ? sellVolume : undefined
  const netValue = safeBuyValue !== undefined && safeSellValue !== undefined
    ? safeBuyValue - safeSellValue
    : undefined

  return {
    symbol,
    ...(safeBuyValue !== undefined ? { buyValue: safeBuyValue } : {}),
    ...(safeSellValue !== undefined ? { sellValue: safeSellValue } : {}),
    ...(safeBuyVolume !== undefined ? { buyVolume: safeBuyVolume } : {}),
    ...(safeSellVolume !== undefined ? { sellVolume: safeSellVolume } : {}),
    ...(netValue !== undefined ? { netValue } : {}),
    asOf,
    sessionDate: sessionDate(asOf),
  }
}
