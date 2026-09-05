# QEO-84 Research Report Detail UI Design

## 1. Scope

QEO-84 adds the authenticated research-report detail experience at `/research/reports/[id]`. The page combines a secure PDF reader, the latest persisted structured AI analysis from QEO-81, ticker-level source opinions with page evidence, and grounded single-report Q&A from QEO-82.

The feature must let a user move from an AI claim to the original report page with one interaction while keeping PDF, analysis, and Q&A failures isolated from one another.

QEO-83 catalog is not required for implementation. Its later integration contract is only that a report card links to `/research/reports/${id}`. The end-to-end catalog-to-detail flow can be exercised when QEO-83 exists and again in QEO-87.

Out of scope: cross-report chat, persistent chat history, OCR implementation, embeddings/vector search, report annotation persistence, AI Council integration, arbitrary PDF URL fetching, and unrelated Research Hub refactors.

## 2. Existing contracts to preserve

The implementation builds on the already-merged research-report module:

- `market_research_reports` owns provider metadata and lifecycle status.
- `market_research_report_analyses` owns versioned persisted structured analysis.
- `market_research_report_ticker_mentions` owns ticker stance/recommendation/target-price evidence tied to an analysis.
- `market_research_report_chunks` owns page-aware evidence chunks.
- QEO-81 already provides secure PDF fetching with HTTPS-only, host allowlisting, DNS/public-IP validation, redirect limits, timeout limits, response-size limits, and PDF validation.
- QEO-82 already provides authenticated single-report Q&A at `POST /api/research-reports/[id]/chat`, bounded request-scoped history, exact report/content/chunk identity, lexical retrieval, fail-closed evidence validation, citations, and explicit `answered` / `not_found` results.
- Broker recommendations, stance, and target prices remain source opinions. They must not be presented as verified company facts.

No UI code may bypass these boundaries by reading provider internals or accepting a raw remote PDF URL from the browser.

## 3. Route and ownership

### Page route

`app/research/reports/[id]/page.tsx`

The page is server-rendered inside the existing authenticated `/research` layout. It validates the route UUID, resolves the report detail view-model through a stable `modules/research-reports/detail` service, and passes only browser-safe data to the interactive client shell.

### PDF API

`GET /api/research-reports/[id]/pdf`

The browser supplies only the report UUID. The route:

1. authenticates the `research` feature;
2. validates the UUID;
3. looks up the stored report and stored `pdf_url` server-side;
4. calls the existing QEO-81 secure PDF fetch boundary;
5. returns PDF bytes with `Content-Type: application/pdf`, private/no-store caching, and a safe filename/content-disposition policy;
6. returns sanitized public errors without exposing provider URL, credentials, private network details, or upstream error bodies.

This endpoint is deliberately not a generic proxy and has no URL query/body parameter.

### Detail module

Create `modules/research-reports/detail/` with focused files:

- `types.ts` — public browser-safe view-model types.
- `repository.ts` — report/latest-analysis/ticker-mention data access.
- `service.ts` — validation, status mapping, normalization, and view-model projection.

Cross-domain consumers import only the detail service/public types from the research-report module entrypoint. React components do not contain Supabase query logic.

## 4. Detail data model

The server view-model contains only fields required by the page:

### Report metadata

- `id`
- `title`
- `sourceName`
- `publishDate`
- `category`
- `sectorName`
- `originalSourceLink` when present
- `parsedPageCount`
- `ingestionStatus`
- `analysisStatus`

The raw stored `pdf_url` is never included in the browser view-model.

### Latest current analysis

For a ready report, resolve the newest persisted analysis that matches the report's current `content_hash`. A stale analysis for an older PDF hash must never be shown as current.

Expose:

- `analysisId`
- `executiveSummary`
- `keyPoints`
- `marketView`
- `sectorOutlook`
- `catalysts`
- `risks`
- `processedAt`
- `modelActual` or requested model fallback when needed for small metadata display
- `confidence`

### Ticker mentions

Only ticker mentions tied to the selected current analysis are returned. Each mention includes:

- ticker
- stance
- recommendation text
- target price and currency
- rationale
- validated page evidence (`page`, `snippet`)

The UI labels recommendation/target/stance as report or broker opinion rather than verified fact.

## 5. PDF viewer architecture

Use the already-installed `pdfjs-dist` directly behind a small viewer abstraction instead of adding `react-pdf` for the MVP.

The client viewer receives only `/api/research-reports/${id}/pdf` as its document source.

### Rendering policy

