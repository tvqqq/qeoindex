import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import { createDataSourcePage, isNotionConfigured, queryDataSource, updatePageProperties } from "@/lib/notion/client"
import { pageProperties, richText } from "@/lib/notion/properties"
import type { CanonicalUniverseStock } from "@/lib/market-universe"

export const TOP_STOCKS_200_UNIVERSE_HISTORY_DATA_SOURCE_ID = process.env.NOTION_TOP_STOCKS_UNIVERSE_HISTORY_DATA_SOURCE_ID || "af1c5fac-8e28-42ac-8e08-c322cb2dcdf7"
export const TOP_STOCKS_200_EOD_ARCHIVE_DATA_SOURCE_ID = process.env.NOTION_TOP_STOCKS_EOD_ARCHIVE_DATA_SOURCE_ID || "a00636bc-4fa6-4f9a-9c1c-11ff04b1314c"
export const TOP_STOCKS_200_EOD_RUNS_DATA_SOURCE_ID = process.env.NOTION_TOP_STOCKS_EOD_RUNS_DATA_SOURCE_ID || "ea4f1552-dff1-434b-a647-ac7cb0330932"
export const EOD_ARCHIVE_VERSION = "top-stocks-200-eod-archive-v1" as const

export interface EodArchiveProgress {
  requested: number
  archived: number
  failed: number
  errors: string[]
}

export interface EodArchiveCheckpoint {
  status: "archived" | "partial" | "blocked" | "skipped" | "error"
  archived?: number
  requested?: number
  detail?: string
  manifestUrl?: string | null
}

function titleProperty(value: string) {
  return { title: [{ type: "text", text: { content: value.slice(0, 1900) } }] }
}
function textProperty(value: unknown) {
  const text = typeof value === "string" ? value : value == null ? "" : JSON.stringify(value)
  return { rich_text: text ? [{ type: "text", text: { content: text.slice(0, 1900) } }] : [] }
}
function numberProperty(value: unknown) {
  const parsed = Number(value)
  return { number: Number.isFinite(parsed) ? parsed : null }
}
function dateProperty(value: string | null | undefined) {
  return { date: value ? { start: value } : null }
}
function selectProperty(value: string | null | undefined) {
  return { select: value ? { name: value } : null }
}
function checkboxProperty(value: boolean) {
  return { checkbox: value }
}
function urlProperty(value: string | null | undefined) {
  return { url: value || null }
}

async function findPageByRichText(dataSourceId: string, property: string, value: string) {
  const result = await queryDataSource(dataSourceId, {
    filter: { property, rich_text: { equals: value } },
    pageSize: 10,
    errorContext: `Notion archive lookup ${property}`,
    timeoutMs: 12_000,
  })
  if (result.results.length > 1) throw new Error(`Duplicate Notion archive ${property}: ${value}`)
  return result.results[0] || null
}

async function upsertArchivePage(dataSourceId: string, keyProperty: string, key: string, properties: Record<string, unknown>) {
  const existing = await findPageByRichText(dataSourceId, keyProperty, key)
  if (existing) {
    await updatePageProperties(existing.id, properties, { errorContext: `Notion archive update ${key}`, timeoutMs: 15_000 })
    return "updated" as const
  }
  await createDataSourcePage(dataSourceId, properties, { errorContext: `Notion archive create ${key}`, timeoutMs: 15_000 })
  return "created" as const
}

function compactWyckoff(row: Record<string, unknown> | undefined) {
  if (!row) return ""
  return [row.phase, row.wyckoff_state, row.ta_bias, row.confidence]
    .filter((value) => typeof value === "string" && value)
    .join(" | ")
}

function llmSummary(row: Record<string, unknown> | undefined) {
  if (!row) return ""
  const chair = row.chair_payload
  if (chair && typeof chair === "object") return JSON.stringify(chair).slice(0, 1800)
  return String(row.status || "")
}

