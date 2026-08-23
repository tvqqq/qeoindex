import { randomUUID } from "node:crypto"

import { queryDataSource, updatePageProperties, type NotionPage } from "@/lib/notion/client"
import { dateText, numberValue, pageProperties, richText, richTextProperty, selectText } from "@/lib/notion/properties"
import { getSupabaseServerClient } from "@/lib/supabase/server"
import { WYCKOFF_AGGREGATION_VERSION, WYCKOFF_MODEL_VERSION } from "@/lib/wyckoff-unified-runner"

const RUNS_DATA_SOURCE_ID = process.env.NOTION_WYCKOFF_RUNS_DATA_SOURCE_ID ?? "4efe8131-196a-4b4e-8a9c-dea48c51a554"
const SNAPSHOTS_DATA_SOURCE_ID = process.env.NOTION_WYCKOFF_SNAPSHOTS_DATA_SOURCE_ID ?? "f9d84b24-965a-4008-a339-5a62db409ecf"
const TIMEFRAMES = ["1H", "4H", "1D", "1W", "1M"] as const
const TA_BIASES = new Set(["Bullish", "Neutral", "Bearish", "Mixed"])
const CONFIDENCE_LEVELS = new Set(["HIGH", "MEDIUM", "LOW"])

type JsonObject = Record<string, unknown>

function parseObject(value: string, field: string): JsonObject {
  try {
    const parsed = JSON.parse(value) as unknown
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as JsonObject
  } catch { /* reported below */ }
  throw new Error(`${field} must be a valid JSON object`)
}

function parseArray(value: string, field: string): unknown[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value) as unknown
    if (Array.isArray(parsed)) return parsed
  } catch { /* reported below */ }
  throw new Error(`${field} must be a valid JSON array`)
}

function selectProperty(value: string) {
  return { select: { name: value } }
}

function dateProperty(value: string) {
  return { date: value ? { start: value } : null }
}

function latestReadyRun(pages: NotionPage[]) {
  return pages
    .filter((page) => selectText(pageProperties(page).Status) === "Ready")
    .sort((a, b) => dateText(pageProperties(b)["Scan Date"]).localeCompare(dateText(pageProperties(a)["Scan Date"])))[0]
}

