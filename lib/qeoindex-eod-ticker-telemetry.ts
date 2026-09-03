import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import { QEOINDEX_EOD_JOB_KEY } from "./admin/job-phases.ts"
import type { EodFailureClass, EodTickerAttempt } from "./qeoindex-eod-fault-isolation.ts"

interface StoredTickerAttemptRow {
  ticker: string
  stage: string
  status: "succeeded" | "failed"
  error_class: EodFailureClass | null
  attempt: number
  retry_eligible: boolean
  error_code?: string | null
  error_message?: string | null
}

function normalizeError(value: string | undefined) {
  return value ? value.slice(0, 1000) : null
}

export async function persistEodTickerAttempts(
  supabase: SupabaseClient,
  runId: string,
  attempts: readonly EodTickerAttempt[],
) {
  if (!attempts.length) return { inserted: 0 }
  const rows = attempts.map((attempt) => ({
    run_id: runId,
    job_key: QEOINDEX_EOD_JOB_KEY,
    ticker: attempt.ticker,
    stage: attempt.stage,
    attempt: attempt.attempt,
    status: attempt.status,
    error_class: attempt.errorClass,
    retry_eligible: attempt.retryEligible,
    error_code: attempt.errorCode?.slice(0, 100) ?? null,
    error_message: normalizeError(attempt.error),
  }))
  const result = await supabase
    .from("system_job_ticker_attempts")
    .upsert(rows, { onConflict: "run_id,ticker,stage,attempt", ignoreDuplicates: true })
  if (result.error) throw new Error(`EOD ticker attempt persistence failed: ${result.error.message}`)
  return { inserted: rows.length }
}

export async function loadEodTickerAttempts(supabase: SupabaseClient, runId: string): Promise<EodTickerAttempt[]> {
  const result = await supabase
    .from("system_job_ticker_attempts")
    .select("ticker,stage,status,error_class,attempt,retry_eligible,error_code,error_message")
    .eq("run_id", runId)
    .order("id", { ascending: true })
  if (result.error) throw new Error(`EOD ticker attempt load failed: ${result.error.message}`)
  return ((result.data || []) as StoredTickerAttemptRow[]).map((row) => ({
    ticker: row.ticker,
    stage: row.stage,
    status: row.status,
    errorClass: row.error_class,
    attempt: row.attempt,
    retryEligible: row.retry_eligible,
    errorCode: row.error_code || undefined,
    error: row.error_message || undefined,
  }))
}

export function nextTickerAttemptNumber(
  attempts: readonly EodTickerAttempt[],
  ticker: string,
  stage: string,
) {
  return attempts
    .filter((attempt) => attempt.ticker === ticker && attempt.stage === stage)
    .reduce((max, attempt) => Math.max(max, attempt.attempt), 0) + 1
}
