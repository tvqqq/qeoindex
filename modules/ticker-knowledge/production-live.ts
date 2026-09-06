import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import { getSupabaseServerClient } from "@/modules/shared/supabase/server"
import {
  retrieveResearchReportQaEvidence,
  type ResearchReportQaEvidenceIdentity,
} from "@/modules/research-reports/qa/retrieval"
import { retrieveResearchReportQaHybridEvidence } from "@/modules/research-reports/qa/hybrid-retrieval"
import type { ResearchReportQaEvaluationCase } from "@/modules/research-reports/qa/evaluation"
import {
  prepareTickerQaContext,
  validateTickerQaRequest,
} from "@/modules/ticker-qa/service"
import { buildTickerContext } from "./context"
import {
  TICKER_KNOWLEDGE_COLLECTION,
  type TickerKnowledgeItem,
} from "./domain"
import { evaluateTickerKnowledgeProductionAcceptance } from "./production-evaluation"
import { createServerTickerKnowledgeIndex } from "./server"

const RESET_CONFIRMATION = "RESET_DERIVED_TICKER_KNOWLEDGE" as const
const MAX_QDRANT_RESPONSE_CHARS = 200_000
const REPORT_TABLE = "market_research_reports"
const ANALYSIS_TABLE = "market_research_report_analyses"
const CHUNK_TABLE = "market_research_report_chunks"
const MENTION_TABLE = "market_research_report_ticker_mentions"
const COUNCIL_RUN_TABLE = "ai_council_runs"
const SNAPSHOT_TABLE = "ai_council_ticker_knowledge_snapshots"

type RecordRow = Record<string, unknown>

type ReportSample = {
  reportId: string
  analysisId: string
  contentHash: string
  chunkVersion: string
  chunkId: string
  chunkText: string
  title: string
}

type CouncilSample = {
  runId: string
  ticker: string
  asOfDate: string
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function finiteNumber(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

function requireSupabase() {
  const client = getSupabaseServerClient()
  if (!client) throw new Error("Ticker knowledge production acceptance requires Supabase service-role configuration")
  return client
}

function endOfVietnamDate(date: string) {
  const parsed = new Date(`${date}T23:59:59.999+07:00`)
  if (!Number.isFinite(parsed.getTime())) throw new Error("Invalid production Council as-of date")
  return parsed.toISOString()
}

function percentile(values: readonly number[], fraction: number) {
  if (!values.length) return 0
  const sorted = [...values].sort((left, right) => left - right)
  const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1))
  return sorted[index]
}

function latencySummary(values: readonly number[]) {
  return {
    samples: values.length,
    p50: Math.round(percentile(values, 0.5)),
    p95: Math.round(percentile(values, 0.95)),
    max: Math.round(values.length ? Math.max(...values) : 0),
  }
}

function probeText(value: string, maxTokens = 8) {
  const tokens = value.match(/[\p{L}\p{N}][\p{L}\p{N}._%/-]{2,}/gu) ?? []
  const seen = new Set<string>()
  const selected: string[] = []
  for (const token of tokens) {
    const normalized = token.toLowerCase()
    if (seen.has(normalized)) continue
    seen.add(normalized)
    selected.push(token)
    if (selected.length >= maxTokens) break
  }
  return selected.join(" ") || "valuation earnings outlook"
}

function exactEvidence(
  evidence: readonly { reportId: string; contentHash: string; chunkVersion: string; page: number }[],
  identity: ResearchReportQaEvidenceIdentity,
) {
  return evidence.length > 0 && evidence.every((row) => (
    row.reportId === identity.reportId
    && row.contentHash === identity.contentHash
    && row.chunkVersion === identity.chunkVersion
    && Number.isInteger(row.page)
    && row.page > 0
  ))
}

