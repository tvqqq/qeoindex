import {
  normalizeTicker,
  queryTickerKnowledgeSafely,
  type TickerKnowledgeAuthority,
  type TickerKnowledgeIndex,
  type TickerKnowledgeItem,
  type TickerKnowledgeQuery,
  type TickerKnowledgeSearchResult,
  type TickerKnowledgeUnavailableReason,
} from "./domain.ts"

const DEFAULT_MAX_CHARS = 18_000
const DEFAULT_LIMIT = 12

export type TickerContextConsumer = "STOCK_QA" | "REPORT_QA" | "AI_COUNCIL" | "HISTORICAL_CASE_SEARCH"

const CONSUMER_POLICY: Record<TickerContextConsumer, { limit: number; maxChars: number }> = {
  STOCK_QA: { limit: 12, maxChars: 18_000 },
  REPORT_QA: { limit: 8, maxChars: 16_000 },
  AI_COUNCIL: { limit: 8, maxChars: 12_000 },
  HISTORICAL_CASE_SEARCH: { limit: 16, maxChars: 22_000 },
}

const AUTHORITY_WEIGHT: Record<TickerKnowledgeAuthority, number> = {
  VERIFIED_FACT: 1,
  CANONICAL_THESIS: 0.95,
  DETERMINISTIC_SIGNAL: 0.95,
  HISTORICAL_LESSON: 0.8,
  SOURCE_OPINION: 0.65,
  AI_INFERENCE: 0.5,
}

export interface BuildTickerContextInput {
  index: TickerKnowledgeIndex
  ticker: string
  query: string
  consumer?: TickerContextConsumer
  mandatory?: readonly TickerKnowledgeItem[]
  knowledgeTypes?: TickerKnowledgeQuery["knowledgeTypes"]
  sourceTypes?: TickerKnowledgeQuery["sourceTypes"]
  authorities?: TickerKnowledgeQuery["authorities"]
  reportId?: TickerKnowledgeQuery["reportId"]
  analysisId?: TickerKnowledgeQuery["analysisId"]
  runId?: TickerKnowledgeQuery["runId"]
  sourceId?: TickerKnowledgeQuery["sourceId"]
  sourceVersion?: TickerKnowledgeQuery["sourceVersion"]
  contentHash?: TickerKnowledgeQuery["contentHash"]
  chunkVersion?: TickerKnowledgeQuery["chunkVersion"]
  asOf?: string
  limit?: number
  maxChars?: number
  now?: string
}

export interface TickerContextTelemetry {
  totalMs: number
  alwaysLoadMs: number
  retrievalMs: number
  rerankMs: number
  buildMs: number
}

export interface TickerContext {
  ticker: string
  query: string
  consumer: TickerContextConsumer | null
  retrievalStatus: "ready" | "unavailable"
  retrievalReason: TickerKnowledgeUnavailableReason | null
  items: TickerKnowledgeItem[]
  retrievedPointIds: string[]
  text: string
  truncated: boolean
  telemetry: TickerContextTelemetry
}

function monotonicNow() {
  return typeof performance !== "undefined" ? performance.now() : Date.now()
}

function durationSince(start: number) {
  return Math.max(0, monotonicNow() - start)
}

function timestamp(value: string | null | undefined) {
  if (!value) return null
  const parsed = new Date(value).getTime()
  return Number.isFinite(parsed) ? parsed : null
}

function availableAsOf(item: TickerKnowledgeItem, asOf: string | undefined) {
  if (!asOf) return true
  const cutoff = timestamp(asOf)
  if (cutoff === null) throw new Error("Ticker context asOf must be a valid timestamp")
  const rawEvidenceTime = item.provenance.asOf ?? item.provenance.publishedAt
  if (!rawEvidenceTime) return true
  const evidenceTime = timestamp(rawEvidenceTime)
  return evidenceTime !== null && evidenceTime <= cutoff
}

function matchesRequestedScope(item: TickerKnowledgeItem, input: BuildTickerContextInput, ticker: string) {
  if (item.ticker !== ticker) return false
  if (!availableAsOf(item, input.asOf)) return false
  if (input.knowledgeTypes?.length && !input.knowledgeTypes.includes(item.knowledgeType)) return false
  if (input.sourceTypes?.length && !input.sourceTypes.includes(item.sourceType)) return false
  if (input.authorities?.length && !input.authorities.includes(item.authority)) return false

  const provenance = item.provenance
  if (input.reportId && provenance.reportId !== input.reportId) return false
  if (input.analysisId && provenance.analysisId !== input.analysisId) return false
  if (input.runId && provenance.runId !== input.runId) return false
  if (input.sourceId && provenance.sourceId !== input.sourceId) return false
  if (input.sourceVersion && provenance.sourceVersion !== input.sourceVersion) return false
  if (input.contentHash && provenance.contentHash !== input.contentHash) return false
  if (input.chunkVersion && provenance.chunkVersion !== input.chunkVersion) return false
  return true
}

function recencyScore(item: TickerKnowledgeItem, nowMs: number) {
  const asOf = timestamp(item.provenance.asOf ?? item.provenance.publishedAt)
  if (asOf === null) return 0.35
  const ageDays = Math.max(0, (nowMs - asOf) / 86_400_000)
  return Math.exp(-ageDays / 180)
}

