const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const PDF_UNAVAILABLE_MESSAGE = "Research report PDF is temporarily unavailable"

function configuredAllowedPdfHosts(): ReadonlySet<string> {
  return new Set(
    (process.env.RESEARCH_REPORT_PDF_ALLOWED_HOSTS || "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  )
}

export function validatePdfReportId(rawId: string):
  | { ok: true; id: string }
  | { ok: false } {
  const id = rawId.trim()
  return UUID_RE.test(id) ? { ok: true, id } : { ok: false }
}

export function safeResearchReportPdfBrowserUrl(value: unknown): string | null {
  if (typeof value !== "string") return null
  const raw = value.trim()
  if (!raw) return null

  try {
    const url = new URL(raw)
    if (url.protocol !== "https:" || url.username || url.password) return null
    if (!configuredAllowedPdfHosts().has(url.hostname.toLowerCase())) return null
    return url.toString()
  } catch {
    return null
  }
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
