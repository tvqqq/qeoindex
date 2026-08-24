import { runAiCouncilDailyOperation, runAiCouncilDebateOperation } from "@/lib/ai-council-operations"
import { getSupabaseServerClient } from "@/lib/supabase/server"
import {
  WYCKOFF_EOD_BATCH_SIZE,
  buildWyckoffEodBatchOffsets,
  validateWyckoffEodDailyRows,
} from "@/lib/wyckoff-eod-refresh"
import { runUnifiedWyckoff } from "@/lib/wyckoff-unified-runner"

function vietnamDateKey(iso: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso))
}

export async function assertFinalEodMarketReadyStep(startedAtIso: string) {
  "use step"

  const supabase = getSupabaseServerClient()
  if (!supabase) throw new Error("Supabase service role is not configured")

  const expectedSessionDate = vietnamDateKey(startedAtIso)
  const latest = await supabase
    .from("insights_stock_ratings")
    .select("as_of_date")
    .eq("is_published", true)
    .eq("source", "kfsp")
    .eq("is_top100", true)
    .order("as_of_date", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (latest.error) throw new Error(`Load EOD rating date failed: ${latest.error.message}`)
  const ratingDate = latest.data?.as_of_date ? String(latest.data.as_of_date) : null
  if (ratingDate !== expectedSessionDate) {
    return {
      ok: false as const,
      expectedSessionDate,
      ratingDate,
      tickers: [] as string[],
      freshMarketCount: 0,
      issues: [`KFSP/TTAI rating date ${ratingDate || "missing"} != EOD session ${expectedSessionDate}`],
    }
  }

  const ratings = await supabase
    .from("insights_stock_ratings")
    .select("ticker")
    .eq("is_published", true)
    .eq("source", "kfsp")
    .eq("is_top100", true)
    .eq("as_of_date", expectedSessionDate)
    .order("top100_rank", { ascending: true, nullsFirst: false })
    .order("ticker", { ascending: true })
  if (ratings.error) throw new Error(`Load EOD Top100 ratings failed: ${ratings.error.message}`)

  const tickers = [...new Set((ratings.data || []).map((row) => String(row.ticker || "").trim().toUpperCase()).filter(Boolean))]
  const issues: string[] = []
  if (tickers.length !== 100) issues.push(`Top100 rating universe incomplete: ${tickers.length}/100`)

  const snapshots = tickers.length
    ? await supabase
        .from("stock_orderbook_snapshots")
        .select("symbol,session_date,updated_at")
        .eq("session_date", expectedSessionDate)
        .in("symbol", tickers)
    : { data: [], error: null }
  if (snapshots.error) throw new Error(`Load final EOD market snapshots failed: ${snapshots.error.message}`)

  const cutoff = new Date(`${expectedSessionDate}T07:50:00.000Z`).getTime()
  const fresh = new Set(
    (snapshots.data || [])
      .filter((row) => {
        if (String(row.session_date || "") !== expectedSessionDate || !row.updated_at) return false
        const updatedAt = new Date(String(row.updated_at)).getTime()
        return Number.isFinite(updatedAt) && updatedAt >= cutoff
      })
      .map((row) => String(row.symbol || "").trim().toUpperCase()),
  )
  if (fresh.size !== tickers.length) issues.push(`Final EOD market snapshots incomplete: ${fresh.size}/${tickers.length}`)

  return {
    ok: issues.length === 0,
    expectedSessionDate,
    ratingDate,
    tickers,
    freshMarketCount: fresh.size,
    issues,
  }
}

export async function runWyckoffBatchStep(offset: number) {
  "use step"
  return runUnifiedWyckoff({ limit: WYCKOFF_EOD_BATCH_SIZE, offset })
}

export async function validateWyckoffTop100Step(expectedSessionDate: string, tickers: string[]) {
  "use step"

  const supabase = getSupabaseServerClient()
  if (!supabase) throw new Error("Supabase service role is not configured")
  const result = await supabase
    .from("wyckoff_latest_by_timeframe")
    .select("ticker,timeframe,bar_closed_at")
    .eq("timeframe", "1D")
    .in("ticker", tickers)
  if (result.error) throw new Error(`Validate EOD Wyckoff snapshots failed: ${result.error.message}`)

  return validateWyckoffEodDailyRows({
    expectedSessionDate,
    expectedTickers: tickers,
    rows: (result.data || []).map((row) => ({
      ticker: String(row.ticker || ""),
      timeframe: String(row.timeframe || ""),
      bar_closed_at: row.bar_closed_at ? String(row.bar_closed_at) : null,
    })),
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

export async function aiCouncilEodWorkflow(startedAtIso: string) {
  "use workflow"

  const market = await assertFinalEodMarketReadyStep(startedAtIso)
  if (!market.ok) {
    return { ok: false, status: "skipped", stage: "market", market, completedAt: new Date().toISOString() }
  }

  const batchResults = []
  for (const offset of buildWyckoffEodBatchOffsets()) {
    batchResults.push(await runWyckoffBatchStep(offset))
  }

  const wyckoffValidation = await validateWyckoffTop100Step(market.expectedSessionDate, market.tickers)
  if (!wyckoffValidation.ok) {
    return {
      ok: false,
      status: "skipped",
      stage: "wyckoff",
      market,
      wyckoffValidation,
      batchErrors: batchResults.flatMap((batch) => batch.errors),
      completedAt: new Date().toISOString(),
    }
  }

  const deterministic = await runDeterministicCouncilStep()
  if (!deterministic.ok) {
    return {
      ok: false,
      status: "skipped",
      stage: "deterministic",
      market,
      wyckoffValidation,
      deterministic,
      completedAt: new Date().toISOString(),
    }
  }

  const debate = await runLlmDebateStep()
  return {
    ok: debate.ok,
    status: debate.ok ? "completed" : "partial",
    stage: debate.ok ? "completed" : "llm",
    market,
    wyckoffValidation,
    deterministic,
    debate,
    completedAt: new Date().toISOString(),
  }
}
