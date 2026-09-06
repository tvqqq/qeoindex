import {
  TICKER_KNOWLEDGE_COLLECTION,
  normalizeTicker,
  type TickerKnowledgeIndex,
} from "./domain.ts"

const DEFAULT_BACKFILL_BATCH_SIZE = 25
const MAX_BACKFILL_BATCH_SIZE = 100
const MAX_CURSOR_LENGTH = 256

export type TickerKnowledgeAcceptanceCommand =
  | { action: "backfill_reports"; cursor: string | null; batchSize: number }
  | { action: "backfill_council"; cursor: string | null; batchSize: number }

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Ticker knowledge acceptance command must be an object")
  }
  return value as Record<string, unknown>
}

function boundedInteger(value: unknown, fallback: number, max: number) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return fallback
  return Math.max(1, Math.min(max, Math.floor(numeric)))
}

function normalizedCursor(value: unknown) {
  if (value === undefined || value === null || value === "") return null
  if (typeof value !== "string") throw new Error("Ticker knowledge backfill cursor must be a string")
  const cursor = value.trim()
  if (!cursor) return null
  if (cursor.length > MAX_CURSOR_LENGTH) throw new Error("Ticker knowledge backfill cursor is too long")
  return cursor
}

export function normalizeTickerKnowledgeAcceptanceCommand(value: unknown): TickerKnowledgeAcceptanceCommand {
  const input = record(value)
  const action = typeof input.action === "string" ? input.action.trim() : ""
  if (action === "backfill_reports" || action === "backfill_council") {
    return {
      action,
      cursor: normalizedCursor(input.cursor),
      batchSize: boundedInteger(input.batchSize, DEFAULT_BACKFILL_BATCH_SIZE, MAX_BACKFILL_BATCH_SIZE),
    }
  }
  throw new Error(`Unsupported ticker knowledge acceptance action: ${action || "missing"}`)
}

export async function probeTickerKnowledgeReadiness(input: {
  index: TickerKnowledgeIndex
  ticker?: string
  queryText?: string
  now?: () => number
}) {
  const ticker = normalizeTicker(input.ticker ?? "MSN")
  const queryText = String(input.queryText ?? "target valuation EBITDA outlook").replace(/\s+/g, " ").trim()
  if (!queryText) throw new Error("Ticker knowledge readiness query text is required")
  const now = input.now ?? (() => performance.now())
  const startedAt = now()
  await input.index.ensureReady()
  const results = await input.index.query({ ticker, text: queryText, limit: 1 })
  const latencyMs = Math.max(0, Math.round(now() - startedAt))
  return {
    status: "ready" as const,
    collection: TICKER_KNOWLEDGE_COLLECTION,
    ticker,
    hybridQuery: "ready" as const,
    resultCount: results.length,
    latencyMs,
  }
}