function validateSnapshots(runKey: string, pages: NotionPage[]) {
  if (pages.length !== 500) throw new Error(`Expected 500 snapshots for ${runKey}; received ${pages.length}`)
  const keys = new Set<string>()
  const tickerFrames = new Map<string, Set<string>>()
  let complete = 0
  let incomplete = 0

  const rows = pages.map((page) => {
    const props = pageProperties(page)
    const snapshotKey = richText(props["Snapshot Key"])
    const ticker = richText(props.Ticker).trim().toUpperCase()
    const timeframe = selectText(props.Timeframe)
    const historyStatus = selectText(props["History Status"])
    const validationStatus = selectText(props["Validation Status"])
    const barCount = numberValue(props["History Bar Count"]) ?? 0
    if (!snapshotKey || keys.has(snapshotKey)) throw new Error(`Duplicate or missing Snapshot Key: ${snapshotKey || "<empty>"}`)
    if (snapshotKey !== `${runKey}|${ticker}|${timeframe}`) throw new Error(`Snapshot Key mismatch: ${snapshotKey}`)
    if (!(TIMEFRAMES as readonly string[]).includes(timeframe)) throw new Error(`Invalid timeframe for ${snapshotKey}`)
    if (validationStatus !== "Valid" || historyStatus === "Rejected") throw new Error(`Invalid snapshot: ${snapshotKey}`)
    keys.add(snapshotKey)
    const frames = tickerFrames.get(ticker) ?? new Set<string>()
    frames.add(timeframe)
    tickerFrames.set(ticker, frames)

    const evidence = parseObject(richText(props["Evidence JSON"]), `${snapshotKey} Evidence JSON`)
    const technicalText = richText(props["Technical JSON"])
    const technical = historyStatus === "Complete" ? parseObject(technicalText, `${snapshotKey} Technical JSON`) : {}
    if (historyStatus === "Complete") {
      const bull = numberValue(props["Bull Probability"])
      const base = numberValue(props["Base Probability"])
      const bear = numberValue(props["Bear Probability"])
      if (barCount < 60 || !dateText(props["Bar Closed At"]) || !richText(props.Provider)) throw new Error(`Incomplete evidence for ${snapshotKey}`)
      if (typeof technical.price !== "number" || technical.price <= 0) throw new Error(`Invalid price for ${snapshotKey}`)
      if (bull == null || base == null || bear == null || bull + base + bear !== 100) throw new Error(`Probability sum invalid for ${snapshotKey}`)
      if (richText(props["Model Version"]) !== WYCKOFF_MODEL_VERSION || richText(props["Aggregation Version"]) !== WYCKOFF_AGGREGATION_VERSION) {
        throw new Error(`Version mismatch for ${snapshotKey}`)
      }
      if (!richText(props.Phase) || !richText(props["Wyckoff State"]) || !TA_BIASES.has(selectText(props["TA Bias"])) || !CONFIDENCE_LEVELS.has(selectText(props.Confidence))) {
        throw new Error(`Required analysis fields invalid for ${snapshotKey}`)
      }
      for (const field of ["Support", "Resistance", "Confirmation", "Invalidation", "What Changed"] as const) {
        if (!richText(props[field])) throw new Error(`${field} is required for ${snapshotKey}`)
      }
      complete += 1
    } else if (historyStatus === "Incomplete") {
      if (typeof evidence.missingReason !== "string" || !evidence.missingReason) throw new Error(`Missing incomplete reason for ${snapshotKey}`)
      incomplete += 1
    } else {
      throw new Error(`Unsupported History Status for ${snapshotKey}`)
    }

    return { page, props, snapshotKey, ticker, timeframe, historyStatus, barCount, evidence, technical }
  })

  if (tickerFrames.size !== 100) throw new Error(`Expected 100 tickers; received ${tickerFrames.size}`)
  for (const [ticker, frames] of tickerFrames) if (frames.size !== 5) throw new Error(`${ticker} has ${frames.size}/5 timeframes`)
  if (complete + incomplete !== 500) throw new Error("Complete + Incomplete must equal 500")
  return { rows, complete, incomplete }
}

