# QEO-84 Research Report Detail UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `/research/reports/[id]` as an authenticated research-report detail experience with a secure single-page PDF.js reader, persisted AI analysis/ticker evidence, and grounded cited Q&A whose citations navigate to the exact PDF page.

**Architecture:** Keep data projection server-side in a new `modules/research-reports/detail` boundary; the browser receives a PDF-safe/report-safe view-model and fetches PDF bytes only from an authenticated report-ID proxy that reuses the existing QEO-81 secure fetch policy. Pure citation-navigation primitives coordinate one requested PDF page across analysis/ticker/chat surfaces, while the final client shell composes independent PDF, analysis, and chat states so one failure cannot erase another subsystem.

**Tech Stack:** TypeScript 5.7, Node 24 test runner, Next.js 16 App Router, React 19, Tailwind CSS 4, Supabase/PostgreSQL, `pdfjs-dist` 6.3.289, existing QEO-81 PDF security boundary, existing QEO-82 grounded Q&A API, pnpm 10.28.

**Spec:** `docs/superpowers/specs/2026-09-05-qeo-84-research-report-detail-ui-design.md`

## Global Constraints

- Route is exactly `/research/reports/[id]`.
- QEO-83 catalog is not part of this implementation; its future integration contract is only `href=/research/reports/${id}`.
- Opening the detail page never triggers a new AI analysis and never loads report chunks/full report text into the page payload.
- The raw stored `pdf_url`, provider payload, service-role credentials, and provider secrets never enter the browser view-model.
- Browser PDF requests provide only a report UUID; there is no URL query/body parameter and no generic proxy behavior.
- PDF fetches reuse QEO-81 HTTPS-only host allowlisting, DNS/public-IP validation, redirect, timeout, byte-size, and PDF-signature/content-type policy; do not add a weaker fetch implementation.
- Current analysis is the newest persisted analysis matching the report's current `content_hash`; stale analyses for old hashes are never shown as current.
- Ticker mentions are read only for the selected current analysis ID.
- Broker recommendation, stance, and target price are visibly labeled as report/source opinion, not verified QeoIndex facts.
- PDF rendering mounts only the current page canvas; optionally preloading metadata or one adjacent page must not mount all pages.
- Shared citation navigation is the only page-jump path for analysis, ticker, and Q&A citations.
- Mobile views are exactly `PDF`, `Phân tích`, and `Hỏi báo cáo`; a citation from a non-PDF tab switches to PDF before jumping.
- Q&A reuses `POST /api/research-reports/[id]/chat`; request-scoped history remains bounded to the existing backend contract and is not persisted.
- `not_found` renders `Không tìm thấy thông tin này trong báo cáo.` with no fabricated citations.
- PDF, analysis, and Q&A failures are isolated; one subsystem failure must not erase successful state in another.
- No schema migration is expected. If implementation proves a persisted field is genuinely missing and cannot be safely derived, stop and revise the design before adding a migration.
- Do not add `react-pdf`, virtualization libraries, OCR, embeddings, persistent chat, cross-report chat, annotations, AI Council integration, or unrelated Research Hub refactors.
- Nested `tests/research-reports/*.test.ts` files are executed through the existing canonical top-level `tests/ai-council-llm-reliability.test.ts` wrapper because `tests/test-contracts.json` classifies top-level test files; do not add nested paths directly to the manifest.
- Final merge evidence is fresh `Verify` plus fresh `DB Drift Reconciliation` on the exact final QEO-84 PR head; QEO-81/QEO-82 runs are not reusable evidence.

## File Structure

### New files

- `modules/research-reports/detail/types.ts` — browser-safe detail view-model types only.
- `modules/research-reports/detail/repository.ts` — narrow Supabase reads for report, exact-hash latest analysis, ticker mentions, and server-only PDF source lookup.
- `modules/research-reports/detail/service.ts` — UUID validation, lifecycle mapping, external-link sanitization, evidence validation, and browser-safe projection.
- `app/api/research-reports/[id]/pdf/route.ts` — authenticated report-ID PDF byte proxy.
- `app/research/reports/[id]/page.tsx` — server route loading the detail service and rendering the shell/not-found states.
- `app/research/reports/[id]/loading.tsx` — route-level metadata/split-view skeleton only.
- `components/research-reports/report-detail-navigation.ts` — pure page/tab citation-navigation primitives.
- `components/research-reports/report-citation.tsx` — shared accessible citation button.
- `components/research-reports/report-detail-shell.tsx` — shared page/mobile-tab state and responsive composition.
- `components/research-reports/pdf-viewer.tsx` — single-page PDF.js renderer and controls.
- `components/research-reports/analysis-panel.tsx` — persisted analysis sections and analysis status states.
- `components/research-reports/ticker-mention-card.tsx` — source-opinion ticker evidence card.
- `components/research-reports/report-chat.tsx` — bounded non-persistent Q&A UI.
- `tests/research-reports/detail-service.test.ts` — data selection/projection/browser-safety contracts.
- `tests/research-reports/pdf-api.test.ts` — PDF API auth/input/source-resolution/security/header contracts.
- `tests/research-reports/detail-navigation.test.ts` — shared citation/page/tab state contracts.
- `tests/research-reports/pdf-viewer.test.ts` — source-level PDF.js/lazy-canvas/accessibility/build-worker contracts.
- `tests/research-reports/detail-analysis-ui.test.ts` — analysis/ticker/source-opinion/citation contracts.
- `tests/research-reports/detail-chat-ui.test.ts` — Q&A request/history/not-found/failure-isolation contracts.
- `tests/research-reports/detail-page.test.ts` — server route/layout/loading/not-found/browser-payload contracts.

