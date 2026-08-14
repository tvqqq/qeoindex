import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 30

const SYMBOLS = ["VPB", "TCB"]
const CHANNEL_NAMES = [
  "tick.G1.json",
  "top_price.G1.json",
  "tick_extra.G1.json",
  "stock_info.G1.json",
  "stockinfo.G1.json",
  "stockInfo.G1.json",
  "stock.G1.json",
  "si.G1.json",
  "ohlc.G1.json",
  "ohlc.1.G1.json",
  "ohlc.stock.1.G1.json",
  "ohlc.G1.1.json",
  "ohlc.1.json",
  "ohlc.1m.G1.json",
  "ohlc_1m.G1.json",
  "candle.1.G1.json",
  "bar.1.G1.json",
  "foreign.G1.json",
  "foreign_trade.G1.json",
  "foreign_room.G1.json",
  "foreign_info.G1.json",
  "foreigntrading.G1.json",
  "foreign_trading.G1.json",
  "foreign_room_info.G1.json",
]
const CHANNELS = CHANNEL_NAMES.map((name) => ({ name, symbols: SYMBOLS }))

export async function GET() {
  const authResponse = await fetch("https://stockos-beryl.vercel.app/api/market/stream-auth", {
    cache: "no-store",
    headers: { Accept: "application/json" },
  })
  const authJson = await authResponse.json() as { ok?: boolean; url?: string; auth?: Record<string, unknown>; message?: string }
  if (!authResponse.ok || !authJson.ok || !authJson.url || !authJson.auth) {
    return NextResponse.json({ ok: false, message: authJson.message ?? `auth ${authResponse.status}` }, { status: 502 })
  }

  return new Promise<Response>((resolve) => {
    const socket = new WebSocket(authJson.url!)
    const messages: Record<string, unknown>[] = []
    const typeCounts: Record<string, number> = {}
    let settled = false

    const finish = (status = 200) => {
      if (settled) return
      settled = true
      try { socket.close(1000, "probe complete") } catch {}
      const unique = new Map<string, Record<string, unknown>>()
      for (const message of messages) {
        const type = String(message.T ?? message.action ?? message.a ?? "unknown")
        const keys = Object.keys(message).sort().join(",")
        const key = `${type}:${String(message.symbol ?? "")}:${keys}`
        if (!unique.has(key)) unique.set(key, message)
      }
      const summary = [...unique.values()].map((message) => ({
        T: message.T,
        action: message.action ?? message.a,
        symbol: message.symbol,
        keys: Object.keys(message).sort(),
        sample: message,
      }))
      resolve(NextResponse.json({
        ok: status === 200,
        channels: CHANNEL_NAMES,
        typeCounts,
        uniqueMessages: summary,
      }, { status, headers: { "Cache-Control": "no-store" } }))
    }

    const timer = setTimeout(() => finish(messages.length ? 200 : 504), 22_000)
    socket.onmessage = (event) => {
      if (typeof event.data !== "string") return
      let data: Record<string, unknown>
      try { data = JSON.parse(event.data) as Record<string, unknown> } catch { return }
      const action = String(data.action ?? data.a ?? "")
      if (action === "ping") {
        socket.send(JSON.stringify({ action: "pong", timestamp: data.timestamp }))
        return
      }
      if (action === "welcome" || data.session_id || data.sid) {
        socket.send(JSON.stringify(authJson.auth))
        return
      }
      if (action === "auth_success") {
        socket.send(JSON.stringify({ action: "subscribe", channels: CHANNELS }))
        return
      }
      if (action === "auth_error" || action === "error") {
        messages.push(data)
        typeCounts[action || "error"] = (typeCounts[action || "error"] ?? 0) + 1
        return
      }
      const symbol = String(data.symbol ?? "").toUpperCase()
      if (SYMBOLS.includes(symbol)) {
        messages.push(data)
        const type = String(data.T ?? "unknown")
        typeCounts[type] = (typeCounts[type] ?? 0) + 1
      }
    }
    socket.onerror = () => { clearTimeout(timer); finish(messages.length ? 200 : 502) }
    socket.onclose = () => { clearTimeout(timer); finish(messages.length ? 200 : 502) }
  })
}
