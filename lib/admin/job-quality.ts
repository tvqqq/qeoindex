export type JobQualityStatus =
  | "complete_by_reported_counts"
  | "partial_by_reported_counts"
  | "reported_issues"
  | "no_reported_issues"
  | "inconsistent"
  | "empty"
  | "unknown"

export type JobQuality = {
  status: JobQualityStatus
  label: string
  details: Record<string, number | boolean>
}

const numberOrNull = (value: unknown) => typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null
const hasInvalidCount = (values: unknown[]) => values.some((value) => value !== undefined && numberOrNull(value) === null)

export function interpretEodQuality(input: {
  total?: unknown
  complete?: unknown
  incomplete?: unknown
  validationAgreement?: unknown
  limitedCoverageCount?: unknown
}): JobQuality {
  const total = numberOrNull(input.total)
  const complete = numberOrNull(input.complete)
  const incomplete = numberOrNull(input.incomplete)
  const agreement = typeof input.validationAgreement === "boolean" ? input.validationAgreement : null
  const limited = numberOrNull(input.limitedCoverageCount)
  if (hasInvalidCount([input.total, input.complete, input.incomplete]) || (input.validationAgreement !== undefined && agreement === null)) return { status: "inconsistent", label: "Báo cáo EOD không hợp lệ", details: {} }
  if (total === null || complete === null || incomplete === null || agreement === null) return { status: "unknown", label: "Chưa đủ dữ liệu chất lượng EOD", details: {} }
  if (total === 0 && complete === 0 && incomplete === 0) return { status: "empty", label: "EOD trống", details: { total, complete, incomplete, validationAgreement: agreement, limitedCoverageCount: limited ?? 0 } }
  if (complete + incomplete !== total) return { status: "inconsistent", label: "Báo cáo EOD không nhất quán", details: { total, complete, incomplete } }
  if (!agreement) return { status: "inconsistent", label: "Validation EOD không khớp", details: { total, complete, incomplete, validationAgreement: false } }
  return {
    status: incomplete > 0 ? "partial_by_reported_counts" : "complete_by_reported_counts",
    label: incomplete > 0 ? `EOD một phần theo báo cáo (${complete}/${total}, ${incomplete} thiếu)` : `EOD hoàn tất theo báo cáo (${complete}/${total})`,
    details: { total, complete, incomplete, validationAgreement: true, limitedCoverageCount: limited ?? 0 },
  }
}

export function interpretSignalsDailyQuality(input: { completed?: unknown; errors?: unknown; skipped?: unknown }): JobQuality {
  const completed = numberOrNull(input.completed)
  const errors = numberOrNull(input.errors)
  const skipped = numberOrNull(input.skipped)
  if (hasInvalidCount([input.completed, input.errors, input.skipped])) return { status: "inconsistent", label: "Báo cáo Signals không hợp lệ", details: {} }
  if (completed === null || errors === null || skipped === null) return { status: "unknown", label: "Chưa đủ dữ liệu chất lượng Signals", details: {} }
  if (errors === 0) return { status: "no_reported_issues", label: "Không có lỗi được báo cáo (không đồng nghĩa hoàn tất dữ liệu)", details: { completed, errors, skipped } }
  return { status: "reported_issues", label: `Signals có ${errors} lỗi được báo cáo`, details: { completed, errors, skipped } }
}

export function interpretRatingQuality(input: { staged?: unknown; published?: unknown }): JobQuality {
  const staged = numberOrNull(input.staged)
  const published = numberOrNull(input.published)
  if (hasInvalidCount([input.staged, input.published])) return { status: "inconsistent", label: "Báo cáo Rating không hợp lệ", details: {} }
  if (staged === null || published === null) return { status: "unknown", label: "Chưa đủ dữ liệu chất lượng Rating", details: {} }
  if (staged === 0 && published === 0) return { status: "empty", label: "Rating trống", details: { staged, published } }
  if (published > staged) return { status: "inconsistent", label: "Báo cáo Rating không nhất quán", details: { staged, published } }
  return { status: published === staged ? "complete_by_reported_counts" : "partial_by_reported_counts", label: published === staged ? `Đã công bố toàn bộ ${published} dòng staged` : `Rating công bố ${published}/${staged} dòng staged`, details: { staged, published } }
}

export function interpretTtaiQuality(input: { candidates?: unknown; processed?: unknown; failed?: unknown }): JobQuality {
  const candidates = numberOrNull(input.candidates)
  const processed = numberOrNull(input.processed)
  const failed = numberOrNull(input.failed)
  if (hasInvalidCount([input.candidates, input.processed, input.failed])) return { status: "inconsistent", label: "Báo cáo TTAI không hợp lệ", details: {} }
  if (candidates === null || processed === null || failed === null) return { status: "unknown", label: "Chưa đủ dữ liệu chất lượng TTAI", details: {} }
  if (candidates === 0 && processed === 0 && failed === 0) return { status: "empty", label: "TTAI trống", details: { candidates, processed, failed } }
  if (processed + failed > candidates) return { status: "inconsistent", label: "Báo cáo TTAI không nhất quán", details: { candidates, processed, failed } }
  if (failed > 0) return { status: "reported_issues", label: `TTAI có ${failed} lỗi được báo cáo`, details: { candidates, processed, failed } }
  return { status: "no_reported_issues", label: "TTAI không có lỗi được báo cáo", details: { candidates, processed, failed } }
}
