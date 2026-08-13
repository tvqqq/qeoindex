import { scanWyckoff, type WyckoffScanResult } from "../../../lib/wyckoff-engine.ts"
import { scannerHistoryPolicy } from "../../../lib/scanner-policy.ts"
import { authorized, db, fetchDailyHistory, json, retry, vietnamDateKey } from "../_shared/scanner.ts"

const ENGINE_VERSION = "wyckoff-v1.0"
type Job = { id: string; run_id: string; ticker: string; rank: number; scan_date: string; attempt_count: number }

function previousResult(row?: Record<string, unknown>): WyckoffScanResult | null {
  if (!row) return null
  return {
    technical: { price: Number(row.price), changePct: Number(row.change_pct), volume: Number(row.volume), rsi14: value(row.rsi14), macd: value(row.macd), macdSignal: value(row.macd_signal), ma20: value(row.ma20), ma50: value(row.ma50), ma200: value(row.ma200), atr14: value(row.atr14), relVolume: value(row.rel_volume) },
    wyckoffState: String(row.wyckoff_state), phase: String(row.phase), taBias: String(row.ta_bias) as WyckoffScanResult["taBias"], bullProbability: Number(row.bull_probability), baseProbability: Number(row.base_probability), bearProbability: Number(row.bear_probability), support: String(row.support), resistance: String(row.resistance), confirmation: String(row.confirmation), invalidation: String(row.invalidation), whatChanged: String(row.what_changed), confidence: String(row.confidence) as WyckoffScanResult["confidence"], tags: [],
  }
}
function value(raw: unknown) { const parsed = Number(raw); return raw == null || !Number.isFinite(parsed) ? null : parsed }

async function refreshRun(runId: string) {
  const jobs = await db(`scanner_jobs?run_id=eq.${runId}&select=status`)
  const runs = await db(`scanner_runs?id=eq.${runId}&select=started_at`)
  const count = (status: string) => jobs.filter((job: Record<string, unknown>) => job.status === status).length
  const pending = count("pending") + count("processing") + count("failed")
  const failed = count("dead")
  await db(`scanner_runs?id=eq.${runId}`, { method: "PATCH", body: JSON.stringify({ status: pending ? "running" : failed ? "partial" : "succeeded", completed_count: count("complete"), incomplete_count: count("incomplete"), failed_count: failed, started_at: runs?.[0]?.started_at ?? new Date().toISOString(), finished_at: pending ? null : new Date().toISOString() }) })
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405)
  if (!authorized(request)) return json({ ok: false, error: "Unauthorized" }, 401)
  const body = await request.json().catch(() => ({})) as { limit?: number }
  const limit = Math.max(1, Math.min(Number(body.limit) || 5, 10))
  try {
    const jobs = (await db("rpc/claim_scanner_jobs", { method: "POST", body: JSON.stringify({ p_limit: limit }) }) ?? []) as Job[]
    const results: Array<{ ticker: string; status: string; provider?: string; error?: string }> = []
    for (const job of jobs) {
      try {
        const history = await fetchDailyHistory(job.ticker)
        const policy = scannerHistoryPolicy(history.bars.length)
        const actualDate = vietnamDateKey(history.bars.at(-1)!.time * 1000)
        if (actualDate > job.scan_date) throw new Error(`Latest completed bar ${actualDate} is after job date ${job.scan_date}`)
        const previousRows = await db(`daily_scans?ticker=eq.${job.ticker}&scan_date=lt.${actualDate}&order=scan_date.desc&limit=1&select=*`)
        const result = scanWyckoff(history.bars, previousResult(previousRows?.[0]))
        const status = policy.status
        const confidence = policy.forceLowConfidence ? "LOW" : result.confidence
        const t = result.technical
        const rows = await db("daily_scans?on_conflict=ticker,scan_date,engine_version", { method: "POST", headers: { prefer: "resolution=merge-duplicates,return=representation" }, body: JSON.stringify({ job_id: job.id, ticker: job.ticker, scan_date: actualDate, rank: job.rank, bar_count: history.bars.length, price: t.price, change_pct: t.changePct, volume: t.volume, rsi14: t.rsi14, macd: t.macd, macd_signal: t.macdSignal, ma20: t.ma20, ma50: t.ma50, ma200: t.ma200, atr14: t.atr14, rel_volume: t.relVolume, wyckoff_state: result.wyckoffState, phase: result.phase, ta_bias: result.taBias, bull_probability: result.bullProbability, base_probability: result.baseProbability, bear_probability: result.bearProbability, support: result.support, resistance: result.resistance, confirmation: result.confirmation, invalidation: result.invalidation, what_changed: result.whatChanged, confidence, provider: history.provider, provider_detail: history.detail, status, engine_version: ENGINE_VERSION }) })
        const scan = rows?.[0]
        await db(`scanner_jobs?id=eq.${job.id}`, { method: "PATCH", body: JSON.stringify({ status: status.toLowerCase(), finished_at: new Date().toISOString(), last_error: null }) })
        await db("provider_health?on_conflict=provider", { method: "POST", headers: { prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ provider: history.provider, status: "healthy", last_success_at: new Date().toISOString(), last_error: null, last_detail: history.detail }) })
        if (history.provider === "Fallback") await db("provider_health?on_conflict=provider", { method: "POST", headers: { prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ provider: "DNSE", status: "degraded", last_failure_at: new Date().toISOString(), last_error: history.primaryError, last_detail: "Daily scanner used fallback provider" }) })
        if (scan?.id) await db("notion_sync_outbox?on_conflict=idempotency_key", { method: "POST", headers: { prefer: "resolution=ignore-duplicates,return=minimal" }, body: JSON.stringify({ entity_type: "daily_scan", entity_id: scan.id, operation: scan.notion_page_id ? "update" : "create", idempotency_key: `daily-scan:${job.ticker}:${actualDate}:${ENGINE_VERSION}`, payload: { ticker: job.ticker } }) })
        results.push({ ticker: job.ticker, status, provider: history.provider })
      } catch (error) {
        await db(`scanner_jobs?id=eq.${job.id}`, { method: "PATCH", body: JSON.stringify(retry(job.attempt_count, error)) })
        results.push({ ticker: job.ticker, status: job.attempt_count >= 5 ? "dead" : "failed", error: error instanceof Error ? error.message : String(error) })
      }
      await refreshRun(job.run_id)
    }
    return json({ ok: results.every((item) => !item.error), claimed: jobs.length, results }, results.some((item) => item.error) ? 207 : 200)
  } catch (error) {
    console.error("daily-scanner-worker failed", error)
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500)
  }
})
