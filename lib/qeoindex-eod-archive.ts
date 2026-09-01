import "server-only"

import { createHash, createSign, randomUUID } from "node:crypto"
import { gzipSync } from "node:zlib"
import type { SupabaseClient } from "@supabase/supabase-js"

import {
  createDataSourcePage,
  isNotionConfigured,
  queryDataSource,
  updatePageProperties,
} from "@/lib/notion/client"
import type { CanonicalUniverseStock } from "@/lib/market-universe"

export const TOP_STOCKS_200_UNIVERSE_HISTORY_DATA_SOURCE_ID = process.env.NOTION_TOP_STOCKS_UNIVERSE_HISTORY_DATA_SOURCE_ID
  || "af1c5fac-8e28-42ac-8e08-c322cb2dcdf7"
export const TOP_STOCKS_200_EOD_ARCHIVE_DATA_SOURCE_ID = process.env.NOTION_TOP_STOCKS_EOD_ARCHIVE_DATA_SOURCE_ID
  || "a00636bc-4fa6-4f9a-9c1c-11ff04b1314c"
export const TOP_STOCKS_200_EOD_RUNS_DATA_SOURCE_ID = process.env.NOTION_TOP_STOCKS_EOD_RUNS_DATA_SOURCE_ID
  || "ea4f1552-dff1-434b-a647-ac7cb0330932"
export const EOD_ARCHIVE_VERSION = "top-stocks-200-eod-archive-v1" as const

export interface EodArchiveCheckpoint {
  status: "archived" | "partial" | "blocked" | "skipped" | "error"
  archived?: number
  requested?: number
  rowCount?: number
  detail?: string
  manifestUrl?: string | null
  manifestSha256?: string | null
}

type NotionKeyType = "title" | "rich_text"

type OhlcvArchiveRow = {
  ticker: string
  timeframe: "1D" | "1H"
  bar_time: string
  open: number | string
  high: number | string
  low: number | string
  close: number | string
  volume: number | string
  provider: string
  provider_detail: string
  source_url: string
  fetched_at: string
}

type DriveServiceAccount = {
  client_email: string
  private_key: string
  token_uri?: string
}

type DriveUploadResult = {
  id: string
  webViewLink?: string
  name?: string
}

function titleProperty(value: string) {
  return { title: [{ type: "text", text: { content: value.slice(0, 1900) } }] }
}

