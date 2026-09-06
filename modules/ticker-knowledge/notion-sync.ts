import type { Thesis } from "@/modules/research/types"

import {
  normalizeTicker,
  queryTickerKnowledgeSafely,
  type TickerKnowledgeIndex,
  type TickerKnowledgeUnavailableReason,
} from "./domain.ts"
import { projectCurrentThesisKnowledge } from "./projections.ts"

export const MAX_CURRENT_THESIS_REBUILD = 200

export interface CurrentThesisRebuildRow {
  ticker: string
  pointId: string
  sourceId: string
  sourceVersion: string
  sourceUpdatedAt: string | null
  status: "current"
}

export interface CurrentThesisRebuildResult {
  requested: number
  synced: number
  failed: number
  truncated: boolean
  rows: CurrentThesisRebuildRow[]
}

export type CurrentThesisProjectionState = "current" | "stale" | "missing" | "unavailable"

export interface CurrentThesisProjectionStatus {
  ticker: string
  pointId: string
  canonicalSourceVersion: string
  indexedSourceVersion: string | null
  indexedAt: string | null
  status: CurrentThesisProjectionState
  reason: TickerKnowledgeUnavailableReason | null
}

export interface RebuildCurrentThesisKnowledgeInput {
  index: TickerKnowledgeIndex
  loadCanonicalTheses: () => Promise<readonly Thesis[]>
  maxTheses?: number
  tickers?: readonly string[]
}

function normalizedTicker(value: string) {
  return value.trim().toUpperCase()
}

function updatedMs(thesis: Thesis) {
  const value = new Date(thesis.updated || thesis.lastAnalysis || 0).getTime()
  return Number.isFinite(value) ? value : 0
}

function currentCanonicalTheses(rows: readonly Thesis[], tickers?: readonly string[]) {
  const allowed = tickers?.length
    ? new Set(tickers.map(normalizedTicker).filter(Boolean))
    : null
  const byTicker = new Map<string, Thesis>()

  for (const thesis of rows) {
    const ticker = normalizedTicker(thesis.ticker)
    if (!ticker || thesis.status.trim().toLowerCase() !== "current") continue
    if (allowed && !allowed.has(ticker)) continue
    const existing = byTicker.get(ticker)
    if (!existing || updatedMs(thesis) > updatedMs(existing)) {
      byTicker.set(ticker, { ...thesis, ticker })
    }
  }

  return [...byTicker.values()].sort((left, right) => left.ticker.localeCompare(right.ticker))
}

export async function inspectCurrentThesisProjection(
  index: TickerKnowledgeIndex,
  thesis: Thesis,
): Promise<CurrentThesisProjectionStatus> {
  const projected = projectCurrentThesisKnowledge(thesis)
  const ticker = normalizeTicker(thesis.ticker)
  const retrieval = await queryTickerKnowledgeSafely(index, {
    ticker,
    text: `current stock thesis ${ticker}`,
    knowledgeTypes: ["CURRENT_THESIS"],
    sourceTypes: ["NOTION_THESIS"],
    authorities: ["CANONICAL_THESIS"],
    sourceId: projected.provenance.sourceId,
    limit: 4,
  })

  if (retrieval.status === "unavailable") {
    return {
      ticker,
      pointId: projected.id,
      canonicalSourceVersion: projected.provenance.sourceVersion,
      indexedSourceVersion: null,
      indexedAt: null,
      status: "unavailable",
      reason: retrieval.reason,
    }
  }

  const indexed = retrieval.results
    .map((result) => result.item)
    .find((item) => (
      item.id === projected.id
      && item.ticker === ticker
      && item.knowledgeType === "CURRENT_THESIS"
      && item.sourceType === "NOTION_THESIS"
      && item.authority === "CANONICAL_THESIS"
      && item.provenance.sourceId === projected.provenance.sourceId
    ))

  if (!indexed) {
    return {
      ticker,
      pointId: projected.id,
      canonicalSourceVersion: projected.provenance.sourceVersion,
      indexedSourceVersion: null,
      indexedAt: null,
      status: "missing",
      reason: null,
    }
  }

  return {
    ticker,
    pointId: projected.id,
    canonicalSourceVersion: projected.provenance.sourceVersion,
    indexedSourceVersion: indexed.provenance.sourceVersion,
    indexedAt: indexed.indexedAt ?? null,
    status: indexed.provenance.sourceVersion === projected.provenance.sourceVersion ? "current" : "stale",
    reason: null,
  }
}

export async function rebuildCurrentThesisKnowledge(
  input: RebuildCurrentThesisKnowledgeInput,
): Promise<CurrentThesisRebuildResult> {
  const maxTheses = Math.max(1, Math.min(MAX_CURRENT_THESIS_REBUILD, Math.floor(input.maxTheses ?? MAX_CURRENT_THESIS_REBUILD)))

  // Canonical read must finish before touching Qdrant. If Notion is unavailable, the
  // exception propagates and last-known-good projections remain untouched.
  const canonical = await input.loadCanonicalTheses()
  const current = currentCanonicalTheses(canonical, input.tickers)
  const selected = current.slice(0, maxTheses)
  const items = selected.map(projectCurrentThesisKnowledge)

  if (items.length) {
    await input.index.ensureReady()
    await input.index.upsert(items)
  }

  return {
    requested: current.length,
    synced: items.length,
    failed: 0,
    truncated: current.length > selected.length,
    rows: items.map((item) => ({
      ticker: item.ticker,
      pointId: item.id,
      sourceId: item.provenance.sourceId,
      sourceVersion: item.provenance.sourceVersion,
      sourceUpdatedAt: item.provenance.asOf ?? item.provenance.publishedAt ?? null,
      status: "current" as const,
    })),
  }
}
