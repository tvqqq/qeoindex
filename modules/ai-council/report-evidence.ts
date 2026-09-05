import { createHash } from "node:crypto"
import type { SupabaseClient } from "@supabase/supabase-js"

import {
  selectCouncilReportEvidence,
  type CouncilReportEvidenceItem,
  type CouncilReportEvidenceSelection,
} from "../research-reports/council-evidence.ts"

export const AI_COUNCIL_REPORT_EVIDENCE_VERSION = "ai-council-report-evidence-v1"

export type CouncilReportEvidenceSnapshotStatus = "ready" | "empty" | "unavailable"

export interface CouncilReportEvidenceSnapshotPayload {
  contextVersion: typeof AI_COUNCIL_REPORT_EVIDENCE_VERSION
  ticker: string
  asOfDate: string
  selectionRunAt: string
  status: CouncilReportEvidenceSnapshotStatus
  reports: CouncilReportEvidenceItem[]
  limitations: string[]
}

export interface FrozenCouncilReportEvidence {
  persisted: boolean
  reused: boolean
  canUseInPrompt: boolean
  contextHash: string | null
  context: CouncilReportEvidenceSnapshotPayload
  reportIds: string[]
  analysisIds: string[]
  capturedAt: string | null
}

type SnapshotRow = {
  run_id: string
  ticker: string
  as_of_date: string
  context_version: string
  context_hash: string
  status: CouncilReportEvidenceSnapshotStatus
  context_payload: unknown
  report_ids: unknown
  analysis_ids: unknown
  captured_at: string
}

type SnapshotClient = {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: unknown): {
        limit(limit: number): Promise<{ data: unknown[] | null; error: { message?: string } | null }>
      }
    }
    upsert(
      payload: Record<string, unknown>,
      options: { onConflict: string; ignoreDuplicates: boolean },
    ): Promise<{ data: unknown; error: { message?: string } | null }>
  }
}

function db(client: SupabaseClient) {
  return client as unknown as SnapshotClient
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function text(value: unknown) {
  return typeof value === "string" ? value : ""
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child)]),
  )
}

function sha256(value: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)), "utf8")
    .digest("hex")
}

function safeUnavailableContext(
  ticker: string,
  asOfDate: string,
  selectionRunAt: string,
): CouncilReportEvidenceSnapshotPayload {
  return {
    contextVersion: AI_COUNCIL_REPORT_EVIDENCE_VERSION,
    ticker,
    asOfDate,
    selectionRunAt,
    status: "unavailable",
    reports: [],
    limitations: ["Research Report evidence unavailable at Council freeze time."],
  }
}

function normalizePersistedContext(
  row: SnapshotRow,
): CouncilReportEvidenceSnapshotPayload {
  const payload = record(row.context_payload)
  const status = row.status === "ready" || row.status === "empty" || row.status === "unavailable"
    ? row.status
    : "unavailable"
  const reports = Array.isArray(payload.reports)
    ? payload.reports as CouncilReportEvidenceItem[]
    : []
  const limitations = Array.isArray(payload.limitations)
    ? payload.limitations.filter((item): item is string => typeof item === "string")
    : []

  return {
    contextVersion: AI_COUNCIL_REPORT_EVIDENCE_VERSION,
    ticker: text(payload.ticker) || row.ticker,
    asOfDate: text(payload.asOfDate) || row.as_of_date,
    selectionRunAt: text(payload.selectionRunAt) || row.captured_at,
    status,
    reports: status === "ready" ? reports : [],
    limitations: status === "unavailable" && limitations.length === 0
      ? ["Research Report evidence unavailable at Council freeze time."]
      : limitations,
  }
}

