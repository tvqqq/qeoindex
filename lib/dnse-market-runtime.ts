import "server-only"

import { createHmac, randomUUID } from "node:crypto"

const DEFAULT_BASE_URL = "https://openapi.dnse.com.vn"
const VIETNAM_TZ = "Asia/Ho_Chi_Minh"

export interface DnseIntradayPoint {
  time: number
  close: number
}

export interface DnseSessionTrade {
  id: string
  time: number
  price: number
  volume: number
  side: string
}

export interface DnseSessionQuote {
  time: number | null
  bid: unknown[]
  offer: unknown[]
  matchPrice: number | null
  openPrice: number | null
}

export interface DnseSessionHistory {
  symbol: string
  sessionStart: number
  generatedAt: string
  prices: DnseIntradayPoint[]
  trades: DnseSessionTrade[]
  tradesTruncated: boolean
  latestQuote: DnseSessionQuote | null
}

function credentials() {
  const apiKey = process.env.DNSE_API_KEY ?? ""
  const apiSecret = process.env.DNSE_API_SECRET ?? ""
  if (!apiKey || !apiSecret) throw new Error("DNSE server credentials are not configured")
  return { apiKey, apiSecret }
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
  const signature = encodeURIComponent(raw)
  return {
    Date: dateValue,
    "X-Signature": `Signature keyId="${apiKey}",algorithm="hmac-sha256",headers="(request-target) date",signature="${signature}",nonce="${nonce}"`,
    "x-api-key": apiKey,
  }
}

async function signedGet(path: string, params?: Record<string, string | number | undefined>) {
  const { apiKey, apiSecret } = credentials()
  const baseUrl = (process.env.DNSE_API_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, "")
  const url = new URL(`${baseUrl}${path}`)
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value))
  }
  const response = await fetch(url, {
    headers: signatureHeaders("GET", path, apiKey, apiSecret),
    cache: "no-store",
    signal: AbortSignal.timeout(7_000),
  })
  const body = await response.text()
  if (!response.ok) throw new Error(`DNSE ${path} failed (${response.status}): ${body.slice(0, 180)}`)
  try {
    return JSON.parse(body) as unknown
  } catch {
    throw new Error(`DNSE ${path} returned invalid JSON`)
  }
}

function vietnamDateParts(timestampMs: number) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: VIETNAM_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestampMs))
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ""
  return { year: Number(value("year")), month: Number(value("month")), day: Number(value("day")) }
}