### Modified files

- `modules/research-reports/index.ts` — export stable detail service/types; keep raw PDF-source repository helpers internal.
- `modules/research-reports/README.md` — document QEO-84 UI/detail ownership and browser/PDF boundaries.
- `tests/ai-council-llm-reliability.test.ts` — import QEO-84 nested research-report contract tests through the existing canonical wrapper.

### Verified unchanged

- `tests/test-contracts.json` — nested QEO-84 tests are not added directly; the existing top-level canonical wrapper remains the manifest entry point.
- Supabase migrations/types — QEO-84 adds no schema change.

---

### Task 1: Browser-safe current-detail domain boundary

**Files:**
- Create: `modules/research-reports/detail/types.ts`
- Create: `modules/research-reports/detail/repository.ts`
- Create: `modules/research-reports/detail/service.ts`
- Create: `tests/research-reports/detail-service.test.ts`
- Modify: `modules/research-reports/index.ts`

**Interfaces:**
- Consumes: `market_research_reports`, `market_research_report_analyses`, `market_research_report_ticker_mentions` and the existing Supabase query-builder behavior.
- Produces:

```ts
export type ResearchReportDetailStatus =
  | "pending"
  | "ready"
  | "needs_ocr"
  | "unsupported"
  | "failed"

export interface ResearchReportDetailCitation {
  page: number
  snippet: string
}

export interface ResearchReportDetailTickerMention {
  ticker: string
  stance: "positive" | "negative" | "neutral" | "mixed"
  recommendationText: string | null
  targetPrice: number | null
  targetCurrency: string | null
  rationale: string | null
  evidence: ResearchReportDetailCitation[]
}

export interface ResearchReportDetailAnalysis {
  analysisId: string
  executiveSummary: string
  keyPoints: string[]
  marketView: string | null
  sectorOutlook: string | null
  catalysts: string[]
  risks: string[]
  processedAt: string
  model: string
  confidence: { score: number; flags: string[] }
  tickerMentions: ResearchReportDetailTickerMention[]
}

export interface ResearchReportDetailViewModel {
  id: string
  title: string
  sourceName: string
  publishDate: string
  category: "macro" | "strategy" | "sector" | "other"
  sectorName: string | null
  originalSourceLink: string | null
  parsedPageCount: number
  ingestionStatus: string
  analysisStatus: ResearchReportDetailStatus
  analysis: ResearchReportDetailAnalysis | null
}

export type ResearchReportDetailResolution =
  | { status: "found"; report: ResearchReportDetailViewModel }
  | { status: "not_found" }
  | { status: "invalid_id" }

export interface ResearchReportDetailQuery
  extends PromiseLike<{
    data: Record<string, unknown>[] | Record<string, unknown> | null
    error: { message?: string } | null
  }> {
  select(columns: string): ResearchReportDetailQuery
  eq(column: string, value: unknown): ResearchReportDetailQuery
  order(column: string, options?: { ascending?: boolean }): ResearchReportDetailQuery
  limit(value: number): ResearchReportDetailQuery
  maybeSingle(): PromiseLike<{
    data: Record<string, unknown> | null
    error: { message?: string } | null
  }>
}

export interface ResearchReportDetailClient {
  from(table: string): ResearchReportDetailQuery
}

export async function getResearchReportDetail(
  client: ResearchReportDetailClient,
  reportId: string,
): Promise<ResearchReportDetailResolution>
```

`repository.ts` additionally produces a server-only helper not exported from `modules/research-reports/index.ts`:

```ts
export async function findResearchReportPdfSource(
  client: ResearchReportDetailClient,
  reportId: string,
): Promise<{ id: string; title: string; pdfUrl: string } | null>
```

- [ ] **Step 1: Write detail-service tests RED**

Create deterministic fakes for report/analysis/mention builders. Add tests equivalent to:

```ts
test("selects only the latest analysis matching the report current content hash", async () => {
  const client = fakeDetailClient({
    report: {
      id: REPORT_ID,
      content_hash: CURRENT_HASH,
      title: "Vietnam Strategy",
      source_name: "Broker A",
      publish_date: "2026-09-05",
      category: "strategy",
      sector_name: null,
      link: "https://example.com/report/1",
      parsed_page_count: 18,
      ingestion_status: "parsed",
      analysis_status: "ready",
    },
    analysis: {
      id: ANALYSIS_ID,
      report_id: REPORT_ID,
      content_hash: CURRENT_HASH,
      executive_summary: "Summary",
      key_points: ["Point"],
      market_view: "Constructive",
      sector_outlook: null,
      catalysts: ["Liquidity"],
      risks: ["FX"],
      confidence: { score: 0.8, flags: [] },
      model_actual: "gpt-5.6-luna",
      model_requested: "gpt-5.6-luna",
      processed_at: "2026-09-05T01:00:00Z",
      created_at: "2026-09-05T01:00:00Z",
    },
    mentions: [],
  })

  const result = await getResearchReportDetail(client, REPORT_ID)
  assert.equal(result.status, "found")
  assert.equal(client.analysisFilters.content_hash, CURRENT_HASH)
  assert.deepEqual(client.analysisOrder, ["processed_at:desc", "created_at:desc", "id:desc"])
})

test("browser view-model never contains raw pdf url or provider payload", async () => {
  const result = await getResearchReportDetail(fakeReadyDetailClient(), REPORT_ID)
  const serialized = JSON.stringify(result)
  assert.doesNotMatch(serialized, /pdf_url|private\.pdf|source_payload/i)
})

test("ticker mentions are filtered to selected analysis id", async () => {
  const client = fakeReadyDetailClient({
    mentions: [{
      analysis_id: ANALYSIS_ID,
      ticker: "MSN",
      stance: "positive",
      recommendation_text: "BUY",
      target_price: 110000,
      target_currency: "VND",
      rationale: "Earnings recovery",
      evidence: [{ page: 7, snippet: "Target price 110,000 VND" }],
    }],
  })
  const result = await getResearchReportDetail(client, REPORT_ID)
  assert.equal(client.mentionFilters.analysis_id, ANALYSIS_ID)
  assert.equal(result.status === "found" ? result.report.analysis?.tickerMentions[0]?.ticker : null, "MSN")
})

test("invalid and out-of-range evidence pages are dropped", async () => {
  const result = await getResearchReportDetail(fakeReadyDetailClient({
    parsed_page_count: 10,
    mentions: [{ evidence: [{ page: 0, snippet: "bad" }, { page: 11, snippet: "bad" }, { page: 7, snippet: "ok" }] }],
  }), REPORT_ID)
  assert.deepEqual(result.status === "found" ? result.report.analysis?.tickerMentions[0]?.evidence : null, [
    { page: 7, snippet: "ok" },
  ])
})

test("source link is exposed only for stored https links", async () => {
  const safe = await getResearchReportDetail(fakeReadyDetailClient({ link: "https://broker.example/report" }), REPORT_ID)
  const unsafe = await getResearchReportDetail(fakeReadyDetailClient({ link: "javascript:alert(1)" }), REPORT_ID)
  assert.equal(safe.status === "found" ? safe.report.originalSourceLink : null, "https://broker.example/report")
  assert.equal(unsafe.status === "found" ? unsafe.report.originalSourceLink : null, null)
})
```

Also cover `processing/pending`, `needs_ocr`, `unsupported`, `failed`, no-current-analysis, missing report, invalid UUID, and model fallback from `model_actual` to `model_requested`.

- [ ] **Step 2: Run RED evidence**

```bash
node --test tests/research-reports/detail-service.test.ts
```

Expected: FAIL because `detail/types.ts`, `detail/repository.ts`, and `detail/service.ts` do not exist.

- [ ] **Step 3: Implement minimal deterministic repository queries**

Report query deliberately excludes `pdf_url` and `source_payload`:

```ts
const report = await client
  .from("market_research_reports")
  .select("id,title,source_name,publish_date,category,sector_name,link,content_hash,parsed_page_count,ingestion_status,analysis_status")
  .eq("id", reportId)
  .maybeSingle()
```

For a report with a current hash, select the latest exact-hash analysis:

```ts
const analysis = await client
  .from("market_research_report_analyses")
  .select("id,report_id,content_hash,executive_summary,key_points,market_view,sector_outlook,catalysts,risks,confidence,model_requested,model_actual,processed_at,created_at")
  .eq("report_id", reportId)
  .eq("content_hash", currentHash)
  .order("processed_at", { ascending: false })
  .order("created_at", { ascending: false })
  .order("id", { ascending: false })
  .limit(1)
  .maybeSingle()
```

When an analysis exists, fetch mentions only by selected analysis ID:

```ts
const mentions = await client
  .from("market_research_report_ticker_mentions")
  .select("ticker,stance,recommendation_text,target_price,target_currency,rationale,evidence")
  .eq("analysis_id", analysis.id)
  .order("ticker", { ascending: true })
```

Implement `findResearchReportPdfSource()` separately with exactly `id,title,pdf_url`.

- [ ] **Step 4: Implement browser-safe service projection**

Validate UUID before any query. Map both `pending` and `processing` analysis lifecycle to `pending`. Normalize JSON arrays/objects fail-closed. Keep evidence only when page is an integer in `1..parsedPageCount` and snippet is non-empty. Return an external source link only when `new URL(link).protocol === "https:"`.

- [ ] **Step 5: Export stable detail surface**

Add only:

```ts
export { getResearchReportDetail } from "./detail/service.ts"
export type {
  ResearchReportDetailAnalysis,
  ResearchReportDetailCitation,
  ResearchReportDetailResolution,
  ResearchReportDetailTickerMention,
  ResearchReportDetailViewModel,
} from "./detail/types.ts"
```

Do not export `findResearchReportPdfSource` from the public module entrypoint.

- [ ] **Step 6: Run GREEN evidence**

