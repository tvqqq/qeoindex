import type { SupabaseClient } from "@supabase/supabase-js"

import { getCachedResearchTickerData } from "../shared/cache/request-cache.ts"
import {
  assembleCouncilProjectionInputs,
  assembleResearchReportProjectionInputs,
} from "../ticker-knowledge/canonical.ts"
import {
  projectCouncilHistoryKnowledge,
  projectCurrentThesisKnowledge,
  projectResearchReportKnowledge,
} from "../ticker-knowledge/projections.ts"
import type { TickerKnowledgeItem } from "../ticker-knowledge/domain.ts"
import { normalizeTicker } from "../ticker-knowledge/domain.ts"
import { TICKER_QA_LIMITS, type TickerQaCitation } from "./types.ts"

const REPORT_TABLE = "market_research_reports"
const ANALYSIS_TABLE = "market_research_report_analyses"
const MENTION_TABLE = "market_research_report_ticker_mentions"
const CHUNK_TABLE = "market_research_report_chunks"
const COUNCIL_RUN_TABLE = "ai_council_runs"
const COUNCIL_OUTCOME_TABLE = "ai_council_outcomes"
const COUNCIL_DEBATE_TABLE = "ai_council_llm_debates"

export interface TickerQaResolvedEvidence {
  evidenceId: string
  item: TickerKnowledgeItem
  text: string
  citation: TickerQaCitation | null
}

export interface TickerQaCanonicalResolution {
  evidence: TickerQaResolvedEvidence[]
  unresolvedCount: number
  infrastructureFailure: boolean
  hydrationMs: number
}

type CanonicalCandidateLoader = (
  client: SupabaseClient,
  ticker: string,
  selected: TickerKnowledgeItem,
) => Promise<readonly TickerKnowledgeItem[]>

export interface TickerQaCanonicalDependencies {
  loadNotionCanonicalCandidates?: CanonicalCandidateLoader
  loadReportCanonicalCandidates?: CanonicalCandidateLoader
  loadCouncilCanonicalCandidates?: CanonicalCandidateLoader
}

function nowMs() {
  return typeof performance !== "undefined" ? performance.now() : Date.now()
}

function cleanText(value: unknown) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : ""
}

function rows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object" && !Array.isArray(row))
    : []
}

function exactOptional(left: unknown, right: unknown) {
  const leftValue = left ?? null
  const rightValue = right ?? null
  return leftValue === rightValue
}

function exactCanonicalMatch(selected: TickerKnowledgeItem, candidate: TickerKnowledgeItem) {
  if (
    candidate.id !== selected.id
    || candidate.identityKey !== selected.identityKey
    || candidate.ticker !== selected.ticker
    || candidate.knowledgeType !== selected.knowledgeType
    || candidate.sourceType !== selected.sourceType
    || candidate.authority !== selected.authority
    || candidate.provenance.sourceId !== selected.provenance.sourceId
    || candidate.provenance.sourceVersion !== selected.provenance.sourceVersion
  ) return false

  const selectedP = selected.provenance
  const candidateP = candidate.provenance
  return exactOptional(candidateP.reportId, selectedP.reportId)
    && exactOptional(candidateP.analysisId, selectedP.analysisId)
    && exactOptional(candidateP.contentHash, selectedP.contentHash)
    && exactOptional(candidateP.chunkVersion, selectedP.chunkVersion)
    && exactOptional(candidateP.chunkId, selectedP.chunkId)
    && exactOptional(candidateP.chunkIndex, selectedP.chunkIndex)
    && exactOptional(candidateP.page, selectedP.page)
    && exactOptional(candidateP.runId, selectedP.runId)
    && exactOptional(candidateP.asOf, selectedP.asOf)
    && exactOptional(candidateP.publishedAt, selectedP.publishedAt)
}

function boundedExcerpt(text: string) {
  const normalized = cleanText(text)
  if (normalized.length <= TICKER_QA_LIMITS.citationExcerptChars) return normalized
  return `${normalized.slice(0, Math.max(0, TICKER_QA_LIMITS.citationExcerptChars - 1)).trimEnd()}…`
}

