import { randomUUID } from "node:crypto"

import { getCanonicalUniverse } from "@/lib/market-universe"
import { queryDataSource, updatePageProperties, type NotionPage } from "@/lib/notion/client"
import { dateText, numberValue, pageProperties, richText, richTextProperty, selectText, urlText } from "@/lib/notion/properties"
import { getSupabaseServerClient } from "@/lib/supabase/server"
import { assertCanonicalWyckoffMembership } from "@/lib/wyckoff-canonical-membership"
import {
  WYCKOFF_V2_AGGREGATION_VERSION,
  WYCKOFF_V2_MODEL_VERSION,
  WYCKOFF_V2_PROMPT_VERSION,
  type WyckoffV2Snapshot,
} from "@/lib/wyckoff-v2-builder"
import { loadWyckoffV2ChartSeriesRows } from "@/lib/wyckoff-v2-chart-series"
import { computeWyckoffV2ValidationHash, validateWyckoffV2SnapshotSet } from "@/lib/wyckoff-v2-contract"
import { buildWyckoffV2SupabasePayload, WYCKOFF_V2_OPERATIONAL_SOURCE, WYCKOFF_V2_UNIVERSE_KEY } from "@/lib/wyckoff-v2-ingest"
import { WYCKOFF_V2_RUNS_DATA_SOURCE_ID, WYCKOFF_V2_SNAPSHOTS_DATA_SOURCE_ID } from "@/lib/wyckoff-v2-notion-staging"

const TIMEFRAMES = new Set(["1D", "1W"])
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

function selectProperty(value: string) { return { select: { name: value } } }
function dateProperty(value: string) { return { date: value ? { start: value } : null } }

function normalizeRunPage(runKey: string, pages: NotionPage[]) {
  const matches = pages.filter((page) => richText(pageProperties(page)["Run Key"]) === runKey)
  if (matches.length > 1) throw new Error(`Duplicate Notion Run Key: ${runKey}`)
  return matches[0] ?? null
}

async function queryRunByKey(runKey: string) {
  const result = await queryDataSource(WYCKOFF_V2_RUNS_DATA_SOURCE_ID, {
    filter: { property: "Run Key", rich_text: { equals: runKey } }, pageSize: 10, errorContext: "Notion Wyckoff v2 run query",
  })
  return normalizeRunPage(runKey, result.results)
}

async function latestReadyRun() {
  const result = await queryDataSource(WYCKOFF_V2_RUNS_DATA_SOURCE_ID, {
    filter: { property: "Status", select: { equals: "Ready" } },
    sorts: [{ property: "Scan Date", direction: "descending" }],
    pageSize: 10,
    errorContext: "Notion Wyckoff v2 latest Ready query",
  })
  return result.results.find((page) => richText(pageProperties(page)["Prompt Version"]) === WYCKOFF_V2_PROMPT_VERSION) ?? null
}

