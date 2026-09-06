import { createHash } from "node:crypto"

import type { TickerContext } from "../ticker-knowledge/context.ts"
import type { TickerKnowledgeItem } from "../ticker-knowledge/domain.ts"

export const AI_COUNCIL_TICKER_KNOWLEDGE_CONTEXT_VERSION = "ticker-knowledge-context-v1" as const

const SNAPSHOT_TABLE = "ai_council_ticker_knowledge_snapshots"
const SAFE_UNAVAILABLE_LIMITATION = "Ticker knowledge retrieval unavailable at Council freeze time."
const SAFE_DEGRADED_LIMITATION = "Semantic retrieval unavailable; using bounded mandatory canonical context only."

export type CouncilTickerKnowledgeStatus = "ready" | "empty" | "unavailable"

export interface CouncilTickerKnowledgeContext {
  contextVersion: typeof AI_COUNCIL_TICKER_KNOWLEDGE_CONTEXT_VERSION
  ticker: string
  asOfDate: string
  status: CouncilTickerKnowledgeStatus
  query: string
  items: TickerKnowledgeItem[]
  retrievedPointIds: string[]
  truncated: boolean
  retrievalStatus: "ready" | "unavailable"
  retrievalReason: string | null
  limitations: string[]
}

export interface FrozenCouncilTickerKnowledge {
  context: CouncilTickerKnowledgeContext
  contextHash: string | null
  pointIds: string[]
  reused: boolean
  persisted: boolean
  canUseInPrompt: boolean
}

interface SnapshotQueryResult {
  data: Record<string, unknown>[] | null
  error: { message?: string } | null
}

export interface CouncilTickerKnowledgeSnapshotClient {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: unknown): {
        limit(value: number): PromiseLike<SnapshotQueryResult>
      }
    }
    upsert(payload: Record<string, unknown>, options?: { onConflict: string; ignoreDuplicates: boolean }): PromiseLike<{
      data: unknown
      error: { message?: string } | null
    }>
  }
}

export interface FreezeCouncilTickerKnowledgeInput {
  runId: string
  ticker: string
  asOfDate: string
  query: string
}

export interface FreezeCouncilTickerKnowledgeDeps {
  buildContext: () => Promise<TickerContext>
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonicalize(nested)]),
  )
}

function sha256(value: unknown) {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex")
}

function normalizeTicker(value: string) {
  return value.trim().toUpperCase()
}

function normalizeQuery(value: string) {
  return value.replace(/\s+/g, " ").trim()
}

function safeItem(value: unknown): TickerKnowledgeItem | null {
  if (!value || typeof value !== "object") return null
  const item = value as Partial<TickerKnowledgeItem>
  if (
    typeof item.id !== "string"
    || typeof item.identityKey !== "string"
    || typeof item.ticker !== "string"
    || typeof item.knowledgeType !== "string"
    || typeof item.authority !== "string"
    || typeof item.sourceType !== "string"
    || typeof item.text !== "string"
    || !item.provenance
    || typeof item.schemaVersion !== "string"
    || typeof item.projectionVersion !== "string"
  ) return null
  return item as TickerKnowledgeItem
}

function parseContext(value: unknown): CouncilTickerKnowledgeContext | null {
  if (!value || typeof value !== "object") return null
  const row = value as Record<string, unknown>
  if (row.contextVersion !== AI_COUNCIL_TICKER_KNOWLEDGE_CONTEXT_VERSION) return null
  if (typeof row.ticker !== "string" || typeof row.asOfDate !== "string" || typeof row.query !== "string") return null
  if (!(["ready", "empty", "unavailable"] as const).includes(row.status as CouncilTickerKnowledgeStatus)) return null
  const items = Array.isArray(row.items) ? row.items.map(safeItem).filter((item): item is TickerKnowledgeItem => Boolean(item)) : []
  const pointIds = Array.isArray(row.retrievedPointIds) ? row.retrievedPointIds.filter((id): id is string => typeof id === "string") : []
  const limitations = Array.isArray(row.limitations) ? row.limitations.filter((item): item is string => typeof item === "string").slice(0, 8) : []
  return {
    contextVersion: AI_COUNCIL_TICKER_KNOWLEDGE_CONTEXT_VERSION,
    ticker: normalizeTicker(row.ticker),
    asOfDate: row.asOfDate,
    status: row.status as CouncilTickerKnowledgeStatus,
    query: row.query,
    items,
    retrievedPointIds: pointIds,
    truncated: row.truncated === true,
    retrievalStatus: row.retrievalStatus === "unavailable" ? "unavailable" : "ready",
    retrievalReason: typeof row.retrievalReason === "string" ? row.retrievalReason.slice(0, 120) : null,
    limitations,
  }
}

