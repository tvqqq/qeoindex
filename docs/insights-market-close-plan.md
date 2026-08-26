# Market-close Insights research and delivery plan

Status: research complete; implementation has not started.

This proposal adds a compact end-of-day market-intelligence surface to `/insights`. It intentionally does not collect a realtime intraday series from the reference dashboard. The target is one verified post-close snapshot on trading days, published only when the complete snapshot passes validation.

## Product boundary

- Audience: every authenticated QeoIndex user under the existing `/insights` auth boundary.
- Primary question: “After the close, what changed in the market, where did participation concentrate, and what needs attention next?”
- Product-facing naming: use only QeoIndex-neutral Vietnamese labels. Do not expose the reference product name in headings, badges, route names, public API fields, database grants, analytics events, or empty/error copy.
- Provenance: retain exact connector and contract evidence in server-only audit records. The client sees freshness, completeness, and a neutral source class such as `Ảnh chụp cuối phiên` or `Dữ liệu thị trường`.
- Non-goals: trade execution, personalized allocation advice, copying provider-written commentary, recreating undisclosed scoring formulas, community posts, news feeds, assistant content, or a second realtime market board.
- Narrative policy: QeoIndex generates concise deterministic observations from published facts. It does not copy source commentary or turn a score into a buy/sell instruction.

## Research findings

### Information model worth preserving

The documentation and public application contract consistently organize the market in this reading order:

1. Index state and closing context.
2. Breadth and participation.
3. Liquidity and capital flow.
4. Market health, sentiment, and risk.
5. Sector leadership and rotation.
6. Index contributors and notable stocks.

This order is a better beginner path than starting with a stock ranking. It should become the default `/insights` reading path, with the existing stock rating experience remaining available as a separate local tab.

### End-of-day data inventory

| Domain | Fields to retain | Priority | Canonical presentation rule |
| --- | --- | --- | --- |
| Index close | VNINDEX, VN30, HNX, UPCOM value, absolute/% change, reference, open, high, low | P0 | QeoIndex market feed remains canonical for duplicated values |
| Market activity | matched volume, traded value, previous-session comparison | P0 | End-of-day totals only; no new intraday series |
| Breadth | advances, unchanged, declines, ceiling, floor, average/typical move | P0 | Show counts and denominator; never show a ratio without coverage |
| MA breadth | % of stocks above MA10, MA20, MA50, MA200 | P0 | 0-100 scale, exact as-of date, history only from real snapshots |
| Market health | trend label, sentiment score/label, risk score/label | P0 | Preserve observed values; do not reverse-engineer hidden formulas |
| Distribution | count and documented observation window | P0 | Context/risk observation, not an action command |
| Foreign/proprietary flow | buy, sell, net value and 20-session daily totals | P0 | Units normalized once; sign and actor always explicit |
| Sector snapshot | traded value, average change, advances/unchanged/declines, RS, rotation state | P0 | Full sector coverage; no top-500 stock shortcut |
| Effort/result | effort %, result %, breadth counts, 1D/5D/20D | P1 | Store source observation; QeoIndex may classify only with a public rule |
| Index impact | top positive/negative contributors and estimated point impact | P1 | Show `ước tính`; keep positive and negative lists balanced |
| Notable stocks | top volume, near 52-week high, accumulation, MA10 cross | P1 | Prefer QeoIndex-derived rules when formulas are public and tested |
| Rotation history | RS history and raw strength/momentum coordinates when available | P1 | Never invent coordinates from a categorical state |
| Market valuation | aggregate P/E and observation date | P2 | Separate from sentiment/risk; explain coverage and source class |
| Intraday source charts | time-series points during the session | Excluded | Existing QeoIndex five-minute chart remains independent |

### Public contract evidence and remaining discovery gate

The public dashboard bundle exposes these endpoint and socket candidates. They are evidence for planning, not an approved or stable API contract:

- `GET /api/stocks/market_pulse/getContent` with `version=v3`.
- `GET /api/stocks/dashboard/get-list-mack-market-volatility` with `type`, `board`, and `limit`.
- `GET /api/filter/top-stock` with `type`, `board`, and `limit`.
- `GET /api/stocks/dashboard/get-data-cash-flows` with `san`.
- `GET /api/foreign-trading` and `GET /api/stocks/dashboard/proprietary-trading` with `stockcode`.
- Socket events `getmarketpulse`, `getincreasesdecreasesnganh`, `getdataibdnganh`, `getforeignseriesbyindex`, and `getlive`.

