import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

function source(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8")
}

test("detail server page reuses authenticated research context and browser-safe detail service", () => {
  const page = source("app/research/reports/[id]/page.tsx")

  assert.match(page, /getServerAuthContext/)
  assert.match(page, /getResearchReportDetail/)
  assert.match(page, /notFound\(/)
  assert.match(page, /ReportDetailShell/)
  assert.doesNotMatch(page, /pdf_url|source_payload|market_research_report_chunks/)
  assert.doesNotMatch(page, /fetchResearchReportPdf|answerResearchReportQuestion|processResearchReport/)
})

test("detail shell is the single owner of citation navigation and all three independent surfaces", () => {
  const shell = source("components/research-reports/report-detail-shell.tsx")

  assert.match(shell, /nextCitationNavigationState/)
  assert.match(shell, /setNavigation\(\(current\)\s*=>\s*nextCitationNavigationState\(current, page\)\)/)
  assert.match(shell, /PdfViewer/)
  assert.match(shell, /AnalysisPanel/)
  assert.match(shell, /ReportChat/)
  assert.equal((shell.match(/<PdfViewer\b/g) ?? []).length, 1)
  assert.match(shell, /data-report-panel=["']pdf["']/)
  assert.match(shell, /data-report-panel=["']analysis["']/)
  assert.match(shell, /data-report-panel=["']chat["']/)
})

test("detail shell provides desktop split and exactly three accessible mobile tabs", () => {
  const shell = source("components/research-reports/report-detail-shell.tsx")

  assert.match(shell, /lg:grid|lg:grid-cols/)
  assert.match(shell, /role=["']tablist["']/)
  assert.match(shell, /aria-selected/)
  assert.match(shell, /aria-controls/)
  assert.match(shell, />PDF</)
  assert.match(shell, />Phân tích</)
  assert.match(shell, />Hỏi báo cáo</)
  assert.match(shell, /tabIndex=\{-1\}/)
  assert.match(shell, /lg:hidden/)
})

test("report header renders persisted metadata lifecycle and safe source navigation", () => {
  const shell = source("components/research-reports/report-detail-shell.tsx")

  assert.match(shell, /report\.title/)
  assert.match(shell, /report\.sourceName/)
  assert.match(shell, /report\.publishDate/)
  assert.match(shell, /report\.category/)
  assert.match(shell, /report\.analysisStatus/)
  assert.match(shell, /originalSourceLink/)
  assert.match(shell, /originalPdfUrl/)
  assert.match(shell, />Mở PDF gốc ↗</)
  assert.match(shell, /target=["']_blank["']/)
  assert.match(shell, /rel=["']noreferrer noopener["']/)
})

test("detail shell provides a previous-page action with catalog fallback", () => {
  const shell = source("components/research-reports/report-detail-shell.tsx")

  assert.match(shell, /useRouter\(\)/)
  assert.match(shell, /window\.history\.length\s*>\s*1/)
  assert.match(shell, /router\.back\(\)/)
  assert.match(shell, /router\.push\(["']\/insights\/reports["']\)/)
  assert.match(shell, />\s*Quay lại\s*</)
})

test("detail shell forwards current persisted state to viewer analysis and chat without cross-fetching", () => {
  const shell = source("components/research-reports/report-detail-shell.tsx")

  assert.match(shell, /reportId=\{report\.id\}/)
  assert.match(shell, /title=\{report\.title\}/)
  assert.match(shell, /requestedPage=\{navigation\.requestedPage\}/)
  assert.match(shell, /originalSourceLink=\{report\.originalSourceLink\}/)
  assert.match(shell, /originalPdfUrl=\{report\.originalPdfUrl\}/)
  assert.match(shell, /analysisStatus=\{report\.analysisStatus\}/)
  assert.match(shell, /analysis=\{report\.analysis\}/)
  assert.match(shell, /onNavigateCitation=\{navigateToCitation\}/)
  assert.doesNotMatch(shell, /fetch\s*\(/)
})

test("detail route loading state is visual-only and does not fabricate report metadata", () => {
  const loading = source("app/research/reports/[id]/loading.tsx")

  assert.match(loading, /animate-pulse|skeleton/i)
  assert.doesNotMatch(loading, /MSN|Vietcap|SSI|VCBS|targetPrice|recommendation/i)
})
