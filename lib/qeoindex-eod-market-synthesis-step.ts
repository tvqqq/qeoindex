import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import { markQeoIndexEodPhaseSkipped, runQeoIndexEodPhase } from "@/lib/admin/job-phase-telemetry"
import { loadMarketAiConclusion, type MarketAiConclusionView } from "@/lib/market-ai-conclusion-loader"
import { getMarketCloseInsightData, type MarketCloseDashboardData } from "@/lib/market-insight-data"
import { getSupabaseServerClient } from "@/lib/supabase/server"

const MARKET_SYNTHESIS_POLL_INTERVAL_MS = 2_000
const MARKET_SYNTHESIS_MAX_WAIT_MS = 90_000

export interface EodMarketSynthesisContext {
  sessionDate: string
  asOf: string
  evidenceHash: string
  posture: string
  confidence: string
  headline: string
  conclusion: string
  risks: string[]
}

export interface EodMarketSynthesisResult {
  ok: true
  status: "succeeded"
  requestId: number | null
  ratingDate: string
  reused: boolean
  context: EodMarketSynthesisContext
}

function requiredSupabase() {
  const supabase = getSupabaseServerClient()
  if (!supabase) throw new Error("Supabase service role is not configured")
  return supabase
}

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

function terminalFailure(view: MarketAiConclusionView) {
  return view.status === "failed"
    || view.status === "insufficient_evidence"
    || view.status === "completion_unknown"
    || view.status === "stale"
}

function toContext(view: MarketAiConclusionView, snapshot: MarketCloseDashboardData): EodMarketSynthesisContext {
  if (view.status !== "succeeded" || !view.payload || !view.evidenceHash) {
    throw Object.assign(new Error(`MARKET_SYNTHESIS terminal context is invalid: ${view.status}`), {
      code: "MARKET_SYNTHESIS_FAILED",
    })
  }
  if (view.payload.sessionDate !== snapshot.sessionDate || view.payload.asOf !== snapshot.asOf) {
    throw Object.assign(
      new Error(`MARKET_SYNTHESIS identity mismatch for ${snapshot.sessionDate}`),
      { code: "MARKET_SYNTHESIS_FAILED" },
    )
  }
  return {
    sessionDate: view.payload.sessionDate,
    asOf: view.payload.asOf,
    evidenceHash: view.evidenceHash,
    posture: view.payload.posture,
    confidence: view.payload.confidence,
    headline: view.payload.headline,
    conclusion: view.payload.conclusion,
    risks: view.payload.risks.slice(0, 6),
  }
}

export async function awaitMarketSynthesisConclusion(
  supabase: SupabaseClient,
  snapshot: MarketCloseDashboardData,
  options: { maxWaitMs?: number; pollIntervalMs?: number } = {},
) {
  const maxWaitMs = Math.max(1_000, options.maxWaitMs ?? MARKET_SYNTHESIS_MAX_WAIT_MS)
  const pollIntervalMs = Math.max(250, options.pollIntervalMs ?? MARKET_SYNTHESIS_POLL_INTERVAL_MS)
  const deadline = Date.now() + maxWaitMs

  while (true) {
    const view = await loadMarketAiConclusion(supabase, snapshot)
    if (view.status === "succeeded") return toContext(view, snapshot)
    if (terminalFailure(view)) {
      throw Object.assign(
        new Error(`MARKET_SYNTHESIS terminal status ${view.status}: ${view.message}`),
        { code: "MARKET_SYNTHESIS_FAILED" },
      )
    }
    if (Date.now() >= deadline) {
      throw Object.assign(
        new Error(`MARKET_SYNTHESIS did not become terminal within ${maxWaitMs}ms`),
        { code: "MARKET_SYNTHESIS_TIMEOUT" },
      )
    }
    await wait(Math.min(pollIntervalMs, Math.max(1, deadline - Date.now())))
  }
}

export async function loadMarketSynthesisContext(ratingDate?: string): Promise<EodMarketSynthesisContext | null> {
  "use step"
  if (!ratingDate) return null
  const supabase = requiredSupabase()
  const snapshot = await getMarketCloseInsightData(supabase, ratingDate)
  if (!snapshot || snapshot.sessionDate !== ratingDate) return null
  const view = await loadMarketAiConclusion(supabase, snapshot)
  return view.status === "succeeded" ? toContext(view, snapshot) : null
}

export async function runMarketSynthesisStep(runId: string, enabled = true, ratingDate?: string) {
  "use step"
  if (!enabled || !ratingDate) {
    await markQeoIndexEodPhaseSkipped({
      runId,
      phaseKey: "MARKET_SYNTHESIS",
      reason: "Council or trading date is not ready for market synthesis.",
    })
    return { ok: false as const, status: "skipped" as const, requestId: null, ratingDate: ratingDate || null }
  }

  return runQeoIndexEodPhase({
    runId,
    phaseKey: "MARKET_SYNTHESIS",
    fn: async (): Promise<EodMarketSynthesisResult> => {
      const supabase = requiredSupabase()
      const snapshot = await getMarketCloseInsightData(supabase, ratingDate)
      if (!snapshot || snapshot.sessionDate !== ratingDate || !snapshot.marketInsightProvenance) {
        throw Object.assign(
          new Error(`MARKET_SYNTHESIS exact published snapshot is unavailable for ${ratingDate}`),
          { code: "MARKET_SYNTHESIS_FAILED" },
        )
      }

      const existing = await loadMarketAiConclusion(supabase, snapshot)
      if (existing.status === "succeeded") {
        return {
          ok: true,
          status: "succeeded",
          requestId: null,
          ratingDate,
          reused: true,
          context: toContext(existing, snapshot),
        }
      }

      const result = await supabase.rpc("dispatch_market_ai_conclusion", {
        p_mode: "session",
        p_session_date: ratingDate,
      })
      if (result.error) {
        throw Object.assign(
          new Error(`MARKET_SYNTHESIS dispatch failed: ${result.error.message}`),
          { code: "MARKET_SYNTHESIS_FAILED" },
        )
      }

      const context = await awaitMarketSynthesisConclusion(supabase, snapshot)
      return {
        ok: true,
        status: "succeeded",
        requestId: result.data == null ? null : Number(result.data),
        ratingDate,
        reused: false,
        context,
      }
    },
    summarize: (result) => ({
      ok: result.ok,
      status: result.status,
      requestId: result.requestId,
      ratingDate: result.ratingDate,
      reused: result.reused,
      sessionDate: result.context.sessionDate,
      asOf: result.context.asOf,
      evidenceHash: result.context.evidenceHash,
      posture: result.context.posture,
      confidence: result.context.confidence,
    }),
  })
}