Before collector code is written, capture one authenticated post-close Network trace and produce a scrubbed contract fixture. The trace must record method, host class, path, query/body shape, response schema, units, session date, pagination, and failure behavior. It must not retain cookies, bearer values, usernames, passwords, query-string tokens, or unrelated account data.

The discovery gate is complete only when:

- account/usage permission and operational limits have been reviewed;
- every retained field maps to an observed response path and unit;
- REST versus socket ownership is understood;
- a token-expiry/refresh path is proven without browser cookies;
- representative response fixtures are sanitized and safe to commit;
- fields that exist only as prose or images are excluded rather than scraped from DOM text.

## Source-of-truth policy

Do not make a new source authoritative for data QeoIndex already owns reliably.

| Data class | Primary truth | Role of the new connector |
| --- | --- | --- |
| Index OHLC, change, volume/value | Existing bounded QeoIndex market feeds and EOD store | Cross-check/fallback only |
| Basic breadth | Existing index/market feed when complete | Fill missing ceiling/floor or coverage metadata |
| Sentiment, risk, distribution count | Verified end-of-day connector snapshot | Primary observation with private provenance |
| MA breadth | Verified connector until QeoIndex computes and backtests its own | Primary observation |
| Sector RS/rotation/effort-result | Verified connector snapshot | Primary observation; no formula inference |
| Foreign/proprietary totals | Existing feed when coherent, otherwise verified connector | Store both privately when reconciling drift |
| Narrative | QeoIndex deterministic rules + Notion thesis where date-matched | Never import provider-written advice |

When duplicated observations disagree beyond an agreed tolerance, publish the canonical QeoIndex value, mark the snapshot `degraded`, and retain the mismatch in server-only telemetry. Never silently average incompatible values.

## Collection architecture

```text
15:15 ICT weekday EOD workflow
  -> acquire/refresh server-only connector token
  -> fetch bounded REST data + one bounded socket snapshot
  -> normalize units and session date
  -> stage under one run UUID
  -> reconcile duplicated market-feed fields
  -> validate completeness and freshness
  -> atomically publish all public tables
  -> build deterministic daily observations
  -> expose authenticated read model to /insights
```

### Scheduling

- Integrate as a `MARKET_CLOSE_COLLECT` phase immediately after the existing `EOD_READY` phase of `qeoindex.eod_pipeline`, scheduled at 15:15 ICT, rather than adding an overlapping cron. Add the phase to `QEOINDEX_EOD_PHASES` so Control Plane telemetry shows its real outcome.
- Run Monday-Friday only and confirm the session calendar before collection. A holiday produces `skipped_non_trading_day`, not a failed run.
- The phase is idempotent by `session_date`. A safe rerun replaces only the same staged run before atomic publication.
- If the source is not yet finalized at 15:15, retry with bounded backoff inside the workflow, for example 15:20 and 15:30, then fail closed. Do not poll throughout the day.
- The previous good snapshot remains readable when the current run is stale, partial, unauthorized, or contract-invalid.

### Connector security

- Server-side only. Never call the source from a browser component.
- Reuse the existing service-role token-cache pattern where possible, but expose no source-specific secret or raw token to the client.
- Use Edge Function/Vault secrets; never `NEXT_PUBLIC_*`.
- Set an 8-10 second timeout per request, bounded concurrency, a maximum response size, and a total workflow deadline.
- Redact authorization, cookies, query tokens, and raw URLs before logging. Log endpoint keys, not credential-bearing URLs.
- Do not persist a full raw payload indefinitely. Keep a checksum, schema version, counts, and sanitized diagnostics; clear staging after successful publication.

## Proposed data model

Names below are product-neutral and avoid a provider label.

### Private operational tables

`market_insight_sync_runs`

- `id`, `session_date`, `trigger`, `status`, `contract_version`.
- `started_at`, `source_observed_at`, `completed_at`.
- `endpoint_coverage`, `staged_counts`, `published_counts`.
- `payload_checksum`, `quality_status`, `sanitized_error_code`.
- Service-role only; no browser grant.

