import "server-only"

import { createHmac, randomUUID } from "node:crypto"

const DEFAULT_BASE_URL = "https://openapi.dnse.com.vn"
const VIETNAM_TZ = "Asia/Ho_Chi_Minh"

export interface DnseIntradayPoint {
  time: number
  close: number
}

export interface DnseForeignTradingSnapshot {
  symbol: string
  buyVolume: number | null
  sellVolume: number | null
  buyValue: number | null
  sellValue: number | null
  currentRoom: number | null
  totalRoom: number | null
  updatedAt: string
  sourceKeys: string[]
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

function vietnamDateKey(timestampMs: number) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: VIETNAM_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestampMs))
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ""
  return `${value("year")}-${value("month")}-${value("day")}`
}

function numberArray(value: unknown): number[] {
  return Array.isArray(value) ? value.map(Number) : []
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

export async function fetchDnseMinuteHistory(symbol: string, now = new Date(), maxPoints = 90) {
  const ticker = symbol.trim().toUpperCase()
  if (!/^[A-Z0-9]{2,12}$/.test(ticker)) throw new Error("Invalid DNSE symbol")
  const to = Math.floor(now.getTime() / 1000)
  const from = to - 8 * 3600
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
    .slice(-Math.max(20, Math.min(maxPoints, 180)))
}

function unwrapObject(raw: unknown): Record<string, unknown> {
  const payload: any = raw
  const source = payload?.data ?? payload?.result ?? payload
  if (Array.isArray(source)) return (source.find((item) => item && typeof item === "object") ?? {}) as Record<string, unknown>
  return source && typeof source === "object" ? source as Record<string, unknown> : {}
}

function normalizedKey(key: string) {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "")
}

function finiteNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function findField(source: Record<string, unknown>, aliases: string[], pattern?: RegExp) {
  const entries = Object.entries(source)
  const aliasSet = new Set(aliases.map(normalizedKey))
  for (const [key, value] of entries) {
    if (aliasSet.has(normalizedKey(key))) {
      const parsed = finiteNumber(value)
      if (parsed !== null) return parsed
    }
  }
  if (pattern) {
    for (const [key, value] of entries) {
      if (pattern.test(normalizedKey(key))) {
        const parsed = finiteNumber(value)
        if (parsed !== null) return parsed
      }
    }
  }
  return null
}

export async function fetchDnseForeignTrading(symbol: string): Promise<DnseForeignTradingSnapshot> {
  const ticker = symbol.trim().toUpperCase()
  if (!/^[A-Z0-9]{2,12}$/.test(ticker)) throw new Error("Invalid DNSE symbol")
  const raw = await signedGet(`/price/${encodeURIComponent(ticker)}/foreign-trading`)
  const source = unwrapObject(raw)

  const buyVolume = findField(source,
    ["buyVolume", "buyQty", "buyQuantity", "foreignBuyVolume", "foreignBuyQty", "foreignBuyQuantity", "foreignBuyVolumeTotal", "buyForeignQuantity"],
    /foreign.*buy.*(volume|qty|quantity)|(buy.*foreign.*(volume|qty|quantity))/)
  const sellVolume = findField(source,
    ["sellVolume", "sellQty", "sellQuantity", "foreignSellVolume", "foreignSellQty", "foreignSellQuantity", "foreignSellVolumeTotal", "sellForeignQuantity"],
    /foreign.*sell.*(volume|qty|quantity)|(sell.*foreign.*(volume|qty|quantity))/)
  const buyValue = findField(source,
    ["buyValue", "buyAmount", "foreignBuyValue", "foreignBuyAmount", "foreignBuyValueTotal", "buyForeignValue"],
    /foreign.*buy.*(value|amount)|(buy.*foreign.*(value|amount))/)
  const sellValue = findField(source,
    ["sellValue", "sellAmount", "foreignSellValue", "foreignSellAmount", "foreignSellValueTotal", "sellForeignValue"],
    /foreign.*sell.*(value|amount)|(sell.*foreign.*(value|amount))/)
  const currentRoom = findField(source,
    ["currentRoom", "remainingRoom", "remainRoom", "foreignCurrentRoom", "foreignRemainingRoom", "availableRoom"],
    /(foreign.*(current|remain|remaining|available).*room)|((current|remain|remaining|available).*foreign.*room)/)
  const totalRoom = findField(source,
    ["totalRoom", "foreignTotalRoom", "maxRoom", "foreignMaxRoom"],
    /(foreign.*(total|max).*room)|((total|max).*foreign.*room)/)

  return {
    symbol: ticker,
    buyVolume,
    sellVolume,
    buyValue,
    sellValue,
    currentRoom,
    totalRoom,
    updatedAt: new Date().toISOString(),
    sourceKeys: Object.keys(source).sort(),
  }
}
