import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

function source(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8")
}

test("desktop report detail keeps chat below PDF when visible and switches to a 30/70 chat-analysis split when PDF is hidden", () => {
  const shell = source("components/research-reports/report-detail-shell.tsx")

  assert.match(shell, /lg:grid-cols-\[minmax\(280px,3fr\)_minmax\(0,7fr\)\]/)
  assert.match(shell, /data-report-left-column[\s\S]*data-report-panel=["']pdf["'][\s\S]*<PdfViewer[\s\S]*data-report-panel=["']chat["'][\s\S]*<ReportChat/)
  assert.match(shell, /data-report-analysis-column[\s\S]*data-report-panel=["']analysis["'][\s\S]*<AnalysisPanel/)
})

test("report cards place status panels directly below the title and only show description for ready AI analysis", () => {
  const page = source("app/reports/page.tsx")

  assert.doesNotMatch(page, /min-h-\[84px\]/)
  assert.doesNotMatch(page, /<p className=["'][^"']*h-\[60px\][^"']*["']>/)
  assert.match(
    page,
    /<h2[\s\S]{0,500}\{item\.title\}[\s\S]{0,500}TRẠNG THÁI AI[\s\S]{0,1000}KHUYẾN NGHỊ[\s\S]{0,1000}item\.analysisStatus === ["']ready["'][\s\S]{0,500}descriptionView\(item\)/,
  )
})
