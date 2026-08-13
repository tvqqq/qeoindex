import { createHmac, randomUUID } from "node:crypto"
import type { OhlcvBar } from "@/lib/technical-indicators"

const DEFAULT_BASE_URL = "https://openapi.dnse.com.vn"
const DEFAULT_LOOKBACK_DAYS = 520
const DEFAULT_INTRADAY_LOOKBACK_DAYS = 180

export interface ProviderHealth {
  configured: boolean
  provider: "DNSE"
  message: string
}

function credentials() {
  const apiKey = process.env.DNSE_API_KEY ?? process.env.NEXT_PUBLIC_DNSE_API_KEY ?? ""
  const apiSecret = process.env.DNSE_API_SECRET ?? process.env.NEXT_PUBLIC_DNSE_API_SECRET ?? ""
  return { apiKey, apiSecret }
}

export function dnseProviderHealth(): ProviderHealth {
  const { apiKey, apiSecret } = credentials()
  return {
    configured: Boolean(apiKey && apiSecret),
    provider: "DNSE",
    message: apiKey && apiSecret
      ? "DNSE OpenAPI historical provider đã cấu hình."
      : "Thiếu DNSE_API_KEY / DNSE_API_SECRET trên server.",
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
  const signature = encodeURIComponent(raw)
  return {
    Date: dateValue,
    "X-Signature": `Signature keyId="${apiKey}",algorithm="hmac-sha256",headers="(request-target) date",signature="${signature}",nonce="${nonce}"`,
    "x-api-key": apiKey,
  }
}

function numberArray(value: unknown): number[] {
  return Array.isArray(value) ? value.map(Number) : []
}

function normalizePayload(raw: unknown): OhlcvBar[] {
  const payload: any = typeof raw === "string" ? JSON.parse(raw) : raw
  const source: any = payload?.data ?? payload?.result ?? payload

  if (Array.isArray(source)) {
    return source
      .map((row: any) => ({
        time: Number(row.time ?? row.t ?? row.timestamp ?? row.ts),
        open: Number(row.open ?? row.o),
        high: Number(row.high ?? row.h),
        low: Number(row.low ?? row.l),
        close: Number(row.close ?? row.c),
        volume: Number(row.volume ?? row.v ?? 0),
      }))
      .filter((bar: OhlcvBar) => [bar.time, bar.open, bar.high, bar.low, bar.close, bar.volume].every(Number.isFinite))
      .sort((a: OhlcvBar, b: OhlcvBar) => a.time - b.time)
  }

  const t = numberArray(source?.t ?? source?.time ?? source?.timestamps)
  const o = numberArray(source?.o ?? source?.open)
  const h = numberArray(source?.h ?? source?.high)
  const l = numberArray(source?.l ?? source?.low)
  const c = numberArray(source?.c ?? source?.close)
  const v = numberArray(source?.v ?? source?.volume)
  const length = Math.min(t.length, o.length, h.length, l.length, c.length, v.length || Number.POSITIVE_INFINITY)
  if (!Number.isFinite(length) || length <= 0) return []
  return Array.from({ length }, (_, i) => ({
    time: t[i], open: o[i], high: h[i], low: l[i], close: c[i], volume: v[i] ?? 0,
  })).filter((bar) => [bar.time, bar.open, bar.high, bar.low, bar.close, bar.volume].every(Number.isFinite))
}

export function vietnamDateKey(timestampMs: number) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestampMs))
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ""
  return `${value("year")}-${value("month")}-${value("day")}`
}

function marketClosedForToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(now)
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0)
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0)
  return hour > 15 || (hour === 15 && minute >= 30)
}

function removeIncompleteCurrentDailyBar(bars: OhlcvBar[], now = new Date()) {
  if (marketClosedForToday(now)) return bars
  const today = vietnamDateKey(now.getTime())
  return bars.filter((bar) => vietnamDateKey(bar.time * 1000) !== today)
}

function removeIncompleteCurrentHourlyBar(bars: OhlcvBar[], now = new Date()) {
  const nowSeconds = Math.floor(now.getTime() / 1000)
  return bars.filter((bar, index) => {
    if (index !== bars.length - 1) return true
    return bar.time + 3600 <= nowSeconds
  })
}

async function requestOhlc(symbol: string, resolution: string, from: number, to: number) {
  const { apiKey, apiSecret } = credentials()
  if (!apiKey || !apiSecret) throw new Error("DNSE server credentials are not configured")
  const path = "/price/ohlc"
  const baseUrl = (process.env.DNSE_API_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, "")
  const url = new URL(`${baseUrl}${path}`)
  url.searchParams.set("symbol", symbol)
  url.searchParams.set("resolution", resolution)
  url.searchParams.set("from", String(from))
  url.searchParams.set("to", String(to))
  url.searchParams.set("type", "STOCK")

  const response = await fetch(url, {
    headers: signatureHeaders("GET", path, apiKey, apiSecret),
    cache: "no-store",
  })
  const body = await response.text()
  if (!response.ok) throw new Error(`DNSE OHLC ${symbol} ${resolution} failed (${response.status}): ${body.slice(0, 180)}`)
  const bars = normalizePayload(body)
  if (!bars.length) throw new Error(`DNSE OHLC ${symbol} ${resolution} returned no usable bars`)
  return bars
}

export async function fetchDailyOhlcv(symbol: string, now = new Date()): Promise<OhlcvBar[]> {
  const to = Math.floor(now.getTime() / 1000)
  const from = to - DEFAULT_LOOKBACK_DAYS * 86400
  const errors: string[] = []
  for (const resolution of ["1D", "D"]) {
    try {
      const bars = await requestOhlc(symbol, resolution, from, to)
      return removeIncompleteCurrentDailyBar(bars, now)
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
    }
  }
  throw new Error(errors.join(" | "))
}

export async function fetchHourlyOhlcv(symbol: string, now = new Date()): Promise<OhlcvBar[]> {
  const to = Math.floor(now.getTime() / 1000)
  const from = to - DEFAULT_INTRADAY_LOOKBACK_DAYS * 86400
  const errors: string[] = []
  for (const resolution of ["1H", "60"]) {
    try {
      const bars = await requestOhlc(symbol, resolution, from, to)
      const completed = removeIncompleteCurrentHourlyBar(bars, now)
      if (completed.length < 2) throw new Error(`DNSE OHLC ${symbol} ${resolution} returned insufficient completed bars`)
      return completed
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
    }
  }
  throw new Error(errors.join(" | "))
}
