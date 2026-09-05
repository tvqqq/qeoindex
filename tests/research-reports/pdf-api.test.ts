import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  publicPdfFailure,
  safeInlineFilename,
  safeResearchReportPdfBrowserUrl,
  validatePdfReportId,
} from "../../modules/research-reports/detail/pdf-route.ts"

function routeSource() {
  return readFileSync(
    new URL("../../app/api/research-reports/[id]/pdf/route.ts", import.meta.url),
    "utf8",
  )
}

test("PDF route authenticates before privileged service-role access", () => {
  const code = routeSource()
  const authGate = code.indexOf('await requireApiFeature("research")')
  const paramsRead = code.indexOf("await params")
  const serverClient = code.indexOf("getSupabaseServerClient()")

  assert.ok(authGate >= 0)
  assert.ok(paramsRead > authGate)
  assert.ok(serverClient > authGate)
})

test("PDF route resolves stored report source and redirects only to the approved browser URL", () => {
  const code = routeSource()
  assert.match(code, /findResearchReportPdfSource/)
  assert.match(code, /safeResearchReportPdfBrowserUrl\(source\.pdfUrl\)/)
  assert.match(code, /status:\s*307/)
  assert.match(code, /Location:\s*target/)
  assert.doesNotMatch(code, /fetchResearchReportPdf/)
  assert.doesNotMatch(code, /searchParams\.get\(["']url["']\)|body\.url|payload\.url|request\.json\(\)/)
})

test("PDF redirect response stays private no-store and nosniff", () => {
  const code = routeSource()
  assert.match(code, /["']Cache-Control["']\s*:\s*["']private, no-store["']/i)
  assert.match(code, /["']X-Content-Type-Options["']\s*:\s*["']nosniff["']/i)
})

test("PDF report id validation fails closed before lookup", () => {
  assert.deepEqual(validatePdfReportId("not-a-uuid"), { ok: false })
  assert.deepEqual(
    validatePdfReportId("11111111-1111-4111-8111-111111111111"),
    { ok: true, id: "11111111-1111-4111-8111-111111111111" },
  )
})

test("browser PDF URL is exposed only for configured HTTPS hosts without credentials", () => {
  const previous = process.env.RESEARCH_REPORT_PDF_ALLOWED_HOSTS
  process.env.RESEARCH_REPORT_PDF_ALLOWED_HOSTS = "cdn02.wigroup.vn,cdn.example.com"
  try {
    assert.equal(
      safeResearchReportPdfBrowserUrl("https://cdn02.wigroup.vn/report.pdf"),
      "https://cdn02.wigroup.vn/report.pdf",
    )
    assert.equal(safeResearchReportPdfBrowserUrl("https://evil.example/report.pdf"), null)
    assert.equal(safeResearchReportPdfBrowserUrl("http://cdn02.wigroup.vn/report.pdf"), null)
    assert.equal(safeResearchReportPdfBrowserUrl("https://user:pass@cdn02.wigroup.vn/report.pdf"), null)
  } finally {
    if (previous === undefined) delete process.env.RESEARCH_REPORT_PDF_ALLOWED_HOSTS
    else process.env.RESEARCH_REPORT_PDF_ALLOWED_HOSTS = previous
  }
})

test("Content-Disposition filename removes header injection and path separators", () => {
  assert.equal(
    safeInlineFilename("Broker / Q3\r\nInjected"),
    'inline; filename="Broker - Q3 Injected.pdf"',
  )
  assert.equal(safeInlineFilename("  "), 'inline; filename="research-report.pdf"')
})

test("public PDF failure never echoes upstream URL DNS or error detail", () => {
  const unsafe = new Error("DNS 10.0.0.2 https://secret.example/x.pdf Bearer secret")
  assert.equal(publicPdfFailure(unsafe), "Research report PDF is temporarily unavailable")
  assert.doesNotMatch(publicPdfFailure(unsafe), /10\.0\.0\.2|secret\.example|Bearer|DNS/i)
})