```bash
node --test tests/research-reports/detail-service.test.ts
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit Task 1**

```bash
git add modules/research-reports/detail modules/research-reports/index.ts tests/research-reports/detail-service.test.ts
git commit -m "feat(qeo-84): add research report detail domain"
```

---

### Task 2: Authenticated secure PDF report-ID proxy

**Files:**
- Create: `app/api/research-reports/[id]/pdf/route.ts`
- Create: `tests/research-reports/pdf-api.test.ts`

**Interfaces:**
- Consumes: `requireApiFeature("research")`, `getSupabaseServerClient()`, internal `findResearchReportPdfSource()` from Task 1, and existing `fetchResearchReportPdf()` from `modules/research-reports/pdf/secure-fetch.ts`.
- Produces: `GET /api/research-reports/[id]/pdf` returning PDF bytes only for a stored report UUID.

- [ ] **Step 1: Write PDF API tests RED**

Use the repo's source-contract style plus direct helper tests for filename/error mapping. Required assertions:

```ts
const code = routeSource()
assert.ok(code.indexOf('await requireApiFeature("research")') < code.indexOf("getSupabaseServerClient()"))
assert.match(code, /findResearchReportPdfSource/)
assert.match(code, /fetchResearchReportPdf/)
assert.doesNotMatch(code, /searchParams\.get\(["']url["']\)|body\.url|payload\.url/)
assert.match(code, /Content-Type["']?\s*[:,]\s*["']application\/pdf/i)
assert.match(code, /Cache-Control["']?\s*[:,]\s*["']private, no-store/i)
assert.match(code, /X-Content-Type-Options["']?\s*[:,]\s*["']nosniff/i)
```

Also assert pure/public state mapping:

```ts
assert.equal(validatePdfReportId("not-a-uuid").ok, false)
assert.equal(safeInlineFilename("Broker / Q3\r\nInjected"), 'inline; filename="Broker - Q3 Injected.pdf"')
assert.equal(publicPdfFailure(new Error("DNS 10.0.0.2 https://secret.example/x.pdf")), "Research report PDF is temporarily unavailable")
```

- [ ] **Step 2: Run RED evidence**

```bash
node --test tests/research-reports/pdf-api.test.ts
```

Expected: FAIL because the PDF route does not exist.

- [ ] **Step 3: Implement the route in security-first order**

Required control flow:

```ts
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiFeature("research")
  if (!auth.ok) return auth.response

  const { id: rawId } = await params
  const id = rawId.trim()
  if (!UUID_RE.test(id)) return jsonError(400, "Invalid research report id")

  const client = getSupabaseServerClient()
  if (!client) return jsonError(503, "Research report service is unavailable")

  const source = await findResearchReportPdfSource(
    client as unknown as Parameters<typeof findResearchReportPdfSource>[0],
    id,
  )
  if (!source) return jsonError(404, "Research report not found")

  try {
    const pdf = await fetchResearchReportPdf(source.pdfUrl)
    return new Response(pdf.bytes, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Cache-Control": "private, no-store",
        "Content-Disposition": safeInlineFilename(source.title),
        "X-Content-Type-Options": "nosniff",
      },
    })
  } catch {
    return jsonError(502, "Research report PDF is temporarily unavailable")
  }
}
```

`safeInlineFilename()` removes CR/LF, quotes, backslashes, forward slashes, and repeated whitespace; it falls back to `research-report.pdf`. The response never echoes upstream URL, DNS data, or error body.

- [ ] **Step 4: Run GREEN evidence**

```bash
node --test tests/research-reports/pdf-api.test.ts tests/research-reports/detail-service.test.ts
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add app/api/research-reports/[id]/pdf/route.ts tests/research-reports/pdf-api.test.ts
git commit -m "feat(qeo-84): add secure research report pdf route"
```

---

### Task 3: Shared citation/page/mobile-tab navigation primitives

**Files:**
- Create: `components/research-reports/report-detail-navigation.ts`
- Create: `components/research-reports/report-citation.tsx`
- Create: `tests/research-reports/detail-navigation.test.ts`

**Interfaces:**
- Produces:

```ts
export type ResearchReportDetailTab = "pdf" | "analysis" | "chat"

export interface CitationNavigationState {
  activeTab: ResearchReportDetailTab
  requestedPage: number | null
}

export function nextCitationNavigationState(
  current: CitationNavigationState,
  page: number,
): CitationNavigationState

export function ReportCitation(props: {
  page: number
  excerpt?: string
  onNavigate: (page: number) => void
}): React.ReactNode
```

- [ ] **Step 1: Write navigation tests RED**

```ts
test("citation navigation always switches mobile state to pdf and requests the cited page", () => {
  assert.deepEqual(
    nextCitationNavigationState({ activeTab: "analysis", requestedPage: null }, 7),
    { activeTab: "pdf", requestedPage: 7 },
  )
})

test("non-positive citation pages are rejected", () => {
  assert.throws(() => nextCitationNavigationState({ activeTab: "chat", requestedPage: null }, 0))
})

test("citation component exposes page context and delegates one page number", () => {
  const source = read("components/research-reports/report-citation.tsx")
  assert.match(source, /aria-label=.*Trang|aria-label=.*page/i)
  assert.match(source, /onNavigate\(page\)/)
})
```

- [ ] **Step 2: Run RED evidence**

```bash
node --test tests/research-reports/detail-navigation.test.ts
```

Expected: FAIL because navigation/citation files do not exist.

- [ ] **Step 3: Implement exact pure navigation helper**

```ts
export function nextCitationNavigationState(current: CitationNavigationState, page: number) {
  if (!Number.isInteger(page) || page < 1) throw new Error("Invalid citation page")
  return { ...current, activeTab: "pdf" as const, requestedPage: page }
}
```

- [ ] **Step 4: Implement accessible shared citation button**

The component renders `Trang {page}`, sets `aria-label={`Mở trang ${page} của báo cáo`}`, forwards optional excerpt through a non-hidden title/description only when present, and calls only `onNavigate(page)` on activation.

- [ ] **Step 5: Run GREEN evidence**

```bash
node --test tests/research-reports/detail-navigation.test.ts
pnpm typecheck
```

Expected: PASS with no imports from not-yet-created viewer/analysis/chat components.

- [ ] **Step 6: Commit Task 3**

```bash
git add components/research-reports/report-detail-navigation.ts components/research-reports/report-citation.tsx tests/research-reports/detail-navigation.test.ts
git commit -m "feat(qeo-84): add report citation navigation primitives"
```

---

### Task 4: Single-page PDF.js viewer with deterministic worker setup

**Files:**
- Create: `components/research-reports/pdf-viewer.tsx`
- Create: `tests/research-reports/pdf-viewer.test.ts`

**Interfaces:**
- Consumes: authenticated PDF source `/api/research-reports/${reportId}/pdf` and a requested citation page.
- Produces:

```ts
export function clampPdfPage(page: number, pageCount: number): number
export function clampPdfZoom(zoom: number): number

export function PdfViewer(props: {
  reportId: string
  title: string
  requestedPage: number | null
  originalSourceLink: string | null
  onPageResolved?: (page: number) => void
}): React.ReactNode
```

- [ ] **Step 1: Write PDF viewer tests RED**

Required pure tests:

```ts
assert.equal(clampPdfPage(0, 12), 1)
assert.equal(clampPdfPage(99, 12), 12)
assert.equal(clampPdfPage(7, 12), 7)
assert.equal(clampPdfZoom(0.1), 0.5)
assert.equal(clampPdfZoom(4), 2.5)
```

Required source/build contracts:

```ts
const source = read("components/research-reports/pdf-viewer.tsx")
assert.match(source, /pdfjs-dist/)
assert.match(source, /getDocument/)
assert.match(source, /getPage\(currentPage\)|getPage\(page/)
assert.match(source, /render\(/)
assert.match(source, /renderTask.*cancel|cancel\(\)/)
assert.doesNotMatch(source, /cdnjs|unpkg|jsdelivr/i)
assert.doesNotMatch(source, /Array\.from\([^\n]*pageCount[\s\S]*<canvas|map\([^\n]*pageCount[\s\S]*<canvas/)
assert.match(source, /aria-label=.*previous|aria-label=.*trước/i)
assert.match(source, /aria-label=.*next|aria-label=.*sau/i)
assert.match(source, /aria-label=.*zoom/i)
```

- [ ] **Step 2: Run RED evidence**

```bash
node --test tests/research-reports/pdf-viewer.test.ts
```

Expected: FAIL because `pdf-viewer.tsx` does not exist.

- [ ] **Step 3: Implement deterministic local PDF.js worker setup**

At module scope in the client component:

```ts
import { GlobalWorkerOptions, getDocument } from "pdfjs-dist"

GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString()
```

Do not use a remote CDN worker. `pnpm build` in Step 6 is the required proof that Next.js 16 resolves this package worker path correctly.

- [ ] **Step 4: Implement one-document/one-canvas render lifecycle**

Load only the authenticated report endpoint:

```ts
const loadingTask = getDocument({
  url: `/api/research-reports/${encodeURIComponent(reportId)}/pdf`,
})
```

Keep one canvas ref. For the active page:

```ts
const page = await document.getPage(currentPage)
const viewport = page.getViewport({ scale: zoom })
const canvas = canvasRef.current
const context = canvas?.getContext("2d")
if (!canvas || !context) return
canvas.width = Math.ceil(viewport.width)
canvas.height = Math.ceil(viewport.height)
const renderTask = page.render({ canvasContext: context, viewport })
await renderTask.promise
```

Store the active render task in a ref and call `renderTask.cancel()` before replacing it/unmounting. Guard stale async document/page work with a monotonically increasing generation ref. Call loading/document destroy methods on unmount. Never map over `pageCount` to create canvases.

- [ ] **Step 5: Implement controls and pending citation behavior**

Controls include previous, next, page number input, current/total display, zoom out/in/reset, and original source link when non-null. Zoom range is `0.5..2.5`; reset is `1`. Before metadata is ready retain `requestedPage`; when `pageCount` becomes known, apply `clampPdfPage(requestedPage, pageCount)` and call `onPageResolved`.

- [ ] **Step 6: Run GREEN + production worker evidence**

```bash
node --test tests/research-reports/pdf-viewer.test.ts tests/research-reports/detail-navigation.test.ts
pnpm typecheck
pnpm build
```

Expected: all PASS; production build reports no missing worker asset, import resolution error, or browser-global SSR compilation error. If this exact local worker expression fails, use `superpowers:systematic-debugging` before changing worker strategy; do not switch to a CDN workaround.

- [ ] **Step 7: Commit Task 4**

```bash
git add components/research-reports/pdf-viewer.tsx tests/research-reports/pdf-viewer.test.ts
git commit -m "feat(qeo-84): add lazy research report pdf viewer"
```

---

### Task 5: Persisted analysis and ticker source-opinion UI

**Files:**
- Create: `components/research-reports/analysis-panel.tsx`
- Create: `components/research-reports/ticker-mention-card.tsx`
- Create: `tests/research-reports/detail-analysis-ui.test.ts`

**Interfaces:**
- Consumes: `ResearchReportDetailAnalysis`, lifecycle status, and `onNavigateCitation(page)` from Tasks 1/3.
- Produces:

```ts
export function AnalysisPanel(props: {
  analysisStatus: ResearchReportDetailStatus
  analysis: ResearchReportDetailAnalysis | null
  onNavigateCitation: (page: number) => void
}): React.ReactNode

export function TickerMentionCard(props: {
  mention: ResearchReportDetailTickerMention
  onNavigateCitation: (page: number) => void
}): React.ReactNode
```

- [ ] **Step 1: Write analysis/ticker UI contracts RED**

```ts
const analysis = read("components/research-reports/analysis-panel.tsx")
const ticker = read("components/research-reports/ticker-mention-card.tsx")

assert.match(analysis, /executiveSummary/)
assert.match(analysis, /keyPoints/)
assert.match(analysis, /marketView/)
assert.match(analysis, /sectorOutlook/)
assert.match(analysis, /catalysts/)
assert.match(analysis, /risks/)
assert.match(analysis, /needs_ocr|OCR/i)
assert.match(analysis, /unsupported/i)
assert.match(ticker, /Quan điểm từ báo cáo/)
assert.match(ticker, /recommendationText/)
assert.match(ticker, /targetPrice/)
assert.match(ticker, /ReportCitation/)
assert.match(ticker, /onNavigateCitation/)
```

Add a source contract that optional recommendation/target values are guarded by null checks and are never rendered as synthetic `0`, `N/A`, or invented currency.

- [ ] **Step 2: Run RED evidence**

```bash
node --test tests/research-reports/detail-analysis-ui.test.ts
```

Expected: FAIL because analysis/ticker components do not exist.

- [ ] **Step 3: Implement persisted-only analysis presentation**

Render sections conditionally. The component never calls an AI provider/API. Lifecycle mapping:

```ts
if (analysisStatus === "pending") return <AnalysisState>Đang xử lý phân tích…</AnalysisState>
if (analysisStatus === "needs_ocr") return <AnalysisState>Báo cáo cần OCR trước khi có thể phân tích.</AnalysisState>
if (analysisStatus === "unsupported") return <AnalysisState>Định dạng PDF hiện chưa được hỗ trợ để phân tích.</AnalysisState>
if (analysisStatus === "failed") return <AnalysisState>Phân tích AI hiện chưa khả dụng.</AnalysisState>
if (!analysis) return <AnalysisState>Chưa có phân tích hiện hành cho phiên bản báo cáo này.</AnalysisState>
```

Ticker values appear under the visible label `Quan điểm từ báo cáo`; every evidence chip uses `ReportCitation`.

- [ ] **Step 4: Run GREEN evidence**

```bash
node --test tests/research-reports/detail-analysis-ui.test.ts tests/research-reports/detail-navigation.test.ts
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit Task 5**

```bash
git add components/research-reports/analysis-panel.tsx components/research-reports/ticker-mention-card.tsx tests/research-reports/detail-analysis-ui.test.ts
git commit -m "feat(qeo-84): render research report analysis evidence"
```

---

### Task 6: Bounded grounded report chat UI

**Files:**
- Create: `components/research-reports/report-chat.tsx`
- Create: `tests/research-reports/detail-chat-ui.test.ts`

**Interfaces:**
- Consumes: existing QEO-82 route and result contract:

```ts
type ResearchReportQaResult = {
  reportId: string
  status: "answered" | "not_found"
  answer: string
  citations: Array<{ page: number; chunkId: string; excerpt: string }>
  audit: unknown | null
}
```

- Produces:

```ts
export function boundChatHistory(
  turns: readonly { role: "user" | "assistant"; content: string }[],
): Array<{ role: "user" | "assistant"; content: string }>

export function ReportChat(props: {
  reportId: string
  analysisStatus: ResearchReportDetailStatus
  onNavigateCitation: (page: number) => void
}): React.ReactNode
```

- [ ] **Step 1: Write chat tests RED**

```ts
test("history sent to backend never exceeds six turns or 1200 chars per turn", () => {
  const bounded = boundChatHistory(makeHistory(10, 2000))
  assert.ok(bounded.length <= 6)
  assert.ok(bounded.every((turn) => turn.content.length <= 1200))
})

const source = read("components/research-reports/report-chat.tsx")
assert.match(source, /\/api\/research-reports\/.*\/chat/)
assert.match(source, /method:\s*["']POST["']/)
assert.match(source, /question/)
assert.match(source, /history/)
assert.match(source, /Không tìm thấy thông tin này trong báo cáo\./)
assert.match(source, /ReportCitation/)
assert.match(source, /onNavigateCitation/)
assert.match(source, /submitting|isSubmitting/)
```

Also assert source/pure-state contracts for one in-flight request, preserving prior successful messages on failure, a dedicated `report_not_ready` message, a temporary-unavailable 502/provider message, and zero citation rendering for `not_found`.

- [ ] **Step 2: Run RED evidence**

```bash
node --test tests/research-reports/detail-chat-ui.test.ts
```

Expected: FAIL because the chat component does not exist.

- [ ] **Step 3: Implement bounded client history**

```ts
export function boundChatHistory(turns: readonly ChatTurn[]) {
  return turns
    .map((turn) => ({ ...turn, content: turn.content.replace(/\s+/g, " ").trim().slice(0, 1_200) }))
    .filter((turn) => turn.content.length > 0)
    .slice(-6)
}
```

- [ ] **Step 4: Implement request lifecycle without destructive failure**

Submit exactly:

```ts
const response = await fetch(`/api/research-reports/${encodeURIComponent(reportId)}/chat`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ question, history: boundChatHistory(history) }),
})
```

Disable submit while in flight. On success append the answer while retaining prior turns. On network/provider failure keep existing turns and render a local error message. For `status === "not_found"`, render exactly `Không tìm thấy thông tin này trong báo cáo.` and no citations. For answered results render returned citations with `ReportCitation`.

- [ ] **Step 5: Run GREEN evidence**

```bash
node --test tests/research-reports/detail-chat-ui.test.ts tests/research-reports/qa-api.test.ts tests/research-reports/qa-service.test.ts
pnpm typecheck
```

Expected: PASS; existing QEO-82 API/service contracts remain unchanged.

- [ ] **Step 6: Commit Task 6**

```bash
git add components/research-reports/report-chat.tsx tests/research-reports/detail-chat-ui.test.ts
git commit -m "feat(qeo-84): add grounded research report chat ui"
```

---

### Task 7: Server detail route, responsive client shell, loading state, and accessibility

**Files:**
- Create: `components/research-reports/report-detail-shell.tsx`
- Create: `app/research/reports/[id]/page.tsx`
- Create: `app/research/reports/[id]/loading.tsx`
- Create: `tests/research-reports/detail-page.test.ts`

**Interfaces:**
- Consumes: `getServerAuthContext()`, `getResearchReportDetail()`, `nextCitationNavigationState()`, `PdfViewer`, `AnalysisPanel`, and `ReportChat` from Tasks 1, 3, 4, 5, and 6.
- Produces: complete `/research/reports/[id]` page and the single owner of interactive citation navigation.

- [ ] **Step 1: Write page/shell/accessibility contracts RED**

```ts
const page = read("app/research/reports/[id]/page.tsx")
const shell = read("components/research-reports/report-detail-shell.tsx")
const loading = read("app/research/reports/[id]/loading.tsx")

assert.match(page, /getServerAuthContext/)
assert.match(page, /getResearchReportDetail/)
assert.match(page, /notFound\(/)
assert.match(page, /ReportDetailShell/)
assert.doesNotMatch(page, /pdf_url|source_payload|market_research_report_chunks/)
assert.match(shell, /nextCitationNavigationState/)
assert.match(shell, /PdfViewer/)
assert.match(shell, /AnalysisPanel/)
assert.match(shell, /ReportChat/)
assert.match(shell, /lg:grid|lg:grid-cols/)
assert.match(shell, /role=["']tablist["']|aria-selected|aria-controls/)
assert.match(shell, /PDF/)
assert.match(shell, /Phân tích/)
assert.match(shell, /Hỏi báo cáo/)
assert.match(shell, /tabIndex=\{-1\}/)
assert.match(loading, /animate-pulse|skeleton/i)
```

Also assert report header metadata, lifecycle badge, external source link `target="_blank"` + `rel="noreferrer noopener"`, and separate PDF/analysis/chat containers.

- [ ] **Step 2: Run RED evidence**

```bash
node --test tests/research-reports/detail-page.test.ts
```

Expected: FAIL because page/shell/loading files do not exist.

- [ ] **Step 3: Implement authenticated server page data flow**

Use the existing cached auth context rather than a second auth mechanism:

```ts
export default async function ResearchReportDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const auth = await getServerAuthContext()
  if (!auth) return null

  const { id } = await params
  const result = await getResearchReportDetail(
    auth.supabase as unknown as Parameters<typeof getResearchReportDetail>[0],
    id,
  )
  if (result.status === "invalid_id" || result.status === "not_found") notFound()

  return <ReportDetailShell report={result.report} />
}
```

The parent `/research/layout.tsx` remains responsible for rendering `LandingLogin` when auth is absent. The page never calls PDF/chat/AI processing during server render.

- [ ] **Step 4: Implement the single-owner citation shell**

Initialize:

```ts
const [navigation, setNavigation] = useState<CitationNavigationState>({
  activeTab: "pdf",
  requestedPage: null,
})
```

All citation surfaces receive one callback:

```ts
const navigateToCitation = (page: number) => {
  setNavigation((current) => nextCitationNavigationState(current, page))
}
```

After `activeTab` becomes `pdf` with a non-null requested page, focus the viewer region through a `tabIndex={-1}` ref in an effect. Do not trap focus or auto-focus on ordinary page load.

- [ ] **Step 5: Implement desktop/mobile composition**

Desktop uses a large-breakpoint split such as `lg:grid lg:grid-cols-[minmax(0,3fr)_minmax(320px,2fr)]`. Mobile/tablet renders one active tab panel with accessible tab buttons for exactly `PDF`, `Phân tích`, and `Hỏi báo cáo`; only one `PdfViewer` instance exists.

Pass:

```tsx
<PdfViewer
  reportId={report.id}
  title={report.title}
  requestedPage={navigation.requestedPage}
  originalSourceLink={report.originalSourceLink}
/>
<AnalysisPanel
  analysisStatus={report.analysisStatus}
  analysis={report.analysis}
  onNavigateCitation={navigateToCitation}
/>
<ReportChat
  reportId={report.id}
  analysisStatus={report.analysisStatus}
  onNavigateCitation={navigateToCitation}
/>
```

- [ ] **Step 6: Implement independent loading/error surfaces**

PDF owns its fetch/render state; analysis panel owns lifecycle state; chat owns request/provider state. `loading.tsx` is only a route skeleton and never fabricates metadata. A PDF error leaves analysis/chat mounted; chat failure leaves the PDF current page and analysis unchanged.

- [ ] **Step 7: Run GREEN evidence**

```bash
node --test \
  tests/research-reports/detail-page.test.ts \
  tests/research-reports/detail-navigation.test.ts \
  tests/research-reports/pdf-viewer.test.ts \
  tests/research-reports/detail-analysis-ui.test.ts \
  tests/research-reports/detail-chat-ui.test.ts
pnpm typecheck
pnpm build
```

Expected: PASS.

- [ ] **Step 8: Commit Task 7**

```bash
git add app/research/reports/[id] components/research-reports/report-detail-shell.tsx tests/research-reports/detail-page.test.ts
git commit -m "feat(qeo-84): add research report detail page"
```

---

### Task 8: Canonical test registration, documentation, full regression, PR, and fresh integration gates

**Files:**
- Modify: `tests/ai-council-llm-reliability.test.ts`
- Modify: `modules/research-reports/README.md`
- Verify unchanged: `tests/test-contracts.json`
- Verify all QEO-84 files from Tasks 1–7.

**Interfaces:**
- Consumes: all prior tasks.
- Produces: repository-visible QEO-84 contract coverage, documentation, clean PR head, and fresh merge evidence.

- [ ] **Step 1: Register nested tests through the existing canonical wrapper**

Append alongside existing QEO-81/QEO-82 nested imports:

```ts
import "./research-reports/detail-service.test.ts"
import "./research-reports/pdf-api.test.ts"
import "./research-reports/detail-navigation.test.ts"
import "./research-reports/pdf-viewer.test.ts"
import "./research-reports/detail-analysis-ui.test.ts"
import "./research-reports/detail-chat-ui.test.ts"
import "./research-reports/detail-page.test.ts"
```

Do not edit `tests/test-contracts.json`.

- [ ] **Step 2: Update research-report ownership README**

Add these boundaries:

```md
- Detail UI reads only browser-safe metadata/current persisted analysis/ticker evidence; it does not expose raw `pdf_url` or chunks.
- PDF bytes are served only through authenticated `GET /api/research-reports/[id]/pdf`, which resolves the stored URL server-side and reuses the existing secure PDF fetch policy.
- Analysis, ticker, and Q&A citations share one page-navigation contract into the single-page PDF.js viewer.
- Detail-page load never triggers AI analysis or Q&A, and chat remains request-scoped/non-persistent.
```

- [ ] **Step 3: Run focused QEO-84 + QEO-81/QEO-82 regression**

```bash
node --test \
  tests/research-reports/detail-service.test.ts \
  tests/research-reports/pdf-api.test.ts \
  tests/research-reports/detail-navigation.test.ts \
  tests/research-reports/pdf-viewer.test.ts \
  tests/research-reports/detail-analysis-ui.test.ts \
  tests/research-reports/detail-chat-ui.test.ts \
  tests/research-reports/detail-page.test.ts \
  tests/research-reports/pdf-ingestion.test.ts \
  tests/research-reports/storage.test.ts \
  tests/research-reports/qa-api.test.ts \
  tests/research-reports/qa-service.test.ts \
  tests/research-reports/qa-retrieval.test.ts
```

Expected: PASS.

- [ ] **Step 4: Run repository pre-PR gates**

```bash
pnpm test:manifest
pnpm test:repo-hygiene
pnpm test:current
pnpm lint:touched
pnpm typecheck
pnpm build
```

Expected: PASS with zero lint errors.

- [ ] **Step 5: Commit documentation/test registration**

```bash
git add tests/ai-council-llm-reliability.test.ts modules/research-reports/README.md
git commit -m "test(qeo-84): register report detail contracts"
```

- [ ] **Step 6: Inspect exact diff against fresh main before PR**

```bash
git fetch origin main
git diff --stat origin/main...HEAD
git diff origin/main...HEAD -- \
  app/research/reports \
  app/api/research-reports \
  components/research-reports \
  modules/research-reports \
  tests/research-reports \
  tests/ai-council-llm-reliability.test.ts \
  docs/superpowers/specs/2026-09-05-qeo-84-research-report-detail-ui-design.md \
  docs/superpowers/plans/2026-09-05-qeo-84-research-report-detail-ui.md
```

Expected: no unrelated QEO-83 catalog work, no schema migration, no secrets, no arbitrary PDF URL input, and no raw provider/PDF URL in browser-facing types.

If `main` advanced, rebase/synthetic-rebase QEO-84 onto fresh main before using any CI result as merge evidence.

- [ ] **Step 7: Open/update QEO-84 PR and record exact head**

PR title:

```text
QEO-84: research report detail PDF, analysis and cited chat UI
```

PR body lists:

```md
- browser-safe exact-current analysis detail service
- authenticated stored-report PDF proxy reusing QEO-81 SSRF/allowlist guards
- single-page PDF.js viewer with shared citation navigation
- persisted analysis/ticker source-opinion UI
- bounded QEO-82 grounded chat UI
- responsive/accessibility and independent failure-state contracts
```

Record the exact PR head SHA after the final branch update.

- [ ] **Step 8: Require fresh GitHub Actions on the exact final PR head**

Require:

```text
Verify -> success
DB Drift Reconciliation -> success
```

DB Drift must show success for reviewed migration ledger, local Supabase startup, replay migrations from zero, generated Database types parity, current DB contracts, and TypeScript compile. Do not merge while either workflow is queued, in progress, stale, unexpectedly skipped, or green only on an older SHA.

- [ ] **Step 9: Merge only after fresh green evidence and verify main**

Use the repository's current squash-merge convention with an expected-head guard. After merge, fetch `main` and verify its new head/tree contains final QEO-84 changes. Update Linear QEO-84 to Done only after merge confirmation.

- [ ] **Step 10: Final completion report**

Report exact evidence:

```text
QEO-84 PR: <number>
Final verified head: <sha>
Verify: success
DB Drift Reconciliation: success
Merged main: <sha>
Linear QEO-84: Done
```

Do not claim production deployment unless an actual deployment was requested and independently verified.
