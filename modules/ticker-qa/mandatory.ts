import type { SupabaseClient } from "@supabase/supabase-js"

import type { ResearchData } from "../research/types.ts"
import {
  projectCouncilHistoryKnowledge,
  projectCurrentThesisKnowledge,
  type CouncilHistoryKnowledgeProjectionInput,
} from "../ticker-knowledge/projections.ts"
import { normalizeTicker, type TickerKnowledgeItem } from "../ticker-knowledge/domain.ts"

export interface TickerQaMandatoryContext {
  items: TickerKnowledgeItem[]
  limitations: string[]
  infrastructureFailure?: boolean
}

export interface TickerQaLatestCouncilRun {
  id: string
  ticker: string
  asOfDate: string
  signal: string
  councilScore: number
  confidence: number
  consensus: number
  riskStatus: string
  price: number | null
  policyVersion: string
  evidenceHash: string
  createdAt: string
}

export interface TickerQaMandatoryDependencies {
  loadResearchTickerData?: (ticker: string) => Promise<ResearchData>
  loadLatestCouncilRun?: (client: SupabaseClient, ticker: string) => Promise<TickerQaLatestCouncilRun | null>
}

type CouncilRunRow = {
  id: string
  ticker: string
  as_of_date: string
  signal: string
  council_score: number
  confidence: number
  consensus: number
  risk_status: string
  price: number | null
  policy_version: string
  evidence_hash: string
  created_at: string
}

function finiteNumber(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function nullableNumber(value: unknown) {
  if (value == null || value === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

async function loadResearchTickerDataDefault(ticker: string): Promise<ResearchData> {
  const { getCachedResearchTickerData } = await import("../shared/cache/request-cache.ts")
  return getCachedResearchTickerData(ticker)
}

async function loadLatestCouncilRunFromPostgres(
  client: SupabaseClient,
  ticker: string,
): Promise<TickerQaLatestCouncilRun | null> {
  const result = await client
    .from("ai_council_runs")
    .select("id,ticker,as_of_date,signal,council_score,confidence,consensus,risk_status,price,policy_version,evidence_hash,created_at")
    .eq("ticker", ticker)
    .order("as_of_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (result.error) {
    throw new Error(`Unable to load canonical AI Council state: ${result.error.message}`)
  }
  if (!result.data) return null

  const row = result.data as CouncilRunRow
  if (normalizeTicker(row.ticker) !== ticker) return null
  if (!row.id || !row.as_of_date || !row.policy_version || !/^[0-9a-f]{64}$/.test(row.evidence_hash || "")) return null

  return {
    id: row.id,
    ticker,
    asOfDate: row.as_of_date,
    signal: row.signal,
    councilScore: finiteNumber(row.council_score),
    confidence: finiteNumber(row.confidence),
    consensus: finiteNumber(row.consensus),
    riskStatus: row.risk_status,
    price: nullableNumber(row.price),
    policyVersion: row.policy_version,
    evidenceHash: row.evidence_hash,
    createdAt: row.created_at,
  }
}

function councilProjectionInput(run: TickerQaLatestCouncilRun): CouncilHistoryKnowledgeProjectionInput {
  return {
    id: run.id,
    ticker: run.ticker,
    asOfDate: run.asOfDate,
    signal: run.signal,
    councilScore: run.councilScore,
    confidence: run.confidence,
    consensus: run.consensus,
    riskStatus: run.riskStatus,
    price: run.price,
    policyVersion: run.policyVersion,
    evidenceHash: run.evidenceHash,
    createdAt: run.createdAt,
    outcome: null,
  }
}

export async function loadTickerQaMandatoryContext(
  client: SupabaseClient,
  rawTicker: string,
  deps: TickerQaMandatoryDependencies = {},
): Promise<TickerQaMandatoryContext> {
  const ticker = normalizeTicker(rawTicker)
  const loadResearch = deps.loadResearchTickerData ?? loadResearchTickerDataDefault
  const loadCouncil = deps.loadLatestCouncilRun ?? loadLatestCouncilRunFromPostgres
  const items: TickerKnowledgeItem[] = []
  const limitations: string[] = []
  let infrastructureFailure = false

  try {
    const research = await loadResearch(ticker)
    if (research.connection.notionLive === true) {
      const thesis = research.theses.find((row) => (
        normalizeTicker(row.ticker) === ticker
        && row.status.trim().toLowerCase() === "current"
      ))
      if (thesis) items.push(projectCurrentThesisKnowledge(thesis))
      else limitations.push(`CURRENT_THESIS unavailable for ${ticker}`)
    } else {
      infrastructureFailure = true
      limitations.push(`CURRENT_THESIS canonical Notion source unavailable for ${ticker}`)
    }
  } catch {
    infrastructureFailure = true
    limitations.push(`CURRENT_THESIS canonical Notion source unavailable for ${ticker}`)
  }

  try {
    const run = await loadCouncil(client, ticker)
    if (run) {
      const memory = projectCouncilHistoryKnowledge(councilProjectionInput(run))
        .find((item) => item.knowledgeType === "COUNCIL_MEMORY")
      if (memory) items.push(memory)
    } else {
      limitations.push(`DETERMINISTIC_SIGNAL unavailable for ${ticker}`)
    }
  } catch {
    infrastructureFailure = true
    limitations.push(`DETERMINISTIC_SIGNAL canonical PostgreSQL source unavailable for ${ticker}`)
  }

  return { items, limitations, infrastructureFailure }
}