function textProperty(value: unknown) {
  const text = typeof value === "string" ? value : value == null ? "" : JSON.stringify(value)
  return {
    rich_text: text
      ? [{ type: "text", text: { content: text.slice(0, 1900) } }]
      : [],
  }
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

async function findArchivePage(
  dataSourceId: string,
  property: string,
  value: string,
  keyType: NotionKeyType,
) {
  const result = await queryDataSource(dataSourceId, {
    filter: { property, [keyType]: { equals: value } },
    pageSize: 10,
    errorContext: `Notion archive lookup ${property}`,
    timeoutMs: 12_000,
  })
  if (result.results.length > 1) throw new Error(`Duplicate Notion archive ${property}: ${value}`)
  return result.results[0] || null
}

async function upsertArchivePage(
  dataSourceId: string,
  keyProperty: string,
  key: string,
  keyType: NotionKeyType,
  properties: Record<string, unknown>,
) {
  const existing = await findArchivePage(dataSourceId, keyProperty, key, keyType)
  if (existing) {
    await updatePageProperties(existing.id, properties, {
      errorContext: `Notion archive update ${key}`,
      timeoutMs: 15_000,
    })
    return "updated" as const
  }
  await createDataSourcePage(dataSourceId, properties, {
    errorContext: `Notion archive create ${key}`,
    timeoutMs: 15_000,
  })
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
  if (row.chair_payload && typeof row.chair_payload === "object") {
    return JSON.stringify(row.chair_payload).slice(0, 1800)
  }
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
  if (!isNotionConfigured()) {
    return {
      status: "blocked" as const,
      archived: 0,
      requested: input.stocks.length,
      detail: "NOTION_API_KEY is not configured",
    }
  }

  let archived = 0
  const errors: string[] = []
  for (const stock of input.stocks) {
    const membershipKey = `${input.universeRunId}|${stock.ticker}`
    try {
      await upsertArchivePage(
        TOP_STOCKS_200_UNIVERSE_HISTORY_DATA_SOURCE_ID,
        "Membership",
        membershipKey,
        "title",
        {
          Membership: titleProperty(membershipKey),
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
        },
      )
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
  if (!isNotionConfigured()) {
    return {
      status: "blocked",
      requested: input.stocks.length,
      archived: 0,
      detail: "NOTION_API_KEY is not configured",
    }
  }
  const tickers = input.stocks.map((stock) => stock.ticker)
  if (!tickers.length) return { status: "skipped", requested: 0, archived: 0, detail: "Empty archive batch" }

  const [ratingsResult, wyckoffResult, councilResult, llmResult] = await Promise.all([
    supabase.from("insights_stock_ratings")
      .select("ticker,kfsp_composite_score,kfsp_score_4m,kfsp_canslim_score,kfsp_stock_rs_score,market_cap_billion,average_volume_50_sessions")
      .eq("source", "kfsp")
      .eq("is_published", true)
      .eq("as_of_date", input.tradingDate)
      .in("ticker", tickers),
    supabase.from("wyckoff_latest_by_timeframe")
      .select("ticker,timeframe,phase,wyckoff_state,ta_bias,confidence,support,resistance,scenarios")
      .in("ticker", tickers)
      .in("timeframe", ["1H", "4H", "1D", "1W", "1M"]),
    supabase.from("ai_council_runs")
      .select("ticker,signal,council_score,confidence,risk_status,support,resistance,bull_case,bear_case,evidence_hash,decision_payload,policy_version")
      .eq("as_of_date", input.tradingDate)
      .in("ticker", tickers),
    supabase.from("ai_council_llm_debates")
      .select("ticker,status,chair_payload,evidence_hash")
      .eq("as_of_date", input.tradingDate)
      .in("ticker", tickers),
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
      await upsertArchivePage(
        TOP_STOCKS_200_EOD_ARCHIVE_DATA_SOURCE_ID,
        "Archive Key",
        archiveKey,
        "title",
        {
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
          "AI Deterministic": textProperty({
            signal: deterministic.signal,
            score: deterministic.council_score,
            confidence: deterministic.confidence,
            risk: deterministic.risk_status,
          }),
          "AI LLM": textProperty(llmSummary(debate)),
          Recommendation: textProperty(deterministic.signal || ""),
          "Evidence Hash": textProperty(deterministic.evidence_hash || debate?.evidence_hash || ""),
          "Validation Hash": textProperty(input.validationHash),
          "Engine Version": textProperty(deterministic.policy_version || EOD_ARCHIVE_VERSION),
          "Drive Archive": urlProperty(input.driveManifestUrl),
          "Archive Status": selectProperty("Archived"),
          "Archived At": dateProperty(new Date().toISOString()),
        },
      )
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
  await upsertArchivePage(
    TOP_STOCKS_200_EOD_RUNS_DATA_SOURCE_ID,
    "EOD Run ID",
    input.eodRunId,
    "rich_text",
    {
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
      "Market Synthesis Status": selectProperty(input.status === "Failed" ? "Failed" : "Succeeded"),
      "Notion Archive Status": selectProperty(
        input.notionArchive.status === "archived"
          ? "Archived"
          : input.notionArchive.status === "partial"
            ? "Partial"
            : input.notionArchive.status === "skipped"
              ? "Skipped"
              : "Error",
      ),
      "Drive Archive Status": selectProperty(
        input.driveArchive.status === "archived"
          ? "Archived"
          : input.driveArchive.status === "partial"
            ? "Partial"
            : input.driveArchive.status === "blocked"
              ? "Blocked"
              : input.driveArchive.status === "skipped"
                ? "Skipped"
                : "Error",
      ),
      "Retention Status": selectProperty(
        input.retention.status === "archived"
          ? "Succeeded"
          : input.retention.status === "blocked"
            ? "Blocked"
            : input.retention.status === "skipped"
              ? "Skipped"
              : "Failed",
      ),
      "Started At": dateProperty(input.startedAt),
      "Completed At": dateProperty(input.completedAt || null),
      "Duration Ms": numberProperty(
        input.completedAt
          ? Math.max(0, new Date(input.completedAt).getTime() - new Date(input.startedAt).getTime())
          : null,
      ),
      "Validation Hash": textProperty(input.validationHash),
      "Engine Version": textProperty("qeoindex-eod-v3"),
      "Archive Version": textProperty(EOD_ARCHIVE_VERSION),
      "Error Code": textProperty(input.errorCode || ""),
      "Error Summary": textProperty(input.errorSummary || ""),
      "Drive Manifest": urlProperty(input.driveArchive.manifestUrl),
    },
  )
  return { status: "archived" as const }
}

function base64Url(value: string | Uint8Array) {
  return Buffer.from(value).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")
}

function parseDriveServiceAccount(): DriveServiceAccount | null {
  const raw = process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON?.trim()
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<DriveServiceAccount>
    if (!parsed.client_email || !parsed.private_key) return null
    return {
      client_email: parsed.client_email,
      private_key: parsed.private_key,
      token_uri: parsed.token_uri || "https://oauth2.googleapis.com/token",
    }
  } catch {
    return null
  }
}

async function driveAccessToken(account: DriveServiceAccount) {
  const now = Math.floor(Date.now() / 1000)
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }))
  const claims = base64Url(JSON.stringify({
    iss: account.client_email,
    scope: "https://www.googleapis.com/auth/drive",
    aud: account.token_uri || "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }))
  const unsigned = `${header}.${claims}`
  const signer = createSign("RSA-SHA256")
  signer.update(unsigned)
  signer.end()
  const assertion = `${unsigned}.${base64Url(signer.sign(account.private_key))}`
  const response = await fetch(account.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
    signal: AbortSignal.timeout(20_000),
  })
  const payload = await response.json() as { access_token?: string; error?: string; error_description?: string }
  if (!response.ok || !payload.access_token) {
    throw new Error(`Google Drive token failed: ${payload.error_description || payload.error || response.status}`)
  }
  return payload.access_token
}

async function driveJson<T>(token: string, url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.headers || {}),
    },
    signal: init?.signal || AbortSignal.timeout(30_000),
  })
  const payload = await response.json() as T
  if (!response.ok) throw new Error(`Google Drive API failed (${response.status}): ${JSON.stringify(payload).slice(0, 500)}`)
  return payload
}