function parseSnapshotPage(page: NotionPage): WyckoffV2Snapshot {
  const props = pageProperties(page)
  const snapshotKey = richText(props["Snapshot Key"])
  const historyStatus = selectText(props["History Status"])
  const timeframe = selectText(props.Timeframe)
  const taBias = selectText(props["TA Bias"])
  const confidence = selectText(props.Confidence)
  if (historyStatus !== "Complete" && historyStatus !== "Incomplete") throw new Error(`Invalid History Status: ${snapshotKey}`)
  if (!TIMEFRAMES.has(timeframe)) throw new Error(`Invalid timeframe: ${snapshotKey}`)
  if (taBias && !TA_BIASES.has(taBias)) throw new Error(`Invalid TA Bias: ${snapshotKey}`)
  if (confidence && !CONFIDENCE_LEVELS.has(confidence)) throw new Error(`Invalid Confidence: ${snapshotKey}`)

  const technicalText = richText(props["Technical JSON"])
  const evidenceText = richText(props["Evidence JSON"])
  const markersText = richText(props["Markers JSON"])
  const scenariosText = richText(props["Scenarios JSON"])
  const evidence = parseObject(evidenceText, `${snapshotKey} Evidence JSON`) as unknown as WyckoffV2Snapshot["evidence"]

  return {
    snapshot: String((props.Snapshot as { title?: Array<{ plain_text?: string }> })?.title?.map((item) => item.plain_text ?? "").join("") ?? ""),
    snapshotKey,
    runKey: richText(props["Run Key"]),
    ticker: richText(props.Ticker).trim().toUpperCase(),
    rank: numberValue(props.Rank),
    exchange: selectText(props.Exchange),
    sector: richText(props.Sector),
    timeframe: timeframe as WyckoffV2Snapshot["timeframe"],
    barClosedAt: dateText(props["Bar Closed At"]) || null,
    historyBarCount: numberValue(props["History Bar Count"]) ?? 0,
    historyStatus,
    provider: richText(props.Provider),
    providerDetail: richText(props["Provider Detail"]),
    sourceUrl: urlText(props["Source URL"]),
    fetchedAt: dateText(props["Fetched At"]),
    modelVersion: richText(props["Model Version"]),
    aggregationVersion: richText(props["Aggregation Version"]),
    promptVersion: richText(props["Prompt Version"]),
    phase: richText(props.Phase) || null,
    wyckoffState: richText(props["Wyckoff State"]) || null,
    taBias: (taBias || null) as WyckoffV2Snapshot["taBias"],
    confidence: (confidence || null) as WyckoffV2Snapshot["confidence"],
    bullProbability: numberValue(props["Bull Probability"]),
    baseProbability: numberValue(props["Base Probability"]),
    bearProbability: numberValue(props["Bear Probability"]),
    support: richText(props.Support) || null,
    resistance: richText(props.Resistance) || null,
    confirmation: richText(props.Confirmation) || null,
    invalidation: richText(props.Invalidation) || null,
    whatChanged: richText(props["What Changed"]) || null,
    technical: historyStatus === "Complete" ? parseObject(technicalText, `${snapshotKey} Technical JSON`) as WyckoffV2Snapshot["technical"] : {},
    evidence,
    markers: parseArray(markersText, `${snapshotKey} Markers JSON`) as WyckoffV2Snapshot["markers"],
    scenarios: parseArray(scenariosText, `${snapshotKey} Scenarios JSON`) as WyckoffV2Snapshot["scenarios"],
    validationStatus: selectText(props["Validation Status"]) as "Valid",
    validationError: richText(props["Validation Error"]),
  }
}

async function loadValidatedSnapshotSet(runKey: string) {
  const result = await queryDataSource(WYCKOFF_V2_SNAPSHOTS_DATA_SOURCE_ID, {
    filter: { property: "Run Key", rich_text: { equals: runKey } },
    pageSize: 100,
    maxPages: 10,
    errorContext: "Notion Wyckoff v2 snapshot query",
  })
  if (result.hasMore) throw new Error(`More than 1000 snapshots found for ${runKey}`)
  const snapshots = result.results.map(parseSnapshotPage)
  const validation = validateWyckoffV2SnapshotSet(runKey, snapshots)
  const validationHash = computeWyckoffV2ValidationHash(snapshots)
  return { snapshots, validation, validationHash }
}

function verifyRunContract(page: NotionPage, runKey: string, expectedStatus: "Ready" | "Ingesting") {
  const props = pageProperties(page)
  if (selectText(props.Status) !== expectedStatus) throw new Error(`${runKey} must be ${expectedStatus}`)
  if (richText(props["Prompt Version"]) !== WYCKOFF_V2_PROMPT_VERSION) throw new Error(`${runKey} Prompt Version mismatch`)
  if (richText(props["Model Version"]) !== WYCKOFF_V2_MODEL_VERSION) throw new Error(`${runKey} Model Version mismatch`)
  if (richText(props["Aggregation Version"]) !== WYCKOFF_V2_AGGREGATION_VERSION) throw new Error(`${runKey} Aggregation Version mismatch`)
  const scanDate = dateText(props["Scan Date"])
  if (!scanDate) throw new Error(`${runKey} Scan Date missing`)
  return { props, scanDate }
}