export async function archiveCanonicalUniverseBatchToNotion(input: {
  universeRunId: string
  sourceDate: string
  minMarketCapBillion: number
  minAverageVolume50d: number
  stocks: CanonicalUniverseStock[]
  activityPositiveDays?: Map<string, number>
}) {
  if (!isNotionConfigured()) return { status: "blocked" as const, archived: 0, requested: input.stocks.length, detail: "NOTION_API_KEY is not configured" }
  let archived = 0
  const errors: string[] = []
  for (const stock of input.stocks) {
    const key = `${input.universeRunId}|${stock.ticker}`
    try {
      await upsertArchivePage(TOP_STOCKS_200_UNIVERSE_HISTORY_DATA_SOURCE_ID, "Universe Run ID", input.universeRunId, {
        Membership: titleProperty(key),
        "Universe Key": textProperty("vn_top_stocks"),
        "Universe Run ID": textProperty(input.universeRunId),
        "Effective From": dateProperty(input.sourceDate),
        "Effective To": dateProperty(null),
        Active: checkboxProperty(true),
        Rank: numberProperty(stock.rank),
        Ticker: textProperty(stock.ticker),
        Company: textProperty(stock.companyName || stock.ticker),
        Exchange: selectProperty(stock.exchange || "HOSE"),
        Sector: textProperty(stock.sector || ""),
        "Market Cap Bn VND": numberProperty(stock.marketCapBillion),
        "Avg Vol 50D": numberProperty(stock.averageVolume50d),
        "Min Market Cap Bn": numberProperty(input.minMarketCapBillion),
        "Min Avg Vol 50D": numberProperty(input.minAverageVolume50d),
        "Activity Observation Days": numberProperty(5),
        "Min Active Days": numberProperty(4),
        "Activity Positive Days": numberProperty(input.activityPositiveDays?.get(stock.ticker) ?? 5),
        "Source As Of Date": dateProperty(input.sourceDate),
        "Detail Complete": checkboxProperty(stock.detailComplete),
        "Logo Kind": selectProperty(stock.logoKind),
        "Logo Path": textProperty(stock.logoPath),
        "Selector Version": textProperty("market-universe-daily-activity-v1"),
        "Archived At": dateProperty(new Date().toISOString()),
      })
      archived += 1
    } catch (error) {
      errors.push(`${stock.ticker}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return {
    status: errors.length ? (archived ? "partial" as const : "error" as const) : "archived" as const,
    archived,
    requested: input.stocks.length,
    errors: errors.slice(0, 20),
  }
}

export async function archiveEodTickerBatchToNotion(
  supabase: SupabaseClient,
  input: {
    tradingDate: string
    universeRunId: string
    validationHash: string
    stocks: CanonicalUniverseStock[]
    driveManifestUrl?: string | null
  },
): Promise<EodArchiveCheckpoint> {
  if (!isNotionConfigured()) return { status: "blocked", requested: input.stocks.length, archived: 0, detail: "NOTION_API_KEY is not configured" }
  const tickers = input.stocks.map((stock) => stock.ticker)
  if (!tickers.length) return { status: "skipped", requested: 0, archived: 0, detail: "Empty archive batch" }

  const [ratingsResult, wyckoffResult, councilResult, llmResult] = await Promise.all([
    supabase.from("insights_stock_ratings")
      .select("ticker,kfsp_composite_score,kfsp_score_4m,kfsp_canslim_score,kfsp_stock_rs_score,market_cap_billion,average_volume_50_sessions")
      .eq("source", "kfsp").eq("is_published", true).eq("as_of_date", input.tradingDate).in("ticker", tickers),
    supabase.from("wyckoff_latest_by_timeframe")
      .select("ticker,timeframe,phase,wyckoff_state,ta_bias,confidence,support,resistance,scenarios")
      .in("ticker", tickers).in("timeframe", ["1H", "4H", "1D", "1W", "1M"]),
    supabase.from("ai_council_runs")
      .select("ticker,signal,council_score,confidence,risk_status,support,resistance,bull_case,bear_case,evidence_hash,decision_payload,policy_version")
      .eq("as_of_date", input.tradingDate).in("ticker", tickers),
    supabase.from("ai_council_llm_debates")
      .select("ticker,status,chair_payload,evidence_hash")
      .eq("as_of_date", input.tradingDate).in("ticker", tickers),
  ])
  for (const result of [ratingsResult, wyckoffResult, councilResult, llmResult]) {
    if (result.error) throw new Error(`Load EOD archive evidence failed: ${result.error.message}`)
  }

  const ratings = new Map((ratingsResult.data || []).map((row) => [String(row.ticker), row as Record<string, unknown>]))
  const council = new Map((councilResult.data || []).map((row) => [String(row.ticker), row as Record<string, unknown>]))
  const llm = new Map((llmResult.data || []).map((row) => [String(row.ticker), row as Record<string, unknown>]))
  const wyckoff = new Map<string, Record<string, unknown>>()
  for (const row of (wyckoffResult.data || []) as Record<string, unknown>[]) {
    wyckoff.set(`${String(row.ticker)}|${String(row.timeframe)}`, row)
  }

  let archived = 0
  const errors: string[] = []
  for (const stock of input.stocks) {
    const ticker = stock.ticker
    const rating = ratings.get(ticker) || {}
    const deterministic = council.get(ticker) || {}
    const debate = llm.get(ticker)
    const oneDay = wyckoff.get(`${ticker}|1D`)
    const archiveKey = `${input.tradingDate}|${input.universeRunId}|${ticker}`
    try {
      await upsertArchivePage(TOP_STOCKS_200_EOD_ARCHIVE_DATA_SOURCE_ID, "Archive Key", archiveKey, {
        "Archive Key": titleProperty(archiveKey),
        "Trading Date": dateProperty(input.tradingDate),
        "Universe Key": textProperty("vn_top_stocks"),
        "Universe Run ID": textProperty(input.universeRunId),
        "Universe Rank": numberProperty(stock.rank),
        Ticker: textProperty(ticker),
        Company: textProperty(stock.companyName || ticker),
        Exchange: selectProperty(stock.exchange || "HOSE"),
        Sector: textProperty(stock.sector || ""),
        "Qeo Composite": numberProperty(rating.kfsp_composite_score),
        "KFSP 4M": numberProperty(rating.kfsp_score_4m),
        CANSLIM: numberProperty(rating.kfsp_canslim_score),
        "RS Score": numberProperty(rating.kfsp_stock_rs_score),
        "Market Cap Bn VND": numberProperty(rating.market_cap_billion ?? stock.marketCapBillion),
        "Avg Vol 50D": numberProperty(rating.average_volume_50_sessions ?? stock.averageVolume50d),
        "Wyckoff 1H": textProperty(compactWyckoff(wyckoff.get(`${ticker}|1H`))),
        "Wyckoff 4H": textProperty(compactWyckoff(wyckoff.get(`${ticker}|4H`))),
        "Wyckoff 1D": textProperty(compactWyckoff(oneDay)),
        "Wyckoff 1W": textProperty(compactWyckoff(wyckoff.get(`${ticker}|1W`))),
        "Wyckoff 1M": textProperty(compactWyckoff(wyckoff.get(`${ticker}|1M`))),
        "TA Bias": selectProperty(typeof oneDay?.ta_bias === "string" ? oneDay.ta_bias : "Neutral"),
        Confidence: selectProperty(typeof oneDay?.confidence === "string" ? oneDay.confidence : "LOW"),
        Support: textProperty(deterministic.support ?? oneDay?.support ?? ""),
        Resistance: textProperty(deterministic.resistance ?? oneDay?.resistance ?? ""),
        "Bull Case": textProperty(deterministic.bull_case),
        "Base Case": textProperty(deterministic.decision_payload),
        "Bear Case": textProperty(deterministic.bear_case),
        "AI Deterministic": textProperty({ signal: deterministic.signal, score: deterministic.council_score, confidence: deterministic.confidence, risk: deterministic.risk_status }),
        "AI LLM": textProperty(llmSummary(debate)),
        Recommendation: textProperty(deterministic.signal || ""),
        "Evidence Hash": textProperty(deterministic.evidence_hash || debate?.evidence_hash || ""),
        "Validation Hash": textProperty(input.validationHash),
        "Engine Version": textProperty(deterministic.policy_version || EOD_ARCHIVE_VERSION),
        "Drive Archive": urlProperty(input.driveManifestUrl),
        "Archive Status": selectProperty("Archived"),
        "Archived At": dateProperty(new Date().toISOString()),
      })
      archived += 1
    } catch (error) {
      errors.push(`${ticker}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return {
    status: errors.length ? (archived ? "partial" : "error") : "archived",
    archived,
    requested: input.stocks.length,
    detail: errors.slice(0, 10).join(" | ") || undefined,
    manifestUrl: input.driveManifestUrl || null,
  }
}

export async function archiveEodRunToNotion(input: {
  tradingDate: string
  eodRunId: string
  status: "Running" | "Succeeded" | "Partial" | "Failed" | "Skipped"
  universeRunId: string
  universeCount: number
  expectedSnapshots: number
  completedSnapshots: number
  deterministicExpected: number
  deterministicCompleted: number
  llmCandidates: number
  llmCompleted: number
  validationHash: string
  startedAt: string
  completedAt?: string | null
  notionArchive: EodArchiveCheckpoint
  driveArchive: EodArchiveCheckpoint
  retention: EodArchiveCheckpoint
  errorCode?: string
  errorSummary?: string
}) {
  if (!isNotionConfigured()) return { status: "blocked" as const, detail: "NOTION_API_KEY is not configured" }
  const runKey = `${input.tradingDate}|${input.eodRunId}`
  await upsertArchivePage(TOP_STOCKS_200_EOD_RUNS_DATA_SOURCE_ID, "EOD Run ID", input.eodRunId, {
    Run: titleProperty(runKey),
    "Trading Date": dateProperty(input.tradingDate),
    "EOD Run ID": textProperty(input.eodRunId),
    Status: selectProperty(input.status),
    "Universe Key": textProperty("vn_top_stocks"),
    "Universe Run ID": textProperty(input.universeRunId),
    "Universe Count": numberProperty(input.universeCount),
    "Wyckoff Timeframes": numberProperty(5),
    "Wyckoff Expected": numberProperty(input.expectedSnapshots),
    "Wyckoff Completed": numberProperty(input.completedSnapshots),
    "AI Deterministic Expected": numberProperty(input.deterministicExpected),
    "AI Deterministic Completed": numberProperty(input.deterministicCompleted),
    "AI LLM Candidates": numberProperty(input.llmCandidates),
    "AI LLM Completed": numberProperty(input.llmCompleted),
    "Market Synthesis Status": selectProperty("Succeeded"),
    "Notion Archive Status": selectProperty(input.notionArchive.status === "archived" ? "Archived" : input.notionArchive.status === "partial" ? "Partial" : input.notionArchive.status === "skipped" ? "Skipped" : "Error"),
    "Drive Archive Status": selectProperty(input.driveArchive.status === "archived" ? "Archived" : input.driveArchive.status === "partial" ? "Partial" : input.driveArchive.status === "blocked" ? "Blocked" : input.driveArchive.status === "skipped" ? "Skipped" : "Error"),
    "Retention Status": selectProperty(input.retention.status === "archived" ? "Succeeded" : input.retention.status === "blocked" ? "Blocked" : input.retention.status === "skipped" ? "Skipped" : "Failed"),
    "Started At": dateProperty(input.startedAt),
    "Completed At": dateProperty(input.completedAt || null),
    "Duration Ms": numberProperty(input.completedAt ? Math.max(0, new Date(input.completedAt).getTime() - new Date(input.startedAt).getTime()) : null),
    "Validation Hash": textProperty(input.validationHash),
    "Engine Version": textProperty("qeoindex-eod-v3"),
    "Archive Version": textProperty(EOD_ARCHIVE_VERSION),
    "Error Code": textProperty(input.errorCode || ""),
    "Error Summary": textProperty(input.errorSummary || ""),
    "Drive Manifest": urlProperty(input.driveArchive.manifestUrl),
  })
  return { status: "archived" as const }
}

export async function runEodDriveArchive(): Promise<EodArchiveCheckpoint> {
  const serviceAccount = process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON?.trim()
  const folderId = process.env.GOOGLE_DRIVE_ARCHIVE_FOLDER_ID?.trim()
  if (!serviceAccount || !folderId) {
    return {
      status: "blocked",
      detail: "Google Drive runtime archive credentials are not configured; raw Supabase data is retained.",
      manifestUrl: null,
    }
  }
  return {
    status: "blocked",
    detail: "Google Drive credentials are present but the production raw-archive writer is not enabled in this release; raw Supabase data is retained.",
    manifestUrl: null,
  }
}

export async function runEodRetentionCleanup(input: {
  notionArchive: EodArchiveCheckpoint
  driveArchive: EodArchiveCheckpoint
}): Promise<EodArchiveCheckpoint> {
  if (input.notionArchive.status !== "archived") {
    return { status: "blocked", detail: `Retention blocked: Notion archive status=${input.notionArchive.status}` }
  }
  if (input.driveArchive.status !== "archived") {
    return { status: "blocked", detail: `Retention blocked: Drive archive status=${input.driveArchive.status}` }
  }
  return {
    status: "blocked",
    detail: "Retention blocked until the raw Drive archive writer verifies manifest hashes and row counts.",
  }
}
