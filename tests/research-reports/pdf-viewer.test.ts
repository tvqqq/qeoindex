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
  assert.match(code, />\s*PDF gốc ↗\s*</)
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

test("pending citation page is applied after PDF metadata resolves and source links remain optional", () => {
  const code = source("components/research-reports/pdf-viewer.tsx")
  assert.match(code, /requestedPage/)
  assert.match(code, /clampPdfPage\(requestedPage,\s*pageCount\)/)
  assert.match(code, /onPageResolved\?\./)
  assert.match(code, /originalSourceLink/)
  assert.match(code, /originalPdfUrl/)
  assert.match(code, /target=["']_blank["']/)
})
