import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import { getSupabaseServerClient } from "@/modules/shared/supabase/server"

import {
  loadCanonicalCouncilBackfillPage,
  loadCanonicalResearchReportBackfillPage,
  type CanonicalCouncilBackfillSource,
  type CanonicalResearchReportBackfillSource,
  type ResearchReportChunkSelector,
} from "./canonical-backfill.ts"
import { createServerTickerKnowledgeIndex } from "./server.ts"
import {
  runTickerKnowledgeBackfill,
  syncCouncilHistoryKnowledge,
  syncResearchReportKnowledge,
  type TickerKnowledgeBackfillProgress,
} from "./sync.ts"

type CanonicalRow = Record<string, unknown>
type DbError = { message?: string } | null

const RELATED_PAGE_SIZE = 500
const MAX_RELATED_ROWS = 5_000
const MAX_CHUNK_SELECTOR_PAGES = 50

const REPORT_TABLE = "market_research_reports"
const ANALYSIS_TABLE = "market_research_report_analyses"
const MENTION_TABLE = "market_research_report_ticker_mentions"
const CHUNK_TABLE = "market_research_report_chunks"
const COUNCIL_RUN_TABLE = "ai_council_runs"
const COUNCIL_OUTCOME_TABLE = "ai_council_outcomes"
const COUNCIL_DEBATE_TABLE = "ai_council_llm_debates"

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function rows(value: unknown): CanonicalRow[] {
  return Array.isArray(value)
    ? value.filter((row): row is CanonicalRow => Boolean(row) && typeof row === "object" && !Array.isArray(row))
    : []
}

function dbError(label: string, error: DbError) {
  const detail = String(error?.message ?? "unknown database error").replace(/\s+/g, " ").trim().slice(0, 300)
  return new Error(`${label}: ${detail}`)
}

async function loadBoundedRelatedRows(
  label: string,
  loadRange: (from: number, to: number) => Promise<{ data: unknown; error: DbError }>,
) {
  const result: CanonicalRow[] = []
  for (let offset = 0; offset < MAX_RELATED_ROWS; offset += RELATED_PAGE_SIZE) {
    const response = await loadRange(offset, offset + RELATED_PAGE_SIZE - 1)
    if (response.error) throw dbError(label, response.error)
    const page = rows(response.data)
    result.push(...page)
    if (page.length < RELATED_PAGE_SIZE) return result
  }
  throw new Error(`${label}: related row safety cap ${MAX_RELATED_ROWS} reached`)
}

function nextCursorForPage(pageRows: readonly CanonicalRow[], requestedLimit: number) {
  if (pageRows.length <= requestedLimit) return null
  return text(pageRows[requestedLimit - 1]?.id) || null
}

function includedPageRows(pageRows: readonly CanonicalRow[], requestedLimit: number) {
  return pageRows.slice(0, requestedLimit)
}

