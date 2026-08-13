import "server-only"
import { createHmac } from "node:crypto"

import type { LiveQuote } from "@/lib/signal-engine"

const WS_URL = process.env.DNSE_WS_URL ?? "wss://ws-openapi.dnse.com.vn/v1/stream?encoding=json"

export interface LiveSnapshotResult {
  provider: "DNSE"
  quotes: Record<string, LiveQuote>
  vnindex: number | null
  startedAt: string
  completedAt: string
  detail: string
}

function credentials() {
  const apiKey = process.env.DNSE_API_KEY ?? ""
  const apiSecret = process.env.DNSE_API_SECRET ?? ""
  if (!apiKey || !apiSecret) throw new Error("DNSE_API_KEY / DNSE_API_SECRET are not configured server-side")
  return { apiKey, apiSecret }
}

function authPayload(apiKey: string, apiSecret: string) {
  const timestamp = Math.floor(Date.now() / 1000)
  const nonce = (Date.now() * 1000).toString()
  const raw = `${apiKey}:${timestamp}:${nonce}`
  const signature = createHmac("sha256", apiSecret).update(raw).digest("hex")
  return { action: "auth", api_key: apiKey, signature, timestamp, nonce }
}

export async function fetchDnseLiveSnapshot(symbols: string[], timeoutMs = 5500): Promise<LiveSnapshotResult> {
  const requested = [...new Set(symbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean))]
  if (!requested.length) return { provider: "DNSE", quotes: {}, vnindex: null, startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), detail: "No symbols requested" }
  const { apiKey, apiSecret } = credentials()
  if (typeof WebSocket === "undefined") throw new Error("WebSocket runtime is unavailable")

  const startedAt = new Date().toISOString()
  return await new Promise<LiveSnapshotResult>((resolve, reject) => {
    const quotes: Record<string, LiveQuote> = {}
    let vnindex: number | null = null
    let settled = false
    let authenticated = false
    const ws = new WebSocket(WS_URL)

    const finish = (detail: string) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { ws.close(1000, "snapshot complete") } catch {}
      resolve({ provider: "DNSE", quotes, vnindex, startedAt, completedAt: new Date().toISOString(), detail })
    }

    const timer = setTimeout(() => finish(`Snapshot timeout ${timeoutMs}ms; received ${Object.keys(quotes).length}/${requested.length} symbol ticks`), timeoutMs)

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(typeof event.data === "string" ? event.data : String(event.data))
        if (data.action === "welcome") {
          ws.send(JSON.stringify(authPayload(apiKey, apiSecret)))
          return
        }
        if (data.action === "auth_success") {
          authenticated = true
          ws.send(JSON.stringify({
            action: "subscribe",
            channels: [
              { name: "tick.G1.json", symbols: requested },
              { name: "market_index.VNINDEX.json" },
            ],
          }))
          return
        }
        if (data.action === "ping") {
          ws.send(JSON.stringify({ action: "pong", timestamp: data.timestamp }))
          return
        }
        if (data.action === "error") {
          if (!authenticated) {
            settled = true
            clearTimeout(timer)
            try { ws.close() } catch {}
            reject(new Error(`DNSE WS auth/subscription error: ${data.code ?? ""} ${data.message ?? "unknown"}`))
          }
          return
        }
        if (data.T === "t" && data.symbol) {
          const ticker = String(data.symbol).toUpperCase()
          const price = Number(data.matchPrice ?? 0)
          const totalVolume = Number(data.totalVolumeTraded ?? 0)
          if (price > 0) quotes[ticker] = { ticker, price, totalVolume: Math.max(0, totalVolume), timestamp: Date.now() }
        } else if (data.T === "mi" && String(data.indexName ?? "").toUpperCase() === "VNINDEX") {
          const value = Number(data.valueIndexes ?? 0)
          if (value > 0) vnindex = value
        }
        if (Object.keys(quotes).length === requested.length && vnindex != null) finish(`Received all ${requested.length} symbol ticks + VNINDEX`)
      } catch {
        // Ignore malformed/non-data frames and keep collecting until timeout.
      }
    }

    ws.onerror = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { ws.close() } catch {}
      reject(new Error("DNSE WS connection failed"))
    }

    ws.onclose = () => {
      if (!settled) finish(`DNSE WS closed; received ${Object.keys(quotes).length}/${requested.length} symbol ticks`)
    }
  })
}
