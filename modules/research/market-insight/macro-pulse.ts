export type MacroFreshness = "fresh" | "delayed" | "stale" | "unknown" | "unavailable"
export type MacroMetricStatus = "ready" | "unavailable"
export type CompactMacroPulseStatus = "ready" | "degraded"

export interface VietcombankUsdVndQuote {
  transferBuy: number
  sell: number
  asOf: string | null
  source: "Vietcombank"
}

export interface TradingViewMacroQuote {
  value: number
  changePct: number | null
  change: number | null
  updateMode: string | null
  retrievedAt: string
}

export interface MacroPulseMetric {
  status: MacroMetricStatus
  freshness: MacroFreshness
  value: number | null
  secondaryValue: number | null
  changePct: number | null
  change: number | null
  asOf: string | null
  source: string
  unit: string
  message: string | null
}

export interface CompactMacroPulseData {
  status: CompactMacroPulseStatus
  retrievedAt: string
  metrics: {
    usdVnd: MacroPulseMetric
    vndOvernight: MacroPulseMetric
    dxy: MacroPulseMetric
    wti: MacroPulseMetric
  }
  message: string
}

export interface BuildCompactMacroPulseInput {
  now?: Date
  usdVnd: VietcombankUsdVndQuote | null
  dxy: TradingViewMacroQuote | null
  wti: TradingViewMacroQuote | null
}

type TradingViewPayload = { data?: Array<{ s?: unknown; d?: unknown[] }> }

const VIETNAM_TIME_ZONE = "Asia/Ho_Chi_Minh"

function finitePositive(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(String(value ?? "").replaceAll(",", "").trim())
  return Number.isFinite(number) && number > 0 ? number : null
}

function finiteOrNull(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value)
  return Number.isFinite(number) ? number : null
}

