import {
  assembleCouncilProjectionInputs,
  assembleResearchReportProjectionInputs,
} from "./canonical.ts"
import type {
  CouncilHistoryKnowledgeProjectionInput,
  ResearchReportKnowledgeProjectionInput,
} from "./projections.ts"
import type { TickerKnowledgeBackfillPage } from "./sync.ts"

export const MAX_RESEARCH_REPORT_BACKFILL_PAGE = 25
export const MAX_COUNCIL_BACKFILL_PAGE = 100

type CanonicalRow = Record<string, unknown>

export interface ResearchReportChunkSelector {
  reportId: string
  contentHash: string
  chunkVersion: string
  pages: readonly number[]
}

export interface CanonicalResearchReportBackfillSource {
  loadReports(cursor: string | null, limit: number): Promise<TickerKnowledgeBackfillPage<CanonicalRow>>
  loadAnalyses(reportIds: readonly string[]): Promise<readonly CanonicalRow[]>
  loadMentions(analysisIds: readonly string[]): Promise<readonly CanonicalRow[]>
  loadChunks(selectors: readonly ResearchReportChunkSelector[]): Promise<readonly CanonicalRow[]>
}

export interface CanonicalCouncilBackfillSource {
  loadRuns(cursor: string | null, limit: number): Promise<TickerKnowledgeBackfillPage<CanonicalRow>>
  loadOutcomes(runIds: readonly string[]): Promise<readonly CanonicalRow[]>
  loadDebates(runIds: readonly string[]): Promise<readonly CanonicalRow[]>
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function boundedPageSize(value: number | undefined, max: number) {
  if (!Number.isFinite(value)) return max
  return Math.max(1, Math.min(max, Math.floor(value ?? max)))
}

function uniqueStrings(values: readonly unknown[]) {
  return [...new Set(values.map(text).filter(Boolean))]
}

function citedPages(input: ResearchReportKnowledgeProjectionInput) {
  return [...new Set(
    input.mentions.flatMap((mention) => mention.evidence.map((entry) => entry.page))
      .filter((page) => Number.isInteger(page) && page > 0),
  )].sort((left, right) => left - right)
}

export async function loadCanonicalResearchReportBackfillPage(input: {
  cursor?: string | null
  batchSize?: number
  source: CanonicalResearchReportBackfillSource
}): Promise<TickerKnowledgeBackfillPage<ResearchReportKnowledgeProjectionInput>> {
  const page = await input.source.loadReports(
    input.cursor ?? null,
    boundedPageSize(input.batchSize, MAX_RESEARCH_REPORT_BACKFILL_PAGE),
  )
  const reportIds = uniqueStrings(page.rows.map((row) => row.id))
  if (!reportIds.length) return { rows: [], nextCursor: page.nextCursor }

  const analyses = await input.source.loadAnalyses(reportIds)
  const selectedAnalyses = assembleResearchReportProjectionInputs({
    reports: page.rows,
    analyses,
    mentions: [],
    chunks: [],
  })
  const analysisIds = uniqueStrings(selectedAnalyses.map((row) => row.analysis.id))
  if (!analysisIds.length) return { rows: [], nextCursor: page.nextCursor }

  const mentions = await input.source.loadMentions(analysisIds)
  const selectedMentions = assembleResearchReportProjectionInputs({
    reports: page.rows,
    analyses,
    mentions,
    chunks: [],
  })

  const selectors: ResearchReportChunkSelector[] = selectedMentions
    .filter((row) => row.mentions.length > 0)
    .flatMap((row) => {
      const pages = citedPages(row)
      return pages.length ? [{
        reportId: row.report.id,
        contentHash: row.report.contentHash,
        chunkVersion: row.analysis.chunkVersion,
        pages,
      }] : []
    })
    .sort((left, right) => left.reportId.localeCompare(right.reportId))

  const chunks = selectors.length ? await input.source.loadChunks(selectors) : []
  const rows = assembleResearchReportProjectionInputs({
    reports: page.rows,
    analyses,
    mentions,
    chunks,
  }).filter((row) => row.mentions.length > 0)

  // Always preserve the canonical source cursor. A report with no ticker-scoped
  // projection must still advance the resumable scan rather than loop forever.
  return { rows, nextCursor: page.nextCursor }
}

export async function loadCanonicalCouncilBackfillPage(input: {
  cursor?: string | null
  batchSize?: number
  source: CanonicalCouncilBackfillSource
}): Promise<TickerKnowledgeBackfillPage<CouncilHistoryKnowledgeProjectionInput>> {
  const page = await input.source.loadRuns(
    input.cursor ?? null,
    boundedPageSize(input.batchSize, MAX_COUNCIL_BACKFILL_PAGE),
  )
  const runIds = uniqueStrings(page.rows.map((row) => row.id))
  if (!runIds.length) return { rows: [], nextCursor: page.nextCursor }

  const [outcomes, debates] = await Promise.all([
    input.source.loadOutcomes(runIds),
    input.source.loadDebates(runIds),
  ])

  return {
    rows: assembleCouncilProjectionInputs({ runs: page.rows, outcomes, debates }),
    nextCursor: page.nextCursor,
  }
}