`market_insight_snapshot_staging`

- `run_id`, `category`, `entity_key`, `normalized_payload`, `observed_at`.
- Unique on `(run_id, category, entity_key)`.
- Service-role only and deleted after publish or retention expiry.

### Authenticated read tables

`market_insight_daily`

- One row per `session_date`.
- `market_regime`, `sentiment_score`, `sentiment_label`.
- `risk_score`, `risk_label`, `distribution_count`, `distribution_window`.
- `above_ma10_pct`, `above_ma20_pct`, `above_ma50_pct`, `above_ma200_pct`.
- `foreign_net_value`, `proprietary_net_value`, `other_flow_net_value` when observed.
- `quality_status`, `missing_fields`, `as_of`, `published_at`, `contract_version`.

`market_insight_indexes`

- Key `(session_date, index_code)` for VNINDEX, VN30, HNX, UPCOM.
- `value`, `change`, `change_pct`, `reference`, `open`, `high`, `low`.
- `matched_volume`, `traded_value`, `previous_value_change_pct`.
- `advances`, `unchanged`, `declines`, `ceilings`, `floors`, `market_pe`.
- `foreign_buy_value`, `foreign_sell_value`, `foreign_net_value` when available.

`market_insight_sectors`

- Key `(session_date, sector_key, window)` where `window` is `1d`, `5d`, or `20d` only when the source supports it.
- `display_name`, `traded_value`, `average_change_pct`.
- `advances`, `unchanged`, `declines`.
- `rs_score`, `rotation_state`.
- `strength_ratio` and `momentum_ratio` nullable; populate only from real coordinates.
- `effort_pct`, `result_pct`, `effort_result_state`.

`market_insight_leaders`

- Key `(session_date, category, rank, ticker)`.
- Categories: `index_up`, `index_down`, `top_volume`, `near_52w_high`, `accumulation`, `cross_ma10`, `foreign_buy`, `foreign_sell`.
- `value`, `change_pct`, `estimated_index_points`, `metric_value`, `as_of` as applicable.

All public tables use authenticated read-only RLS/column grants. Staging, sync lifecycle, connector identity, raw mappings, and mismatch diagnostics remain private.

## Validation and publication contract

A successful HTTP response is not publication evidence. The publisher must fail closed unless all required checks pass.

### Required checks

- `session_date` equals the expected Vietnam trading session and is not in the future.
- Four canonical index keys are present exactly once.
- Required market-health fields are finite and fresh after the close.
- Percent fields are in `[0, 100]`; risk values are normalized once from their observed source scale.
- Counts are non-negative integers and breadth components reconcile to a plausible denominator.
- Monetary values are non-negative except explicitly signed net-flow fields; units are normalized once.
- Sector keys are unique; coverage is at least an agreed percentage of the previous good snapshot, with required sectors separately allowlisted if needed.
- Rotation state belongs to `leading`, `recovering`, `weakening`, `lagging`, or `unknown` in storage; Vietnamese labels are presentation only.
- Raw strength/momentum coordinates stay null when absent.
- Leader lists contain valid uppercase tickers, unique ranks, and bounded length.
- Cross-source duplicated fields are within documented tolerance or the run is published as `degraded` with the canonical value.

### Atomic publish

Create a `publish_market_insight_snapshot(run_id)` transaction that locks the run, revalidates counts, replaces only that session's rows across all read tables, marks the run completed, and clears staging. A failure leaves the previous published date untouched.

## Deterministic market observations

Create a pure module such as `lib/market-insight-model.ts`. It produces 3-5 short observations with explicit evidence references, for example:

- index direction confirmed or contradicted by breadth;
- liquidity expansion/contraction versus the previous session;
- foreign/proprietary flow direction;
- number of leading/recovering sectors and the strongest changes;
- risk/sentiment movement versus the prior real snapshot.

Rules:

- Every sentence references exact snapshot fields and `as_of`.
- Missing inputs omit the sentence; they are not replaced with neutral guesses.
- No recommendation, target allocation, or probability language without a calibrated model.
- Source-derived score semantics stay distinct from QeoIndex-derived regime rules.
- The existing metric-semantics registry is extended and versioned so the UI and AI Council share definitions.