async function ensureDriveFolder(token: string, parentId: string, name: string) {
  const escapedName = name.replace(/'/g, "\\'")
  const query = `'${parentId}' in parents and name='${escapedName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`
  const params = new URLSearchParams({ q: query, fields: "files(id,name)", pageSize: "10" })
  const existing = await driveJson<{ files?: Array<{ id: string; name: string }> }>(
    token,
    `https://www.googleapis.com/drive/v3/files?${params.toString()}`,
  )
  if (existing.files?.[0]?.id) return existing.files[0].id
  const created = await driveJson<{ id: string }>(token, "https://www.googleapis.com/drive/v3/files?fields=id", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId],
    }),
  })
  if (!created.id) throw new Error(`Google Drive folder create returned no id: ${name}`)
  return created.id
}

async function uploadDriveFile(
  token: string,
  parentId: string,
  name: string,
  mimeType: string,
  bytes: Uint8Array,
): Promise<DriveUploadResult> {
  const boundary = `qeo-${randomUUID()}`
  const prefix = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`
    + `${JSON.stringify({ name, parents: [parentId] })}\r\n`
    + `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
  )
  const suffix = Buffer.from(`\r\n--${boundary}--\r\n`)
  const body = Buffer.concat([prefix, Buffer.from(bytes), suffix])
  const response = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body: new Uint8Array(body),
      signal: AbortSignal.timeout(45_000),
    },
  )
  const payload = await response.json() as DriveUploadResult & { error?: unknown }
  if (!response.ok || !payload.id) {
    throw new Error(`Google Drive upload failed (${response.status}): ${JSON.stringify(payload).slice(0, 500)}`)
  }
  return payload
}