- Render the current page only.
- Optionally preload metadata and one adjacent page without mounting canvases for the full document.
- A page change disposes obsolete render tasks/canvas work before starting the next render.
- Viewer state keeps `currentPage`, `pageCount`, and bounded `zoom`.
- Controls: previous, next, page indicator/input, zoom out, zoom in, reset/fit default, and open original source.
- If citation navigation requests page N before PDF metadata is ready, store the requested page and apply it once page count is known.
- Clamp all requested pages to `1..pageCount` once metadata exists.

This single-page strategy satisfies the MVP requirement not to render every page up front and avoids a second virtualization dependency.

### PDF.js worker

Worker configuration must be deterministic for the Next.js production build. The implementation plan must include a production-build test for the chosen worker asset/import approach so local-only worker behavior cannot pass unnoticed.

## 6. Shared citation navigation

`report-detail-shell.tsx` owns the browser interaction state shared by PDF, analysis, ticker cards, and chat.

A single callback such as `navigateToCitation(page, sourceElement?)` is passed to every citation surface. It:

1. switches the mobile view to PDF when needed;
2. updates the requested/current PDF page;
3. focuses the PDF viewer region after navigation without trapping focus;
4. preserves enough source context for keyboard users to return naturally through normal tab order.

Analysis citations, ticker evidence, and Q&A citations all use the same citation component and page-navigation contract. No panel implements independent page-jump logic.

## 7. Page layout and responsive behavior

### Header

The detail header displays:

- report title;
- broker/source;
- publish date;
- category/sector;
- report lifecycle badge;
- original-source action when stored metadata includes a safe source link.

### Desktop

At large breakpoints use a split layout approximately 60–65% PDF and 35–40% analysis/chat. Both columns can scroll within the page without making the right panel unusably narrow.

The right side contains:

1. AI analysis summary;
2. key points;
3. market/sector outlook when present;
4. catalysts and risks when present;
5. ticker mention cards;
6. grounded Q&A.

### Mobile/tablet

Use explicit tabs/views: `PDF`, `Phân tích`, `Hỏi báo cáo`. Only the active heavy PDF viewer is mounted/rendered as needed; the mobile layout must not create all PDF pages or duplicate the PDF document renderer.

Citation click from Analysis or Q&A changes the active tab to PDF and navigates to the cited page.

## 8. Analysis presentation

The AI panel renders persisted analysis only; opening the page does not trigger a new analysis request.

Metadata such as model and processed timestamp is secondary text and must not dominate the report content.

Ticker cards show stance and source-opinion values with a visible semantic label such as `Quan điểm từ báo cáo`. The wording should prevent a target price or recommendation from being mistaken for QeoIndex's verified recommendation.

Evidence chips use concise labels such as `Trang 7` and include an accessible label describing that activation opens the cited report page.

## 9. Chat behavior

Reuse the QEO-82 endpoint unchanged unless a narrow compatibility fix is required.

Client history is request-scoped and bounded to the backend contract. The client sends only recent normalized user/assistant turns; no chat persistence is introduced.

### States

- idle
- submitting
- answered
- not found
- report not ready
- temporarily unavailable/provider degraded

For `status: "not_found"`, show the canonical meaning clearly: `Không tìm thấy thông tin này trong báo cáo.` and no fake citations.

Answered results render the answer and returned citations. Citation activation uses the shared page-navigation callback.

A chat failure does not clear existing successful answers, PDF state, or analysis state. Submitting is disabled while one request is in flight to avoid accidental duplicate provider calls.

## 10. Independent failure and lifecycle states

The page must remain useful when only one subsystem fails.

### PDF failure

Show a localized warning in the PDF area. Keep report metadata, persisted AI analysis, ticker evidence, Q&A availability where valid, and original source action.

### Analysis pending/processing

Show metadata and PDF normally with an explicit analysis-pending state. Chat should map backend `report_not_ready` to a non-destructive state rather than a generic fatal page error.

### `needs_ocr` / unsupported

Show the lifecycle status explicitly. Do not imply that missing AI output is an AI failure when the PDF is image-only or unsupported.

### Analysis failed

Show PDF and metadata. Display a sanitized analysis failure state without persisted provider/internal error text.

### Missing report

A valid UUID with no report resolves to the Next.js not-found path. Invalid UUIDs are treated as invalid route input without querying arbitrary identifiers.

## 11. Authentication and security

- `/research` layout continues to require a logged-in user.
- PDF and chat APIs additionally enforce the `research` feature gate.
- Detail data access uses authenticated/read-safe repository boundaries consistent with existing RLS policies.
- Browser code never receives `SUPABASE_SERVICE_ROLE_KEY`, provider credentials, or arbitrary stored provider payload.
- Browser code never chooses a PDF URL.
- PDF proxy reuses the existing allowlist/SSRF-safe fetch policy; no weaker second fetch implementation is introduced.
- Public API errors are sanitized and do not echo upstream response bodies, stored URLs, DNS results, or secrets.
- Original source links come only from stored provider metadata and are rendered as navigation links, never fetched server-side merely because the browser supplied a value.