## UI/UX specification

### Design direction

- Aesthetic: **editorial market brief + analytical utilitarianism**.
- Purpose: let a beginner complete a reliable four-step read in under 60 seconds, while keeping dense evidence one interaction away.
- Differentiation anchor: a horizontal **Dải đọc thị trường** that connects `Chỉ số -> Độ rộng -> Dòng tiền -> Rủi ro` and highlights where evidence agrees or diverges.
- DFII: impact 4 + context fit 5 + feasibility 5 + performance safety 5 - consistency risk 4 = **15/15**. Execute as a restrained, performance-safe direction.

The page should feel like a post-close editorial brief, not a grid of unrelated metric cards. Large typography is reserved for the session regime and index value; tabular figures remain compact and aligned.

### Page information architecture

```text
Insights thị trường                                      Chốt lúc 15:15
[ Tổng quan ] [ Ngành & dòng tiền ] [ Cổ phiếu ] [ Nghiên cứu ]

┌─ Trạng thái phiên ───────────────────┬─ Chỉ số đóng cửa ─────────┐
│ PHÂN HÓA / TÍCH CỰC / THẬN TRỌNG     │ VNINDEX  VN30  HNX  UPCOM │
│ 2-3 deterministic observations       │ OHLC, %, GTGD             │
└──────────────────────────────────────┴────────────────────────────┘

Chỉ số ─── Độ rộng ─── Dòng tiền ─── Rủi ro     <- Dải đọc thị trường

┌─ Độ rộng & MA ──────────────────────┬─ Thanh khoản & dòng tiền ──┐
│ MA10/20/50/200 + breadth histogram  │ today vs prior + actors    │
└─────────────────────────────────────┴────────────────────────────┘

┌─ Ngành dẫn dắt / phục hồi ─────────┬─ Tác động chỉ số ──────────┐
│ sortable sector table / heat strip  │ positive vs negative       │
└─────────────────────────────────────┴────────────────────────────┘

Top đáng chú ý | Lịch sử tâm lý/rủi ro | Số phiên phân phối
```

### Interaction model

- Local shadcn `Tabs` split the existing long page into `Tổng quan`, `Ngành & dòng tiền`, `Cổ phiếu`, and `Nghiên cứu`. The stock rating table and detail dialog remain under `Cổ phiếu`.
- `Tổng quan` is the default and contains only the 60-second reading path.
- Clicking a node in `Dải đọc thị trường` scrolls/focuses the corresponding evidence module and opens the relevant metric-guide entry.
- Sector rows sort by RS, value, breadth, effort, or result. A row opens a shadcn `Sheet` on desktop and `Drawer` on mobile with 1D/5D/20D evidence and notable stocks.
- Index contributor bars always show positive and negative sides together; color is reinforced by arrows and signed values.
- All modules show `as_of`, freshness, and `complete/degraded/stale` status without exposing connector identity.
- No hover-only essential content. Tooltips explain terms; Dialog/Sheet contains the full explanation.

### shadcn composition

Use the project's `base-nova`, Base UI, Tailwind 4, Lucide, RSC, and semantic tokens. Add only components needed by the design; “full combo” means a complete coherent composition, not installing the entire registry.

| Need | shadcn primitive |
| --- | --- |
| Local IA | `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent` |
| Snapshot modules | full `Card` composition |
| Status/freshness | `Badge`, `Alert` |
| Charts | `Chart` wrapper with stable-height Recharts containers |
| Sector data | `Table`, `ScrollArea`, `DropdownMenu` for sorting |
| Time window | `ToggleGroup` for 1D/5D/20D |
| Progressive detail | `Collapsible`, `Accordion`, `Tooltip` |
| Desktop/mobile detail | `Sheet` and `Drawer`, each with accessible title |
| Loading/failure | `Skeleton`, `Spinner`, `Empty`, `Alert` |
| Search/filter | `Input`, `Select`, `Command` only when the option count justifies it |
| Structure | `Separator` rather than ad-hoc border dividers |

Before implementation, run the project package runner for `shadcn info`, inspect installed components, search the registry, and fetch docs for every component being added. Preview updates with `--dry-run`/`--diff`; never overwrite existing customized components without approval.

