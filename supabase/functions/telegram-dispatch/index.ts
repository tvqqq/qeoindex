import { authorize, db, json, retryPatch } from "../_shared/outbox.ts"

type Notification = { id: string; event_id: string; attempt_count: number; payload: Record<string, unknown> }

function number(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed.toLocaleString("en-US", { maximumFractionDigits: 2 }) : "—"
}

function message(event: Record<string, unknown>, payload: Record<string, unknown>) {
  if (typeof payload.message === "string" && payload.message.trim()) return payload.message.trim()
  return [
    `StockOS ${event.event_type} · ${event.ticker}`,
    `Giá: ${number(event.price)} | VNINDEX: ${number(event.vnindex)}`,
    `Lý do: ${event.rule}`,
    `Engine: ${event.engine_version}`,
  ].join("\n")
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405)
  if (!authorize(request)) return json({ ok: false, error: "Unauthorized" }, 401)
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? ""
  const chatId = Deno.env.get("TELEGRAM_CHAT_ID") ?? ""
  const apiBase = (Deno.env.get("TELEGRAM_API_BASE_URL")?.trim() || "https://api.telegram.org").replace(/\/$/, "")
  if (!token || !chatId) return json({ ok: false, error: "Telegram is not configured" }, 503)

  try {
    const body = await request.json().catch(() => ({})) as { limit?: number }
    const limit = Math.max(1, Math.min(Number(body.limit) || 10, 25))
    const claimed = (await db("rpc/claim_notification_outbox", { method: "POST", body: JSON.stringify({ p_limit: limit }) }) ?? []) as Notification[]
    let sent = 0
    const failures: Array<{ id: string; error: string }> = []
    for (const item of claimed) {
      try {
        const rows = await db(`signal_events?id=eq.${item.event_id}&select=*`)
        if (!rows?.[0]) throw new Error("Signal event not found")
        const result = await fetch(`${apiBase}/bot${token}/sendMessage`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text: message(rows[0], item.payload), disable_web_page_preview: true }),
        })
        const payload = await result.json()
        if (!result.ok || !payload.ok) throw new Error(`Telegram send failed (${result.status}): ${String(payload.description ?? "unknown")}`)
        await db(`notification_outbox?id=eq.${item.id}`, { method: "PATCH", body: JSON.stringify({ status: "sent", sent_at: new Date().toISOString(), last_error: null, telegram_message_id: String(payload.result?.message_id ?? "") }) })
        sent++
      } catch (error) {
        await db(`notification_outbox?id=eq.${item.id}`, { method: "PATCH", body: JSON.stringify(retryPatch(item.attempt_count, error)) })
        failures.push({ id: item.id, error: error instanceof Error ? error.message : String(error) })
      }
    }
    return json({ ok: failures.length === 0, claimed: claimed.length, sent, failures }, failures.length ? 207 : 200)
  } catch (error) {
    console.error("telegram-dispatch failed", error)
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500)
  }
})