function vietnamDateKey(timestampMs: number) {
  const { year, month, day } = vietnamDateParts(timestampMs)
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

function vietnamSessionStart(now: Date) {
  const { year, month, day } = vietnamDateParts(now.getTime())
  // Vietnam is UTC+7 year-round. 09:00 ICT = 02:00 UTC.
  return Math.floor(Date.UTC(year, month - 1, day, 2, 0, 0) / 1000)
}

function numberArray(value: unknown): number[] {
  return Array.isArray(value) ? value.map(Number) : []
}

function finiteNumber(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function timestampSeconds(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value > 10_000_000_000 ? value / 1000 : value
  if (value && typeof value === "object") {
    const data = value as Record<string, unknown>
    const seconds = finiteNumber(data.Seconds ?? data.seconds)
    if (seconds && seconds > 0) return seconds
  }
  const text = String(value ?? "").trim()
  if (!text) return null
  const numeric = Number(text)
  if (Number.isFinite(numeric)) return numeric > 10_000_000_000 ? numeric / 1000 : numeric
  const millis = Date.parse(text)
  return Number.isFinite(millis) ? millis / 1000 : null
}

function normalizeIntraday(raw: unknown): DnseIntradayPoint[] {
  const payload: any = raw
  const source: any = payload?.data ?? payload?.result ?? payload
  let points: DnseIntradayPoint[] = []

  if (Array.isArray(source)) {
    points = source.map((row: any) => ({
      time: Number(row?.time ?? row?.t ?? row?.timestamp ?? row?.ts),
      close: Number(row?.close ?? row?.c),
    }))
  } else {
    const times = numberArray(source?.t ?? source?.time ?? source?.timestamps)
    const closes = numberArray(source?.c ?? source?.close)
    const length = Math.min(times.length, closes.length)
    points = Array.from({ length }, (_, index) => ({ time: times[index], close: closes[index] }))
  }

  return points
    .filter((point) => Number.isFinite(point.time) && point.time > 0 && Number.isFinite(point.close) && point.close > 0)
    .sort((a, b) => a.time - b.time)
}

function pageRows(raw: unknown, preferredKey: "trades" | "quotes") {
  const payload: any = raw
  const source: any = payload?.data ?? payload?.result ?? payload
  const candidates = [source?.[preferredKey], source?.items, source?.rows, source, payload?.[preferredKey], payload?.items]
  const rows = candidates.find((value) => Array.isArray(value)) ?? []
  const nextPageToken = String(source?.nextPageToken ?? source?.next_page_token ?? payload?.nextPageToken ?? payload?.next_page_token ?? "").trim()
  return { rows: rows as any[], nextPageToken: nextPageToken || null }
}

function normalizeTrade(row: any, index: number): DnseSessionTrade | null {
  const price = finiteNumber(row?.matchPrice ?? row?.price ?? row?.lastPrice)
  const volume = finiteNumber(row?.matchQtty ?? row?.quantity ?? row?.qtty ?? row?.volume)
  const time = timestampSeconds(row?.transactTime ?? row?.time ?? row?.timestamp ?? row?.ts)
  if (!price || price <= 0 || !volume || volume <= 0 || !time || time <= 0) return null
  const side = String(row?.side ?? row?.matchSide ?? row?.aggressorSide ?? "")
  const sourceId = String(row?.id ?? row?.tradeId ?? row?.seqNo ?? row?.sequence ?? "").trim()
  return {
    id: sourceId || `rest-${Math.round(time * 1000)}-${price}-${volume}-${side}-${index}`,
    time,
    price,
    volume,
    side,
  }
}

function normalizeLatestQuote(raw: unknown): DnseSessionQuote | null {
  const payload: any = raw
  const source: any = payload?.data ?? payload?.result ?? payload
  const row: any = Array.isArray(source) ? source[0] : source?.quote ?? source?.item ?? source
  if (!row || typeof row !== "object") return null
  const bid = Array.isArray(row.bid) ? row.bid : Array.isArray(row.bids) ? row.bids : []
  const offer = Array.isArray(row.offer) ? row.offer : Array.isArray(row.asks) ? row.asks : []
  return {
    time: timestampSeconds(row?.transactTime ?? row?.time ?? row?.timestamp ?? row?.ts),
    bid,
    offer,
    matchPrice: finiteNumber(row?.matchPrice ?? row?.price ?? row?.lastPrice),
    openPrice: finiteNumber(row?.openPrice ?? row?.openingPrice ?? row?.open),
  }
}

export async function fetchDnseMinuteHistory(symbol: string, now = new Date(), maxPoints = 90) {
  const ticker = symbol.trim().toUpperCase()
  if (!/^[A-Z0-9]{2,12}$/.test(ticker)) throw new Error("Invalid DNSE symbol")
  const to = Math.floor(now.getTime() / 1000)
  const from = vietnamSessionStart(now)
  const raw = await signedGet("/price/ohlc", {
    symbol: ticker,
    resolution: "1",
    from,
    to,
    type: "STOCK",
  })
  const today = vietnamDateKey(now.getTime())
  return normalizeIntraday(raw)
    .filter((point) => vietnamDateKey(point.time * 1000) === today)
    .slice(-Math.max(20, Math.min(maxPoints, 360)))
}

async function fetchDnseSessionTrades(symbol: string, now: Date, maxRows = 6_000) {
  const from = vietnamSessionStart(now)
  const to = Math.floor(now.getTime() / 1000)
  const rows: DnseSessionTrade[] = []
  let nextPageToken: string | null = null
  let page = 0
  let truncated = false

  do {
    const raw = await signedGet(`/price/${symbol}/trades`, {
      boardId: "G1",
      from,
      to,
      limit: 500,
      order: "ASC",
      nextPageToken: nextPageToken ?? undefined,
    })
    const parsed = pageRows(raw, "trades")
    for (let index = 0; index < parsed.rows.length; index += 1) {
      const trade = normalizeTrade(parsed.rows[index], page * 500 + index)
      if (trade) rows.push(trade)
      if (rows.length >= maxRows) {
        truncated = Boolean(parsed.nextPageToken) || index < parsed.rows.length - 1
        break
      }
    }
    nextPageToken = rows.length >= maxRows ? null : parsed.nextPageToken
    page += 1
  } while (nextPageToken && page < 20)

  if (nextPageToken) truncated = true
  rows.sort((a, b) => a.time - b.time)
  return { rows, truncated }
}

async function fetchDnseLatestQuote(symbol: string) {
  try {
    return normalizeLatestQuote(await signedGet(`/price/${symbol}/quotes/latest`, { boardId: "G1" }))
  } catch {
    const raw = await signedGet(`/price/${symbol}/quotes`, { boardId: "G1", limit: 1, order: "DESC" })
    return normalizeLatestQuote(raw)
  }
}

export async function fetchDnseSessionHistory(symbol: string, now = new Date()): Promise<DnseSessionHistory> {
  const ticker = symbol.trim().toUpperCase()
  if (!/^[A-Z0-9]{2,12}$/.test(ticker)) throw new Error("Invalid DNSE symbol")

  const [prices, tradeResult, latestQuote] = await Promise.all([
    fetchDnseMinuteHistory(ticker, now, 360),
    fetchDnseSessionTrades(ticker, now),
    fetchDnseLatestQuote(ticker),
  ])

  return {
    symbol: ticker,
    sessionStart: vietnamSessionStart(now),
    generatedAt: now.toISOString(),
    prices,
    trades: tradeResult.rows,
    tradesTruncated: tradeResult.truncated,
    latestQuote,
  }
}
