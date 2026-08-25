import {
  createDataSourcePage,
  queryDataSource,
  updatePageProperties,
  type NotionPage,
  type NotionProperties,
  type NotionQueryOptions,
  type NotionQueryResult,
} from "./notion/client.ts"
import { dateText, numberValue, pageProperties, selectText, urlText } from "./notion/properties.ts"
import {
  WYCKOFF_V2_AGGREGATION_VERSION,
  WYCKOFF_V2_MODEL_VERSION,
  WYCKOFF_V2_PROMPT_VERSION,
  type WyckoffV2Snapshot,
} from "./wyckoff-v2-builder.ts"
import { computeWyckoffV2ValidationHash, validateWyckoffV2SnapshotSet } from "./wyckoff-v2-contract.ts"
import type { TechnicalSnapshot } from "./technical-indicators.ts"
import type { WyckoffEventMarker, WyckoffScenario } from "./wyckoff-chart-model.ts"

export const WYCKOFF_V2_RUNS_DATA_SOURCE_ID = process.env.NOTION_WYCKOFF_RUNS_DATA_SOURCE_ID ?? "4efe8131-196a-4b4e-8a9c-dea48c51a554"
export const WYCKOFF_V2_SNAPSHOTS_DATA_SOURCE_ID = process.env.NOTION_WYCKOFF_SNAPSHOTS_DATA_SOURCE_ID ?? "f9d84b24-965a-4008-a339-5a62db409ecf"

const RICH_TEXT_CHUNK = 1900
const DEFAULT_WRITE_INTERVAL_MS = 360

function titleProperty(value: string) {
  return { title: [{ type: "text", text: { content: value.slice(0, RICH_TEXT_CHUNK) } }] }
}

function selectProperty(value: string | null) {
  return { select: value ? { name: value } : null }
}

function numberProperty(value: number | null | undefined) {
  return { number: typeof value === "number" && Number.isFinite(value) ? value : null }
}

function dateProperty(value: string | null | undefined) {
  return { date: value ? { start: value } : null }
}

function urlProperty(value: string | null | undefined) {
  return { url: value || null }
}

export function chunkedRichTextProperty(value: string | null | undefined) {
  if (!value) return { rich_text: [] }
  const chunks: Array<{ type: "text"; text: { content: string } }> = []
  for (let offset = 0; offset < value.length; offset += RICH_TEXT_CHUNK) {
    chunks.push({ type: "text", text: { content: value.slice(offset, offset + RICH_TEXT_CHUNK) } })
  }
  return { rich_text: chunks }
}

function jsonProperty(value: unknown) {
  return chunkedRichTextProperty(JSON.stringify(value))
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null
}

function propertyText(property: unknown, kind: "rich_text" | "title" = "rich_text") {
  const record = objectValue(property)
  const items = Array.isArray(record?.[kind]) ? record?.[kind] as unknown[] : []
  return items.map((item) => {
    const row = objectValue(item)
    if (typeof row?.plain_text === "string") return row.plain_text
    const text = objectValue(row?.text)
    return typeof text?.content === "string" ? text.content : ""
  }).join("")
}

function parseJson<T>(value: string, field: string): T {
  try {
    return JSON.parse(value) as T
  } catch {
    throw new Error(`${field} must be valid JSON`)
  }
}

export interface WyckoffV2RunPropertyInput {
  runKey: string
  scanDate: string
  status: "Writing" | "Ready" | "Ingesting" | "Ingested" | "Partial" | "Error"
  snapshotComplete: number
  snapshotIncomplete: number
  errorCount: number
  errorSummary: string
  startedAt: string
  completedAt?: string | null
  ingestedAt?: string | null
  providerSummary: string
  validationHash: string
  supabaseRunId?: string
}