export async function claimReadyWyckoffV2Run(requestedRunKey?: string) {
  const page = requestedRunKey ? await queryRunByKey(requestedRunKey) : await latestReadyRun()
  if (!page) return { ok: true as const, status: "idle" as const, message: "No notion-unified-v2 Ready run" }
  const runKey = richText(pageProperties(page)["Run Key"])
  if (!runKey) throw new Error("Ready v2 run is missing Run Key")
  const { props, scanDate } = verifyRunContract(page, runKey, "Ready")
  const validated = await loadValidatedSnapshotSet(runKey)
  const storedHash = richText(props["Validation Hash"])
  if (!storedHash || storedHash !== validated.validationHash) throw new Error(`Validation Hash mismatch for ${runKey}`)

  const supabaseRunId = randomUUID()
  await updatePageProperties(page.id, {
    Status: selectProperty("Ingesting"), "Supabase Run ID": richTextProperty(supabaseRunId), "Error Summary": richTextProperty(""),
  }, { errorContext: "Notion Wyckoff v2 claim" })

  const readBack = await queryRunByKey(runKey)
  if (!readBack || selectText(pageProperties(readBack).Status) !== "Ingesting" || richText(pageProperties(readBack)["Supabase Run ID"]) !== supabaseRunId) {
    throw new Error(`Wyckoff v2 claim lost race for ${runKey}`)
  }

  return {
    ok: true as const, status: "claimed" as const, runKey, scanDate, supabaseRunId,
    complete: validated.validation.complete, incomplete: validated.validation.incomplete, validationHash: validated.validationHash,
  }
}

async function ensureOperationalRun(supabase: NonNullable<ReturnType<typeof getSupabaseServerClient>>, input: {
  runId: string
  runKey: string
  scanDate: string
  complete: number
  incomplete: number
  tickerCount: number
  universeRunId: string
}) {
  const { data: existing, error: lookupError } = await supabase.from("wyckoff_scan_runs").select("id,status").eq("id", input.runId).maybeSingle()
  if (lookupError) throw new Error(`Supabase run lookup failed: ${lookupError.message}`)
  if (existing?.status === "published") return "published" as const
  if (!existing) {
    const { error } = await supabase.from("wyckoff_scan_runs").insert({
      id: input.runId,
      universe_key: WYCKOFF_V2_UNIVERSE_KEY,
      universe_effective_date: input.scanDate,
      model_version: WYCKOFF_V2_MODEL_VERSION,
      aggregation_version: WYCKOFF_V2_AGGREGATION_VERSION,
      prompt_version: WYCKOFF_V2_PROMPT_VERSION,
      status: "running",
      requested_count: input.tickerCount,
      completed_count: 0,
      incomplete_count: input.incomplete,
      error_count: 0,
      diagnostics: { source: WYCKOFF_V2_OPERATIONAL_SOURCE, runKey: input.runKey, universeRunId: input.universeRunId, completeSnapshots: input.complete, incompleteSnapshots: input.incomplete, tickerCount: input.tickerCount },
      started_at: new Date().toISOString(),
    })
    if (error) throw new Error(`Supabase run insert failed: ${error.message}`)
  } else if (existing.status !== "running") {
    throw new Error(`Supabase run ${input.runId} is ${existing.status}, expected running/published`)
  }
  return "running" as const
}

