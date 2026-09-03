import type { SupabaseClient } from "@supabase/supabase-js"

import {
  createDataSourcePage,
  isNotionConfigured,
  queryDataSource,
  updatePageProperties,
} from "@/lib/notion/client"
import type { EodArchiveCheckpoint } from "@/lib/qeoindex-eod-archive"

export const TOP_STOCKS_200_EOD_RUNS_DATA_SOURCE_ID = process.env.NOTION_TOP_STOCKS_EOD_RUNS_DATA_SOURCE_ID
  || "ea4f1552-dff1-434b-a647-ac7cb0330932"
export const EOD_ANALYTICAL_SUMMARY_VERSION = "qeoindex-eod-v4-notion-summary-v1" as const

type CouncilSummaryRow = { ticker: string; as_of_date?: string; signal?: string; council_score?: number; confidence?: number; risk_status?: string }
type LlmSummaryRow = { ticker?: string; status?: string }

export type EodAnalyticalSummaryInput = {
  tradingDate: string
  eodRunId: string
  runStatus?: "Succeeded" | "Partial"
  universeRunId: string
  universeCount: number
  expectedSnapshots: number
  completedSnapshots: number
  validationHash: string
  startedAt: string
  completedAt?: string | null
  marketSynthesisStatus: string
  tickers: string[]
  failedTickers?: string[]
  anomalies?: string[]
  retention: EodArchiveCheckpoint
}

function titleProperty(value: string) { return { title: [{ type: "text", text: { content: value.slice(0, 1900) } }] } }
function textProperty(value: unknown) {
  const text = typeof value === "string" ? value : value == null ? "" : JSON.stringify(value)
  return { rich_text: text ? [{ type: "text", text: { content: text.slice(0, 1900) } }] : [] }
}
function numberProperty(value: unknown) { const parsed = Number(value); return { number: Number.isFinite(parsed) ? parsed : null } }
function dateProperty(value: string | null | undefined) { return { date: value ? { start: value } : null } }
function selectProperty(value: string | null | undefined) { return { select: value ? { name: value } : null } }
function compactList(values: Array<string | null | undefined>, limit = 20) {
  return values.filter((value): value is string => Boolean(value && value.trim())).slice(0, limit).join("; ").slice(0, 1800)
}
function uniqueTickers(values: string[]) { return [...new Set(values.map((value) => value.trim().toUpperCase()).filter(Boolean))] }
function retentionStatus(status: EodArchiveCheckpoint["status"]) {
  if (status === "archived") return "Succeeded"
  if (status === "blocked") return "Blocked"
  if (status === "skipped") return "Skipped"
  return "Failed"
}
function synthesisStatus(status: string) {
  const normalized = status.trim().toLowerCase()
  if (["succeeded", "completed", "success"].includes(normalized)) return "Succeeded"
  if (normalized === "partial") return "Partial"
  if (normalized === "failed" || normalized === "error") return "Failed"
  if (normalized === "skipped") return "Skipped"
  return "Pending"
}

async function upsertEodSummaryPage(eodRunId: string, properties: Record<string, unknown>) {
  const found = await queryDataSource(TOP_STOCKS_200_EOD_RUNS_DATA_SOURCE_ID, {
    filter: { property: "EOD Run ID", rich_text: { equals: eodRunId } }, pageSize: 2,
    errorContext: "Notion EOD analytical summary lookup", timeoutMs: 12_000,
  })
  if (found.results.length > 1) throw new Error(`Duplicate Notion EOD summary for run ${eodRunId}`)
  const existing = found.results[0]
  if (existing) {
    await updatePageProperties(existing.id, properties, { errorContext: `Notion EOD analytical summary update ${eodRunId}`, timeoutMs: 15_000 })
    return "updated" as const
  }
  await createDataSourcePage(TOP_STOCKS_200_EOD_RUNS_DATA_SOURCE_ID, properties, { errorContext: `Notion EOD analytical summary create ${eodRunId}`, timeoutMs: 15_000 })
  return "created" as const
}