export function buildWyckoffV2RunProperties(input: WyckoffV2RunPropertyInput) {
  return {
    Run: titleProperty(input.runKey),
    "Run Key": chunkedRichTextProperty(input.runKey),
    "Scan Date": dateProperty(input.scanDate),
    Status: selectProperty(input.status),
    "Universe Key": chunkedRichTextProperty("hose_top100"),
    "Universe Count": numberProperty(100),
    "Snapshot Expected": numberProperty(500),
    "Snapshot Complete": numberProperty(input.snapshotComplete),
    "Snapshot Incomplete": numberProperty(input.snapshotIncomplete),
    "Error Count": numberProperty(input.errorCount),
    "Error Summary": chunkedRichTextProperty(input.errorSummary),
    "Model Version": chunkedRichTextProperty(WYCKOFF_V2_MODEL_VERSION),
    "Aggregation Version": chunkedRichTextProperty(WYCKOFF_V2_AGGREGATION_VERSION),
    "Prompt Version": chunkedRichTextProperty(WYCKOFF_V2_PROMPT_VERSION),
    "Started At": dateProperty(input.startedAt),
    "Completed At": dateProperty(input.completedAt),
    "Ingested At": dateProperty(input.ingestedAt),
    "Provider Summary": chunkedRichTextProperty(input.providerSummary),
    "Validation Hash": chunkedRichTextProperty(input.validationHash),
    "Supabase Run ID": chunkedRichTextProperty(input.supabaseRunId ?? ""),
  }
}

export function buildWyckoffV2SnapshotProperties(row: WyckoffV2Snapshot) {
  return {
    Snapshot: titleProperty(row.snapshot),
    "Snapshot Key": chunkedRichTextProperty(row.snapshotKey),
    "Run Key": chunkedRichTextProperty(row.runKey),
    Ticker: chunkedRichTextProperty(row.ticker),
    Rank: numberProperty(row.rank),
    Exchange: selectProperty(row.exchange),
    Sector: chunkedRichTextProperty(row.sector),
    Timeframe: selectProperty(row.timeframe),
    "Bar Closed At": dateProperty(row.barClosedAt),
    "History Bar Count": numberProperty(row.historyBarCount),
    "History Status": selectProperty(row.historyStatus),
    Provider: chunkedRichTextProperty(row.provider),
    "Provider Detail": chunkedRichTextProperty(row.providerDetail),
    "Source URL": urlProperty(row.sourceUrl),
    "Fetched At": dateProperty(row.fetchedAt),
    "Model Version": chunkedRichTextProperty(row.modelVersion),
    "Aggregation Version": chunkedRichTextProperty(row.aggregationVersion),
    "Prompt Version": chunkedRichTextProperty(row.promptVersion),
    Phase: chunkedRichTextProperty(row.phase),
    "Wyckoff State": chunkedRichTextProperty(row.wyckoffState),
    "TA Bias": selectProperty(row.taBias),
    Confidence: selectProperty(row.confidence),
    "Bull Probability": numberProperty(row.bullProbability),
    "Base Probability": numberProperty(row.baseProbability),
    "Bear Probability": numberProperty(row.bearProbability),
    Support: chunkedRichTextProperty(row.support),
    Resistance: chunkedRichTextProperty(row.resistance),
    Confirmation: chunkedRichTextProperty(row.confirmation),
    Invalidation: chunkedRichTextProperty(row.invalidation),
    "What Changed": chunkedRichTextProperty(row.whatChanged),
    "Technical JSON": jsonProperty(row.technical),
    "Evidence JSON": jsonProperty(row.evidence),
    "Markers JSON": jsonProperty(row.markers),
    "Scenarios JSON": jsonProperty(row.scenarios),
    "Validation Status": selectProperty(row.validationStatus),
    "Validation Error": chunkedRichTextProperty(row.validationError),
  }
}

