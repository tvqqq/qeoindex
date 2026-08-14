import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const CHANNELS = [
  { name: "tick.G1.json", symbols: ["VPB"] },
  { name: "top_price.G1.json", symbols: ["VPB"] },
  { name: "tick_extra.G1.json", symbols: ["VPB"] },
  { name: "stock_info.G1.json", symbols: ["VPB"] },
  { name: "stock_info.G1", symbols: ["VPB"] },
  { name: "ohlc.1.G1.json", symbols: ["VPB"] },
  { name: "ohlc.stock.1.G1.json", symbols: ["VPB"] },
  { name: "ohlc.G1.1.json", symbols: ["VPB"] },
  { name: "foreign.G1.json", symbols: ["VPB"] },
  { name: "foreign_trade.G1.json", symbols: ["VPB"] },
  { name: "foreign_room.G1.json", symbols: ["VPB"] },
  { name: "foreign_info.G1.json", symbols: ["VPB"] },
]

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
    let settled = false

    const finish = (status = 200) => {
      if (settled) return
      settled = true
      try { socket.close(1000, "probe complete") } catch {}
      const summary = messages.map((message) => ({
        T: message.T,
        action: message.action ?? message.a,
        symbol: message.symbol,
        keys: Object.keys(message).sort(),
        sample: message,
      }))
      resolve(NextResponse.json({ ok: status === 200, channels: CHANNELS.map((channel) => channel.name), messages: summary }, {
        status,
        headers: { "Cache-Control": "no-store" },
      }))
    }

    const timer = setTimeout(() => finish(messages.length ? 200 : 504), 12_000)
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
        return
      }
      if (String(data.symbol ?? "").toUpperCase() === "VPB") {
        messages.push(data)
        if (messages.length >= 30) {
          clearTimeout(timer)
          finish(200)
        }
      }
    }
    socket.onerror = () => { clearTimeout(timer); finish(messages.length ? 200 : 502) }
    socket.onclose = () => { clearTimeout(timer); finish(messages.length ? 200 : 502) }
  })
}