### SmoothUI usage

Reuse only bounded, reduced-motion-safe local patterns:

- `InsightsTransition`: one coarse opacity/translate entrance for hero and module groups.
- `PriceFlow`: post-hydration number transition, disabled for unchanged EOD values and reduced motion.
- `AnimatedTabs`: only if it is composed without duplicating shadcn tab semantics; otherwise keep shadcn Tabs and a small transform-only indicator.
- `AiLoader`: only for an explicit server analysis state, not normal snapshot loading.

Do not use `SoftBlurIn` on this dense/chart screen because it animates CSS blur per character. Avoid persistent glow, large shadows, animated gradients, `backdrop-filter`, CSS filter stacks, and `transition-all`. Do not animate row reordering or chart container dimensions.

### Responsive behavior

- `>= 1440`: two-column analytical layout; sector table and contributors side by side.
- `768-1439`: one main column with paired compact KPI rows; no forced horizontal page overflow.
- `< 768`: index strip becomes a two-column grid, charts keep a fixed aspect/height, sector table becomes priority columns plus Drawer detail.
- Do not load every stock or dynamic ticker route on initial render. Use bounded queries, pagination/on-demand detail, and `prefetch={false}` for dense ticker links.

### Empty, stale, and error states

- Missing field: `—` plus metric-specific explanation; never zero.
- Current run failed: show the previous good snapshot with a `Dữ liệu cũ` Alert and its exact date.
- Partial connector result: never publish the partial date.
- No history: show an `Empty` state; never synthesize points.
- Degraded cross-source mismatch: show canonical value and neutral `Đang đối soát` status.
- Loading: dimensionally stable Skeletons matching final chart/table heights.

## Delivery plan

### PR 1 - Contract, schema, and collection

1. Complete the authenticated Network discovery gate and commit sanitized fixtures only.
2. Add migrations for private staging/run telemetry and authenticated read tables/RLS.
3. Implement a bounded `market-insight-eod-sync` Edge Function and normalization contract.
4. Add atomic publish RPC, data-quality validation, token redaction, and failure telemetry.
5. Add `MARKET_CLOSE_COLLECT` after `EOD_READY` in the existing 15:15 ICT EOD workflow, update the phase catalog/Control Plane, and use bounded retries for a stale source snapshot.
6. Apply/deploy Supabase changes immediately when implementation begins, per repository invariants, then prove a real Ready run and row/value counts.

Acceptance: a complete real post-close run publishes atomically; an intentionally partial fixture fails closed and the previous good snapshot remains visible.

### PR 2 - Read model, semantics, and deterministic observations

1. Add `lib/market-insight-data.ts` with bounded authenticated queries.
2. Add pure `lib/market-insight-model.ts` rules and exact evidence references.
3. Extend `lib/insights-metric-semantics.ts` and increment its guide version.
4. Add stale/degraded/missing-data handling and server-side cache policy.
5. Connect point-in-time evidence to AI Council only after exact `as_of` and value validation.

Acceptance: every generated observation can be traced to a persisted field/date; missing evidence removes the claim rather than creating a fallback guess.

### PR 3 - Complete UI and real-browser QA

1. Add the local page Tabs and a new `components/insights/market-close-dashboard.tsx` instead of expanding the existing monolith further.
2. Build the closing hero, reading rail, breadth/MA, liquidity/flow, sector, contributor, leader, and history modules.
3. Add shadcn empty/loading/error/detail states and bounded SmoothUI motion.
4. Add deterministic UI/performance guards for blur/filter/transition/prefetch and stable chart containers.
5. Update Insights docs/handover and run authenticated visual QA.

Acceptance: a beginner can state index direction, breadth confirmation, leading sectors, flow direction, and risk context in under 60 seconds; the full evidence remains accessible without a crowded default screen.

## Verification matrix

### Automated