export interface WyckoffV2NotionIo {
  queryDataSource(dataSourceId: string, options?: NotionQueryOptions): Promise<NotionQueryResult>
  createDataSourcePage(dataSourceId: string, properties: NotionProperties, options?: { errorContext?: string; timeoutMs?: number }): Promise<NotionPage>
  updatePageProperties(pageId: string, properties: NotionProperties, options?: { errorContext?: string; timeoutMs?: number }): Promise<NotionPage>
}

const DEFAULT_NOTION_IO: WyckoffV2NotionIo = {
  queryDataSource,
  createDataSourcePage,
  updatePageProperties,
}

async function queryRunPages(runKey: string, io: WyckoffV2NotionIo) {
  return io.queryDataSource(WYCKOFF_V2_RUNS_DATA_SOURCE_ID, {
    filter: { property: "Run Key", rich_text: { equals: runKey } },
    pageSize: 10,
    errorContext: "Notion Wyckoff v2 run query",
  })
}

async function querySnapshotPages(runKey: string, io: WyckoffV2NotionIo) {
  const result = await io.queryDataSource(WYCKOFF_V2_SNAPSHOTS_DATA_SOURCE_ID, {
    filter: { property: "Run Key", rich_text: { equals: runKey } },
    pageSize: 100,
    maxPages: 5,
    errorContext: "Notion Wyckoff v2 snapshot query",
  })
  if (result.hasMore) throw new Error(`More than 500 Notion snapshots found for ${runKey}`)
  return result.results
}

function uniqueRunPage(runKey: string, pages: NotionPage[]) {
  const matches = pages.filter((page) => propertyText(pageProperties(page)["Run Key"]) === runKey)
  if (matches.length > 1) throw new Error(`Duplicate Notion Run Key: ${runKey}`)
  return matches[0] ?? null
}

export async function beginWyckoffV2NotionRun(
  input: { runKey: string; scanDate: string; startedAt: string; providerSummary: string },
  io: WyckoffV2NotionIo = DEFAULT_NOTION_IO,
) {
  const queried = await queryRunPages(input.runKey, io)
  let page = uniqueRunPage(input.runKey, queried.results)
  const currentStatus = page ? selectText(pageProperties(page).Status) : ""

  if (currentStatus === "Ingested" || currentStatus === "Ingesting") {
    return { action: "stop" as const, status: currentStatus as "Ingested" | "Ingesting", pageId: page!.id }
  }
  if (currentStatus === "Ready") {
    return { action: "ready" as const, status: "Ready" as const, pageId: page!.id }
  }

  const properties = buildWyckoffV2RunProperties({
    ...input,
    status: "Writing",
    snapshotComplete: 0,
    snapshotIncomplete: 0,
    errorCount: 0,
    errorSummary: "",
    validationHash: "",
  })
  page = page
    ? await io.updatePageProperties(page.id, properties, { errorContext: "Notion Wyckoff v2 run Writing update" })
    : await io.createDataSourcePage(WYCKOFF_V2_RUNS_DATA_SOURCE_ID, properties, { errorContext: "Notion Wyckoff v2 run create" })

  const readBack = uniqueRunPage(input.runKey, (await queryRunPages(input.runKey, io)).results)
  if (!readBack || selectText(pageProperties(readBack).Status) !== "Writing") {
    throw new Error(`NOTION_WRITE_UNAVAILABLE: could not read back Writing run ${input.runKey}`)
  }
  return { action: "write" as const, status: "Writing" as const, pageId: readBack.id || page.id }
}

function snapshotPageKey(page: NotionPage) {
  return propertyText(pageProperties(page)["Snapshot Key"])
}

