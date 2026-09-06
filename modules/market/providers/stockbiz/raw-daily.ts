const STOCKBIZ_BASE_URL = "https://web.stockbiz.vn"

export type RawDailyPriceBasis = "RAW"
export type RawDailySourcePriceUnit = "VND_THOUSANDS"

export interface StockBizRawDailyBar {
  ticker: string
  sessionDate: string
  open: number
  high: number
  low: number
  close: number
  volume: number
  adjustedClose: number
  priceBasis: RawDailyPriceBasis
  sourcePriceUnit: RawDailySourcePriceUnit
}

export interface RawDailyRangeSummary {
  sessions: number
  high: number
  low: number
  firstSession: string
  lastSession: string
}

type RequiredColumn = "date" | "open" | "high" | "low" | "close" | "adjustedClose" | "volume"

const HEADER_ALIASES: Record<RequiredColumn, Set<string>> = {
  date: new Set(["ngay", "date"]),
  open: new Set(["mo cua", "open"]),
  high: new Set(["cao nhat", "high"]),
  low: new Set(["thap nhat", "low"]),
  close: new Set(["dong cua", "close"]),
  adjustedClose: new Set(["dong cua dc", "dong cua dieu chinh", "adjusted close", "close adjusted"]),
  volume: new Set(["khoi luong", "volume"]),
}