function frozenFromRow(row: SnapshotRow, reused: boolean): FrozenCouncilReportEvidence {
  const context = normalizePersistedContext(row)
  const reportIds = stringArray(row.report_ids)
  const analysisIds = stringArray(row.analysis_ids)
  return {
    persisted: true,
    reused,
    canUseInPrompt: context.status === "ready" || context.status === "empty",
    contextHash: /^[0-9a-f]{64}$/.test(row.context_hash) ? row.context_hash : null,
    context,
    reportIds: context.status === "ready" ? reportIds : [],
    analysisIds: context.status === "ready" ? analysisIds : [],
    capturedAt: row.captured_at || null,
  }
}

async function loadSnapshot(client: SupabaseClient, runId: string): Promise<SnapshotRow | null> {
  const result = await db(client)
    .from("ai_council_report_evidence_snapshots")
    .select("run_id,ticker,as_of_date,context_version,context_hash,status,context_payload,report_ids,analysis_ids,captured_at")
    .eq("run_id", runId)
    .limit(1)

  if (result.error) return null
  const candidate = Array.isArray(result.data) ? result.data[0] : null
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null
  return candidate as SnapshotRow
}

function contextFromSelection(
  ticker: string,
  asOfDate: string,
  runAt: string,
  selection: CouncilReportEvidenceSelection,
): CouncilReportEvidenceSnapshotPayload {
  const reports = selection.reports
  return {
    contextVersion: AI_COUNCIL_REPORT_EVIDENCE_VERSION,
    ticker,
    asOfDate,
    selectionRunAt: runAt,
    status: reports.length ? "ready" : "empty",
    reports,
    limitations: selection.truncated
      ? ["Research Report evidence was deterministically truncated to the Council prompt budget."]
      : [],
  }
}

export async function freezeCouncilReportEvidence(
  client: SupabaseClient,
  params: {
    runId: string
    ticker: string
    asOfDate: string
    runAt: string
  },
  deps: {
    selectEvidence?: (
      client: SupabaseClient,
      params: { ticker: string; asOf: string; runAt: string },
    ) => Promise<CouncilReportEvidenceSelection>
  } = {},
): Promise<FrozenCouncilReportEvidence> {
  const existing = await loadSnapshot(client, params.runId)
  if (existing) return frozenFromRow(existing, true)

  let context: CouncilReportEvidenceSnapshotPayload
  try {
    const selector = deps.selectEvidence ?? selectCouncilReportEvidence
    const selection = await selector(client, {
      ticker: params.ticker,
      asOf: params.asOfDate,
      runAt: params.runAt,
    })
    context = contextFromSelection(params.ticker, params.asOfDate, params.runAt, selection)
  } catch {
    context = safeUnavailableContext(params.ticker, params.asOfDate, params.runAt)
  }

  const contextHash = sha256(context)
  const reportIds = context.status === "ready" ? context.reports.map((report) => report.reportId) : []
  const analysisIds = context.status === "ready" ? context.reports.map((report) => report.analysisId) : []

  const write = await db(client)
    .from("ai_council_report_evidence_snapshots")
    .upsert({
      run_id: params.runId,
      ticker: params.ticker,
      as_of_date: params.asOfDate,
      context_version: AI_COUNCIL_REPORT_EVIDENCE_VERSION,
      context_hash: contextHash,
      status: context.status,
      context_payload: context,
      report_ids: reportIds,
      analysis_ids: analysisIds,
    }, {
      onConflict: "run_id",
      ignoreDuplicates: true,
    })

  if (write.error) {
    return {
      persisted: false,
      reused: false,
      canUseInPrompt: false,
      contextHash: null,
      context: safeUnavailableContext(params.ticker, params.asOfDate, params.runAt),
      reportIds: [],
      analysisIds: [],
      capturedAt: null,
    }
  }

  const persisted = await loadSnapshot(client, params.runId)
  if (!persisted) {
    return {
      persisted: false,
      reused: false,
      canUseInPrompt: false,
      contextHash: null,
      context: safeUnavailableContext(params.ticker, params.asOfDate, params.runAt),
      reportIds: [],
      analysisIds: [],
      capturedAt: null,
    }
  }

  return frozenFromRow(persisted, false)
}