function snapshotPageMatches(page: NotionPage, row: WyckoffV2Snapshot) {
  const props = pageProperties(page)
  return snapshotPageKey(page) === row.snapshotKey
    && dateText(props["Bar Closed At"]) === (row.barClosedAt ?? "")
    && numberValue(props["History Bar Count"]) === row.historyBarCount
    && selectText(props["History Status"]) === row.historyStatus
    && propertyText(props.Provider) === row.provider
    && urlText(props["Source URL"]) === row.sourceUrl
    && dateText(props["Fetched At"]) === row.fetchedAt
    && propertyText(props["Model Version"]) === row.modelVersion
    && propertyText(props["Aggregation Version"]) === row.aggregationVersion
    && propertyText(props["Prompt Version"]) === row.promptVersion
    && selectText(props["Validation Status"]) === row.validationStatus
    && propertyText(props["Technical JSON"]) === JSON.stringify(row.technical)
    && propertyText(props["Evidence JSON"]) === JSON.stringify(row.evidence)
    && propertyText(props["Markers JSON"]) === JSON.stringify(row.markers)
    && propertyText(props["Scenarios JSON"]) === JSON.stringify(row.scenarios)
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

async function withRateLimitRetry<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      const message = error instanceof Error ? error.message : String(error)
      if (!/\(429\)|rate.?limit/i.test(message) || attempt === attempts - 1) throw error
      await sleep(500 * 2 ** attempt)
    }
  }
  throw lastError
}

export async function stageWyckoffV2Snapshots(
  input: { runKey: string; snapshots: WyckoffV2Snapshot[]; minWriteIntervalMs?: number },
  io: WyckoffV2NotionIo = DEFAULT_NOTION_IO,
) {
  validateWyckoffV2SnapshotSet(input.runKey, input.snapshots)
  const existingPages = await querySnapshotPages(input.runKey, io)
  const existingByKey = new Map<string, NotionPage>()
  for (const page of existingPages) {
    const key = snapshotPageKey(page)
    if (!key) continue
    if (existingByKey.has(key)) throw new Error(`Duplicate existing Notion Snapshot Key: ${key}`)
    existingByKey.set(key, page)
  }

  let created = 0
  let updated = 0
  let skipped = 0
  let lastWriteStartedAt = 0
  const interval = Math.max(0, input.minWriteIntervalMs ?? DEFAULT_WRITE_INTERVAL_MS)

  for (const row of input.snapshots) {
    const existing = existingByKey.get(row.snapshotKey)
    if (existing && snapshotPageMatches(existing, row)) {
      skipped += 1
      continue
    }
    const waitMs = interval - (Date.now() - lastWriteStartedAt)
    if (waitMs > 0) await sleep(waitMs)
    lastWriteStartedAt = Date.now()
    const properties = buildWyckoffV2SnapshotProperties(row)
    if (existing) {
      await withRateLimitRetry(() => io.updatePageProperties(existing.id, properties, { errorContext: `Notion Wyckoff v2 update ${row.snapshotKey}` }))
      updated += 1
    } else {
      await withRateLimitRetry(() => io.createDataSourcePage(WYCKOFF_V2_SNAPSHOTS_DATA_SOURCE_ID, properties, { errorContext: `Notion Wyckoff v2 create ${row.snapshotKey}` }))
      created += 1
    }
  }

  return { created, updated, skipped, total: input.snapshots.length }
}

