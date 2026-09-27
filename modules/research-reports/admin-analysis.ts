const MAX_ERROR_CHARS = 500

export interface ResearchReportAdminDiagnostic {
  analysisStatus: string
  analysisError: string | null
  ingestionStatus: string
  ingestionError: string | null
  retryable: boolean
  retryBlockedReason: string | null
}

export function sanitizeResearchReportAdminError(value: unknown): string | null {
  if (typeof value !== "string") return null
  const sanitized = value
    .replace(/Bearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]+\b/g, "[REDACTED]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_ERROR_CHARS)
  return sanitized || null
}

function normalizedStatus(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim()
    ? value.trim().toLowerCase()
    : fallback
}

export function buildResearchReportAdminDiagnostic(
  row: Record<string, unknown>,
): ResearchReportAdminDiagnostic {
  const analysisStatus = normalizedStatus(row.analysis_status, "pending")
  const ingestionStatus = normalizedStatus(row.ingestion_status, "discovered")
  const hasPdfSource = typeof row.pdf_url === "string" && /^https:\/\//i.test(row.pdf_url.trim())

  let retryBlockedReason: string | null = null
  if (analysisStatus === "processing") {
    retryBlockedReason = "Phân tích AI đang chạy. Hãy chờ lần xử lý hiện tại hoàn tất."
  } else if (ingestionStatus === "fetching") {
    retryBlockedReason = "PDF đang được tải và xử lý. Hãy chờ lần xử lý hiện tại hoàn tất."
  } else if (analysisStatus === "needs_ocr" || ingestionStatus === "needs_ocr") {
    retryBlockedReason = "Báo cáo cần OCR trước khi có thể chạy lại phân tích AI."
  } else if (analysisStatus === "unsupported" || ingestionStatus === "unsupported") {
    retryBlockedReason = "Định dạng PDF hiện chưa được pipeline hỗ trợ để phân tích AI."
  } else if (!hasPdfSource) {
    retryBlockedReason = "Báo cáo chưa có PDF HTTPS hợp lệ để chạy lại phân tích."
  }

  return {
    analysisStatus,
    analysisError: sanitizeResearchReportAdminError(row.analysis_error),
    ingestionStatus,
    ingestionError: sanitizeResearchReportAdminError(row.ingestion_error),
    retryable: retryBlockedReason === null,
    retryBlockedReason,
  }
}
