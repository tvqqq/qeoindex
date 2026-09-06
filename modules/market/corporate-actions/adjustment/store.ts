import type { SupabaseClient } from "@supabase/supabase-js"

import type { FactorRunCandidate, FactorTransition } from "./engine.ts"
import { sha256Canonical } from "./lineage.ts"

export type FactorRunPersistenceResult = {
  runId: string
  persistedTransitions: number
}

type PersistedRunRow = {
  id: string
  ticker: string
  factor_version: string
  engine_version: string
  event_lineage_hash: string
  as_of_date: string
  status: string
  blocked_reason: string | null
}

type PersistedTransitionRow = {
  run_id: string
  ticker: string
  effective_session: string
  reference_session: string
  reference_raw_close: number | string
  step_price_factor: number | string
  step_volume_factor: number | string
  cumulative_price_factor: number | string
  cumulative_volume_factor: number | string
  corporate_action_ids: string[]
  event_lineage_hash: string
  formula_inputs: unknown
}

function transitionPayload(transition: FactorTransition) {
  return {
    effective_session: transition.effectiveSession,
    reference_session: transition.referenceSession,
    reference_raw_close: transition.referenceRawClose,
    step_price_factor: transition.stepPriceFactor,
    step_volume_factor: transition.stepVolumeFactor,
    cumulative_price_factor: transition.cumulativePriceFactor,
    cumulative_volume_factor: transition.cumulativeVolumeFactor,
    corporate_action_ids: transition.corporateActionIds,
    event_lineage_hash: transition.eventLineageHash,
    formula_inputs: transition.formulaInputs,
  }
}

function numericEqual(actual: number | string, expected: number) {
  return Number(actual) === expected
}

function runMatches(row: PersistedRunRow, candidate: FactorRunCandidate) {
  return row.ticker === candidate.ticker
    && row.factor_version === candidate.factorVersion
    && row.engine_version === candidate.engineVersion
    && row.event_lineage_hash === candidate.eventLineageHash
    && row.as_of_date === candidate.asOfDate
    && row.status === candidate.status
    && row.blocked_reason === candidate.blockedReason
}

function transitionMatches(
  row: PersistedTransitionRow,
  transition: FactorTransition,
  runId: string,
) {
  return row.run_id === runId
    && row.ticker === transition.ticker
    && row.effective_session === transition.effectiveSession
    && row.reference_session === transition.referenceSession
    && numericEqual(row.reference_raw_close, transition.referenceRawClose)
    && numericEqual(row.step_price_factor, transition.stepPriceFactor)
    && numericEqual(row.step_volume_factor, transition.stepVolumeFactor)
    && numericEqual(row.cumulative_price_factor, transition.cumulativePriceFactor)
    && numericEqual(row.cumulative_volume_factor, transition.cumulativeVolumeFactor)
    && Array.isArray(row.corporate_action_ids)
    && row.corporate_action_ids.length === transition.corporateActionIds.length
    && row.corporate_action_ids.every((id, index) => id === transition.corporateActionIds[index])
    && row.event_lineage_hash === transition.eventLineageHash
    && sha256Canonical(row.formula_inputs) === sha256Canonical(transition.formulaInputs)
}

export async function persistFactorRunCandidate(
  supabase: SupabaseClient,
  candidate: FactorRunCandidate,
): Promise<FactorRunPersistenceResult> {
  const { data, error } = await supabase.rpc("qeo_persist_adjustment_factor_candidate", {
    p_ticker: candidate.ticker,
    p_factor_version: candidate.factorVersion,
    p_engine_version: candidate.engineVersion,
    p_event_lineage_hash: candidate.eventLineageHash,
    p_as_of_date: candidate.asOfDate,
    p_status: candidate.status,
    p_blocked_reason: candidate.blockedReason,
    p_transitions: candidate.transitions.map(transitionPayload),
  })
  if (error || typeof data !== "string" || data.length === 0) {
    throw new Error("Adjustment factor persistence failed")
  }

  const runId = data
  const { data: runRow, error: runError } = await supabase
    .from("market_adjustment_factor_runs")
    .select("id,ticker,factor_version,engine_version,event_lineage_hash,as_of_date,status,blocked_reason")
    .eq("id", runId)
    .maybeSingle()

  if (runError || !runRow || !runMatches(runRow as PersistedRunRow, candidate)) {
    throw new Error("Adjustment factor exact read-back mismatch")
  }

  const { data: transitionRows, error: transitionError } = await supabase
    .from("market_price_adjustment_factors")
    .select("run_id,ticker,effective_session,reference_session,reference_raw_close,step_price_factor,step_volume_factor,cumulative_price_factor,cumulative_volume_factor,corporate_action_ids,event_lineage_hash,formula_inputs")
    .eq("run_id", runId)
    .order("effective_session", { ascending: true })

  if (transitionError || !Array.isArray(transitionRows) || transitionRows.length !== candidate.transitions.length) {
    throw new Error("Adjustment factor exact read-back mismatch")
  }

  const expected = [...candidate.transitions].sort((left, right) => left.effectiveSession.localeCompare(right.effectiveSession))
  for (let index = 0; index < expected.length; index += 1) {
    if (!transitionMatches(transitionRows[index] as PersistedTransitionRow, expected[index], runId)) {
      throw new Error("Adjustment factor exact read-back mismatch")
    }
  }

  return { runId, persistedTransitions: transitionRows.length }
}