- Contract fixtures: field mapping, units, auth expiry, timeout, malformed JSON, contract drift.
- Normalization: risk scale, percent ranges, dates/timezone, signed flows, duplicate sectors/tickers.
- Publication: atomic success, partial failure, idempotent rerun, previous-snapshot preservation.
- RLS: anon denied, authenticated public columns only, operational/raw tables denied.
- Schedule: 15:15 ICT weekdays, holiday skip, bounded retry, no overlap with intraday sync.
- Model: deterministic regime/observation rules, missing-data omission, exact evidence refs.
- UI: status states, keyboard tabs/sheet/drawer, no eager ticker prefetch, no prohibited effects.
- Repository gates: `pnpm test:core`, targeted tests, `pnpm lint:touched`, `pnpm typecheck`, `pnpm scan:secrets`, `pnpm exec next build --webpack`, `git diff --check`.

### Live evidence

- Compare the published session date and representative values against the authenticated dashboard after 15:00.
- Verify all four indices, breadth totals, at least three sectors, both flow signs, distribution count, sentiment/risk, and one leader category.
- Confirm run status, staged/published counts, exact endpoint coverage, and no secret-bearing logs.
- Test `/insights` at approximately 390, 768, 1440, and 1920 px, light CPU/GPU behavior, keyboard-only navigation, reduced motion, clean console/network, and no layout jitter.
- After release approval: one merge to `main`, one Git-triggered Vercel production deployment, `READY`, runtime-error inspection, and authenticated smoke with actual values.

## Risks and decisions

| Risk | Decision |
| --- | --- |
| Private/unstable upstream contract | Contract fixtures, versioning, bounded connector, fail closed |
| Terms/account restriction | Permission review is a P0 gate; no collector before it passes |
| Token in upstream query string | Server-only request builder and strict URL/query redaction |
| Proprietary formula ambiguity | Preserve observed values/labels; do not reverse-engineer |
| Source data conflicts with QeoIndex feeds | Explicit source-of-truth matrix and private mismatch telemetry |
| Large payload/UI overload | EOD-only snapshot, normalized tables, progressive disclosure, on-demand detail |
| Dense dashboard performance | Stable dimensions, no blur/filter/transition-all, bounded motion, browser profiling |
| Brand leakage | Product-neutral naming lint/source guard and UI smoke assertions |

## Estimated solo-developer effort

- Discovery and scrubbed fixtures: 0.5-1 day.
- Schema, connector, validation, workflow integration: 2-3 days.
- Read model, semantics, deterministic observations: 1-1.5 days.
- Complete responsive UI: 2-3 days.
- Live QA, docs, PR/release evidence: 1-1.5 days.

Expected total: **6.5-10 working days**, depending mainly on authenticated contract stability and whether socket data can be captured reliably after the close.

## Research references

- [Trang chủ and feature inventory](https://hdsd.kfsp.vn/hdsd-kfsp/gioi-thieu-chuc-nang/trang-chu)
- [Market pulse and distribution-day semantics](https://hdsd.kfsp.vn/hdsd-kfsp/cac-cau-hoi-thuong-gap/nhip-dap-thi-truong)
- [Market module index](https://hdsd.kfsp.vn/hdsd-kfsp/gioi-thieu-chuc-nang/1-thi-truong)
- [End-of-day index, liquidity, breadth, contributor, and foreign-flow fields](https://hdsd.kfsp.vn/hdsd-kfsp/gioi-thieu-chuc-nang/1-thi-truong/dien-bien-trong-phien)
- [MA breadth](https://hdsd.kfsp.vn/hdsd-kfsp/gioi-thieu-chuc-nang/1-thi-truong/thong-ke-ma)
- [Sector overview](https://hdsd.kfsp.vn/hdsd-kfsp/gioi-thieu-chuc-nang/1-thi-truong/tong-quan-nganh)
- [Sector rotation](https://hdsd.kfsp.vn/hdsd-kfsp/gioi-thieu-chuc-nang/1-thi-truong/luan-chuyen-dong-tien-nganh)
- [Effort-result semantics](https://hdsd.kfsp.vn/hdsd-kfsp/gioi-thieu-chuc-nang/1-thi-truong/kungfu-ibd/no-luc-ket-qua)
- [Market-health scales](https://hdsd.kfsp.vn/hdsd-kfsp/gioi-thieu-chuc-nang/1-thi-truong/kungfu-ibd/suc-khoe-thi-truong)
- [Top-stock categories](https://hdsd.kfsp.vn/hdsd-kfsp/gioi-thieu-chuc-nang/1-thi-truong/thong-ke-top-co-phieu)
