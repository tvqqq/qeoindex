import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { AiCouncilData, AiCouncilStockSnapshot } from "@/lib/ai-council-data"

export const AI_COUNCIL_POLICY_VERSION = "council-policy-v1"
export const AI_COUNCIL_ENGINE = "deterministic-evidence-v1"

type PersistedRunIdentity = {
  id: string
  ticker: string
  evidence_hash: string
}

export interface AiCouncilPersistResult {
  ratingDate: string
  insertedRuns: number
  materializedRuns: number
  persistedVotes: number
  refreshedOutcomes: number
}

function runKey(ticker: string, evidenceHash: string) {
  return `${ticker}|${evidenceHash}`
}

function runRow(stock: AiCouncilStockSnapshot, ratingDate: string, mode: AiCouncilData["mode"]) {
  return {
    as_of_date: ratingDate,
    ticker: stock.ticker,
    bar_closed_at: stock.asOf,
    rating_date: ratingDate,
    policy_version: AI_COUNCIL_POLICY_VERSION,
    evidence_version: mode,
    evidence_hash: stock.evidenceHash,
    signal: stock.signal,
    council_score: stock.councilScore,
    confidence: stock.confidence,
    consensus: stock.consensus,
    bull_votes: stock.bullVotes,
    neutral_votes: stock.neutralVotes,
    bear_votes: stock.bearVotes,
    risk_status: stock.riskStatus,
    confirmation_pending: stock.confirmationPending,
    data_quality: stock.dataQuality,
    price: stock.price,
    support: stock.support,
    resistance: stock.resistance,
    confirmation: stock.confirmation,
    invalidation: stock.invalidation,
    bull_case: stock.bullCase,
    bear_case: stock.bearCase,
    dissent: stock.dissent,
    what_changes_decision: stock.whatChangesDecision,
    decision_payload: stock,
  }
}

export async function persistAiCouncilData(
  supabase: SupabaseClient,
  data: AiCouncilData,
): Promise<AiCouncilPersistResult> {
  if (!data.ratingDate) throw new Error("AI Council cannot persist without a ratingDate")
  if (!data.stocks.length) throw new Error("AI Council cannot persist an empty stock set")

  const ratingDate = data.ratingDate
  const rows = data.stocks.map((stock) => runRow(stock, ratingDate, data.mode))
  const inserted = await supabase
    .from("ai_council_runs")
    .upsert(rows, {
      onConflict: "ticker,as_of_date,policy_version,evidence_hash",
      ignoreDuplicates: true,
    })
    .select("id,ticker,evidence_hash")

  if (inserted.error) throw new Error(`Persist Council runs failed: ${inserted.error.message}`)

  const tickers = data.stocks.map((stock) => stock.ticker)
  const lookup = await supabase
    .from("ai_council_runs")
    .select("id,ticker,evidence_hash")
    .eq("as_of_date", ratingDate)
    .eq("policy_version", AI_COUNCIL_POLICY_VERSION)
    .in("ticker", tickers)

  if (lookup.error) throw new Error(`Reload Council run identities failed: ${lookup.error.message}`)

  const identityByKey = new Map(
    ((lookup.data || []) as PersistedRunIdentity[]).map((row) => [runKey(row.ticker, row.evidence_hash), row]),
  )

  const votes = data.stocks.flatMap((stock) => {
    const run = identityByKey.get(runKey(stock.ticker, stock.evidenceHash))
    if (!run) return []
    return stock.agents.map((agent) => ({
      run_id: run.id,
      agent_key: agent.key,
      agent_label: agent.label,
      role: agent.role,
      stance: agent.stance,
      score: agent.score,
      confidence: agent.confidence,
      summary: agent.summary,
      evidence_for: agent.evidenceFor,
      evidence_against: agent.evidenceAgainst,
      engine: AI_COUNCIL_ENGINE,
      policy_version: AI_COUNCIL_POLICY_VERSION,
    }))
  })

  if (votes.length) {
    const votesResult = await supabase
      .from("ai_council_votes")
      .upsert(votes, { onConflict: "run_id,agent_key", ignoreDuplicates: true })
    if (votesResult.error) throw new Error(`Persist Council votes failed: ${votesResult.error.message}`)
  }

  const outcomeSeeds = data.stocks.flatMap((stock) => {
    const run = identityByKey.get(runKey(stock.ticker, stock.evidenceHash))
    if (!run) return []
    const usablePrice = stock.price != null && stock.price > 0
    return [{
      run_id: run.id,
      ticker: stock.ticker,
      as_of_date: ratingDate,
      start_price: stock.price,
      outcome_status: usablePrice ? "pending" : "unavailable",
      notes: usablePrice ? "" : "Missing positive start price; forward returns cannot be evaluated.",
    }]
  })

  if (outcomeSeeds.length) {
    const outcomesResult = await supabase
      .from("ai_council_outcomes")
      .upsert(outcomeSeeds, { onConflict: "run_id", ignoreDuplicates: true })
    if (outcomesResult.error) throw new Error(`Seed Council outcomes failed: ${outcomesResult.error.message}`)
  }

  const refresh = await supabase.rpc("refresh_ai_council_outcomes")
  if (refresh.error) throw new Error(`Refresh Council outcomes failed: ${refresh.error.message}`)

  return {
    ratingDate,
    insertedRuns: inserted.data?.length || 0,
    materializedRuns: outcomeSeeds.length,
    persistedVotes: votes.length,
    refreshedOutcomes: Number(refresh.data || 0),
  }
}
