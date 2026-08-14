import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  const authResponse = await fetch("https://stockos-beryl.vercel.app/api/market/stream-auth", {
    cache: "no-store",
    headers: { Accept: "application/json" },
  })
  const authJson = await authResponse.json() as {
    ok?: boolean
    url?: string
    auth?: Record<string, unknown>
    message?: string
  }

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
      resolve(NextResponse.json({ ok: status === 200, messages }, { status, headers: { "Cache-Control": "no-store" } }))
    }

    const timer = setTimeout(() => finish(messages.length ? 200 : 504), 8_000)

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
        socket.send(JSON.stringify({
          action: "subscribe",
          channels: [
            { name: "tick.G1.json", symbols: ["TCB"] },
            { name: "top_price.G1.json", symbols: ["TCB"] },
          ],
        }))
        return
      }
      if (action === "auth_error" || action === "error") {
        clearTimeout(timer)
        messages.push({ action, message: data.message ?? data.msg })
        finish(502)
        return
      }

      const type = String(data.T ?? "")
      if ((type === "t" || type === "q") && String(data.symbol ?? "").toUpperCase() === "TCB") {
        messages.push(data)
        if (messages.some((item) => item.T === "t") && messages.some((item) => item.T === "q")) {
          clearTimeout(timer)
          finish(200)
        }
      }
    }

    socket.onerror = () => {
      clearTimeout(timer)
      finish(502)
    }
  })
}
