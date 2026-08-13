import { createHmac, randomUUID } from "node:crypto"

const DEFAULT_BASE_URL = "https://openapi.dnse.com.vn"

export interface MarketDepthLevel {
  price: number
  volume: number
}

export interface MarketTrade {
  id: string
  time: string
  price: number
  volume: number
  side: "BUY" | "SELL" | "UNKNOWN"
}

export interface MarketOrderBookSnapshot {
  symbol: string
  bids: MarketDepthLevel[]
  asks: MarketDepthLevel[]
  trades: MarketTrade[]
  provider: "DNSE OpenAPI"
  updatedAt: string
  partial: boolean
  warnings: string[]
}

function credentials() {
  return {
    apiKey: process.env.DNSE_API_KEY ?? process.env.NEXT_PUBLIC_DNSE_API_KEY ?? "",
    apiSecret: process.env.DNSE_API_SECRET ?? process.env.NEXT_PUBLIC_DNSE_API_SECRET ?? "",
  }
}

function formatDateHeader(date: Date) {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
  const pad = (value: number) => String(value).padStart(2, "0")
  return `${days[date.getUTCDay()]}, ${pad(date.getUTCDate())} ${months[date.getUTCMonth()]} ${date.getUTCFullYear()} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} +0000`
}

function signatureHeaders(method: string, path: string, apiKey: string, apiSecret: string) {
  const dateValue = formatDateHeader(new Date())
  const nonce = randomUUID().replaceAll("-", "")
  const signingString = `(request-target): ${method.toLowerCase()} ${path}\ndate: ${dateValue}\nnonce: ${nonce}`
  const raw = createHmac("sha256", Buffer.from(apiSecret, "utf8")).update(signingString, "utf8").digest("base64")
  return {
    Date: dateValue,
    "X-Signature": `Signature keyId="${apiKey}",algorithm="hmac-sha256",headers="(request-target) date",signature="${encodeURIComponent(raw)}",nonce="${nonce}"`,
    "x-api-key": apiKey,
    Accept: "application/json",
  }
}

async function dnseGet(path: string, query?: Record<string, string>) {
  const { apiKey, apiSecret } = credentials()
  if (!apiKey || !apiSecret) throw new Error("DNSE server credentials are not configured")

  const baseUrl = (process.env.DNSE_API_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, "")
  const url = new URL(`${baseUrl}${path}`)
  for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, value)

  const response = await fetch(url, {
    headers: signatureHeaders("GET", path, apiKey, apiSecret),
    cache: "no-store",
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`DNSE ${path} failed (${response.status}): ${text.slice(0, 220)}`)
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`DNSE ${path} returned invalid JSON`)
  }
}

function num(value: unknown) {
  const result = typeof value === "number" ? value : Number(value)
  return Number.isFinite(result) ? result : 0
}

function sourceObject(raw: any) {
  return raw?.data ?? raw?.result ?? raw
}

function levelFromRow(row: any): MarketDepthLevel | null {
  if (Array.isArray(row)) {
    const price = num(row[0])
    const volume = num(row[1])
    return price > 0 && volume >= 0 ? { price, volume } : null
  }
  const price = num(row?.price ?? row?.p ?? row?.bidPrice ?? row?.askPrice ?? row?.offerPrice)
  const volume = num(row?.volume ?? row?.qty ?? row?.qtty ?? row?.quantity ?? row?.bidQtty ?? row?.askQtty ?? row?.offerQtty)
  return price > 0 && volume >= 0 ? { price, volume } : null
}

function normalizeDepth(raw: any) {
  const source = sourceObject(raw)
  const directBids = source?.bids ?? source?.bid ?? source?.buy ?? source?.buyOrders
  const directAsks = source?.asks ?? source?.ask ?? source?.offers ?? source?.sell ?? source?.sellOrders

  let bids = Array.isArray(directBids) ? directBids.map(levelFromRow).filter(Boolean) as MarketDepthLevel[] : []
  let asks = Array.isArray(directAsks) ? directAsks.map(levelFromRow).filter(Boolean) as MarketDepthLevel[] : []

  if (!bids.length || !asks.length) {
    const bidLevels: MarketDepthLevel[] = []
    const askLevels: MarketDepthLevel[] = []
    for (let i = 1; i <= 10; i += 1) {
      const bidPrice = num(source?.[`bidPrice${i}`] ?? source?.[`bid_price_${i}`])
      const bidVolume = num(source?.[`bidQtty${i}`] ?? source?.[`bidQty${i}`] ?? source?.[`bidVolume${i}`] ?? source?.[`bid_volume_${i}`])
      const askPrice = num(source?.[`offerPrice${i}`] ?? source?.[`askPrice${i}`] ?? source?.[`offer_price_${i}`] ?? source?.[`ask_price_${i}`])
      const askVolume = num(source?.[`offerQtty${i}`] ?? source?.[`askQtty${i}`] ?? source?.[`askQty${i}`] ?? source?.[`offerVolume${i}`] ?? source?.[`ask_volume_${i}`])
      if (bidPrice > 0) bidLevels.push({ price: bidPrice, volume: bidVolume })
      if (askPrice > 0) askLevels.push({ price: askPrice, volume: askVolume })
    }
    if (!bids.length) bids = bidLevels
    if (!asks.length) asks = askLevels
  }

  return {
    bids: bids.sort((a, b) => b.price - a.price).slice(0, 10),
    asks: asks.sort((a, b) => a.price - b.price).slice(0, 10),
  }
}