## 12. Accessibility

Minimum accessibility contract:

- all viewer controls have text or `aria-label` names;
- page number input has a visible/accessible label and validation semantics;
- zoom/navigation buttons are keyboard operable;
- mobile tabs use proper tab semantics or equivalent accessible controls;
- citation chips are buttons/links with page context in their accessible name;
- viewer focus target is programmatically focusable without trapping focus;
- loading and error states are readable text, not color-only indicators;
- stance/status color is accompanied by text;
- focus-visible styles follow existing app conventions.

## 13. Performance

- Do not load PDF bytes during the server detail metadata query.
- Do not include chunks or full report text in the detail page payload.
- Do not run AI analysis or Q&A on page load.
- Do not render all PDF pages at once.
- Reuse the current `pdfjs-dist` dependency; add no viewer dependency unless implementation evidence shows a blocker.
- Keep client components limited to interaction-heavy surfaces. Metadata/data projection remains server-side.

## 14. Testing strategy

Implementation follows TDD and adds focused contracts before production code.

### Detail service tests

- valid report metadata projection;
- current `content_hash` selects only a matching latest analysis;
- stale analysis is not shown;
- ticker mentions belong to the selected analysis only;
- raw `pdf_url` and provider payload are absent from browser view-model;
- pending/failed/needs-OCR/unsupported status mapping.

### PDF API/security tests

- malformed report UUID rejected;
- missing report handled safely;
- feature authentication enforced;
- route resolves stored PDF URL server-side;
- request cannot provide/override a URL;
- secure fetch boundary is reused;
- response headers/type are correct;
- upstream errors are sanitized.

### PDF viewer/UI tests

- fixture PDF loads and reports page count;
- initial render mounts only the current page canvas, not every page;
- next/previous/page input/zoom controls update state correctly;
- citation navigation jumps to the correct page;
- pending citation before PDF load is applied after metadata resolves;
- mobile citation switches to PDF view;
- keyboard labels/focus semantics exist.

### Analysis/ticker tests

- persisted summary/key points/outlook/catalysts/risks render conditionally;
- ticker stance, recommendation, target, and page evidence render;
- source-opinion label is present;
- citation click delegates to the shared navigator.

### Chat tests

- request uses the existing QEO-82 API shape;
- history remains within the backend limit;
- answered citations render and navigate;
- `not_found` renders the explicit no-evidence state;
- provider/report-not-ready failures remain isolated from PDF/analysis state;
- duplicate submit is prevented while in flight.

### Final verification

Before merge, run fresh repository `Verify` and `DB Drift Reconciliation` on the exact final PR head. Previous QEO-81/QEO-82 green runs are not evidence for QEO-84.

## 15. Expected implementation boundaries

Expected new/changed areas:

- `app/research/reports/[id]/page.tsx`
- `app/research/reports/[id]/loading.tsx`
- `app/api/research-reports/[id]/pdf/route.ts`
- `components/research-reports/report-detail-shell.tsx`
- `components/research-reports/pdf-viewer.tsx`
- `components/research-reports/analysis-panel.tsx`
- `components/research-reports/ticker-mention-card.tsx`
- `components/research-reports/report-chat.tsx`
- `components/research-reports/report-citation.tsx`
- `modules/research-reports/detail/types.ts`
- `modules/research-reports/detail/repository.ts`
- `modules/research-reports/detail/service.ts`
- `modules/research-reports/index.ts` for stable exports
- focused tests under `tests/research-reports/`

Changes outside these boundaries require an explicit reason tied to QEO-84. No schema migration is expected unless implementation discovers a demonstrable missing persisted field that cannot be derived safely from the current QEO-81/QEO-82 schema; such a discovery requires stopping and revising the design before adding a migration.

## 16. Acceptance mapping

QEO-84 is complete when:

- `/research/reports/[id]` displays correct report metadata for a stored report;
- fixture PDF is readable without rendering every page up front;
- analysis/ticker/chat citations navigate to the exact PDF page;
- ticker stance/recommendation/target values carry report-source-opinion semantics;
- chat answered and no-evidence states match QEO-82 contracts;
- PDF, analysis, and Q&A loading/error states are independent;
- mobile and desktop layouts remain usable;
- raw/arbitrary PDF URL fetching is impossible from browser input;
- basic keyboard/accessibility contracts pass;
- QEO-81 and QEO-82 contracts remain green;
- fresh Verify and DB Drift Reconciliation succeed on the exact final PR head.
