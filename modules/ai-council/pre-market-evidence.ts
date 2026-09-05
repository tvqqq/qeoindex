import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { AiCouncilStockSnapshot } from "@/modules/ai-council/data"
import { enrichCouncilStocksWithLlmEvidence } from "@/modules/ai-council/llm-evidence"
import { AI_COUNCIL_POLICY_VERSION } from "@/modules/ai-council/persistence"
import {
  AI_COUNCIL_REPORT_EVIDENCE_VERSION,
  freezeCouncilReportEvidence,
} from "@/modules/ai-council/report-evidence"
import {
  AI_COUNCIL_RESEARCH_CONTEXT_VERSION,
  freezeCouncilResearchContext,
  isCouncilResearchTickerEnabled,
} from "@/modules/ai-council/research-context"

type CouncilRunIdentityRow = {
  id: string
  ticker: string
  evidence_hash: string
}

type RawContextHashRow = {
  run_id: string
  context_hash: string
}

export interface AiCouncilPreMarketEvidenceResult {
  stocks: AiCouncilStockSnapshot[]
  contextVersion: string
  contextsBuilt: number
  contextsReused: number
  contextsPersisted: number
  missingRunIdentities: number
  ttaiRowsLoaded: number
  wyckoffRowsLoaded: number
  detail: string
  researchContextVersion: typeof AI_COUNCIL_RESEARCH_CONTEXT_VERSION
  researchReady: number
  researchUnavailable: number
  researchReused: number
  researchPersisted: number
  researchMissingRunIdentities: number
  reportEvidenceVersion: typeof AI_COUNCIL_REPORT_EVIDENCE_VERSION
  reportEvidenceReady: number
  reportEvidenceEmpty: number
  reportEvidenceUnavailable: number
  reportEvidenceReused: number
  reportEvidencePersisted: number
  reportEvidenceMissingRunIdentities: number
}

function runKey(ticker: string, evidenceHash: string) {
  return `${ticker}|${evidenceHash}`
}

async function loadRunIdentities(
  supabase: SupabaseClient,
  ratingDate: string,
  stocks: AiCouncilStockSnapshot[],
) {
  if (!stocks.length) return new Map<string, CouncilRunIdentityRow>()
  const result = await supabase
    .from("ai_council_runs")
    .select("id,ticker,evidence_hash")
    .eq("as_of_date", ratingDate)
    .eq("policy_version", AI_COUNCIL_POLICY_VERSION)
    .in("ticker", stocks.map((stock) => stock.ticker))
  if (result.error) throw new Error(`Load Council evidence identities failed: ${result.error.message}`)
  return new Map(
    ((result.data || []) as CouncilRunIdentityRow[])
      .map((row) => [runKey(row.ticker, row.evidence_hash), row] as const),
  )
}

async function loadRawContextHashes(supabase: SupabaseClient, runIds: string[]) {
  if (!runIds.length) return new Map<string, string>()
  const result = await supabase
    .from("ai_council_llm_evidence")
    .select("run_id,context_hash")
    .in("run_id", runIds)
  if (result.error) throw new Error(`Load raw LLM context hashes failed: ${result.error.message}`)
  return new Map(
    ((result.data || []) as RawContextHashRow[])
      .map((row) => [row.run_id, row.context_hash] as const),
  )
}

function attachResearchContext(
  stock: AiCouncilStockSnapshot,
  frozen: Awaited<ReturnType<typeof freezeCouncilResearchContext>>,
) {
  return {
    ...stock,
    researchContext: {
      purpose: "Curated Notion research evidence for advisory LLM reasoning only. Broker forecasts/targets are opinions, not verified company facts.",
      contextVersion: AI_COUNCIL_RESEARCH_CONTEXT_VERSION,
      contextHash: frozen.contextHash,
      rawContextHash: frozen.rawContextHash,
      promptIdentityHash: frozen.promptIdentityHash,
      context: frozen.context,
    },
  }
}

function attachReportEvidence(
  stock: AiCouncilStockSnapshot,
  frozen: Awaited<ReturnType<typeof freezeCouncilReportEvidence>>,
) {
  if (!frozen.canUseInPrompt || !frozen.contextHash) return stock
  return {
    ...stock,
    reportEvidence: {
      purpose: "Curated Research Report evidence for advisory LLM reasoning only; recommendations and targets are source opinions.",
      contextVersion: AI_COUNCIL_REPORT_EVIDENCE_VERSION,
      contextHash: frozen.contextHash,
      status: frozen.context.status,
      context: frozen.context,
    },
  }
}