function csvCell(value: unknown) {
  const text = value == null ? "" : String(value)
  if (!/[",\n\r]/.test(text)) return text
  return `"${text.replace(/"/g, '""')}"`
}

function ohlcvCsv(rows: OhlcvArchiveRow[]) {
  const header = [
    "ticker", "timeframe", "bar_time", "open", "high", "low", "close", "volume",
    "provider", "provider_detail", "source_url", "fetched_at",
  ]
  const lines = rows.map((row) => header.map((key) => csvCell(row[key as keyof OhlcvArchiveRow])).join(","))
  return `${header.join(",")}\n${lines.join("\n")}\n`
}

function nextDate(date: string) {
  const next = new Date(`${date}T00:00:00.000Z`)
  next.setUTCDate(next.getUTCDate() + 1)
  return next.toISOString()
}

async function loadDailyArchiveRows(
  supabase: SupabaseClient,
  tickers: string[],
  tradingDate: string,
) {
  const start = `${tradingDate}T00:00:00.000Z`
  const end = nextDate(tradingDate)
  const rows: OhlcvArchiveRow[] = []
  for (let offset = 0; offset < tickers.length; offset += 50) {
    const batch = tickers.slice(offset, offset + 50)
    const result = await supabase
      .from("market_ohlcv_history")
      .select("ticker,timeframe,bar_time,open,high,low,close,volume,provider,provider_detail,source_url,fetched_at")
      .in("ticker", batch)
      .in("timeframe", ["1D", "1H"])
      .gte("bar_time", start)
      .lt("bar_time", end)
      .order("bar_time", { ascending: true })
    if (result.error) throw new Error(`Load Drive archive OHLCV failed: ${result.error.message}`)
    rows.push(...((result.data || []) as OhlcvArchiveRow[]))
  }
  return rows
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>) {
  const output = new Array<R>(items.length)
  let cursor = 0
  async function worker() {
    while (true) {
      const index = cursor
      cursor += 1
      if (index >= items.length) return
      output[index] = await fn(items[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()))
  return output
}

export async function runEodDriveArchive(
  supabase: SupabaseClient,
  input: {
    tradingDate: string
    universeRunId: string
    validationHash: string
    stocks: CanonicalUniverseStock[]
  },
): Promise<EodArchiveCheckpoint> {
  const account = parseDriveServiceAccount()
  const archiveRootId = process.env.GOOGLE_DRIVE_ARCHIVE_FOLDER_ID?.trim()
  if (!account || !archiveRootId) {
    return {
      status: "blocked",
      detail: "Google Drive runtime archive credentials are not configured; raw Supabase data is retained.",
      manifestUrl: null,
    }
  }

  const tickers = input.stocks.map((stock) => stock.ticker)
  const rows = await loadDailyArchiveRows(supabase, tickers, input.tradingDate)
  const dailyTickers = new Set(rows.filter((row) => row.timeframe === "1D").map((row) => row.ticker))
  const missingDaily = tickers.filter((ticker) => !dailyTickers.has(ticker))
  if (missingDaily.length) {
    return {
      status: "error",
      requested: tickers.length,
      archived: 0,
      rowCount: rows.length,
      detail: `Drive archive blocked by missing 1D rows: ${missingDaily.slice(0, 20).join(",")}`,
      manifestUrl: null,
    }
  }

  const token = await driveAccessToken(account)
  const [year, month] = input.tradingDate.split("-")
  const yearFolder = await ensureDriveFolder(token, archiveRootId, year)
  const monthFolder = await ensureDriveFolder(token, yearFolder, month)
  const timeframeFolders = {
    "1D": await ensureDriveFolder(token, monthFolder, "1D"),
    "1H": await ensureDriveFolder(token, monthFolder, "1H"),
  }

  const groups = new Map<string, OhlcvArchiveRow[]>()
  for (const row of rows) {
    const key = `${row.timeframe}|${row.ticker}`
    const bucket = groups.get(key) || []
    bucket.push(row)
    groups.set(key, bucket)
  }

  const manifestEntries = await mapWithConcurrency([...groups.entries()], 5, async ([key, group]) => {
    const [timeframe, ticker] = key.split("|") as ["1D" | "1H", string]
    const csv = ohlcvCsv(group)
    const gzip = gzipSync(Buffer.from(csv, "utf8"), { level: 9 })
    const sha256 = createHash("sha256").update(gzip).digest("hex")
    const fileName = `${ticker}-${input.tradingDate}.csv.gz`
    const uploaded = await uploadDriveFile(
      token,
      timeframeFolders[timeframe],
      fileName,
      "application/gzip",
      gzip,
    )
    return {
      ticker,
      timeframe,
      rowCount: group.length,
      sha256,
      fileId: uploaded.id,
      fileName,
      webViewLink: uploaded.webViewLink || `https://drive.google.com/file/d/${uploaded.id}/view`,
    }
  })

  const manifest = {
    archiveVersion: EOD_ARCHIVE_VERSION,
    tradingDate: input.tradingDate,
    universeKey: "vn_top_stocks",
    universeRunId: input.universeRunId,
    validationHash: input.validationHash,
    generatedAt: new Date().toISOString(),
    rowCount: rows.length,
    entries: manifestEntries.sort((left, right) => `${left.timeframe}|${left.ticker}`.localeCompare(`${right.timeframe}|${right.ticker}`)),
  }
  const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2), "utf8")
  const manifestSha256 = createHash("sha256").update(manifestBytes).digest("hex")
  const manifestUpload = await uploadDriveFile(
    token,
    monthFolder,
    `manifest-${input.tradingDate}.json`,
    "application/json",
    manifestBytes,
  )
  const manifestUrl = manifestUpload.webViewLink || `https://drive.google.com/file/d/${manifestUpload.id}/view`

  const checkpoint = await supabase.from("eod_archive_checkpoints").upsert({
    trading_date: input.tradingDate,
    universe_run_id: input.universeRunId,
    universe_count: tickers.length,
    validation_hash: input.validationHash,
    drive_status: "archived",
    drive_manifest_url: manifestUrl,
    drive_manifest_sha256: manifestSha256,
    drive_row_count: rows.length,
    drive_file_count: manifestEntries.length,
    archived_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }, { onConflict: "trading_date" })
  if (checkpoint.error) throw new Error(`Persist Drive archive checkpoint failed: ${checkpoint.error.message}`)

  return {
    status: "archived",
    requested: groups.size,
    archived: manifestEntries.length,
    rowCount: rows.length,
    manifestUrl,
    manifestSha256,
  }
}

async function retentionDelete(
  supabase: SupabaseClient,
  table: string,
  column: string,
  cutoff: string,
) {
  const result = await supabase.from(table).delete().lt(column, cutoff)
  if (result.error) throw new Error(`Retention delete ${table} failed: ${result.error.message}`)
}

export async function runEodRetentionCleanup(
  supabase: SupabaseClient,
  input: {
    tradingDate: string
    notionArchive: EodArchiveCheckpoint
    driveArchive: EodArchiveCheckpoint
  },
): Promise<EodArchiveCheckpoint> {
  if (input.notionArchive.status !== "archived") {
    return { status: "blocked", detail: `Retention blocked: Notion archive status=${input.notionArchive.status}` }
  }
  if (input.driveArchive.status !== "archived") {
    return { status: "blocked", detail: `Retention blocked: Drive archive status=${input.driveArchive.status}` }
  }

  const checkpointUpdate = await supabase.from("eod_archive_checkpoints").upsert({
    trading_date: input.tradingDate,
    notion_status: "archived",
    drive_status: "archived",
    drive_manifest_url: input.driveArchive.manifestUrl || null,
    drive_manifest_sha256: input.driveArchive.manifestSha256 || null,
    updated_at: new Date().toISOString(),
  }, { onConflict: "trading_date" })
  if (checkpointUpdate.error) {
    return { status: "error", detail: `Retention checkpoint update failed: ${checkpointUpdate.error.message}` }
  }

  if (process.env.GOOGLE_DRIVE_RETENTION_BACKFILL_COMPLETE !== "true") {
    return {
      status: "blocked",
      detail: "Retention blocked until historical Drive backfill is explicitly verified and GOOGLE_DRIVE_RETENTION_BACKFILL_COMPLETE=true.",
    }
  }

  const preflight = await supabase.rpc("qeo_archive_retention_preflight", {
    p_reference_date: input.tradingDate,
  })
  if (preflight.error) return { status: "error", detail: `Retention preflight failed: ${preflight.error.message}` }
  const preflightData = preflight.data as { safe?: boolean; missingDates?: string[] } | null
  if (!preflightData?.safe) {
    return {
      status: "blocked",
      detail: `Retention blocked by incomplete archive coverage: ${(preflightData?.missingDates || []).slice(0, 20).join(",") || "unknown dates"}`,
    }
  }

  const reference = new Date(`${input.tradingDate}T00:00:00.000Z`)
  const daysAgo = (days: number) => new Date(reference.getTime() - days * 86_400_000).toISOString()
  await retentionDelete(supabase, "market_ohlcv_history", "bar_time", daysAgo(480))
  const oneHourCutoff = daysAgo(90)
  const oneHourDelete = await supabase
    .from("market_ohlcv_history")
    .delete()
    .eq("timeframe", "1H")
    .lt("bar_time", oneHourCutoff)
  if (oneHourDelete.error) throw new Error(`Retention delete market_ohlcv_history 1H failed: ${oneHourDelete.error.message}`)

  await retentionDelete(supabase, "wyckoff_analysis_snapshots", "published_at", daysAgo(20))
  await retentionDelete(supabase, "ai_council_llm_evidence", "created_at", daysAgo(10))
  await retentionDelete(supabase, "ai_council_llm_research_contexts", "created_at", daysAgo(10))
  await retentionDelete(supabase, "ai_council_llm_debates", "created_at", daysAgo(10))
  await retentionDelete(supabase, "ai_council_runs", "created_at", daysAgo(45))
  await retentionDelete(supabase, "system_job_phases", "created_at", daysAgo(30))
  await retentionDelete(supabase, "system_job_runs", "created_at", daysAgo(30))

  const checkpoint = await supabase.from("eod_archive_checkpoints").update({
    retention_status: "succeeded",
    retention_completed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("trading_date", input.tradingDate)
  if (checkpoint.error) throw new Error(`Persist retention completion failed: ${checkpoint.error.message}`)

  return {
    status: "archived",
    detail: "Retention cleanup completed after Notion + Drive archive and historical coverage preflight.",
  }
}
