import type { ResearchReportSourceRecord, ResearchReportUpsertResult } from "./types.ts"

const REPORT_TABLE = "market_research_reports"
const REPORT_CONFLICT_TARGET = "provider,external_report_id"

interface ResearchReportUpsertClient {
  from(table: string): {
    upsert(
      rows: Array<Record<string, unknown>>,
      options: { onConflict: string; ignoreDuplicates: boolean },
    ): PromiseLike<{ error: { message?: string } | null }>
  }
}

export function toResearchReportUpsertRow(report: ResearchReportSourceRecord): Record<string, unknown> {
  return {
    provider: report.provider,
    external_report_id: report.externalReportId,
    title: report.title,
    source_name: report.sourceName,
    publish_date: report.publishDate,
    original_type_report: report.originalTypeReport,
    category: report.category,
    sector_name: report.sectorName,
    recommendation: report.recommendation,
    target_price: report.targetPrice,
    code: report.code,
    link: report.link,
    pdf_url: report.pdfUrl,
    source_payload: report.sourcePayload,
    updated_at: new Date().toISOString(),
  }
}

export async function upsertResearchReports(
  client: ResearchReportUpsertClient,
  reports: readonly ResearchReportSourceRecord[],
): Promise<ResearchReportUpsertResult> {
  if (reports.length === 0) return { upserted: 0 }

  const rows = reports.map(toResearchReportUpsertRow)
  const result = await client.from(REPORT_TABLE).upsert(rows, {
    onConflict: REPORT_CONFLICT_TARGET,
    ignoreDuplicates: false,
  })

  if (result.error) {
    throw new Error(`Research report metadata upsert failed: ${result.error.message || "unknown Supabase error"}`)
  }

  return { upserted: rows.length }
}
