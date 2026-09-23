import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  clampPdfPage,
  clampPdfZoom,
} from "../../components/research-reports/pdf-viewer-state.ts"

function source(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8")
}

test("PDF page and zoom bounds are deterministic", () => {
  assert.equal(clampPdfPage(0, 12), 1)
  assert.equal(clampPdfPage(99, 12), 12)
  assert.equal(clampPdfPage(7, 12), 7)
  assert.equal(clampPdfPage(1.5, 12), 2)
  assert.equal(clampPdfZoom(0.1), 0.5)
  assert.equal(clampPdfZoom(4), 2.5)
  assert.equal(clampPdfZoom(1.25), 1.25)
})

test("PDF viewer loads pdfjs only in the client runtime and keeps the bundled worker", () => {
  const code = source("components/research-reports/pdf-viewer.tsx")
  assert.match(code, /import\(["']pdfjs-dist["']\)/)
  assert.match(code, /GlobalWorkerOptions\.workerSrc/)
  assert.match(code, /new URL\(\s*["']pdfjs-dist\/build\/pdf\.worker\.min\.mjs["']/)
  assert.doesNotMatch(code, /import\s+\*\s+as\s+pdfjsLib\s+from\s+["']pdfjs-dist["']/)
  assert.doesNotMatch(code, /cdnjs|unpkg|jsdelivr/i)
})

test("PDF viewer prefers the approved original PDF URL and falls back to the authenticated report route", () => {
  const code = source("components/research-reports/pdf-viewer.tsx")
  assert.match(code, /const candidateUrls = originalPdfUrl \? \[originalPdfUrl, proxyUrl\] : \[proxyUrl\]/)
  assert.match(code, /pdfjsLib\.getDocument\(\{ url \}\)/)
  assert.match(code, /\/api\/research-reports\/\$\{encodeURIComponent\(reportId\)\}\/pdf/)
  assert.match(code, /originalPdfUrl/)
  assert.doesNotMatch(code, />\s*PDF gốc ↗\s*</)
  assert.match(code, />\s*Mở PDF gốc ↗\s*</)
})

test("PDF viewer renders exactly the active page canvas and cancels stale render work", () => {
  const code = source("components/research-reports/pdf-viewer.tsx")
  assert.match(code, /getPage\(currentPage\)|getPage\(page/)
  assert.match(code, /page\.render\(/)
  assert.match(code, /renderTaskRef\.current\?\.cancel\(\)|renderTask\.cancel\(\)/)
  assert.match(code, /<canvas/)
  assert.doesNotMatch(code, /Array\.from\([^\n]*pageCount[\s\S]*<canvas|map\([^\n]*pageCount[\s\S]*<canvas/)
})

test("PDF viewer exposes keyboard-operable navigation zoom and page controls", () => {
  const code = source("components/research-reports/pdf-viewer.tsx")
  assert.match(code, /aria-label=["']Trang trước["']|aria-label=["'][^"']*previous[^"']*["']/i)
  assert.match(code, /aria-label=["']Trang sau["']|aria-label=["'][^"']*next[^"']*["']/i)
  assert.match(code, /aria-label=["'][^"']*zoom[^"']*["']/i)
  assert.match(code, /aria-label=["']Số trang["']/)
  assert.match(code, /type=["']number["']/)
})

test("PDF viewer mirrors controls below the page and provides subdued middle paging buttons", () => {
  const code = source("components/research-reports/pdf-viewer.tsx")
  assert.match(code, /data-pdf-toolbar=\{placement\}/)
  assert.match(code, /renderToolbar\(["']top["']\)/)
  assert.match(code, /renderToolbar\(["']bottom["']\)/)
  assert.match(code, /data-pdf-floating-nav=["']previous["']/)
  assert.match(code, /data-pdf-floating-nav=["']next["']/)
  assert.match(code, /opacity-35/)
  assert.match(code, /disabled:pointer-events-none disabled:opacity-0/)
})

test("pending citation page is applied after PDF metadata resolves and source links remain optional", () => {
  const code = source("components/research-reports/pdf-viewer.tsx")
  assert.match(code, /requestedPage/)
  assert.match(code, /clampPdfPage\(requestedPage,\s*pageCount\)/)
  assert.match(code, /onPageResolved\?\./)
  assert.match(code, /originalSourceLink/)
  assert.match(code, /originalPdfUrl/)
  assert.match(code, /target=["']_blank["']/)
})

test("Research Reports catalog uses one, two, then three columns as viewport width grows", () => {
  const code = source("app/reports/page.tsx")
  assert.match(code, /className=["'][^"']*grid[^"']*md:grid-cols-2[^"']*xl:grid-cols-3[^"']*["']/)
})

test("Research Reports catalog card uses generated report image, compact footer metadata, and ticker filters", () => {
  const code = source("app/reports/page.tsx")

  assert.match(code, /href=\{`\/research\/reports\/\$\{item\.id\}`\}/)
  assert.match(code, /<ReportSummaryImage/)
  assert.match(code, /summaryImageStatus === "ready"/)
  assert.doesNotMatch(code, /TRẠNG THÁI AI/)
  assert.doesNotMatch(code, /text-\[10px\][^\n]*KHUYẾN NGHỊ/)
  assert.match(code, /item\.sourceName/)
  assert.match(code, /dateLabel\(item\.publishDate\)/)
  assert.match(code, /recommendation\.primary/)
  assert.match(code, /catalogHref\(query, \{ ticker, page: 1 \}\)/)
})

test("Research Reports catalog keeps current-analysis metadata without rendering description text", () => {
  const service = source("modules/research-reports/catalog.ts")
  const page = source("app/reports/page.tsx")

  assert.match(service, /content_hash/)
  assert.match(service, /market_research_report_analyses/)
  assert.match(service, /market_research_report_ticker_mentions/)
  assert.match(service, /executive_summary/)
  assert.doesNotMatch(service, /market_research_report_chunks/)
  assert.doesNotMatch(page, /item\.description/)
})

test("Research report cards keep equal-height category styling and clickable source filters", () => {
  const code = source("app/reports/page.tsx")

  assert.match(code, /macro[\s\S]{0,220}emerald/)
  assert.match(code, /strategy[\s\S]{0,220}cyan/)
  assert.match(code, /sector[\s\S]{0,220}amber/)
  assert.match(code, /(other|return)[\s\S]{0,220}violet/)
  assert.match(code, /h-full/)
  assert.match(code, /\/reports\?source=/)
  assert.match(code, /encodeURIComponent\(item\.sourceName\)/)
})

test("Research report recommendation panel identifies buy or sell ticker and shows target price only when present", () => {
  const code = source("app/reports/page.tsx")

  assert.match(code, /function recommendationView/)
  assert.match(code, /MUA\|BÁN/)
  assert.match(code, /item\.code/)
  assert.match(code, /item\.targetPrice/)
  assert.match(code, /Mục tiêu/)
})

test("PDF viewer provides adjustable amber anti-glare overlay without changing PDF pixels", () => {
  const code = source("components/research-reports/pdf-viewer.tsx")

  assert.match(code, /antiGlare/)
  assert.match(code, /type=["']range["']/)
  assert.match(code, /aria-label=["']Mức chống chói["']/)
  assert.match(code, /max=\{?40\}?/)
  assert.match(code, /pointer-events-none/)
  assert.match(code, /(amber|rgba\(|backgroundColor)/)
})

test("Report detail can hide PDF on desktop and expand analysis typography while keeping mobile tabs intact", () => {
  const shell = source("components/research-reports/report-detail-shell.tsx")
  const analysis = source("components/research-reports/analysis-panel.tsx")
  const chat = source("components/research-reports/report-chat.tsx")

  assert.match(shell, /pdfHidden/)
  assert.match(shell, /Ẩn PDF/)
  assert.match(shell, /Hiện PDF/)
  assert.match(shell, /lg:hidden/)
  assert.match(shell, /expanded=\{pdfHidden\}/)
  assert.match(analysis, /expanded/)
  assert.match(analysis, /text-base/)
  assert.match(chat, /expanded/)
  assert.match(shell, /lg:grid/)
  assert.match(shell, /role=["']tablist["']/)
})

test("desktop report detail keeps chat below PDF when visible and switches to a 30/70 chat-analysis split when PDF is hidden", () => {
  const shell = source("components/research-reports/report-detail-shell.tsx")

  assert.match(shell, /lg:grid-cols-\[minmax\(280px,3fr\)_minmax\(0,7fr\)\]/)
  assert.match(shell, /data-report-left-column[\s\S]*data-report-panel=["']pdf["'][\s\S]*<PdfViewer[\s\S]*data-report-panel=["']chat["'][\s\S]*<ReportChat/)
  assert.match(shell, /data-report-analysis-column[\s\S]*data-report-panel=["']analysis["'][\s\S]*<AnalysisPanel/)
})

test("report cards place the generated summary immediately below the title and keep recommendation in the footer", () => {
  const page = source("app/reports/page.tsx")

  assert.doesNotMatch(page, /TRẠNG THÁI AI/)
  assert.doesNotMatch(page, /descriptionView\(item\)/)
  assert.match(page, /<h2[\s\S]{0,700}\{item\.title\}[\s\S]{0,900}<ReportSummaryImage/)
  assert.match(page, /border-t[\s\S]{0,1200}item\.sourceName[\s\S]{0,1000}recommendation\.primary/)
})


test("generated research summary image has an accessible click-to-zoom lightbox", () => {
  const image = source("components/research-reports/report-summary-image.tsx")
  assert.match(image, /aria-label=\{\`Phóng to ảnh tóm tắt báo cáo/)
  assert.match(image, /role="dialog"/)
  assert.match(image, /aria-modal="true"/)
  assert.match(image, /event\.key === "Escape"/)
  assert.match(image, /aspect-\[3\/2\]/)
})