function parseSnapshotPage(page: NotionPage): WyckoffV2Snapshot {
  const props = pageProperties(page)
  const historyStatus = selectText(props["History Status"])
  if (historyStatus !== "Complete" && historyStatus !== "Incomplete") throw new Error(`Invalid Notion History Status on ${page.id}`)
  const timeframe = selectText(props.Timeframe)
  if (!["1H", "4H", "1D", "1W", "1M"].includes(timeframe)) throw new Error(`Invalid Notion timeframe on ${page.id}`)
  const taBias = selectText(props["TA Bias"])
  const confidence = selectText(props.Confidence)
  const technicalText = propertyText(props["Technical JSON"])
  const evidenceText = propertyText(props["Evidence JSON"])
  const markersText = propertyText(props["Markers JSON"])
  const scenariosText = propertyText(props["Scenarios JSON"])

  return {
    snapshot: propertyText(props.Snapshot, "title"),
    snapshotKey: propertyText(props["Snapshot Key"]),
    runKey: propertyText(props["Run Key"]),
    ticker: propertyText(props.Ticker),
    rank: numberValue(props.Rank),
    exchange: selectText(props.Exchange),
    sector: propertyText(props.Sector),
    timeframe: timeframe as WyckoffV2Snapshot["timeframe"],
    barClosedAt: dateText(props["Bar Closed At"]) || null,
    historyBarCount: numberValue(props["History Bar Count"]) ?? 0,
    historyStatus,
    provider: propertyText(props.Provider),
    providerDetail: propertyText(props["Provider Detail"]),
    sourceUrl: urlText(props["Source URL"]),
    fetchedAt: dateText(props["Fetched At"]),
    modelVersion: propertyText(props["Model Version"]),
    aggregationVersion: propertyText(props["Aggregation Version"]),
    promptVersion: propertyText(props["Prompt Version"]),
    phase: propertyText(props.Phase) || null,
    wyckoffState: propertyText(props["Wyckoff State"]) || null,
    taBias: (taBias || null) as WyckoffV2Snapshot["taBias"],
    confidence: (confidence || null) as WyckoffV2Snapshot["confidence"],
    bullProbability: numberValue(props["Bull Probability"]),
    baseProbability: numberValue(props["Base Probability"]),
    bearProbability: numberValue(props["Bear Probability"]),
    support: propertyText(props.Support) || null,
    resistance: propertyText(props.Resistance) || null,
    confirmation: propertyText(props.Confirmation) || null,
    invalidation: propertyText(props.Invalidation) || null,
    whatChanged: propertyText(props["What Changed"]) || null,
    technical: technicalText ? parseJson<Partial<TechnicalSnapshot>>(technicalText, `${page.id} Technical JSON`) : {},
    evidence: parseJson<WyckoffV2Snapshot["evidence"]>(evidenceText, `${page.id} Evidence JSON`),
    markers: markersText ? parseJson<WyckoffEventMarker[]>(markersText, `${page.id} Markers JSON`) : [],
    scenarios: scenariosText ? parseJson<WyckoffScenario[]>(scenariosText, `${page.id} Scenarios JSON`) : [],
    validationStatus: selectText(props["Validation Status"]) as "Valid",
    validationError: propertyText(props["Validation Error"]),
  }
}

export async function validateAndFinalizeWyckoffV2NotionRun(
  input: { runKey: string; scanDate: string; startedAt: string; completedAt: string; providerSummary: string },
  io: WyckoffV2NotionIo = DEFAULT_NOTION_IO,
) {
  const pages = await querySnapshotPages(input.runKey, io)
  const snapshots = pages.map(parseSnapshotPage)
  const validation = validateWyckoffV2SnapshotSet(input.runKey, snapshots)
  const validationHash = computeWyckoffV2ValidationHash(snapshots)

  const runPage = uniqueRunPage(input.runKey, (await queryRunPages(input.runKey, io)).results)
  if (!runPage) throw new Error(`Notion Run not found for ${input.runKey}`)
  await io.updatePageProperties(runPage.id, buildWyckoffV2RunProperties({
    ...input,
    status: "Ready",
    snapshotComplete: validation.complete,
    snapshotIncomplete: validation.incomplete,
    errorCount: 0,
    errorSummary: "",
    validationHash,
  }), { errorContext: "Notion Wyckoff v2 finalize Ready" })

  const readBack = uniqueRunPage(input.runKey, (await queryRunPages(input.runKey, io)).results)
  if (!readBack || selectText(pageProperties(readBack).Status) !== "Ready") throw new Error(`Notion Ready read-back failed for ${input.runKey}`)
  if (propertyText(pageProperties(readBack)["Validation Hash"]) !== validationHash) throw new Error(`Notion Validation Hash read-back failed for ${input.runKey}`)

  return { status: "Ready" as const, validationHash, ...validation }
}