function normalizeSide(value: unknown): MarketTrade["side"] {
  const side = String(value ?? "").toUpperCase()
  if (["BUY", "B", "MUA", "1", "BU"].includes(side)) return "BUY"
  if (["SELL", "S", "BÁN", "BAN", "2", "SD"].includes(side)) return "SELL"
  return "UNKNOWN"
}

function normalizeTime(value: unknown) {
  if (typeof value === "number") {
    const millis = value > 10_000_000_000 ? value : value * 1000
    return new Date(millis).toISOString()
  }
  const text = String(value ?? "")
  if (!text) return new Date().toISOString()
  const parsed = Date.parse(text)
  if (Number.isFinite(parsed)) return new Date(parsed).toISOString()
  return text
}

function normalizeTrades(raw: any): MarketTrade[] {
  const source = sourceObject(raw)
  const rows = Array.isArray(source)
    ? source
    : Array.isArray(source?.items)
      ? source.items
      : Array.isArray(source?.trades)
        ? source.trades
        : source && typeof source === "object"
          ? [source]
          : []

  return rows.map((row: any, index: number) => {
    const price = num(row?.price ?? row?.matchPrice ?? row?.matchedPrice ?? row?.p)
    const volume = num(row?.volume ?? row?.matchQtty ?? row?.matchedQtty ?? row?.quantity ?? row?.qty ?? row?.q)
    const rawTime = row?.time ?? row?.tradeTime ?? row?.matchedTime ?? row?.timestamp ?? row?.createdAt ?? row?.tradingTime
    const time = normalizeTime(rawTime)
    const id = String(row?.id ?? row?.tradeId ?? row?.matchId ?? `${time}-${price}-${volume}-${index}`)
    return {
      id,
      time,
      price,
      volume,
      side: normalizeSide(row?.side ?? row?.matchSide ?? row?.matchedBy ?? row?.matchType ?? row?.type),
    }
  }).filter((trade) => trade.price > 0 && trade.volume >= 0)
}

function vietnamDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now)
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ""
  return `${read("year")}-${read("month")}-${read("day")}`
}

export async function fetchMarketOrderBook(symbol: string): Promise<MarketOrderBookSnapshot> {
  const normalizedSymbol = symbol.trim().toUpperCase()
  if (!/^[A-Z0-9]{2,8}$/.test(normalizedSymbol)) throw new Error("Invalid symbol")

  const warnings: string[] = []
  let bids: MarketDepthLevel[] = []
  let asks: MarketDepthLevel[] = []
  let trades: MarketTrade[] = []

  try {
    const depthRaw = await dnseGet(`/price/${normalizedSymbol}/quotes/latest`)
    const depth = normalizeDepth(depthRaw)
    bids = depth.bids
    asks = depth.asks
    if (!bids.length && !asks.length) warnings.push("DNSE trả dữ liệu bid/ask nhưng không có level khả dụng.")
  } catch (error) {
    warnings.push(error instanceof Error ? error.message : String(error))
  }

  try {
    const today = vietnamDate()
    const tradesRaw = await dnseGet(`/price/${normalizedSymbol}/trades`, {
      fromDate: today,
      toDate: today,
      limit: "40",
      order: "DESC",
    })
    trades = normalizeTrades(tradesRaw).slice(0, 40)
  } catch (historyError) {
    warnings.push(historyError instanceof Error ? historyError.message : String(historyError))
    try {
      const latestRaw = await dnseGet(`/price/${normalizedSymbol}/trades/latest`)
      trades = normalizeTrades(latestRaw).slice(0, 1)
    } catch (latestError) {
      warnings.push(latestError instanceof Error ? latestError.message : String(latestError))
    }
  }

  return {
    symbol: normalizedSymbol,
    bids,
    asks,
    trades,
    provider: "DNSE OpenAPI",
    updatedAt: new Date().toISOString(),
    partial: !bids.length || !asks.length || !trades.length,
    warnings,
  }
}
