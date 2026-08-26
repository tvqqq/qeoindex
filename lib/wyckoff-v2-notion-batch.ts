import {
  createDataSourcePage,
  queryDataSource,
  updatePageProperties,
  type NotionPage,
  type NotionProperties,
  type NotionQueryOptions,
  type NotionQueryResult,
} from "./notion/client.ts"
import { pageProperties } from "./notion/properties.ts"
import type { WyckoffV2Snapshot } from "./wyckoff-v2-builder.ts"
import {
  buildWyckoffV2SnapshotProperties,
  WYCKOFF_V2_SNAPSHOTS_DATA_SOURCE_ID,
  type WyckoffV2NotionIo,
} from "./wyckoff-v2-notion-staging.ts"

const TIMEFRAMES = ["1H", "4H", "1D", "1W", "1M"] as const
const MAX_BATCH_SNAPSHOTS = 50
const DEFAULT_WRITE_INTERVAL_MS = 360

const DEFAULT_NOTION_IO: WyckoffV2NotionIo = {
  queryDataSource,
  createDataSourcePage,
  updatePageProperties,
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

function snapshotPageKey(page: NotionPage) {
  return propertyText(pageProperties(page)["Snapshot Key"])
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

async function querySnapshotPages(runKey: string, io: WyckoffV2NotionIo) {
  const result = await io.queryDataSource(WYCKOFF_V2_SNAPSHOTS_DATA_SOURCE_ID, {
    filter: { property: "Run Key", rich_text: { equals: runKey } },
    pageSize: 100,
    maxPages: 5,
    errorContext: "Notion Wyckoff v2 batch snapshot query",
  })
  if (result.hasMore) throw new Error(`More than 500 Notion snapshots found for ${runKey}`)
  return result.results
}

function assertSnapshotBatch(runKey: string, snapshots: WyckoffV2Snapshot[]) {
  if (snapshots.length < 1 || snapshots.length > MAX_BATCH_SNAPSHOTS) {
    throw new Error(`Notion staging batch must contain 1-${MAX_BATCH_SNAPSHOTS} snapshots; received ${snapshots.length}`)
  }

  const keys = new Set<string>()
  const tickerFrames = new Map<string, Set<string>>()
  for (const row of snapshots) {
    if (row.runKey !== runKey) throw new Error(`Run Key mismatch: ${row.snapshotKey}`)
    if (row.snapshotKey !== `${runKey}|${row.ticker}|${row.timeframe}`) throw new Error(`Snapshot Key mismatch: ${row.snapshotKey}`)
    if (keys.has(row.snapshotKey)) throw new Error(`Duplicate Snapshot Key: ${row.snapshotKey}`)
    keys.add(row.snapshotKey)

    const frames = tickerFrames.get(row.ticker) ?? new Set<string>()
    if (frames.has(row.timeframe)) throw new Error(`Duplicate ticker timeframe: ${row.snapshotKey}`)
    frames.add(row.timeframe)
    tickerFrames.set(row.ticker, frames)
  }

  if (snapshots.length !== tickerFrames.size * TIMEFRAMES.length) {
    throw new Error(`Notion staging batch must contain all five timeframes per ticker; received ${snapshots.length} snapshots for ${tickerFrames.size} ticker(s)`)
  }
  for (const [ticker, frames] of tickerFrames) {
    if (frames.size !== TIMEFRAMES.length || TIMEFRAMES.some((timeframe) => !frames.has(timeframe))) {
      throw new Error(`${ticker} does not have all five timeframes in Notion staging batch`)
    }
  }
}

export async function stageWyckoffV2SnapshotBatch(
  input: { runKey: string; snapshots: WyckoffV2Snapshot[]; minWriteIntervalMs?: number },
  io: WyckoffV2NotionIo = DEFAULT_NOTION_IO,
) {
  assertSnapshotBatch(input.runKey, input.snapshots)
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
  let lastWriteStartedAt = 0
  const interval = Math.max(0, input.minWriteIntervalMs ?? DEFAULT_WRITE_INTERVAL_MS)

  for (const row of input.snapshots) {
    const waitMs = interval - (Date.now() - lastWriteStartedAt)
    if (waitMs > 0) await sleep(waitMs)
    lastWriteStartedAt = Date.now()

    const properties = buildWyckoffV2SnapshotProperties(row) as NotionProperties
    const existing = existingByKey.get(row.snapshotKey)
    if (existing) {
      await withRateLimitRetry(() => io.updatePageProperties(existing.id, properties, { errorContext: `Notion Wyckoff v2 batch update ${row.snapshotKey}` }))
      updated += 1
    } else {
      await withRateLimitRetry(() => io.createDataSourcePage(WYCKOFF_V2_SNAPSHOTS_DATA_SOURCE_ID, properties, { errorContext: `Notion Wyckoff v2 batch create ${row.snapshotKey}` }))
      created += 1
    }
  }

  return { created, updated, skipped: 0, total: input.snapshots.length }
}

export type { NotionPage, NotionProperties, NotionQueryOptions, NotionQueryResult }
