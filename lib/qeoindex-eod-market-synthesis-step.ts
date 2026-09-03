import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import { markQeoIndexEodPhaseSkipped, runQeoIndexEodPhase } from "@/lib/admin/job-phase-telemetry"
import { getSupabaseServerClient } from "@/lib/supabase/server"
import type { MarketCloseDashboardData } from "@/lib/market-insight-data"

const MARKET_SYNTHESIS_POLL_INTERVAL_MS = 2_000
const MARKET_SYNTHESIS_MAX_WAIT_MS = 90_000

const TERMINAL_FAILURE_STATUSES = new Set([
  "failed",
  "insufficient_evidence",
  "completion_unknown",
])

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

interface PersistedMarketSynthesisRow {
  snapshot_id: string
  evidence_hash: string
  status: string
  posture: string
  session_date: string
  as_of: string
  conclusion_payload: unknown
  error_code: string | null
  completed_at: string | null
}

function requiredSupabase() {
  const supabase = getSupabaseServerClient()
  if (!supabase) throw new Error("Supabase service role is not configured")
  return supabase
}

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function stringField(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function stringList(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => stringField(item)).filter((item): item is string => Boolean(item))
    : []
}

function sameInstant(left: unknown, right: unknown) {
  const leftMs = typeof left === "string" ? new Date(left).getTime() : Number.NaN
  const rightMs = typeof right === "string" ? new Date(right).getTime() : Number.NaN
  return Number.isFinite(leftMs) && Number.isFinite(rightMs) && leftMs === rightMs
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
}

async function marketSnapshotIdentity(snapshot: MarketCloseDashboardData) {
  const provenance = snapshot.marketInsightProvenance
  if (!provenance) {
    throw Object.assign(
      new Error("MARKET_SYNTHESIS requires published market snapshot provenance"),
      { code: "MARKET_SYNTHESIS_FAILED" },
    )
  }
  return sha256Hex(JSON.stringify({
    sessionDate: snapshot.sessionDate,
    asOf: snapshot.asOf,
    source: "market_insight_published",
    syncRunId: provenance.syncRunId,
    payloadChecksum: provenance.payloadChecksum,
    contractVersion: provenance.contractVersion,
  }))
}

async function loadExactMarketCloseSnapshot(supabase: SupabaseClient, ratingDate: string) {
  const { getMarketCloseInsightData } = await import("@/lib/market-insight-data")
  return getMarketCloseInsightData(supabase, ratingDate)
}

async function loadPersistedMarketSynthesis(
  supabase: SupabaseClient,
  snapshot: MarketCloseDashboardData,
): Promise<PersistedMarketSynthesisRow | null> {
  const snapshotId = await marketSnapshotIdentity(snapshot)
  const result = await supabase
    .from("market_ai_conclusions")
    .select("snapshot_id,evidence_hash,status,posture,session_date,as_of,conclusion_payload,error_code,completed_at")
    .eq("snapshot_id", snapshotId)
    .maybeSingle()

  if (result.error) {
    throw Object.assign(
      new Error(`MARKET_SYNTHESIS persisted evidence lookup failed: ${result.error.message}`),
      { code: "MARKET_SYNTHESIS_FAILED" },
    )
  }
  return result.data as PersistedMarketSynthesisRow | null
}

function toContext(
  row: PersistedMarketSynthesisRow,
  snapshot: MarketCloseDashboardData,
): EodMarketSynthesisContext {
  if (row.status !== "succeeded" || !row.completed_at) {
    throw Object.assign(
      new Error(`MARKET_SYNTHESIS terminal context is invalid: ${row.status}`),
      { code: "MARKET_SYNTHESIS_FAILED" },
    )
  }
  if (row.session_date !== snapshot.sessionDate || !sameInstant(row.as_of, snapshot.asOf)) {
    throw Object.assign(
      new Error(`MARKET_SYNTHESIS persisted identity mismatch for ${snapshot.sessionDate}`),
      { code: "MARKET_SYNTHESIS_FAILED" },
    )
  }

  const payload = record(row.conclusion_payload)
  const payloadSnapshotId = stringField(payload?.snapshotId)
  const payloadEvidenceHash = stringField(payload?.evidenceHash)
  const payloadSessionDate = stringField(payload?.sessionDate)
  const payloadAsOf = stringField(payload?.asOf)
  const confidence = stringField(payload?.confidence)
  const headline = stringField(payload?.headline)
  const conclusion = stringField(payload?.conclusion)
  const posture = stringField(payload?.posture)

  if (
    !payload
    || payloadSnapshotId !== row.snapshot_id
    || payloadEvidenceHash !== row.evidence_hash
    || payloadSessionDate !== snapshot.sessionDate
    || !sameInstant(payloadAsOf, snapshot.asOf)
    || posture !== row.posture
    || !confidence
    || !headline
    || !conclusion
  ) {
    throw Object.assign(
      new Error(`MARKET_SYNTHESIS persisted payload identity is invalid for ${snapshot.sessionDate}`),
      { code: "MARKET_SYNTHESIS_FAILED" },
    )
  }

  return {
    sessionDate: payloadSessionDate,
    asOf: payloadAsOf,
    evidenceHash: row.evidence_hash,
    posture,
    confidence,
    headline,
    conclusion,
    risks: stringList(payload.risks).slice(0, 6),
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
    const row = await loadPersistedMarketSynthesis(supabase, snapshot)
    if (row?.status === "succeeded") return toContext(row, snapshot)
    if (row && TERMINAL_FAILURE_STATUSES.has(row.status)) {
      throw Object.assign(
        new Error(`MARKET_SYNTHESIS terminal status ${row.status}${row.error_code ? ` (${row.error_code})` : ""}`),
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
  if (!ratingDate) return null
  const supabase = requiredSupabase()
  const snapshot = await loadExactMarketCloseSnapshot(supabase, ratingDate)
  if (!snapshot || snapshot.sessionDate !== ratingDate || !snapshot.marketInsightProvenance) return null
  const row = await loadPersistedMarketSynthesis(supabase, snapshot)
  return row?.status === "succeeded" ? toContext(row, snapshot) : null
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
      const snapshot = await loadExactMarketCloseSnapshot(supabase, ratingDate)
      if (!snapshot || snapshot.sessionDate !== ratingDate || !snapshot.marketInsightProvenance) {
        throw Object.assign(
          new Error(`MARKET_SYNTHESIS exact published snapshot is unavailable for ${ratingDate}`),
          { code: "MARKET_SYNTHESIS_FAILED" },
        )
      }

      const existing = await loadPersistedMarketSynthesis(supabase, snapshot)
      if (existing?.status === "succeeded") {
        return {
          ok: true,
          status: "succeeded",
          requestId: null,
          ratingDate,
          reused: true,
          context: toContext(existing, snapshot),
        }
      }
      if (existing && TERMINAL_FAILURE_STATUSES.has(existing.status)) {
        throw Object.assign(
          new Error(`MARKET_SYNTHESIS existing terminal status ${existing.status}`),
          { code: "MARKET_SYNTHESIS_FAILED" },
        )
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
