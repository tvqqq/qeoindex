const ANALYSIS_TABLE = "market_research_report_analyses"

interface RecoveryLookupRow {
  id: string
  report_id: string
  content_hash: string
  parsed_page_count: number
}

interface RecoveryLookupBuilder {
  select(columns: string): RecoveryLookupBuilder
  eq(column: string, value: unknown): RecoveryLookupBuilder
  order(column: string, options: { ascending: boolean }): RecoveryLookupBuilder
  limit(count: number): RecoveryLookupBuilder
  maybeSingle(): PromiseLike<{
    data: RecoveryLookupRow | null
    error: { message?: string } | null
  }>
}

export interface ResearchReportRecoveryLookupClient {
  from(table: string): RecoveryLookupBuilder
}

export interface LastKnownGoodResearchReportAnalysis {
  id: string
  reportId: string
  contentHash: string
  parsedPageCount: number
}

function safeLookupError(error: { message?: string } | null) {
  const message = error?.message?.replace(/\s+/g, " ").trim().slice(0, 300) || "unknown Supabase error"
  return new Error(`Research report recovery lookup failed: ${message}`)
}

export async function findLastKnownGoodResearchReportAnalysis(
  client: ResearchReportRecoveryLookupClient,
  reportId: string,
): Promise<LastKnownGoodResearchReportAnalysis | null> {
  const result = await client
    .from(ANALYSIS_TABLE)
    .select("id,report_id,content_hash,parsed_page_count")
    .eq("report_id", reportId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (result.error) throw safeLookupError(result.error)
  if (!result.data) return null

  return {
    id: result.data.id,
    reportId: result.data.report_id,
    contentHash: result.data.content_hash,
    parsedPageCount: result.data.parsed_page_count,
  }
}