export function createCanonicalPostgresBackfillSource(
  supabase: SupabaseClient,
): CanonicalResearchReportBackfillSource & CanonicalCouncilBackfillSource {
  return {
    async loadReports(cursor, limit) {
      let request = supabase
        .from(REPORT_TABLE)
        .select("id,title,source_name,publish_date,content_hash,analysis_status")
        .eq("analysis_status", "ready")
        .not("content_hash", "is", null)
        .order("id", { ascending: true })
        .limit(limit + 1)
      if (cursor) request = request.gt("id", cursor)
      const response = await request
      if (response.error) throw dbError("Canonical research-report page read failed", response.error)
      const pageRows = rows(response.data)
      return {
        rows: includedPageRows(pageRows, limit),
        nextCursor: nextCursorForPage(pageRows, limit),
      }
    },

    async loadAnalyses(reportIds) {
      if (!reportIds.length) return []
      return loadBoundedRelatedRows(
        "Canonical research-report analyses read failed",
        async (from, to) => {
          const response = await supabase
            .from(ANALYSIS_TABLE)
            .select("id,report_id,content_hash,chunk_version,executive_summary,key_points,market_view,sector_outlook,catalysts,risks,processed_at,created_at")
            .in("report_id", [...reportIds])
            .order("report_id", { ascending: true })
            .order("processed_at", { ascending: true })
            .order("id", { ascending: true })
            .range(from, to)
          return { data: response.data, error: response.error }
        },
      )
    },

    async loadMentions(analysisIds) {
      if (!analysisIds.length) return []
      return loadBoundedRelatedRows(
        "Canonical research-report mentions read failed",
        async (from, to) => {
          const response = await supabase
            .from(MENTION_TABLE)
            .select("analysis_id,ticker,stance,recommendation_text,target_price,target_currency,rationale,evidence")
            .in("analysis_id", [...analysisIds])
            .order("analysis_id", { ascending: true })
            .order("ticker", { ascending: true })
            .range(from, to)
          return { data: response.data, error: response.error }
        },
      )
    },

    async loadChunks(selectors: readonly ResearchReportChunkSelector[]) {
      const result: CanonicalRow[] = []
      for (const selector of selectors) {
        if (!selector.pages.length) continue
        if (selector.pages.length > MAX_CHUNK_SELECTOR_PAGES) {
          throw new Error(`Canonical report chunk selector exceeds ${MAX_CHUNK_SELECTOR_PAGES} cited pages`)
        }
        const selected = await loadBoundedRelatedRows(
          "Canonical research-report chunks read failed",
          async (from, to) => {
            const response = await supabase
              .from(CHUNK_TABLE)
              .select("id,report_id,content_hash,chunk_version,page_number,chunk_index,content,chunk_hash")
              .eq("report_id", selector.reportId)
              .eq("content_hash", selector.contentHash)
              .eq("chunk_version", selector.chunkVersion)
              .in("page_number", [...selector.pages])
              .order("page_number", { ascending: true })
              .order("chunk_index", { ascending: true })
              .order("id", { ascending: true })
              .range(from, to)
            return { data: response.data, error: response.error }
          },
        )
        result.push(...selected)
      }
      return result
    },

    async loadRuns(cursor, limit) {
      let request = supabase
        .from(COUNCIL_RUN_TABLE)
        .select("id,ticker,as_of_date,signal,council_score,confidence,consensus,risk_status,price,policy_version,evidence_hash,created_at,bull_case,bear_case,confirmation,invalidation,what_changes_decision,decision_payload")
        .order("id", { ascending: true })
        .limit(limit + 1)
      if (cursor) request = request.gt("id", cursor)
      const response = await request
      if (response.error) throw dbError("Canonical AI Council run page read failed", response.error)
      const pageRows = rows(response.data)
      return {
        rows: includedPageRows(pageRows, limit),
        nextCursor: nextCursorForPage(pageRows, limit),
      }
    },

    async loadOutcomes(runIds) {
      if (!runIds.length) return []
      const response = await supabase
        .from(COUNCIL_OUTCOME_TABLE)
        .select("run_id,outcome_status,sessions_observed,evaluated_through_date,return_1d_pct,return_5d_pct,return_20d_pct,mfe_20d_pct,mae_20d_pct,direction_correct_5d,last_refreshed_at")
        .in("run_id", [...runIds])
        .order("run_id", { ascending: true })
      if (response.error) throw dbError("Canonical AI Council outcomes read failed", response.error)
      return rows(response.data)
    },

    async loadDebates(runIds) {
      if (!runIds.length) return []
      const response = await supabase
        .from(COUNCIL_DEBATE_TABLE)
        .select("run_id,status,prompt_version,error,completed_at,created_at")
        .in("run_id", [...runIds])
        .order("run_id", { ascending: true })
      if (response.error) throw dbError("Canonical AI Council debates read failed", response.error)
      return rows(response.data)
    },
  }
}

function requireCanonicalSupabase() {
  const supabase = getSupabaseServerClient()
  if (!supabase) throw new Error("Canonical ticker-knowledge backfill requires Supabase service-role configuration")
  return supabase
}

export async function runServerResearchReportKnowledgeBackfillPage(input: {
  cursor?: string | null
  batchSize?: number
} = {}): Promise<TickerKnowledgeBackfillProgress> {
  const source = createCanonicalPostgresBackfillSource(requireCanonicalSupabase())
  const index = createServerTickerKnowledgeIndex()
  return runTickerKnowledgeBackfill({
    cursor: input.cursor,
    batchSize: input.batchSize,
    loadPage: (cursor, limit) => loadCanonicalResearchReportBackfillPage({ cursor, batchSize: limit, source }),
    syncRow: (row) => syncResearchReportKnowledge(index, row),
  })
}

export async function runServerCouncilKnowledgeBackfillPage(input: {
  cursor?: string | null
  batchSize?: number
} = {}): Promise<TickerKnowledgeBackfillProgress> {
  const source = createCanonicalPostgresBackfillSource(requireCanonicalSupabase())
  const index = createServerTickerKnowledgeIndex()
  return runTickerKnowledgeBackfill({
    cursor: input.cursor,
    batchSize: input.batchSize,
    loadPage: (cursor, limit) => loadCanonicalCouncilBackfillPage({ cursor, batchSize: limit, source }),
    syncRow: (row) => syncCouncilHistoryKnowledge(index, row),
  })
}