export async function enrichCouncilStocksForDebate(
  supabase: SupabaseClient,
  params: {
    ratingDate: string | null
    stocks: AiCouncilStockSnapshot[]
    promptVersion: string
  },
): Promise<AiCouncilPreMarketEvidenceResult> {
  const raw = await enrichCouncilStocksWithLlmEvidence(supabase, {
    ratingDate: params.ratingDate,
    stocks: params.stocks,
  })

  if (!params.ratingDate || !raw.stocks.length) {
    return {
      ...raw,
      researchContextVersion: AI_COUNCIL_RESEARCH_CONTEXT_VERSION,
      researchReady: 0,
      researchUnavailable: 0,
      researchReused: 0,
      researchPersisted: 0,
      researchMissingRunIdentities: raw.stocks.length,
      reportEvidenceVersion: AI_COUNCIL_REPORT_EVIDENCE_VERSION,
      reportEvidenceReady: 0,
      reportEvidenceEmpty: 0,
      reportEvidenceUnavailable: 0,
      reportEvidenceReused: 0,
      reportEvidencePersisted: 0,
      reportEvidenceMissingRunIdentities: raw.stocks.length,
    }
  }

  const reportSelectionRunAt = new Date().toISOString()
  const reportStocks = raw.stocks
  const researchStocks = raw.stocks.filter((stock) => isCouncilResearchTickerEnabled(stock.ticker))
  const runIdentities = await loadRunIdentities(supabase, params.ratingDate, reportStocks)
  const researchRunIds = researchStocks
    .map((stock) => runIdentities.get(runKey(stock.ticker, stock.evidenceHash))?.id)
    .filter((runId): runId is string => Boolean(runId))
  const rawContextHashes = await loadRawContextHashes(supabase, researchRunIds)

  const researchFrozenByRun = new Map<
    string,
    Awaited<ReturnType<typeof freezeCouncilResearchContext>>
  >()
  let researchReady = 0
  let researchUnavailable = 0
  let researchReused = 0
  let researchPersisted = 0
  let researchMissingRunIdentities = 0

  for (const stock of researchStocks) {
    const run = runIdentities.get(runKey(stock.ticker, stock.evidenceHash))
    if (!run) {
      researchMissingRunIdentities += 1
      continue
    }
    const rawContextHash = rawContextHashes.get(run.id)
    if (!rawContextHash) {
      researchUnavailable += 1
      continue
    }

    const frozen = await freezeCouncilResearchContext(supabase, {
      runId: run.id,
      ticker: stock.ticker,
      asOfDate: params.ratingDate,
      deterministicEvidenceHash: stock.evidenceHash,
      rawContextHash,
      promptVersion: params.promptVersion,
    })
    researchFrozenByRun.set(run.id, frozen)
    if (frozen.context.status === "ready") researchReady += 1
    else researchUnavailable += 1
    if (frozen.reused) researchReused += 1
    else researchPersisted += 1
  }

  const reportFrozenByRun = new Map<
    string,
    Awaited<ReturnType<typeof freezeCouncilReportEvidence>>
  >()
  let reportEvidenceReady = 0
  let reportEvidenceEmpty = 0
  let reportEvidenceUnavailable = 0
  let reportEvidenceReused = 0
  let reportEvidencePersisted = 0
  let reportEvidenceMissingRunIdentities = 0

  for (const stock of reportStocks) {
    const run = runIdentities.get(runKey(stock.ticker, stock.evidenceHash))
    if (!run) {
      reportEvidenceMissingRunIdentities += 1
      continue
    }

    const frozen = await freezeCouncilReportEvidence(supabase, {
      runId: run.id,
      ticker: stock.ticker,
      asOfDate: params.ratingDate,
      runAt: reportSelectionRunAt,
    })
    reportFrozenByRun.set(run.id, frozen)
    if (frozen.context.status === "ready" && frozen.persisted) reportEvidenceReady += 1
    else if (frozen.context.status === "empty" && frozen.persisted) reportEvidenceEmpty += 1
    else reportEvidenceUnavailable += 1
    if (frozen.reused) reportEvidenceReused += 1
    else if (frozen.persisted) reportEvidencePersisted += 1
  }

  const stocks = raw.stocks.map((stock) => {
    const run = runIdentities.get(runKey(stock.ticker, stock.evidenceHash))
    if (!run) return stock

    const researchFrozen = researchFrozenByRun.get(run.id)
    const withResearch = researchFrozen ? attachResearchContext(stock, researchFrozen) : stock
    const reportFrozen = reportFrozenByRun.get(run.id)
    return reportFrozen ? attachReportEvidence(withResearch, reportFrozen) : withResearch
  })

  return {
    ...raw,
    stocks,
    researchContextVersion: AI_COUNCIL_RESEARCH_CONTEXT_VERSION,
    researchReady,
    researchUnavailable,
    researchReused,
    researchPersisted,
    researchMissingRunIdentities,
    reportEvidenceVersion: AI_COUNCIL_REPORT_EVIDENCE_VERSION,
    reportEvidenceReady,
    reportEvidenceEmpty,
    reportEvidenceUnavailable,
    reportEvidenceReused,
    reportEvidencePersisted,
    reportEvidenceMissingRunIdentities,
    detail: `${raw.detail} Notion Research Context pilot froze ${researchReady} ready context(s); unavailable=${researchUnavailable}, reused=${researchReused}. Research Reports froze ready=${reportEvidenceReady}, empty=${reportEvidenceEmpty}, unavailable=${reportEvidenceUnavailable}, reused=${reportEvidenceReused}.`,
  }
}