export async function publishIngestingWyckoffV2Run(runKey: string, expectedSupabaseRunId: string) {
  const page = await queryRunByKey(runKey)
  if (!page) throw new Error(`Notion Run not found for ${runKey}`)
  const { props, scanDate } = verifyRunContract(page, runKey, "Ingesting")
  if (richText(props["Supabase Run ID"]) !== expectedSupabaseRunId) throw new Error(`Supabase Run ID claim mismatch for ${runKey}`)

  const validated = await loadValidatedSnapshotSet(runKey)
  const storedHash = richText(props["Validation Hash"])
  if (storedHash !== validated.validationHash) throw new Error(`Validation Hash changed after claim for ${runKey}`)

  const supabase = getSupabaseServerClient()
  if (!supabase) throw new Error("Supabase service role is not configured")
  const payload = buildWyckoffV2SupabasePayload({ snapshots: validated.snapshots, runId: expectedSupabaseRunId, scanDate, runKey })
  const canonical = await getCanonicalUniverse()
  assertCanonicalWyckoffMembership(
    canonical.stocks.map((stock) => ({ ticker: stock.ticker, rank: stock.rank })),
    payload.memberships.map((row) => ({ ticker: row.ticker, rank: row.rank })),
  )
  if (canonical.selectedCount !== payload.memberships.length) {
    throw new Error(`Canonical Wyckoff membership mismatch: selectedCount=${canonical.selectedCount}; snapshots=${payload.memberships.length}`)
  }
  const tickers = payload.memberships.map((row) => row.ticker)
  const chartSeries = await loadWyckoffV2ChartSeriesRows(supabase, tickers, expectedSupabaseRunId)
  const expectedSeriesCount = tickers.length * 2
  if (chartSeries.length !== expectedSeriesCount) throw new Error(`Expected ${expectedSeriesCount} Wyckoff chart series; received ${chartSeries.length}`)

  const runState = await ensureOperationalRun(supabase, {
    runId: expectedSupabaseRunId,
    runKey,
    scanDate,
    complete: payload.complete,
    incomplete: payload.incomplete,
    tickerCount: tickers.length,
    universeRunId: canonical.runId,
  })

  if (runState !== "published") {
    for (let offset = 0; offset < payload.snapshots.length; offset += 100) {
      const chunk = payload.snapshots.slice(offset, offset + 100).map((row) => ({ id: randomUUID(), ...row }))
      const { error } = await supabase.from("wyckoff_analysis_snapshots").upsert(chunk, {
        onConflict: "ticker,timeframe,bar_closed_at,model_version,aggregation_version,prompt_version", ignoreDuplicates: true,
      })
      if (error) throw new Error(`Supabase snapshot upsert failed: ${error.message}`)
    }

    const { error: chartSeriesError } = await supabase.from("wyckoff_chart_series").upsert(chartSeries, { onConflict: "ticker,timeframe" })
    if (chartSeriesError) throw new Error(`Supabase chart-series upsert failed: ${chartSeriesError.message}`)

    const { data: publishedSeries, error: chartSeriesVerifyError } = await supabase
      .from("wyckoff_chart_series").select("ticker,timeframe").eq("run_id", expectedSupabaseRunId).in("ticker", tickers).in("timeframe", ["1D", "1W"])
    if (chartSeriesVerifyError) throw new Error(`Supabase chart-series verification failed: ${chartSeriesVerifyError.message}`)
    const publishedSeriesKeys = new Set((publishedSeries || []).map((row) => `${row.ticker}|${row.timeframe}`))
    if (publishedSeriesKeys.size !== expectedSeriesCount) throw new Error(`Expected ${expectedSeriesCount} persisted Wyckoff chart series; received ${publishedSeriesKeys.size}`)

    const finishedAt = new Date().toISOString()
    const { error: finishError } = await supabase.from("wyckoff_scan_runs").update({
      status: "published",
      completed_count: tickers.length,
      incomplete_count: payload.incomplete,
      error_count: 0,
      diagnostics: {
        source: payload.source, runKey, universeRunId: canonical.runId, completeSnapshots: payload.complete, incompleteSnapshots: payload.incomplete,
        validationHash: validated.validationHash, chartSeriesCount: chartSeries.length, tickerCount: tickers.length,
      },
      finished_at: finishedAt,
    }).eq("id", expectedSupabaseRunId).eq("status", "running")
    if (finishError) throw new Error(`Supabase run publish failed: ${finishError.message}`)
  }

  const ingestedAt = new Date().toISOString()
  await updatePageProperties(page.id, {
    Status: selectProperty("Ingested"), "Ingested At": dateProperty(ingestedAt), "Supabase Run ID": richTextProperty(expectedSupabaseRunId), "Error Summary": richTextProperty(""),
  }, { errorContext: "Notion Wyckoff v2 Ingested completion" })

  const readBack = await queryRunByKey(runKey)
  if (!readBack || selectText(pageProperties(readBack).Status) !== "Ingested" || richText(pageProperties(readBack)["Supabase Run ID"]) !== expectedSupabaseRunId) {
    throw new Error(`Notion Ingested read-back failed for ${runKey}`)
  }

  return {
    ok: true as const, status: "ingested" as const, runKey, supabaseRunId: expectedSupabaseRunId,
    complete: payload.complete, incomplete: payload.incomplete, chartSeriesCount: chartSeries.length,
  }
}

export async function ingestLatestReadyWyckoffRun() {
  const claim = await claimReadyWyckoffV2Run()
  if (claim.status === "idle") return claim
  return publishIngestingWyckoffV2Run(claim.runKey, claim.supabaseRunId)
}
