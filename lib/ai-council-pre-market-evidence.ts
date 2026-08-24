import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { AiCouncilStockSnapshot } from "@/lib/ai-council-data"
import { enrichCouncilStocksWithLlmEvidence } from "@/lib/ai-council-llm-evidence"
import { AI_COUNCIL_POLICY_VERSION } from "@/lib/ai-council-persistence"
import {
  AI_COUNCIL_RESEARCH_CONTEXT_VERSION,
  freezeCouncilResearchContext,
  isCouncilResearchTickerEnabled,
} from "@/lib/ai-council-research-context"

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
  if (result.error) throw new Error(`Load Council identities for Notion research context failed: ${result.error.message}`)
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
    }
  }

  const researchStocks = raw.stocks.filter((stock) => isCouncilResearchTickerEnabled(stock.ticker))
  if (!researchStocks.length) {
    return {
      ...raw,
      researchContextVersion: AI_COUNCIL_RESEARCH_CONTEXT_VERSION,
      researchReady: 0,
      researchUnavailable: 0,
      researchReused: 0,
      researchPersisted: 0,
      researchMissingRunIdentities: 0,
    }
  }

  const runIdentities = await loadRunIdentities(supabase, params.ratingDate, researchStocks)
  const runIds = [...runIdentities.values()].map((row) => row.id)
  const rawContextHashes = await loadRawContextHashes(supabase, runIds)

  const frozenByRun = new Map<
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
    frozenByRun.set(run.id, frozen)
    if (frozen.context.status === "ready") researchReady += 1
    else researchUnavailable += 1
    if (frozen.reused) researchReused += 1
    else researchPersisted += 1
  }

  const stocks = raw.stocks.map((stock) => {
    const run = runIdentities.get(runKey(stock.ticker, stock.evidenceHash))
    if (!run) return stock
    const frozen = frozenByRun.get(run.id)
    return frozen ? attachResearchContext(stock, frozen) : stock
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
    detail: `${raw.detail} Notion Research Context pilot froze ${researchReady} ready context(s); unavailable=${researchUnavailable}, reused=${researchReused}.`,
  }
}
