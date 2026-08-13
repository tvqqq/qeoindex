import { authorized, db, json, vietnamDateKey } from "../_shared/scanner.ts"

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405)
  if (!authorized(request)) return json({ ok: false, error: "Unauthorized" }, 401)
  try {
    const body = await request.json().catch(() => ({})) as { scanDate?: string }
    const scanDate = body.scanDate && /^\d{4}-\d{2}-\d{2}$/.test(body.scanDate) ? body.scanDate : vietnamDateKey()
    const result = await db("rpc/enqueue_daily_scanner", { method: "POST", body: JSON.stringify({ p_scan_date: scanDate }) })
    return json({ ok: true, scanDate, run: result?.[0] ?? null })
  } catch (error) {
    console.error("daily-scanner-orchestrator failed", error)
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500)
  }
})
