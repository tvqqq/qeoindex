import {
  normalizeTicker,
  TickerKnowledgeUnavailableError,
  type TickerKnowledgeIndex,
  type TickerKnowledgeItem,
  type TickerKnowledgeSourceType,
  type TickerKnowledgeUnavailableReason,
} from "./domain.ts"
import {
  projectCouncilHistoryKnowledge,
  projectResearchReportKnowledge,
  type CouncilHistoryKnowledgeProjectionInput,
  type ResearchReportKnowledgeProjectionInput,
} from "./projections.ts"

const MAX_SYNC_UPSERT_BATCH = 64
const MAX_BACKFILL_FAILURE_SOURCE_ID = 128

export interface TickerKnowledgeSyncResult {
  sourceId: string
  sourceVersion: string
  itemIds: string[]
  upserted: number
}

function projectionIdentity(items: readonly TickerKnowledgeItem[]) {
  if (!items.length) throw new Error("Ticker knowledge projection produced no items")
  const sourceId = items[0].provenance.sourceId
  const sourceVersion = items[0].provenance.sourceVersion
  for (const item of items) {
    if (item.provenance.sourceId !== sourceId) {
      throw new Error("Ticker knowledge sync requires one exact source identity per projection batch")
    }
  }
  return { sourceId, sourceVersion }
}

function projectionSourceVersionGroups(items: readonly TickerKnowledgeItem[]) {
  const groups = new Map<string, TickerKnowledgeItem[]>()
  for (const item of items) {
    const sourceVersion = item.provenance.sourceVersion
    const group = groups.get(sourceVersion)
    if (group) group.push(item)
    else groups.set(sourceVersion, [item])
  }
  return [...groups.values()]
}

async function syncProjection(
  index: TickerKnowledgeIndex,
  items: readonly TickerKnowledgeItem[],
): Promise<TickerKnowledgeSyncResult> {
  const identity = projectionIdentity(items)
  await index.ensureReady()
  for (const group of projectionSourceVersionGroups(items)) {
    for (let offset = 0; offset < group.length; offset += MAX_SYNC_UPSERT_BATCH) {
      await index.upsert(group.slice(offset, offset + MAX_SYNC_UPSERT_BATCH))
    }
  }
  return {
    ...identity,
    itemIds: items.map((item) => item.id),
    upserted: items.length,
  }
}

export async function syncResearchReportKnowledge(
  index: TickerKnowledgeIndex,
  input: ResearchReportKnowledgeProjectionInput,
) {
  return syncProjection(index, projectResearchReportKnowledge(input))
}

export async function syncCouncilHistoryKnowledge(
  index: TickerKnowledgeIndex,
  input: CouncilHistoryKnowledgeProjectionInput,
) {
  return syncProjection(index, projectCouncilHistoryKnowledge(input))
}

export interface TickerKnowledgeSourceVersionTombstone {
  ticker: string
  sourceType: TickerKnowledgeSourceType
  sourceId: string
  sourceVersion: string
}

function exactTombstoneValue(label: string, value: string) {
  const normalized = value.trim()
  if (!normalized) throw new Error(`Ticker knowledge tombstone requires exact ${label}`)
  return normalized
}

export async function tombstoneTickerKnowledgeSourceVersion(
  index: TickerKnowledgeIndex,
  input: TickerKnowledgeSourceVersionTombstone,
) {
  const exact = {
    ticker: normalizeTicker(input.ticker),
    sourceType: input.sourceType,
    sourceId: exactTombstoneValue("sourceId", input.sourceId),
    sourceVersion: exactTombstoneValue("sourceVersion", input.sourceVersion),
  }
  await index.ensureReady()
  await index.deleteSourceVersion(exact)
}

export interface TickerKnowledgeBackfillPage<T> {
  rows: readonly T[]
  nextCursor: string | null
}

export type TickerKnowledgeBackfillFailureReason = TickerKnowledgeUnavailableReason | "sync_error"

export interface TickerKnowledgeBackfillFailure {
  sourceId: string
  reason: TickerKnowledgeBackfillFailureReason
}

export interface RunTickerKnowledgeBackfillInput<T> {
  cursor?: string | null
  batchSize?: number
  loadPage: (cursor: string | null, limit: number) => Promise<TickerKnowledgeBackfillPage<T>>
  syncRow: (row: T) => Promise<unknown>
  failureId?: (row: T) => string
}

export interface TickerKnowledgeBackfillProgress {
  processed: number
  failed: number
  failures?: TickerKnowledgeBackfillFailure[]
  nextCursor: string | null
  completed: boolean
}

function boundedBatchSize(value: number | undefined) {
  if (value === undefined) return 50
  if (!Number.isFinite(value)) throw new Error("Ticker knowledge backfill batch size must be finite")
  return Math.max(1, Math.min(200, Math.floor(value)))
}

function boundedFailureSourceId(value: string | undefined) {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_BACKFILL_FAILURE_SOURCE_ID)
  return normalized || "unknown"
}

function backfillFailureReason(error: unknown): TickerKnowledgeBackfillFailureReason {
  return error instanceof TickerKnowledgeUnavailableError ? error.reason : "sync_error"
}

export async function runTickerKnowledgeBackfill<T>(
  input: RunTickerKnowledgeBackfillInput<T>,
): Promise<TickerKnowledgeBackfillProgress> {
  const page = await input.loadPage(input.cursor ?? null, boundedBatchSize(input.batchSize))
  const failures: TickerKnowledgeBackfillFailure[] = []
  for (const row of page.rows) {
    try {
      await input.syncRow(row)
    } catch (error) {
      failures.push({
        sourceId: boundedFailureSourceId(input.failureId?.(row)),
        reason: backfillFailureReason(error),
      })
    }
  }
  return {
    processed: page.rows.length,
    failed: failures.length,
    ...(failures.length ? { failures } : {}),
    nextCursor: page.nextCursor,
    completed: page.nextCursor === null,
  }
}
