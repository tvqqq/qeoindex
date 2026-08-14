import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 30

const PROBE_VERSION = 3
const SYMBOLS = ["VPB", "TCB", "MBB", "SSI", "VIX", "SHB"]
const CHANNELS = [
  { name: "tick_extra.G1.json", symbols: SYMBOLS },
  { name: "tick.G1.json", symbols: SYMBOLS },
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
    const typeCounts: Record<string, number> = {}
    let settled = false

    const finish = (status = 200) => {
      if (settled) return
      settled = true
      try { socket.close(1000, "probe complete") } catch {}
      const byShape = new Map<string, Record<string, unknown>>()
      for (const message of messages) {
        const type = String(message.T ?? message.action ?? message.a ?? "unknown")
        const key = `${type}:${Object.keys(message).sort().join(",")}`
        if (!byShape.has(key)) byShape.set(key, message)
      }
      resolve(NextResponse.json({
        ok: status === 200,
        probeVersion: PROBE_VERSION,
        typeCounts,
        uniqueShapes: [...byShape.values()].map((message) => ({
          T: message.T,
          symbol: message.symbol,
          keys: Object.keys(message).sort(),
          sample: message,
        })),
      }, { status, headers: { "Cache-Control": "no-store" } }))
    }

    const timer = setTimeout(() => finish(messages.length ? 200 : 504), 20_000)
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
      if (!SYMBOLS.includes(symbol)) return
      const type = String(data.T ?? "unknown")
      typeCounts[type] = (typeCounts[type] ?? 0) + 1
      messages.push(data)
      if ((typeCounts.te ?? 0) >= 10 && (typeCounts.t ?? 0) >= 3) {
        clearTimeout(timer)
        finish(200)
      }
    }
    socket.onerror = () => { clearTimeout(timer); finish(messages.length ? 200 : 502) }
    socket.onclose = () => { clearTimeout(timer); finish(messages.length ? 200 : 502) }
  })
}