async function readPersistedSnapshot(client: CouncilTickerKnowledgeSnapshotClient, runId: string) {
  const result = await client
    .from(SNAPSHOT_TABLE)
    .select("run_id,ticker,as_of_date,context_version,context_hash,status,context_payload,point_ids,captured_at")
    .eq("run_id", runId)
    .limit(1)
  if (result.error || !result.data?.length) return null
  const row = result.data[0]
  const context = parseContext(row.context_payload)
  const contextHash = typeof row.context_hash === "string" && /^[0-9a-f]{64}$/.test(row.context_hash) ? row.context_hash : null
  if (!context || !contextHash) return null
  return {
    context,
    contextHash,
    pointIds: Array.isArray(row.point_ids) ? row.point_ids.filter((id): id is string => typeof id === "string") : context.retrievedPointIds,
  }
}

function unavailableContext(
  input: FreezeCouncilTickerKnowledgeInput,
  reason = "ticker_knowledge_unavailable",
): CouncilTickerKnowledgeContext {
  return {
    contextVersion: AI_COUNCIL_TICKER_KNOWLEDGE_CONTEXT_VERSION,
    ticker: normalizeTicker(input.ticker),
    asOfDate: input.asOfDate,
    status: "unavailable",
    query: normalizeQuery(input.query),
    items: [],
    retrievedPointIds: [],
    truncated: false,
    retrievalStatus: "unavailable",
    retrievalReason: reason.slice(0, 120),
    limitations: [SAFE_UNAVAILABLE_LIMITATION],
  }
}

function freezeContext(input: FreezeCouncilTickerKnowledgeInput, built: TickerContext): CouncilTickerKnowledgeContext {
  const ticker = normalizeTicker(input.ticker)
  const items = built.items.filter((item) => item.ticker === ticker)
  const pointIds = built.retrievedPointIds.filter((id) => items.some((item) => item.id === id))

  if (built.retrievalStatus === "unavailable") {
    if (!items.length) return unavailableContext(input, built.retrievalReason ?? undefined)
    return {
      contextVersion: AI_COUNCIL_TICKER_KNOWLEDGE_CONTEXT_VERSION,
      ticker,
      asOfDate: input.asOfDate,
      status: "ready",
      query: normalizeQuery(input.query),
      items,
      retrievedPointIds: pointIds,
      truncated: built.truncated,
      retrievalStatus: "unavailable",
      retrievalReason: built.retrievalReason,
      limitations: [SAFE_DEGRADED_LIMITATION],
    }
  }

  return {
    contextVersion: AI_COUNCIL_TICKER_KNOWLEDGE_CONTEXT_VERSION,
    ticker,
    asOfDate: input.asOfDate,
    status: items.length ? "ready" : "empty",
    query: normalizeQuery(input.query),
    items,
    retrievedPointIds: pointIds,
    truncated: built.truncated,
    retrievalStatus: "ready",
    retrievalReason: null,
    limitations: [],
  }
}

function frozenResult(
  persisted: { context: CouncilTickerKnowledgeContext; contextHash: string; pointIds: string[] },
  reused: boolean,
): FrozenCouncilTickerKnowledge {
  return {
    context: persisted.context,
    contextHash: persisted.contextHash,
    pointIds: persisted.pointIds,
    reused,
    persisted: true,
    canUseInPrompt: persisted.context.status !== "unavailable",
  }
}

export async function freezeCouncilTickerKnowledge(
  client: CouncilTickerKnowledgeSnapshotClient,
  input: FreezeCouncilTickerKnowledgeInput,
  deps: FreezeCouncilTickerKnowledgeDeps,
): Promise<FrozenCouncilTickerKnowledge> {
  const existing = await readPersistedSnapshot(client, input.runId)
  if (existing) return frozenResult(existing, true)

  let context: CouncilTickerKnowledgeContext
  try {
    context = freezeContext(input, await deps.buildContext())
  } catch {
    context = unavailableContext(input)
  }
  const contextHash = sha256(context)
  const write = await client.from(SNAPSHOT_TABLE).upsert({
    run_id: input.runId,
    ticker: context.ticker,
    as_of_date: context.asOfDate,
    context_version: context.contextVersion,
    context_hash: contextHash,
    status: context.status,
    context_payload: context,
    point_ids: context.retrievedPointIds,
  }, { onConflict: "run_id", ignoreDuplicates: true })

  if (write.error) {
    return {
      context: unavailableContext(input),
      contextHash: null,
      pointIds: [],
      reused: false,
      persisted: false,
      canUseInPrompt: false,
    }
  }

  const persisted = await readPersistedSnapshot(client, input.runId)
  if (!persisted) {
    return {
      context: unavailableContext(input),
      contextHash: null,
      pointIds: [],
      reused: false,
      persisted: false,
      canUseInPrompt: false,
    }
  }
  return frozenResult(persisted, false)
}