function decodeHtml(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function normalizeHeader(value: string) {
  return decodeHtml(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLowerCase()
}

function normalizeTicker(value: string) {
  const ticker = value.trim().toUpperCase()
  if (!/^[A-Z0-9]{2,12}$/.test(ticker)) throw new Error(`Invalid StockBiz ticker: ${value}`)
  return ticker
}

function parseStockBizNumber(value: string, field: string) {
  const text = decodeHtml(value).replace(/[\s\u00a0]/g, "")
  if (!text || !/^-?[0-9.,]+$/.test(text)) throw new Error(`Invalid StockBiz ${field}`)

  let normalized = text
  const commaCount = (text.match(/,/g) || []).length
  const dotCount = (text.match(/\./g) || []).length

  if (commaCount > 0 && dotCount > 0) {
    const decimalSeparator = text.lastIndexOf(",") > text.lastIndexOf(".") ? "," : "."
    const thousandsSeparator = decimalSeparator === "," ? "." : ","
    normalized = text.split(thousandsSeparator).join("")
    if (decimalSeparator === ",") normalized = normalized.replace(",", ".")
  } else if (commaCount > 1) {
    normalized = text.replaceAll(",", "")
  } else if (dotCount > 1) {
    normalized = text.replaceAll(".", "")
  } else if (commaCount === 1) {
    const fractionLength = text.length - text.lastIndexOf(",") - 1
    normalized = fractionLength > 0 && fractionLength <= 2 ? text.replace(",", ".") : text.replace(",", "")
  } else if (dotCount === 1) {
    const fractionLength = text.length - text.lastIndexOf(".") - 1
    normalized = fractionLength > 0 && fractionLength <= 3 ? text : text.replace(".", "")
  }

  const parsed = Number(normalized)
  if (!Number.isFinite(parsed)) throw new Error(`Invalid StockBiz ${field}`)
  return parsed
}

function parseSessionDate(value: string) {
  const match = decodeHtml(value).match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (!match) throw new Error(`Invalid StockBiz date: ${value}`)
  const [, dd, mm, yyyy] = match
  const day = Number(dd)
  const month = Number(mm)
  const year = Number(yyyy)
  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    throw new Error(`Invalid StockBiz date: ${value}`)
  }
  return `${yyyy}-${mm}-${dd}`
}

function parseCells(rowHtml: string, cellTag: "th" | "td") {
  const pattern = cellTag === "th"
    ? /<th\b[^>]*>([\s\S]*?)<\/th>/gi
    : /<td\b[^>]*>([\s\S]*?)<\/td>/gi
  return [...rowHtml.matchAll(pattern)].map((match) => decodeHtml(match[1] ?? ""))
}

function requiredColumnIndexes(headers: string[]) {
  const normalized = headers.map(normalizeHeader)
  const result = {} as Record<RequiredColumn, number>
  for (const key of Object.keys(HEADER_ALIASES) as RequiredColumn[]) {
    const indexes = normalized
      .map((header, index) => HEADER_ALIASES[key].has(header) ? index : -1)
      .filter((index) => index >= 0)
    if (indexes.length !== 1) {
      throw new Error(`StockBiz ${key} column is missing or ambiguous`)
    }
    result[key] = indexes[0]
  }
  return result
}

function parseHistoryTable(tableHtml: string, ticker: string): StockBizRawDailyBar[] {
  const rows = [...tableHtml.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((match) => match[1] ?? "")
  const headerRow = rows.find((rowHtml) => /<th\b/i.test(rowHtml))
  if (!headerRow) throw new Error("StockBiz history header is missing")
  const headers = parseCells(headerRow, "th")
  const indexes = requiredColumnIndexes(headers)
  const requiredWidth = Math.max(...Object.values(indexes)) + 1

  const bars: StockBizRawDailyBar[] = []
  const sessions = new Set<string>()
  for (const rowHtml of rows) {
    if (!/<td\b/i.test(rowHtml)) continue
    const cells = parseCells(rowHtml, "td")
    if (cells.length < requiredWidth) continue
    const sessionDate = parseSessionDate(cells[indexes.date] ?? "")
    if (sessions.has(sessionDate)) throw new Error(`Duplicate or ambiguous StockBiz session: ${sessionDate}`)

    const open = parseStockBizNumber(cells[indexes.open] ?? "", "open")
    const high = parseStockBizNumber(cells[indexes.high] ?? "", "high")
    const low = parseStockBizNumber(cells[indexes.low] ?? "", "low")
    const close = parseStockBizNumber(cells[indexes.close] ?? "", "close")
    const adjustedClose = parseStockBizNumber(cells[indexes.adjustedClose] ?? "", "adjusted close")
    const volume = parseStockBizNumber(cells[indexes.volume] ?? "", "volume")

    if (open <= 0 || high <= 0 || low <= 0 || close <= 0 || adjustedClose <= 0) {
      throw new Error(`Invalid StockBiz OHLC for ${sessionDate}`)
    }
    if (volume < 0) throw new Error(`Invalid StockBiz volume for ${sessionDate}`)
    if (high < Math.max(open, close, low) || low > Math.min(open, close, high)) {
      throw new Error(`Invalid StockBiz OHLC high/low for ${sessionDate}`)
    }

    sessions.add(sessionDate)
    bars.push({
      ticker,
      sessionDate,
      open,
      high,
      low,
      close,
      volume,
      adjustedClose,
      priceBasis: "RAW",
      sourcePriceUnit: "VND_THOUSANDS",
    })
  }
  if (!bars.length) throw new Error("StockBiz history returned no usable raw Daily rows")
  return bars.sort((left, right) => left.sessionDate.localeCompare(right.sessionDate))
}

export function parseStockBizRawDailyHtml(html: string, input: { ticker: string }) {
  const ticker = normalizeTicker(input.ticker)
  if (typeof html !== "string" || html.trim().length === 0) throw new Error("StockBiz history HTML is empty")
  const tables = [...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)].map((match) => match[0])
  if (!tables.length) throw new Error("StockBiz history table is missing")

  const matching: StockBizRawDailyBar[][] = []
  for (const tableHtml of tables) {
    try {
      matching.push(parseHistoryTable(tableHtml, ticker))
    } catch (error) {
      if (error instanceof Error && /column is missing or ambiguous|history header is missing/.test(error.message)) continue
      throw error
    }
  }
  if (matching.length !== 1) {
    throw new Error(`StockBiz raw history table/header columns are ${matching.length === 0 ? "missing" : "ambiguous"}`)
  }
  return matching[0]
}

export function summarizeRawDailyRange(bars: StockBizRawDailyBar[]): RawDailyRangeSummary {
  if (!Array.isArray(bars) || bars.length === 0) throw new Error("Raw Daily summary requires at least one bar")
  const sorted = [...bars].sort((left, right) => left.sessionDate.localeCompare(right.sessionDate))
  const sessions = new Set(sorted.map((bar) => bar.sessionDate))
  if (sessions.size !== sorted.length) throw new Error("Raw Daily summary contains duplicate sessions")
  return {
    sessions: sorted.length,
    high: Math.max(...sorted.map((bar) => bar.high)),
    low: Math.min(...sorted.map((bar) => bar.low)),
    firstSession: sorted[0].sessionDate,
    lastSession: sorted.at(-1)!.sessionDate,
  }
}

export function buildStockBizHistoricalQuoteUrl(symbol: string, date: string) {
  const ticker = normalizeTicker(symbol)
  parseSessionDate(date)
  const url = new URL(`/Stocks/${ticker}/LookupQuote.aspx`, STOCKBIZ_BASE_URL)
  url.searchParams.set("Date", date)
  return url.toString()
}
