const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const PDF_UNAVAILABLE_MESSAGE = "Research report PDF is temporarily unavailable"

export function validatePdfReportId(rawId: string):
  | { ok: true; id: string }
  | { ok: false } {
  const id = rawId.trim()
  return UUID_RE.test(id) ? { ok: true, id } : { ok: false }
}

export function safeInlineFilename(title: string): string {
  let base = String(title ?? "")
    .replace(/[\r\n]+/g, " ")
    .replace(/[\\/]+/g, " - ")
    .replace(/["\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\.pdf$/i, "")
    .trim()

  if (!base) base = "research-report"
  base = base.slice(0, 120).trim() || "research-report"
  return `inline; filename="${base}.pdf"`
}

export function publicPdfFailure(_error: unknown): string {
  return PDF_UNAVAILABLE_MESSAGE
}