function readAttributes(tag: string) {
  const attributes: Record<string, string> = {}
  const pattern = /([A-Za-z][A-Za-z0-9]*)\s*=\s*(["'])(.*?)\2/g
  for (const match of tag.matchAll(pattern)) attributes[match[1].toLowerCase()] = match[3]
  return attributes
}

function parseVietcombankDate(value: string | null): string | null {
  if (!value) return null
  const text = value.trim()
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)$/i.exec(text)
  if (!match) return null

  const month = Number(match[1])
  const day = Number(match[2])
  const year = Number(match[3])
  let hour = Number(match[4])
  const minute = Number(match[5])
  const second = Number(match[6])
  const meridiem = match[7].toUpperCase()
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour < 1 || hour > 12 || minute > 59 || second > 59) return null
  if (hour === 12) hour = 0
  if (meridiem === "PM") hour += 12

  const calendarCheck = new Date(Date.UTC(year, month - 1, day, hour, minute, second))
  if (
    calendarCheck.getUTCFullYear() !== year
    || calendarCheck.getUTCMonth() !== month - 1
    || calendarCheck.getUTCDate() !== day
  ) return null

  const pad = (number: number) => String(number).padStart(2, "0")
  return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(second)}+07:00`
}

function vietnamDateKey(date: Date): string | null {
  if (!Number.isFinite(date.getTime())) return null
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: VIETNAM_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date)
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return byType.year && byType.month && byType.day ? `${byType.year}-${byType.month}-${byType.day}` : null
}

export function parseVietcombankUsdVndXml(xml: string): VietcombankUsdVndQuote | null {
  if (!xml.trim()) return null
  const dateText = /<Date>([^<]+)<\/Date>/i.exec(xml)?.[1]?.trim() ?? null
  const usdTag = [...xml.matchAll(/<Exrate\b[^>]*>/gi)]
    .map((match) => readAttributes(match[0]))
    .find((attributes) => attributes.currencycode?.trim().toUpperCase() === "USD")
  if (!usdTag) return null

  const transferBuy = finitePositive(usdTag.transfer)
  const sell = finitePositive(usdTag.sell)
  if (transferBuy == null || sell == null) return null

  return {
    transferBuy,
    sell,
    asOf: parseVietcombankDate(dateText),
    source: "Vietcombank",
  }
}

export function classifyVietcombankFreshness(
  asOf: string | null,
  now = new Date(),
): MacroFreshness {
  if (!asOf) return "unknown"
  const quoteDate = new Date(asOf)
  const quoteKey = vietnamDateKey(quoteDate)
  const nowKey = vietnamDateKey(now)
  if (!quoteKey || !nowKey) return "unknown"
  return quoteKey === nowKey ? "fresh" : "stale"
}

export function classifyTradingViewFreshness(updateMode: string | null | undefined): MacroFreshness {
  const normalized = String(updateMode ?? "").trim().toLowerCase()
  if (!normalized) return "unknown"
  if (normalized.includes("delayed")) return "delayed"
  if (normalized === "endofday" || normalized === "eod" || normalized.includes("end_of_day")) return "stale"
  if (normalized.includes("streaming")) return "fresh"
  return "unknown"
}

export function parseTradingViewMacroScan(
  payload: TradingViewPayload,
  retrievedAt = new Date().toISOString(),
): { dxy: TradingViewMacroQuote | null; wti: TradingViewMacroQuote | null } {
  let dxy: TradingViewMacroQuote | null = null
  let wti: TradingViewMacroQuote | null = null

  for (const row of payload.data ?? []) {
    const symbol = String(row.s ?? "")
    if (symbol !== "TVC:DXY" && symbol !== "NYMEX:CL1!") continue
    const value = finitePositive(row.d?.[0])
    if (value == null) continue
    const quote: TradingViewMacroQuote = {
      value,
      changePct: finiteOrNull(row.d?.[1]),
      change: finiteOrNull(row.d?.[2]),
      updateMode: typeof row.d?.[3] === "string" ? row.d[3] : null,
      retrievedAt,
    }
    if (symbol === "TVC:DXY") dxy = quote
    else wti = quote
  }

  return { dxy, wti }
}

function unavailableMetric(source: string, unit: string, message: string): MacroPulseMetric {
  return {
    status: "unavailable",
    freshness: "unavailable",
    value: null,
    secondaryValue: null,
    changePct: null,
    change: null,
    asOf: null,
    source,
    unit,
    message,
  }
}

function tradingViewMetric(quote: TradingViewMacroQuote | null, label: string, unit: string): MacroPulseMetric {
  if (!quote || !Number.isFinite(quote.value) || quote.value <= 0) {
    return unavailableMetric("TradingView", unit, `${label} hiện không có snapshot hợp lệ.`)
  }
  return {
    status: "ready",
    freshness: classifyTradingViewFreshness(quote.updateMode),
    value: quote.value,
    secondaryValue: null,
    changePct: quote.changePct,
    change: quote.change,
    asOf: quote.retrievedAt,
    source: "TradingView",
    unit,
    message: quote.updateMode ? `Update mode: ${quote.updateMode}.` : "Update mode chưa xác định.",
  }
}

export function buildCompactMacroPulse(input: BuildCompactMacroPulseInput): CompactMacroPulseData {
  const now = input.now ?? new Date()
  const usdVnd = input.usdVnd && finitePositive(input.usdVnd.transferBuy) != null && finitePositive(input.usdVnd.sell) != null
    ? {
        status: "ready" as const,
        freshness: classifyVietcombankFreshness(input.usdVnd.asOf, now),
        value: input.usdVnd.transferBuy,
        secondaryValue: input.usdVnd.sell,
        changePct: null,
        change: null,
        asOf: input.usdVnd.asOf,
        source: input.usdVnd.source,
        unit: "VND/USD",
        message: "Tỷ giá USD chuyển khoản mua / bán do Vietcombank công bố.",
      }
    : unavailableMetric("Vietcombank", "VND/USD", "USD/VND hiện không có quote Vietcombank hợp lệ.")

  const metrics = {
    usdVnd,
    vndOvernight: unavailableMetric(
      "SBV",
      "%",
      "Nguồn VND overnight (O/N) tự động chưa được xác minh.",
    ),
    dxy: tradingViewMetric(input.dxy, "DXY", "index"),
    wti: tradingViewMetric(input.wti, "WTI", "USD/barrel"),
  }
  const readyCount = Object.values(metrics).filter((metric) => metric.status === "ready").length

  return {
    status: readyCount === Object.keys(metrics).length ? "ready" : "degraded",
    retrievedAt: now.toISOString(),
    metrics,
    message: "Macro chỉ là bối cảnh; không thay thế bằng chứng price/volume của thị trường Việt Nam.",
  }
}