async function loadAnalyticalEvidence(supabase: SupabaseClient, input: EodAnalyticalSummaryInput) {
  const tickers = uniqueTickers(input.tickers)
  if (!tickers.length) throw new Error("Cannot build EOD analytical summary for an empty universe")
  const [currentCouncilResult, llmResult, previousDateResult] = await Promise.all([
    supabase.from("ai_council_runs").select("ticker,as_of_date,signal,council_score,confidence,risk_status").eq("as_of_date", input.tradingDate).in("ticker", tickers),
    supabase.from("ai_council_llm_debates").select("ticker,status").eq("as_of_date", input.tradingDate).in("ticker", tickers),
    supabase.from("ai_council_runs").select("as_of_date").lt("as_of_date", input.tradingDate).in("ticker", tickers).order("as_of_date", { ascending: false }).limit(1).maybeSingle(),
  ])
  if (currentCouncilResult.error) throw new Error(`Load current Council summary failed: ${currentCouncilResult.error.message}`)
  if (llmResult.error) throw new Error(`Load current LLM summary failed: ${llmResult.error.message}`)
  if (previousDateResult.error) throw new Error(`Load previous Council date failed: ${previousDateResult.error.message}`)
  const currentRows = (currentCouncilResult.data || []) as CouncilSummaryRow[]
  const llmRows = (llmResult.data || []) as LlmSummaryRow[]
  const previousDate = previousDateResult.data?.as_of_date ? String(previousDateResult.data.as_of_date) : null
  let previousRows: CouncilSummaryRow[] = []
  if (previousDate) {
    const previous = await supabase.from("ai_council_runs").select("ticker,as_of_date,signal,council_score,confidence,risk_status").eq("as_of_date", previousDate).in("ticker", tickers)
    if (previous.error) throw new Error(`Load previous Council summary failed: ${previous.error.message}`)
    previousRows = (previous.data || []) as CouncilSummaryRow[]
  }
  const notable = currentRows.filter((row) => ["BUY", "BUY_ON_CONFIRMATION"].includes(String(row.signal || "")))
    .sort((a, b) => Number(b.council_score || 0) - Number(a.council_score || 0)).slice(0, 12)
    .map((row) => `${row.ticker} ${row.signal} score=${row.council_score ?? "?"} conf=${row.confidence ?? "?"}`)
  const previousByTicker = new Map(previousRows.map((row) => [String(row.ticker), row]))
  const changes = currentRows.filter((row) => {
    const previous = previousByTicker.get(String(row.ticker)); return previous && String(previous.signal || "") !== String(row.signal || "")
  }).slice(0, 20).map((row) => `${row.ticker} ${previousByTicker.get(String(row.ticker))?.signal || "?"}→${row.signal || "?"}`)
  const riskSignals = currentRows.filter((row) => ["REDUCE", "SELL"].includes(String(row.signal || ""))).slice(0, 12)
    .map((row) => `${row.ticker} ${row.signal} risk=${row.risk_status || "?"}`)
  const signalCounts = currentRows.reduce<Record<string, number>>((counts, row) => {
    const signal = String(row.signal || "UNKNOWN"); counts[signal] = (counts[signal] || 0) + 1; return counts
  }, {})
  const llmCompleted = llmRows.filter((row) => ["completed", "succeeded"].includes(String(row.status || ""))).length
  return { currentRows, llmRows, notable, changes, riskSignals, previousDate, llmCompleted, signalCounts }
}