export async function ingestLatestReadyWyckoffRun() {
  const supabase = getSupabaseServerClient()
  if (!supabase) throw new Error("Supabase service role is not configured")

  const runQuery = await queryDataSource(RUNS_DATA_SOURCE_ID, {
    filter: { property: "Status", select: { equals: "Ready" } },
    sorts: [{ property: "Scan Date", direction: "descending" }],
    pageSize: 10,
    errorContext: "Notion unified Wyckoff ready-run query",
  })
  const runPage = latestReadyRun(runQuery.results)
  if (!runPage) return { ok: true, status: "idle", message: "No Ready Wyckoff run in Notion" }

  const runProps = pageProperties(runPage)
  const runKey = richText(runProps["Run Key"])
  const scanDate = dateText(runProps["Scan Date"])
  if (!runKey || !scanDate) throw new Error("Ready run is missing Run Key or Scan Date")
  await updatePageProperties(runPage.id, { Status: selectProperty("Ingesting") }, { errorContext: "Notion Wyckoff run claim" })

  const supabaseRunId = randomUUID()
  try {
    const snapshotQuery = await queryDataSource(SNAPSHOTS_DATA_SOURCE_ID, {
      filter: { property: "Run Key", rich_text: { equals: runKey } },
      pageSize: 100,
      maxPages: 5,
      errorContext: "Notion unified Wyckoff snapshot query",
    })
    if (snapshotQuery.hasMore) throw new Error(`More than 500 snapshots found for ${runKey}`)
    const validated = validateSnapshots(runKey, snapshotQuery.results)
    const completeRows = validated.rows.filter((row) => row.historyStatus === "Complete")
    const ranks = new Map<string, { ticker: string; rank: number; exchange: string; sector: string }>()
    for (const row of validated.rows) {
      if (!ranks.has(row.ticker)) ranks.set(row.ticker, {
        ticker: row.ticker,
        rank: numberValue(row.props.Rank) ?? 0,
        exchange: selectText(row.props.Exchange) || "HOSE",
        sector: richText(row.props.Sector),
      })
    }
    if ([...ranks.values()].some((row) => row.rank < 1 || row.rank > 100) || new Set([...ranks.values()].map((row) => row.rank)).size !== 100) {
      throw new Error("Ticker rank must be unique from 1 to 100")
    }

    const { error: runError } = await supabase.from("wyckoff_scan_runs").insert({
      id: supabaseRunId,
      universe_effective_date: scanDate,
      model_version: WYCKOFF_MODEL_VERSION,
      aggregation_version: WYCKOFF_AGGREGATION_VERSION,
      status: "running",
      requested_count: 100,
      started_at: new Date().toISOString(),
      diagnostics: { source: "notion-chatgpt-web", runKey },
    })
    if (runError) throw new Error(`Supabase run insert failed: ${runError.message}`)

    const { error: membershipError } = await supabase.from("wyckoff_universe_memberships").upsert([...ranks.values()].map((row) => ({
      ...row, universe_key: "hose_top100", effective_date: scanDate, active: true, source: "notion-chatgpt-web", synced_at: new Date().toISOString(),
    })), { onConflict: "universe_key,ticker,effective_date" })
    if (membershipError) throw new Error(`Supabase membership upsert failed: ${membershipError.message}`)

    for (let offset = 0; offset < completeRows.length; offset += 100) {
      const payload = completeRows.slice(offset, offset + 100).map((row) => {
        const props = row.props
        return {
          id: randomUUID(), run_id: supabaseRunId, ticker: row.ticker, timeframe: row.timeframe,
          bar_closed_at: dateText(props["Bar Closed At"]), model_version: richText(props["Model Version"]), aggregation_version: richText(props["Aggregation Version"]),
          history_bar_count: row.barCount, history_status: "complete", phase: richText(props.Phase), wyckoff_state: richText(props["Wyckoff State"]),
          ta_bias: selectText(props["TA Bias"]), confidence: selectText(props.Confidence), bull_probability: numberValue(props["Bull Probability"]),
          base_probability: numberValue(props["Base Probability"]), bear_probability: numberValue(props["Bear Probability"]), support: richText(props.Support),
          resistance: richText(props.Resistance), confirmation: richText(props.Confirmation), invalidation: richText(props.Invalidation), what_changed: richText(props["What Changed"]),
          technical: row.technical, evidence: row.evidence, markers: parseArray(richText(props["Markers JSON"]), `${row.snapshotKey} Markers JSON`),
          scenarios: parseArray(richText(props["Scenarios JSON"]), `${row.snapshotKey} Scenarios JSON`),
        }
      })
      const { error } = await supabase.from("wyckoff_analysis_snapshots").upsert(payload, { onConflict: "ticker,timeframe,bar_closed_at,model_version,aggregation_version", ignoreDuplicates: true })
      if (error) throw new Error(`Supabase snapshot upsert failed: ${error.message}`)
    }

    const finishedAt = new Date().toISOString()
    const { error: finishError } = await supabase.from("wyckoff_scan_runs").update({
      status: "published", completed_count: 100, incomplete_count: validated.incomplete, error_count: 0,
      diagnostics: { source: "notion-chatgpt-web", runKey, completeSnapshots: validated.complete, incompleteSnapshots: validated.incomplete }, finished_at: finishedAt,
    }).eq("id", supabaseRunId)
    if (finishError) throw new Error(`Supabase run publish failed: ${finishError.message}`)

    await updatePageProperties(runPage.id, {
      Status: selectProperty("Ingested"), "Ingested At": dateProperty(finishedAt), "Supabase Run ID": richTextProperty(supabaseRunId), "Error Summary": richTextProperty(""),
    }, { errorContext: "Notion Wyckoff run completion" })
    return { ok: true, status: "ingested", runKey, supabaseRunId, complete: validated.complete, incomplete: validated.incomplete }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await supabase.from("wyckoff_scan_runs").update({
      status: "failed", error_count: 1, finished_at: new Date().toISOString(),
      diagnostics: { source: "notion-chatgpt-web", runKey, error: message.slice(0, 1000) },
    }).eq("id", supabaseRunId).eq("status", "running")
    await updatePageProperties(runPage.id, { Status: selectProperty("Error"), "Error Summary": richTextProperty(message) }, { errorContext: "Notion Wyckoff run failure" }).catch(() => undefined)
    throw error
  }
}
