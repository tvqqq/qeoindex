import type { Thesis } from "@/modules/research/types"

import {
  normalizeTicker,
  type TickerKnowledgeIndex,
  type TickerKnowledgeItem,
  type TickerKnowledgeSourceType,
} from "./domain.ts"
import {
  projectCouncilHistoryKnowledge,
  projectCurrentThesisKnowledge,
  projectResearchReportKnowledge,
  type CouncilHistoryKnowledgeProjectionInput,
  type ResearchReportKnowledgeProjectionInput,
} from "./projections.ts"

const MAX_SYNC_UPSERT_BATCH = 64

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
    if (item.provenance.sourceId !== sourceId || item.provenance.sourceVersion !== sourceVersion) {
      throw new Error("Ticker knowledge sync requires one exact source version per projection batch")
    }
  }
  return { sourceId, sourceVersion }
}

async function syncProjection(
  index: TickerKnowledgeIndex,
  items: readonly TickerKnowledgeItem[],
): Promise<TickerKnowledgeSyncResult> {
  const identity = projectionIdentity(items)
  await index.ensureReady()
  for (let offset = 0; offset < items.length; offset += MAX_SYNC_UPSERT_BATCH) {
    await index.upsert(items.slice(offset, offset + MAX_SYNC_UPSERT_BATCH))
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

export async function syncCurrentThesisKnowledge(
  index: TickerKnowledgeIndex,
  thesis: Thesis,
) {
  const item = projectCurrentThesisKnowledge(thesis)
  return syncProjection(index, [item])
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

export interface RunTickerKnowledgeBackfillInput<T> {
  cursor?: string | null
  batchSize?: number
  loadPage: (cursor: string | null, limit: number) => Promise<TickerKnowledgeBackfillPage<T>>
  syncRow: (row: T) => Promise<unknown>
}

export interface TickerKnowledgeBackfillProgress {
  processed: number
  failed: number
  nextCursor: string | null
  completed: boolean
}

function boundedBatchSize(value: number | undefined) {
  if (value === undefined) return 50
  if (!Number.isFinite(value)) throw new Error("Ticker knowledge backfill batch size must be finite")
  return Math.max(1, Math.min(200, Math.floor(value)))
}

export async function runTickerKnowledgeBackfill<T>(
  input: RunTickerKnowledgeBackfillInput<T>,
): Promise<TickerKnowledgeBackfillProgress> {
  const page = await input.loadPage(input.cursor ?? null, boundedBatchSize(input.batchSize))
  let failed = 0
  for (const row of page.rows) {
    try {
      await input.syncRow(row)
    } catch {
      failed += 1
    }
  }
  return {
    processed: page.rows.length,
    failed,
    nextCursor: page.nextCursor,
    completed: page.nextCursor === null,
  }
}