export async function archiveEodAnalyticalSummaryToNotion(supabase: SupabaseClient, input: EodAnalyticalSummaryInput): Promise<EodArchiveCheckpoint> {
  if (!isNotionConfigured()) return { status: "blocked", requested: 1, archived: 0, rowCount: 0, detail: "NOTION_API_KEY is not configured; operational EOD evidence remains canonical in Supabase." }
  try {
    const evidence = await loadAnalyticalEvidence(supabase, input)
    const failedTickers = uniqueTickers(input.failedTickers || [])
    const anomalies = compactList([...(input.anomalies || []), ...evidence.riskSignals])
    const completedAt = input.completedAt || new Date().toISOString()
    const durationMs = Math.max(0, new Date(completedAt).getTime() - new Date(input.startedAt).getTime())
    const timeframeCount = input.universeCount > 0 ? Math.max(1, Math.round(input.expectedSnapshots / input.universeCount)) : 0
    const aiSummary = [
      `Council ${evidence.currentRows.length}/${input.universeCount}`,
      `Signals ${Object.entries(evidence.signalCounts).sort(([a], [b]) => a.localeCompare(b)).map(([signal, count]) => `${signal}=${count}`).join(", ") || "none"}`,
      `LLM ${evidence.llmCompleted}/${evidence.llmRows.length}`, `Market synthesis=${input.marketSynthesisStatus}`,
      evidence.previousDate ? `Compared with ${evidence.previousDate}` : "No prior Council date",
    ].join(" | ")
    const supabaseEvidence = `system_job_runs.id=${input.eodRunId} | market_universe_run_id=${input.universeRunId} | wyckoff_validation_hash=${input.validationHash} | tables=wyckoff_analysis_snapshots,ai_council_runs,ai_council_llm_debates`
    const action = await upsertEodSummaryPage(input.eodRunId, {
      Run: titleProperty(`${input.tradingDate}|${input.eodRunId}`), "Trading Date": dateProperty(input.tradingDate), "EOD Run ID": textProperty(input.eodRunId),
      Status: selectProperty(input.runStatus || "Succeeded"), "Universe Key": textProperty("vn_top_stocks"), "Universe Run ID": textProperty(input.universeRunId),
      "Universe Count": numberProperty(input.universeCount), "Wyckoff Timeframes": numberProperty(timeframeCount), "Wyckoff Expected": numberProperty(input.expectedSnapshots),
      "Wyckoff Completed": numberProperty(input.completedSnapshots), "AI Deterministic Expected": numberProperty(input.universeCount), "AI Deterministic Completed": numberProperty(evidence.currentRows.length),
      "AI LLM Candidates": numberProperty(evidence.llmRows.length), "AI LLM Completed": numberProperty(evidence.llmCompleted), "Market Synthesis Status": selectProperty(synthesisStatus(input.marketSynthesisStatus)),
      "Notion Archive Status": selectProperty("Archived"), "Retention Status": selectProperty(retentionStatus(input.retention.status)), "Started At": dateProperty(input.startedAt), "Completed At": dateProperty(completedAt),
      "Duration Ms": numberProperty(durationMs), "Validation Hash": textProperty(input.validationHash), "Engine Version": textProperty("qeoindex-eod-v4"), "Archive Version": textProperty(EOD_ANALYTICAL_SUMMARY_VERSION),
      "Error Code": textProperty(anomalies || failedTickers.length ? "POST_ANALYSIS_ANOMALIES" : ""), "Error Summary": textProperty(compactList([failedTickers.length ? `Failed tickers: ${failedTickers.join(",")}` : "", anomalies])),
      "Notable Candidates": textProperty(compactList(evidence.notable, 12)), "Signal Changes": textProperty(compactList(evidence.changes, 20)), "Failed Tickers": textProperty(failedTickers.join(", ")),
      Anomalies: textProperty(anomalies), "AI Summary": textProperty(aiSummary), "Supabase Evidence": textProperty(supabaseEvidence),
    })
    return { status: "archived", archived: 1, requested: 1, rowCount: 1, detail: `EOD analytical summary ${action}; ${evidence.notable.length} notable candidate(s), ${evidence.changes.length} signal change(s), ${failedTickers.length} failed ticker(s).`, manifestUrl: null }
  } catch (error) {
    return { status: "error", archived: 0, requested: 1, rowCount: 0, detail: `Notion analytical summary failed: ${error instanceof Error ? error.message : String(error)}; operational EOD evidence remains canonical in Supabase.`, manifestUrl: null }
  }
}