async function loadReportSample(client: SupabaseClient): Promise<ReportSample> {
  const chunkResponse = await client
    .from(CHUNK_TABLE)
    .select("id,report_id,content_hash,chunk_version,content,created_at")
    .not("content", "is", null)
    .order("created_at", { ascending: false })
    .limit(25)

  if (chunkResponse.error) throw new Error(`Production report sample read failed: ${chunkResponse.error.message}`)
  const chunks = Array.isArray(chunkResponse.data) ? chunkResponse.data as RecordRow[] : []

  for (const chunk of chunks) {
    const reportId = text(chunk.report_id)
    const contentHash = text(chunk.content_hash)
    const chunkVersion = text(chunk.chunk_version)
    const chunkId = text(chunk.id)
    const chunkText = text(chunk.content)
    if (!reportId || !contentHash || !chunkVersion || !chunkId || !chunkText) continue

    const reportResponse = await client
      .from(REPORT_TABLE)
      .select("id,title,content_hash,analysis_status")
      .eq("id", reportId)
      .eq("content_hash", contentHash)
      .eq("analysis_status", "ready")
      .maybeSingle()
    if (reportResponse.error) throw new Error(`Production report lookup failed: ${reportResponse.error.message}`)
    if (!reportResponse.data) continue

    const analysisResponse = await client
      .from(ANALYSIS_TABLE)
      .select("id,report_id,content_hash,chunk_version,processed_at,created_at")
      .eq("report_id", reportId)
      .eq("content_hash", contentHash)
      .eq("chunk_version", chunkVersion)
      .order("processed_at", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    if (analysisResponse.error) throw new Error(`Production report analysis lookup failed: ${analysisResponse.error.message}`)
    if (!analysisResponse.data) continue

    const analysisId = text(analysisResponse.data.id)
    if (!analysisId) continue
    return {
      reportId,
      analysisId,
      contentHash,
      chunkVersion,
      chunkId,
      chunkText,
      title: text(reportResponse.data.title),
    }
  }

  throw new Error("No ready production report sample with canonical chunks")
}

async function loadCouncilSample(client: SupabaseClient): Promise<CouncilSample> {
  const response = await client
    .from(COUNCIL_RUN_TABLE)
    .select("id,ticker,as_of_date")
    .order("as_of_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (response.error) throw new Error(`Production Council sample read failed: ${response.error.message}`)
  if (!response.data) throw new Error("No production Council run is available")
  const runId = text(response.data.id)
  const ticker = text(response.data.ticker).toUpperCase()
  const asOfDate = text(response.data.as_of_date)
  if (!runId || !ticker || !asOfDate) throw new Error("Production Council sample is incomplete")
  return { runId, ticker, asOfDate }
}

async function loadStockTicker(client: SupabaseClient) {
  const response = await client
    .from(MENTION_TABLE)
    .select("ticker,created_at")
    .not("ticker", "is", null)
    .order("created_at", { ascending: false })
    .limit(20)
  if (response.error) throw new Error(`Production ticker mention read failed: ${response.error.message}`)
  const rows = Array.isArray(response.data) ? response.data as RecordRow[] : []
  for (const row of rows) {
    const ticker = text(row.ticker).toUpperCase()
    if (/^[A-Z0-9]{2,12}$/.test(ticker)) return ticker
  }
  return (await loadCouncilSample(client)).ticker
}

function qdrantConfiguration() {
  const baseUrl = process.env.QDRANT_URL?.trim().replace(/\/+$/, "")
  const apiKey = process.env.QDRANT_API_KEY?.trim()
  if (!baseUrl || !apiKey) throw new Error("Ticker knowledge production acceptance requires Qdrant configuration")
  const url = new URL(baseUrl)
  if (url.protocol !== "https:" && !["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
    throw new Error("Ticker knowledge production Qdrant URL must use HTTPS")
  }
  return { baseUrl, apiKey }
}

async function qdrantJson(path: string, init: RequestInit = {}) {
  const { baseUrl, apiKey } = qdrantConfiguration()
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      "api-key": apiKey,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  })
  const raw = await response.text()
  if (!response.ok) throw new Error(`Ticker knowledge Qdrant operation failed (${response.status})`)
  if (raw.length > MAX_QDRANT_RESPONSE_CHARS) throw new Error("Ticker knowledge Qdrant response exceeded acceptance bound")
  if (!raw) return {} as RecordRow
  const parsed: unknown = JSON.parse(raw)
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Ticker knowledge Qdrant response is invalid")
  return parsed as RecordRow
}

async function qdrantCount(sourceType?: "RESEARCH_REPORT" | "AI_COUNCIL") {
  const filter = sourceType
    ? { filter: { must: [{ key: "source_type", match: { value: sourceType } }] }, exact: true }
    : { exact: true }
  const payload = await qdrantJson(`/collections/${TICKER_KNOWLEDGE_COLLECTION}/points/count`, {
    method: "POST",
    body: JSON.stringify(filter),
  })
  const result = payload.result && typeof payload.result === "object" && !Array.isArray(payload.result)
    ? payload.result as RecordRow
    : {}
  return Math.max(0, Math.floor(finiteNumber(result.count)))
}

async function tableCount(client: SupabaseClient, table: string, filter?: (query: any) => any) {
  let query = client.from(table).select("*", { count: "exact", head: true })
  if (filter) query = filter(query)
  const response = await query
  if (response.error) throw new Error(`Production inventory read failed for ${table}: ${response.error.message}`)
  return response.count ?? 0
}

function collectionMetrics(payload: RecordRow) {
  const result = payload.result && typeof payload.result === "object" && !Array.isArray(payload.result)
    ? payload.result as RecordRow
    : {}
  return {
    status: text(result.status) || "unknown",
    points: Math.max(0, Math.floor(finiteNumber(result.points_count))),
    indexedVectors: Math.max(0, Math.floor(finiteNumber(result.indexed_vectors_count))),
    segments: Math.max(0, Math.floor(finiteNumber(result.segments_count))),
  }
}

export async function runServerTickerKnowledgeInventory() {
  const client = requireSupabase()
  const [collection, totalPoints, reportPoints, councilPoints, reports, reportChunks, councilRuns, councilSnapshots] = await Promise.all([
    qdrantJson(`/collections/${TICKER_KNOWLEDGE_COLLECTION}`, { method: "GET" }),
    qdrantCount(),
    qdrantCount("RESEARCH_REPORT"),
    qdrantCount("AI_COUNCIL"),
    tableCount(client, REPORT_TABLE, (query) => query.eq("analysis_status", "ready")),
    tableCount(client, CHUNK_TABLE),
    tableCount(client, COUNCIL_RUN_TABLE),
    tableCount(client, SNAPSHOT_TABLE),
  ])

  const qdrant = collectionMetrics(collection)
  return {
    collection: TICKER_KNOWLEDGE_COLLECTION,
    qdrant: {
      ...qdrant,
      exactPointCount: totalPoints,
      reportPoints,
      councilPoints,
      sourcePointSumMatchesTotal: reportPoints + councilPoints === totalPoints,
    },
    canonical: { reports, reportChunks, councilRuns, councilSnapshots },
  }
}

async function reportProbe(client: SupabaseClient, sample: ReportSample, queryText: string) {
  const identity: ResearchReportQaEvidenceIdentity = {
    reportId: sample.reportId,
    analysisId: sample.analysisId,
    contentHash: sample.contentHash,
    chunkVersion: sample.chunkVersion,
  }
  const startedAt = performance.now()
  const lexical = await retrieveResearchReportQaEvidence(client, identity, queryText)
  const lexicalMs = Math.max(0, performance.now() - startedAt)
  const hybrid = await retrieveResearchReportQaHybridEvidence(
    createServerTickerKnowledgeIndex(),
    client,
    identity,
    queryText,
  )
  const canonical = hybrid.status === "ready" && exactEvidence(hybrid.evidence, identity)
  return { identity, lexical, lexicalMs, hybrid, canonical }
}

export async function runServerReportQaCanary() {
  const client = requireSupabase()
  const sample = await loadReportSample(client)
  const probe = await reportProbe(client, sample, probeText(sample.chunkText))
  const expectedFound = probe.hybrid.status === "ready"
    && probe.hybrid.evidence.some((row) => row.chunkId === sample.chunkId)
  return {
    passed: probe.hybrid.status === "ready" && probe.canonical && probe.hybrid.evidence.length > 0,
    reportId: sample.reportId,
    analysisId: sample.analysisId,
    expectedChunkFound: expectedFound,
    lexicalCount: probe.lexical.length,
    hybridCandidateCount: probe.hybrid.status === "ready" ? probe.hybrid.pointIds.length : 0,
    canonicalHybridCount: probe.hybrid.status === "ready" ? probe.hybrid.evidence.length : 0,
    latencyMs: {
      lexical: Math.round(probe.lexicalMs),
      hybridRetrieval: probe.hybrid.status === "ready" ? Math.round(probe.hybrid.retrievalMs) : 0,
      hybridHydration: probe.hybrid.status === "ready" ? Math.round(probe.hybrid.hydrationMs) : 0,
    },
  }
}

export async function runServerStockQaCanary() {
  const client = requireSupabase()
  const ticker = await loadStockTicker(client)
  const request = validateTickerQaRequest({ ticker, question: "catalysts risks valuation outlook", history: [] })
  const prepared = await prepareTickerQaContext(client, request, { index: createServerTickerKnowledgeIndex() })
  const isolated = prepared.context.items.every((item) => item.ticker === ticker)
  const grounded = prepared.evidence.length > 0 && prepared.unresolvedCount === 0
  return {
    passed: prepared.context.retrievalStatus === "ready" && isolated && grounded && !prepared.infrastructureFailure,
    ticker,
    retrievalStatus: prepared.context.retrievalStatus,
    selectedItems: prepared.context.items.length,
    resolvedEvidence: prepared.evidence.length,
    unresolved: prepared.unresolvedCount,
    tickerIsolation: isolated,
    latencyMs: {
      context: Math.round(prepared.context.telemetry.totalMs),
      hydration: Math.round(prepared.hydrationMs),
    },
  }
}

function authorityBoundary(items: readonly TickerKnowledgeItem[]) {
  if (!items.length) return false
  return items.every((item) => {
    if (item.sourceType === "RESEARCH_REPORT") return item.authority === "SOURCE_OPINION"
    if (item.sourceType !== "AI_COUNCIL") return true
    if (item.knowledgeType === "COUNCIL_MEMORY" || item.knowledgeType === "COUNCIL_SCENARIO") {
      return item.authority === "DETERMINISTIC_SIGNAL"
    }
    if (item.knowledgeType === "COUNCIL_OUTCOME" || item.knowledgeType === "COUNCIL_ERROR") {
      return item.authority === "VERIFIED_FACT"
    }
    return true
  })
}

function temporalBoundary(items: readonly TickerKnowledgeItem[], cutoff: string) {
  const max = new Date(cutoff).getTime()
  return items.length > 0 && items.every((item) => {
    const raw = item.provenance.asOf ?? item.provenance.publishedAt
    if (!raw) return false
    const time = new Date(raw).getTime()
    return Number.isFinite(time) && time <= max
  })
}

export async function runServerCouncilKnowledgeCanary() {
  const client = requireSupabase()
  const sample = await loadCouncilSample(client)
  const asOf = endOfVietnamDate(sample.asOfDate)
  const context = await buildTickerContext({
    index: createServerTickerKnowledgeIndex(),
    ticker: sample.ticker,
    query: `${sample.ticker} historical Council decisions outcomes risks catalysts contradictions reusable lessons`,
    consumer: "AI_COUNCIL",
    knowledgeTypes: ["COUNCIL_MEMORY", "COUNCIL_OUTCOME", "REPORT_SUMMARY", "BROKER_VIEW"],
    asOf,
    now: asOf,
  })
  const isolated = context.items.every((item) => item.ticker === sample.ticker)
  const hasCouncil = context.items.some((item) => item.sourceType === "AI_COUNCIL")
  const authorityOk = authorityBoundary(context.items)
  const temporalOk = temporalBoundary(context.items, asOf)
  return {
    passed: context.retrievalStatus === "ready" && isolated && hasCouncil && authorityOk && temporalOk,
    ticker: sample.ticker,
    runId: sample.runId,
    asOfDate: sample.asOfDate,
    retrievalStatus: context.retrievalStatus,
    selectedItems: context.items.length,
    retrievedPoints: context.retrievedPointIds.length,
    tickerIsolation: isolated,
    authorityBoundary: authorityOk,
    temporalValidity: temporalOk,
    latencyMs: Math.round(context.telemetry.totalMs),
  }
}

function evaluationCase(
  id: string,
  kind: ResearchReportQaEvaluationCase["kind"],
  expectedChunkId: string,
  probe: Awaited<ReturnType<typeof reportProbe>>,
): ResearchReportQaEvaluationCase {
  const hybridChunkIds = probe.hybrid.status === "ready" ? probe.hybrid.evidence.map((row) => row.chunkId) : []
  return {
    id,
    kind,
    expectedChunkIds: [expectedChunkId],
    lexicalChunkIds: probe.lexical.map((row) => row.chunkId),
    hybridChunkIds,
    qdrantCandidateCount: probe.hybrid.status === "ready" ? probe.hybrid.pointIds.length : 0,
    canonicalHybridCount: probe.hybrid.status === "ready" ? probe.hybrid.evidence.length : 0,
    lexicalMs: probe.lexicalMs,
    hybridRetrievalMs: probe.hybrid.status === "ready" ? probe.hybrid.retrievalMs : 0,
    hybridHydrationMs: probe.hybrid.status === "ready" ? probe.hybrid.hydrationMs : 0,
    citationValidity: probe.canonical ? "pass" : "fail",
    answerQuality: "not_scored",
  }
}

export async function runServerTickerKnowledgeBenchmark() {
  const client = requireSupabase()
  const sample = await loadReportSample(client)
  const lexicalProbe = await reportProbe(client, sample, probeText(sample.chunkText))
  const semanticProbe = await reportProbe(client, sample, probeText(sample.title || sample.chunkText, 6))
  const lexicalExpected = lexicalProbe.lexical[0]?.chunkId ?? sample.chunkId
  const semanticExpected = semanticProbe.lexical[0]?.chunkId ?? sample.chunkId
  const reportCases = [
    evaluationCase("production-lexical-anchor", "lexical_anchor", lexicalExpected, lexicalProbe),
    evaluationCase("production-semantic-title", "semantic_paraphrase", semanticExpected, semanticProbe),
  ]

  const councilSample = await loadCouncilSample(client)
  const asOf = endOfVietnamDate(councilSample.asOfDate)
  const councilContext = await buildTickerContext({
    index: createServerTickerKnowledgeIndex(),
    ticker: councilSample.ticker,
    query: `${councilSample.ticker} historical decisions outcomes risks reusable lessons`,
    consumer: "HISTORICAL_CASE_SEARCH",
    asOf,
    now: asOf,
  })
  const isolated = councilContext.retrievalStatus === "ready"
    && councilContext.items.length > 0
    && councilContext.items.every((item) => item.ticker === councilSample.ticker)
  const authorityOk = authorityBoundary(councilContext.items)
  const temporalOk = temporalBoundary(councilContext.items, asOf)
  const historical = councilContext.items.some((item) => (
    item.knowledgeType === "COUNCIL_MEMORY" || item.knowledgeType === "COUNCIL_OUTCOME"
  ))
  const exactVersion = lexicalProbe.hybrid.status === "ready" && lexicalProbe.canonical

  const evaluation = evaluateTickerKnowledgeProductionAcceptance({
    reportCases,
    tickerIsolation: { tested: 1, passed: isolated ? 1 : 0 },
    exactVersion: { tested: 1, passed: exactVersion ? 1 : 0 },
    contradictionAuthority: { tested: 1, passed: authorityOk ? 1 : 0 },
    temporalValidity: { tested: 1, passed: temporalOk ? 1 : 0 },
    historicalAnalog: { tested: 1, passed: historical ? 1 : 0 },
  })
  const latencies = reportCases.flatMap((entry) => [
    entry.lexicalMs,
    entry.hybridRetrievalMs + entry.hybridHydrationMs,
  ]).concat(councilContext.telemetry.totalMs)

  return {
    passed: evaluation.passed,
    gates: evaluation.gates,
    report: {
      totalCases: evaluation.report.totalCases,
      lexicalRecall: evaluation.report.overall.lexical.recall,
      hybridRecall: evaluation.report.overall.hybrid.recall,
      canonicalResolutionRate: evaluation.report.canonicalResolutionRate,
      citationPassRate: evaluation.report.citationValidity.passRate,
    },
    probes: evaluation.probes,
    latencyMs: latencySummary(latencies),
  }
}

export async function resetServerTickerKnowledgeDerivedCollection(confirm: string) {
  if (confirm !== RESET_CONFIRMATION) throw new Error("Ticker knowledge collection reset requires explicit confirmation")
  await qdrantJson(`/collections/${TICKER_KNOWLEDGE_COLLECTION}`, { method: "DELETE" })
  await createServerTickerKnowledgeIndex().ensureReady()
  const totalPoints = await qdrantCount()
  if (totalPoints !== 0) throw new Error("Ticker knowledge derived collection did not reset to zero points")
  return {
    collection: TICKER_KNOWLEDGE_COLLECTION,
    reset: true,
    recreated: true,
    exactPointCount: totalPoints,
  }
}