function citationFor(item: TickerKnowledgeItem): TickerQaCitation | null {
  if (item.sourceType === "NOTION_THESIS") {
    return {
      id: `tk:${item.id}`,
      sourceType: "NOTION_THESIS",
      authority: item.authority,
      label: "Current Stock Thesis",
      excerpt: boundedExcerpt(item.text),
      href: null,
      sourceVersion: item.provenance.sourceVersion,
    }
  }

  if (item.sourceType === "RESEARCH_REPORT" && item.provenance.reportId) {
    return {
      id: `tk:${item.id}`,
      sourceType: "RESEARCH_REPORT",
      authority: item.authority,
      label: item.provenance.page
        ? `Research Report · page ${item.provenance.page}`
        : "Research Report",
      excerpt: boundedExcerpt(item.text),
      href: `/research/reports/${encodeURIComponent(item.provenance.reportId)}`,
      reportId: item.provenance.reportId,
      page: item.provenance.page ?? undefined,
      sourceVersion: item.provenance.sourceVersion,
    }
  }

  if (item.sourceType === "AI_COUNCIL" && item.provenance.runId) {
    return {
      id: `tk:${item.id}`,
      sourceType: "AI_COUNCIL",
      authority: item.authority,
      label: `AI Council · ${item.provenance.asOf ?? item.provenance.runId}`,
      excerpt: boundedExcerpt(item.text),
      href: null,
      runId: item.provenance.runId,
      sourceVersion: item.provenance.sourceVersion,
    }
  }

  return null
}

async function loadNotionCanonicalCandidates(
  _client: SupabaseClient,
  ticker: string,
  _selected: TickerKnowledgeItem,
) {
  const research = await getCachedResearchTickerData(ticker)
  if (research.connection.notionLive !== true) return []
  const thesis = research.theses.find((row) => (
    normalizeTicker(row.ticker) === ticker
    && row.status.trim().toLowerCase() === "current"
  ))
  return thesis ? [projectCurrentThesisKnowledge(thesis)] : []
}

async function loadReportCanonicalCandidates(
  client: SupabaseClient,
  ticker: string,
  selected: TickerKnowledgeItem,
): Promise<TickerKnowledgeItem[]> {
  const provenance = selected.provenance
  if (!provenance.reportId || !provenance.analysisId || !provenance.contentHash || !provenance.chunkVersion) return []

  const reportResult = await client
    .from(REPORT_TABLE)
    .select("id,title,source_name,publish_date,content_hash,analysis_status")
    .eq("id", provenance.reportId)
    .eq("content_hash", provenance.contentHash)
    .maybeSingle()
  if (reportResult.error) throw new Error(`Ticker Q&A canonical report lookup failed: ${cleanText(reportResult.error.message).slice(0, 200)}`)
  if (!reportResult.data) return []

  const analysisResult = await client
    .from(ANALYSIS_TABLE)
    .select("id,report_id,content_hash,chunk_version,executive_summary,key_points,market_view,sector_outlook,catalysts,risks,processed_at,created_at")
    .eq("id", provenance.analysisId)
    .eq("report_id", provenance.reportId)
    .eq("content_hash", provenance.contentHash)
    .eq("chunk_version", provenance.chunkVersion)
    .maybeSingle()
  if (analysisResult.error) throw new Error(`Ticker Q&A canonical analysis lookup failed: ${cleanText(analysisResult.error.message).slice(0, 200)}`)
  if (!analysisResult.data) return []

  const mentionResult = await client
    .from(MENTION_TABLE)
    .select("analysis_id,ticker,stance,recommendation_text,target_price,target_currency,rationale,evidence")
    .eq("analysis_id", provenance.analysisId)
    .eq("ticker", ticker)
  if (mentionResult.error) throw new Error(`Ticker Q&A canonical mention lookup failed: ${cleanText(mentionResult.error.message).slice(0, 200)}`)

  let chunks: Record<string, unknown>[] = []
  if (provenance.chunkId) {
    const chunkResult = await client
      .from(CHUNK_TABLE)
      .select("id,report_id,content_hash,chunk_version,page_number,chunk_index,content,chunk_hash")
      .eq("id", provenance.chunkId)
      .eq("report_id", provenance.reportId)
      .eq("content_hash", provenance.contentHash)
      .eq("chunk_version", provenance.chunkVersion)
      .maybeSingle()
    if (chunkResult.error) throw new Error(`Ticker Q&A canonical chunk lookup failed: ${cleanText(chunkResult.error.message).slice(0, 200)}`)
    if (chunkResult.data) chunks = [chunkResult.data as Record<string, unknown>]
  }

  const inputs = assembleResearchReportProjectionInputs({
    reports: [reportResult.data as Record<string, unknown>],
    analyses: [analysisResult.data as Record<string, unknown>],
    mentions: rows(mentionResult.data),
    chunks,
  })
  return inputs.flatMap(projectResearchReportKnowledge).filter((item) => item.ticker === ticker)
}