function normalizeRelevance(results: readonly TickerKnowledgeSearchResult[]) {
  if (!results.length) return new Map<string, number>()
  const finite = results.map((result) => result.score).filter(Number.isFinite)
  if (!finite.length) return new Map(results.map((result) => [result.id, 0.5]))
  const min = Math.min(...finite)
  const max = Math.max(...finite)
  if (max === min) return new Map(results.map((result) => [result.id, 1]))
  return new Map(results.map((result) => [result.id, (result.score - min) / (max - min)]))
}

function rankRetrieved(results: readonly TickerKnowledgeSearchResult[], nowMs: number) {
  const relevance = normalizeRelevance(results)
  return [...results].sort((left, right) => {
    const leftScore = 0.55 * (relevance.get(left.id) ?? 0) + 0.25 * AUTHORITY_WEIGHT[left.item.authority] + 0.2 * recencyScore(left.item, nowMs)
    const rightScore = 0.55 * (relevance.get(right.id) ?? 0) + 0.25 * AUTHORITY_WEIGHT[right.item.authority] + 0.2 * recencyScore(right.item, nowMs)
    return rightScore - leftScore || right.score - left.score || left.id.localeCompare(right.id)
  })
}

function itemHeader(item: TickerKnowledgeItem) {
  const provenance = item.provenance
  const source = [item.sourceType, provenance.sourceId, provenance.sourceVersion].filter(Boolean).join("/")
  const location = [
    provenance.reportId ? `report=${provenance.reportId}` : "",
    provenance.analysisId ? `analysis=${provenance.analysisId}` : "",
    provenance.runId ? `run=${provenance.runId}` : "",
    provenance.page ? `page=${provenance.page}` : "",
    provenance.chunkId ? `chunk=${provenance.chunkId}` : "",
  ].filter(Boolean).join(" ")
  return `[${item.knowledgeType} | ${item.authority} | ${source}${location ? ` | ${location}` : ""}]`
}

function buildBoundedText(items: readonly TickerKnowledgeItem[], maxChars: number) {
  let text = ""
  let truncated = false
  for (const item of items) {
    const block = `${itemHeader(item)}\n${item.text.trim()}\n\n`
    const remaining = maxChars - text.length
    if (remaining <= 0) {
      truncated = true
      break
    }
    if (block.length <= remaining) {
      text += block
      continue
    }
    const minimumUseful = itemHeader(item).length + 80
    if (remaining >= minimumUseful) {
      text += `${block.slice(0, Math.max(0, remaining - 1)).trimEnd()}…`
    }
    truncated = true
    break
  }
  return { text: text.trim(), truncated }
}

export async function buildTickerContext(input: BuildTickerContextInput): Promise<TickerContext> {
  const totalStarted = monotonicNow()
  const ticker = normalizeTicker(input.ticker)
  const query = input.query.replace(/\s+/g, " ").trim()
  if (!query) throw new Error("Ticker context query is required")
  const policy = input.consumer ? CONSUMER_POLICY[input.consumer] : null

  const alwaysLoadStarted = monotonicNow()
  const mandatory = (input.mandatory ?? []).filter((item) => item.ticker === ticker && availableAsOf(item, input.asOf))
  const alwaysLoadMs = durationSince(alwaysLoadStarted)

  const retrievalStarted = monotonicNow()
  const retrieval = await queryTickerKnowledgeSafely(input.index, {
    ticker,
    text: query,
    knowledgeTypes: input.knowledgeTypes,
    sourceTypes: input.sourceTypes,
    authorities: input.authorities,
    reportId: input.reportId,
    analysisId: input.analysisId,
    runId: input.runId,
    sourceId: input.sourceId,
    sourceVersion: input.sourceVersion,
    contentHash: input.contentHash,
    chunkVersion: input.chunkVersion,
    asOf: input.asOf,
    limit: input.limit ?? policy?.limit ?? DEFAULT_LIMIT,
  })
  const retrievalMs = durationSince(retrievalStarted)

  const rerankStarted = monotonicNow()
  const nowMs = timestamp(input.now) ?? Date.now()
  const scopedResults = retrieval.status === "ready"
    ? retrieval.results.filter((result) => matchesRequestedScope(result.item, input, ticker))
    : []
  const retrieved = rankRetrieved(scopedResults, nowMs)
  const seen = new Set<string>()
  const items: TickerKnowledgeItem[] = []
  for (const item of mandatory) {
    if (seen.has(item.id)) continue
    seen.add(item.id)
    items.push(item)
  }
  for (const result of retrieved) {
    if (seen.has(result.item.id)) continue
    seen.add(result.item.id)
    items.push(result.item)
  }
  const rerankMs = durationSince(rerankStarted)

  const buildStarted = monotonicNow()
  const maxChars = Math.max(500, Math.min(60_000, Math.floor(input.maxChars ?? policy?.maxChars ?? DEFAULT_MAX_CHARS)))
  const bounded = buildBoundedText(items, maxChars)
  const buildMs = durationSince(buildStarted)

  return {
    ticker,
    query,
    consumer: input.consumer ?? null,
    retrievalStatus: retrieval.status,
    retrievalReason: retrieval.status === "unavailable" ? retrieval.reason : null,
    items,
    retrievedPointIds: retrieved.map((result) => result.id),
    text: bounded.text,
    truncated: bounded.truncated,
    telemetry: {
      totalMs: durationSince(totalStarted),
      alwaysLoadMs,
      retrievalMs,
      rerankMs,
      buildMs,
    },
  }
}
