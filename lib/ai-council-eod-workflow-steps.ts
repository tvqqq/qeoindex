import { runAiCouncilDailyOperation, runAiCouncilDebateOperation } from "@/lib/ai-council-operations"
import { getCanonicalUniverse } from "@/lib/market-universe"
import { getSupabaseServerClient } from "@/lib/supabase/server"
import { WYCKOFF_EOD_BATCH_SIZE, validateWyckoffEodDailyRows } from "@/lib/wyckoff-eod-refresh"
import { runUnifiedWyckoff } from "@/lib/wyckoff-unified-runner"

export const AI_COUNCIL_EOD_JOB_KEY = "ai_council.eod"

function vietnamDateKey(iso: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso))
}

export async function startAiCouncilEodTelemetryStep(startedAtIso: string) {
  "use step"
  const supabase = getSupabaseServerClient()
  if (!supabase) throw new Error("Supabase service role is not configured")
  const { data, error } = await supabase.from("system_job_runs").insert({
    job_key: AI_COUNCIL_EOD_JOB_KEY, provider: "vercel_cron_workflow", trigger: "workflow", status: "running", started_at: startedAtIso,
  }).select("id").single()
  if (error || !data?.id) throw new Error(`AI Council EOD telemetry start failed: ${error?.message || "missing run id"}`)
  return String(data.id)
}

export async function finishAiCouncilEodTelemetryStep(
  runId: string,
  startedAtIso: string,
  status: "succeeded" | "skipped" | "failed",
  summary: Record<string, unknown>,
  errorMessage?: string,
) {
  "use step"
  const supabase = getSupabaseServerClient()
  if (!supabase) throw new Error("Supabase service role is not configured")
  const finishedAt = new Date()
  const startedAt = new Date(startedAtIso).getTime()
  const durationMs = Number.isFinite(startedAt) ? Math.max(0, finishedAt.getTime() - startedAt) : null
  const { error } = await supabase.from("system_job_runs").update({
    status,
    finished_at: finishedAt.toISOString(),
    duration_ms: durationMs,
    summary,
    error_code: status === "failed" ? "AI_COUNCIL_EOD_FAILED" : null,
    error_message: status === "failed" && errorMessage ? errorMessage.slice(0, 1000) : null,
  }).eq("id", runId)
  if (error) throw new Error(`AI Council EOD telemetry finish failed: ${error.message}`)
  return { ok: true as const, runId, status }
}

export async function assertFinalEodMarketReadyStep(startedAtIso: string) {
  "use step"
  const supabase = getSupabaseServerClient()
  if (!supabase) throw new Error("Supabase service role is not configured")
  const universe = await getCanonicalUniverse()
  const tickers = universe.stocks.map((stock) => stock.ticker)
  const expectedSessionDate = vietnamDateKey(startedAtIso)
  if (!tickers.length) return { ok: false as const, expectedSessionDate, ratingDate: null, tickers, freshMarketCount: 0, issues: ["Canonical universe is empty"] }

  const latest = await supabase
    .from("insights_stock_ratings")
    .select("as_of_date")
    .eq("is_published", true)
    .eq("source", "kfsp")
    .in("ticker", tickers)
    .order("as_of_date", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (latest.error) throw new Error(`Load EOD rating date failed: ${latest.error.message}`)
  const ratingDate = latest.data?.as_of_date ? String(latest.data.as_of_date) : null
  if (ratingDate !== expectedSessionDate) {
    return { ok: false as const, expectedSessionDate, ratingDate, tickers: [] as string[], freshMarketCount: 0, issues: [`KFSP/TTAI rating date ${ratingDate || "missing"} != EOD session ${expectedSessionDate}`] }
  }

  const ratings = await supabase
    .from("insights_stock_ratings")
    .select("ticker")
    .eq("is_published", true)
    .eq("source", "kfsp")
    .eq("as_of_date", expectedSessionDate)
    .in("ticker", tickers)
  if (ratings.error) throw new Error(`Load EOD canonical ratings failed: ${ratings.error.message}`)
  const ratingSet = new Set((ratings.data || []).map((row) => String(row.ticker || "").trim().toUpperCase()).filter(Boolean))
  const issues: string[] = []
  const missing = tickers.filter((ticker) => !ratingSet.has(ticker))
  if (missing.length) issues.push(`Canonical rating universe incomplete: ${tickers.length - missing.length}/${tickers.length}`)

  const snapshots = await supabase
    .from("stock_orderbook_snapshots")
    .select("symbol,session_date,updated_at")
    .eq("session_date", expectedSessionDate)
    .in("symbol", tickers)
  if (snapshots.error) throw new Error(`Load final EOD market snapshots failed: ${snapshots.error.message}`)
  const cutoff = new Date(`${expectedSessionDate}T07:45:00.000Z`).getTime()
  const fresh = new Set((snapshots.data || []).filter((row) => {
    if (String(row.session_date || "") !== expectedSessionDate || !row.updated_at) return false
    const updatedAt = new Date(String(row.updated_at)).getTime()
    return Number.isFinite(updatedAt) && updatedAt >= cutoff
  }).map((row) => String(row.symbol || "").trim().toUpperCase()))
  if (fresh.size !== tickers.length) issues.push(`Final EOD market snapshots incomplete: ${fresh.size}/${tickers.length}`)

  return { ok: issues.length === 0, expectedSessionDate, ratingDate, tickers, freshMarketCount: fresh.size, issues, universeRunId: universe.runId }
}

export async function runWyckoffBatchStep(offset: number) {
  "use step"
  return runUnifiedWyckoff({ limit: WYCKOFF_EOD_BATCH_SIZE, offset })
}

export async function validateWyckoffTop100Step(expectedSessionDate: string, tickers: string[]) {
  "use step"
  const supabase = getSupabaseServerClient()
  if (!supabase) throw new Error("Supabase service role is not configured")
  const result = await supabase.from("wyckoff_latest_by_timeframe").select("ticker,timeframe,bar_closed_at").eq("timeframe", "1D").in("ticker", tickers)
  if (result.error) throw new Error(`Validate EOD Wyckoff snapshots failed: ${result.error.message}`)
  return validateWyckoffEodDailyRows({
    expectedSessionDate,
    expectedTickers: tickers,
    rows: (result.data || []).map((row) => ({ ticker: String(row.ticker || ""), timeframe: String(row.timeframe || ""), bar_closed_at: row.bar_closed_at ? String(row.bar_closed_at) : null })),
  })
}

export async function runDeterministicCouncilStep() {
  "use step"
  const supabase = getSupabaseServerClient()
  if (!supabase) throw new Error("Supabase service role is not configured")
  return runAiCouncilDailyOperation(supabase, new Date())
}

export async function runLlmDebateStep() {
  "use step"
  const supabase = getSupabaseServerClient()
  if (!supabase) throw new Error("Supabase service role is not configured")
  return runAiCouncilDebateOperation(supabase)
}