async function loadCouncilCanonicalCandidates(
  client: SupabaseClient,
  ticker: string,
  selected: TickerKnowledgeItem,
): Promise<TickerKnowledgeItem[]> {
  const runId = selected.provenance.runId
  if (!runId) return []

  const runResult = await client
    .from(COUNCIL_RUN_TABLE)
    .select("id,ticker,as_of_date,signal,council_score,confidence,consensus,risk_status,price,policy_version,evidence_hash,created_at,bull_case,bear_case,confirmation,invalidation,what_changes_decision,decision_payload")
    .eq("id", runId)
    .eq("ticker", ticker)
    .maybeSingle()
  if (runResult.error) throw new Error(`Ticker Q&A canonical Council run lookup failed: ${cleanText(runResult.error.message).slice(0, 200)}`)
  if (!runResult.data) return []

  const outcomeResult = await client
    .from(COUNCIL_OUTCOME_TABLE)
    .select("run_id,outcome_status,sessions_observed,evaluated_through_date,return_1d_pct,return_5d_pct,return_20d_pct,mfe_20d_pct,mae_20d_pct,direction_correct_5d,last_refreshed_at")
    .eq("run_id", runId)
    .order("last_refreshed_at", { ascending: false })
    .limit(1)
  if (outcomeResult.error) throw new Error(`Ticker Q&A canonical Council outcome lookup failed: ${cleanText(outcomeResult.error.message).slice(0, 200)}`)

  const debateResult = await client
    .from(COUNCIL_DEBATE_TABLE)
    .select("id,run_id,status,prompt_version,error,completed_at,created_at")
    .eq("run_id", runId)
    .order("completed_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
  if (debateResult.error) throw new Error(`Ticker Q&A canonical Council debate lookup failed: ${cleanText(debateResult.error.message).slice(0, 200)}`)

  const inputs = assembleCouncilProjectionInputs({
    runs: [runResult.data as Record<string, unknown>],
    outcomes: rows(outcomeResult.data),
    debates: rows(debateResult.data),
  })
  return inputs.flatMap(projectCouncilHistoryKnowledge).filter((item) => item.ticker === ticker)
}

export async function resolveTickerQaEvidence(
  client: SupabaseClient,
  rawTicker: string,
  items: readonly TickerKnowledgeItem[],
  deps: TickerQaCanonicalDependencies = {},
): Promise<TickerQaCanonicalResolution> {
  const startedAt = nowMs()
  const ticker = normalizeTicker(rawTicker)
  const evidence: TickerQaResolvedEvidence[] = []
  let unresolvedCount = 0
  let infrastructureFailure = false
  const seen = new Set<string>()

  for (const selected of items) {
    if (selected.ticker !== ticker || seen.has(selected.id)) {
      unresolvedCount += 1
      continue
    }
    seen.add(selected.id)

    let loader: CanonicalCandidateLoader | null = null
    if (selected.sourceType === "NOTION_THESIS") loader = deps.loadNotionCanonicalCandidates ?? loadNotionCanonicalCandidates
    else if (selected.sourceType === "RESEARCH_REPORT") loader = deps.loadReportCanonicalCandidates ?? loadReportCanonicalCandidates
    else if (selected.sourceType === "AI_COUNCIL") loader = deps.loadCouncilCanonicalCandidates ?? loadCouncilCanonicalCandidates

    if (!loader) {
      unresolvedCount += 1
      continue
    }

    try {
      const candidates = await loader(client, ticker, selected)
      const canonical = candidates.find((candidate) => exactCanonicalMatch(selected, candidate))
      if (!canonical) {
        unresolvedCount += 1
        continue
      }
      evidence.push({
        evidenceId: `tk:${canonical.id}`,
        item: canonical,
        text: canonical.text,
        citation: citationFor(canonical),
      })
    } catch {
      infrastructureFailure = true
      unresolvedCount += 1
    }
  }

  return {
    evidence,
    unresolvedCount,
    infrastructureFailure,
    hydrationMs: Math.max(0, nowMs() - startedAt),
  }
}
