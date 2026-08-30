# QeoIndex engineering handover

Last updated: 2026-08-23. This is the canonical fast-start document for agents and maintainers.

## Product and production

- Product: QeoIndex — realtime/EOD Vietnamese stock board plus research, scanner, recommendation, and signal workflows.
- Brand slogan: `Đọc thị trường. Giữ kỷ luật.`
- Official domain: <https://qeoindex.qeoqeo.com>.
- Framework: Next.js 16 App Router, React 19, TypeScript, Tailwind CSS 4, pnpm.
- Vercel project: `tvqqq/stockos` is the legacy infrastructure slug; it is not the product brand.
- Primary page: `app/page.tsx` renders `components/live-market-board-v2.tsx` inside the order-book provider.
- Supabase production project: `qeoindex` (`glwhhrmejlonhyorvtzm`, Singapore region).

Read `AGENTS.md` before editing. When a local checkout is available, use the version-specific Next.js docs under `node_modules/next/dist/docs/`; do not assume older App Router behavior.

## Security model

The client auth gate is UX only. The real user-facing boundary is:

```text
Supabase Auth
  -> verified HttpOnly server session
  -> server user.id
  -> server feature gate
  -> user-scoped Supabase client + JWT
  -> RLS auth.uid()
```

Important files:

| Path | Responsibility |
| --- | --- |
| `lib/auth/server.ts` | Verify Supabase access tokens, read HttpOnly session, enforce typed user feature gates. |
| `lib/auth/machine.ts` | Constant-time bearer-secret authorization for machine/admin endpoints. |
| `app/api/auth/session/route.ts` | Synchronize the browser Supabase session to the verified server cookie. |
| `app/api/me/route.ts` | User profile/preferences API; user ID always comes from server auth. |
| `app/api/watchlist/route.ts` | Per-user default watchlist API; ownership enforced again by RLS. |
| `lib/supabase/server.ts` | Trusted infrastructure-only service-role client. It fails closed without `SUPABASE_SERVICE_ROLE_KEY`. |
| `docs/auth.md` | Full Auth/RLS architecture and verification checklist. |
| `docs/security.md` | Current security audit, endpoint policy, headers, and remaining actions. |

Applied production security migrations:

1. `20260821094252_user_auth_rls.sql`
2. `20260821094322_revoke_bootstrap_rpc_execute.sql`
3. `20260821103811_harden_orderbook_rls_and_indexes.sql`
4. `20260821111359_gate_orderbook_by_market_feature.sql`
5. `20260822092848_require_auth_for_insights_stock_ratings.sql`

`profiles`, `user_preferences`, `user_features`, `watchlists`, and `watchlist_items` use RLS ownership via `auth.uid()`. `user_features` is read-only for normal users. `stock_orderbook_snapshots` no longer allows anonymous direct Supabase reads; authenticated direct SELECT is additionally gated by the user's enabled `market_board` entitlement, while trusted ingestion uses the service role.

Supabase Security Advisor still reports the hosted-Auth setting **Leaked Password Protection Disabled**. Enable it in Supabase Auth settings before expanding access. Also verify hosted public/email signup remains disabled because QeoIndex exposes login only.

## Browser API feature gates

- `market_board`: market intraday/index/session/put-through/stream endpoints.
- `research`: research promotion and scanner diagnostic UI endpoints.
- `signals`: signal health UI endpoint.
- `finhay_live`: Finhay status/quote/connect/disconnect/OAuth callback.

`AppAuthGate` must never be referenced as justification for exposing an API.

## Machine/admin endpoints

Machine endpoints use `isMachineRequestAuthorized()` instead of browser sessions:

| Endpoint | Secret |
| --- | --- |
| `/api/signals/daily` | `CRON_SECRET` |
| `/api/signals/monitor` | `SIGNAL_MONITOR_SECRET` or `CRON_SECRET` |
| `/api/scanner/run` | `SCANNER_RUN_SECRET` or `CRON_SECRET` |
| `/api/market/sync-universe` | `MARKET_SYNC_SECRET` or `CRON_SECRET` |
| `/api/market/cache/invalidate` | `MARKET_CACHE_ADMIN_SECRET` or `CRON_SECRET` |

The two destructive market maintenance routes are POST-only. Do not restore unauthenticated GET aliases.

## Data boundaries

| Concern | Runtime source | Important rule |
| --- | --- | --- |
| Board universe | `lib/wyckoff-universe.ts` canonical Top 100 constants | Keep the 100-symbol safety cap and deterministic sector/rank metadata. |
| Persistent research/thesis/scans | Notion canonical workspace | Fail visibly if the canonical research source is unavailable; market feeds are not research persistence. |
| Initial stock quotes | Broker batch quotes + Supabase snapshots | SSR should render usable values before WebSocket connect. |
| Intraday mini charts | Shared 5m snapshot service: DNSE chart first, Yahoo fallback | Keep provider concurrency bounded; prefer valid cached history to blocking a browser request. |
| Realtime stocks/indices | DNSE WebSocket | Credentials/signatures stay server-side; stale watchdog reconnects. |
| Index bootstrap | TradingView/DNSE server routes | Keep after-close values visible even without a WebSocket frame. |
| Shared board cache | Vercel Runtime Cache + optional Upstash Redis | Cache failure fails open to the bounded provider path. |
| Orderbook persistence | Supabase Postgres | Browser access is authenticated + `market_board` RLS-gated; server ingestion uses service role. |
| Optional Finhay adapter | Finhay MCP OAuth | Tokens remain secure server cookies; browser routes require `finhay_live`. |
| Root Admin Control Plane | Supabase Postgres + Server Auth | Restricted strictly to server-side `ROOT_ADMIN_USER_IDS` allowlist; service-role private tables. |
| Market Close Insights | Edge Function + Supabase Postgres | Fail-closed multi-feed collector (REST + Socket.IO) + atomic publish RPC; public read / service-role write. |

## Market Close Insights ("Insight thị trường sau phiên")

The Market Close Insights subsystem provides an automated, factual post-market briefing after 15:15 ICT every trading session.

The `/insights` presentation uses an analytics-first, tab-free hierarchy: market pulse and score tiles, four canonical index tiles, chart grids for breadth/MA/flows, sector performance and breadth, liquidity and index impact, then 20-session context. Long duplicate tables and narrative blocks are intentionally avoided; factual observations are capped as compact signal chips. The separate `Top cổ phiếu rating score` disclosure remains unchanged and closed by default. Keep chart containers dimensionally stable and do not add blur/filter/continuous motion around this screen.

The visual shell follows the Liquid Glass Financial Center direction with translucent color, edge highlights, gradients, and bounded shadows only. It intentionally avoids persistent `backdrop-filter` around charts. The VNINDEX hero line is grounded in a bounded 20-row query to `market_insight_indexes`; missing history shows an explicit empty state and is never synthesized.

### Core Architecture & Boundaries

1. **Pipeline Phase**: `MARKET_CLOSE_COLLECT` executes as Phase 2 in `workflows/qeoindex-eod-pipeline.ts`. It extracts 4 canonical indexes (`VNINDEX`, `VN30`, `HNX`, `UPCOM`) scaled to billion VND (`1e9`) from TradingView and passes them in the sync payload.
2. **Collector Edge Function (`market-insight-eod-sync`)**:
   - Bounded Socket.IO & REST aggregator with 6,000ms client timeouts.
   - Extracts Pulse content (`distribution_count`), MA breadth (MA10, MA20, MA50, MA200), Risk & Psychology scores, Foreign & Proprietary cash flows, Sector performance/breadth, and Top Volume leaders.
   - Stages items with compound keys `(run_id, staging_key)` into `market_insight_snapshot_staging`.
   - Never injects synthetic/fallback index numbers; missing feeds produce `quality_status = 'failing'`.
3. **Database Schema & Read Models**:
   - `market_insight_sync_runs`: run tracking with `status in ('running', 'completed', 'failed', 'skipped')`.
   - `market_insight_daily`: daily regime, sentiment, risk, distribution days, MA breadth, and institutional flows.
   - `market_insight_indexes`: OHLCV, PE, breadth, and foreign trading across 4 major indexes.
   - `market_insight_sectors`: sector performance, rotation states, VSA effort/result, and breadth.
   - `market_insight_leaders`: top volume and index contributor leaders.
4. **Strict Fail-Closed Publish RPC (`publish_market_insight_snapshot`)**:
   - Requires all **8 P0 coverage keys** to be `true` (`canonical_indexes`, `market_pulse_content`, `ma_breadth`, `risk_indicator`, `psychology_indicator`, `cash_flows`, `sector_pulse`, `sector_breadth`).
   - Requires 4 canonical index rows with non-null positive values and at least 1 sector row.
   - Atomically replaces old records for the session date and marks the sync run `completed`.
5. **Live Verification**:
   - Run authenticated EOD pipeline via admin or machine route (`/api/qeoindex/eod` or manual runner).
   - Verify `market_insight_sync_runs.status = 'completed'` and `endpoint_coverage`.
   - Smoke-test UI at `https://qeoindex.qeoqeo.com/insights` checking the 4 tabs: Tổng quan, Nhóm ngành, Dẫn dắt & Khối lượng, Lịch sử phiên.

## Root Admin Control Plane

The QeoIndex Root Admin Control Plane provides a low-overhead, private operational cockpit for monitoring system health, telemetry, environment inventory, and safely tuning allowlisted runtime parameters without code changes or redeployments.

### Authorization boundary & security model

- **Root Authority**: Restricted exclusively to the server-side environment variable `ROOT_ADMIN_USER_IDS` containing comma-separated canonical Supabase user UUIDs.
- **Fails Closed**: If `ROOT_ADMIN_USER_IDS` is unset, empty, or contains invalid UUIDs, root access is completely disabled. Email addresses, client-supplied flags, database roles, or `user_features` are never used for root authorization.
- **Response Headers**: All root admin routes and APIs emit `Cache-Control: private, no-store, no-cache, max-age=0, must-revalidate` to prevent intermediary caching of sensitive operational data.
- **CSRF & Mutation Protection**: All state-modifying requests (POST/DELETE) enforce strict same-origin checks (`validateAdminMutationRequest`) and require a mandatory change reason (`validateChangeReason`, 8–240 characters).

### Control Plane persistence & database architecture

Applied migration: `20260824120000_root_admin_control_plane.sql`

1. **`public.system_settings`**: Stores runtime parameter overrides with optimistic locking (`version`), validated JSON values, and service-role-only access.
2. **`public.system_job_runs`**: High-performance telemetry table tracking execution lifecycles (`started`, `succeeded`, `failed`, `running`), trigger sources (`cron`, `manual`, `startup`), durations, actor IDs, error codes, and sanitized summaries.
3. **`public.system_audit_log`**: Immutable audit ledger recording all runtime setting mutations and manual job dispatches with before/after state snapshots and change reasons.
4. **Atomic RPCs**:
   - `public.qeo_admin_set_system_setting`: Atomic compare-and-swap (CAS) upsert with concurrent version check and audit logging in the same database transaction.
   - `public.qeo_admin_reset_system_setting`: Atomic CAS delete reverting a setting to code/environment default with audit logging.
   - `public.qeo_admin_cron_snapshot`: Security-definer RPC exposing `pg_cron` schedule status while strictly redacting shell commands, vault secrets, request headers, and return messages.

### Safe runtime settings vs Read-only inventory

The catalog defines 7 editable runtime-safe keys. All other system parameters (universe caps, URLs, secret keys) are strictly read-only:

| Setting Key | Type | Default | Bounds / Allowed Values | Description |
| --- | --- | --- | --- | --- |
| `ai_council.llm_enabled` | `boolean` | `true` | `true` \| `false` | Bật/tắt gọi LLM thực tế trong AI Council daily debate |
| `ai_council.llm_max_tickers` | `integer` | `3` | `1` – `10` | Số lượng cổ phiếu tối đa đưa vào debate thực tế mỗi ngày |
| `ai_council.llm_tickers` | `ticker_list` | `[]` | VN uppercase symbols | Danh sách mã cổ phiếu ưu tiên debate |
| `ai_council.research_tickers` | `ticker_list` | `["MSN"]` | VN uppercase symbols | Danh sách mã cổ phiếu trích xuất ngữ cảnh nghiên cứu |
| `market.intraday_5m_cache_ttl_seconds` | `integer` | `180` | `15` – `1800` (giây) | Thời gian cache dữ liệu nến intraday 5m |
| `scanner.manual_run_limit` | `integer` | `100` | `1` – `100` | Số lượng mã tối đa quét trong 1 lần chạy thủ công |
| `admin.refresh_interval_seconds` | `integer` | `30` | `5` – `300` (giây) | Chu kỳ tự động làm mới giao diện Control Plane |

**Resolution Order**: `Runtime Database Override` > `Environment Variable` > `Code Default`.

### Job health state machine, evidence boundaries & Manual dispatch

The system inventories scheduled background and on-demand jobs across Vercel Workflow, Supabase pg_cron, and machine endpoints. 4 jobs are allowlisted for safe manual dispatch from the Control Plane:

- `market.sync_universe`: Đồng bộ danh mục cổ phiếu Top 100 từ VPS market feed.
- `scanner.run`: Kích hoạt bộ lọc quét tín hiệu thị trường.
- `signals.monitor`: Kiểm tra tình trạng dữ liệu và hoạt động của engine tín hiệu.
- `wyckoff.ingest`: Nhập 500 snapshot phân tích Wyckoff từ Notion staging vào Supabase.

#### Scheduler Dispatch Health vs Actual Execution Evidence

A critical invariant of the Control Plane is the strict separation between:
1. **Scheduler Dispatch Health**: Indicates whether pg_cron or Vercel Cron triggered the HTTP request. `cron.job_run_details.status = 'succeeded'` means only that the asynchronous HTTP request was queued into `pg_net`. It is NOT execution success.
2. **Execution Evidence**: The actual domain outcome and freshness derived from canonical data stores:
   - `qeoindex.eod_pipeline` & manual jobs: `system_job_runs` and `system_job_phases`.
   - `kfsp.rating_daily`: `kfsp_rating_sync_runs` (verifying published row count, e.g. 1,752 rows).
   - `kfsp.ttai_history`: `kfsp_ttai_sync_runs` (verifying candidate vs processed count).
   - `market.sync_5m` & `market.sync_eod`: `stock_orderbook_snapshots` coverage and session freshness.
   - `signals.daily`: `system_job_runs` workflow completion telemetry.

#### Active Production Schedules & Scheduler Names

| Job Key | Provider | Scheduler Name | Schedule (UTC) | Schedule (ICT) | Evidence Source |
| --- | --- | --- | --- | --- | --- |
| `qeoindex.eod_pipeline` | `supabase_pg_cron_workflow` | `qeoindex-eod-pipeline-1515-ict` | `15 8 * * 1-5` | 15:15 T2-T6 | `system_job_runs` / `system_job_phases` |
| `signals.daily` | `vercel_cron_workflow` | Vercel Cron | `0 0 * * 1-5` | 07:00 T2-T6 | `system_job_runs` |
| `kfsp.rating_daily` | `supabase_pg_cron` | `kfsp-rating-daily-7am-ict` | `0 0 * * *` | 07:00 Hàng ngày | `kfsp_rating_sync_runs` |
| `kfsp.ttai_history` | `supabase_pg_cron` | `kfsp-ttai-history-daily-1am-ict` | `0 18 * * *` | 01:00 Hàng ngày | `kfsp_ttai_sync_runs` |
| `market.sync_5m` | `supabase_pg_cron` | `sync-universe-5m` | `*/5 2-6 * * 1-5; 0-40/5 7 * * 1-5` | 09:00-14:40 T2-T6 | `stock_orderbook_snapshots` |
| `market.sync_eod` | `supabase_pg_cron` | `sync-universe-eod-1445` | `45 7 * * 1-5` | 14:45 T2-T6 | `stock_orderbook_snapshots` |

#### Operational Findings & Resolution

1. **Orderbook Sync Schedule (Resolved)**: `sync-universe-5m` runs every 5 minutes during active market hours up to 14:40 ICT (`*/5 2-6 * * 1-5` and `0-40/5 7 * * 1-5`), and `sync-universe-eod-1445` captures the post-ATC market close snapshot at 14:45 ICT (`45 7 * * 1-5`). Zero overlap exists between intraday and closing syncs.
2. **KFSP TTAI Provider Failure**: Edge Function returns HTTP 207 with `0/12` processed and `12/12` failed due to upstream provider changes. Displayed truthfully as `FAILING` on `/admin/jobs`.
3. **QeoIndex EOD First Run**: Remains `UNKNOWN` (Pending First Run) until actual execution telemetry is recorded in `system_job_runs`.
4. **Signals Daily Telemetry**: Workflow start, finish, and failure are durably persisted to `system_job_runs` via step telemetry.

**Health Status Derivation**:
- `healthy`: Bằng chứng thực thi gần nhất thành công và trong ngưỡng độ tươi (`freshnessMinutes`).
- `degraded`: Lần chạy gần nhất có cảnh báo hoặc thời lượng thực thi vượt ngưỡng tối đa.
- `failing`: Lần chạy gần nhất thất bại hoặc kết thúc với mã lỗi / HTTP 207 provider failure.
- `stale`: Quá thời hạn kiểm tra độ tươi mà không có lượt chạy mới thành công.
- `unknown`: Chưa ghi nhận lần chạy nào trong hệ thống telemetry hoặc đang chờ lượt chạy đầu tiên.

### Admin endpoints & Navigation

| Route / API | Method | Access | Description |
| --- | --- | --- | --- |
| `/admin` | `GET` | Server Root Auth | Bảng điều khiển tổng quan hệ thống, nguồn dữ liệu, telemetry và audit trail. |
| `/admin/settings` | `GET` | Server Root Auth | Quản lý cài đặt runtime, hỗ trợ chỉnh sửa in-place với optimistic locking và lý do thay đổi. |
| `/admin/jobs` | `GET` | Server Root Auth | Giám sát 13 tác vụ, trạng thái sức khỏe, lịch cron và kích hoạt chạy thủ công. |
| `/admin/jobs/[key]` | `GET` | Server Root Auth | Lịch sử chi tiết 50 lần chạy gần nhất của từng tác vụ cụ thể. |
| `/admin/environment` | `GET` | Server Root Auth | Kiểm tra trạng thái cấu hình của tất cả các biến môi trường; bí mật được ẩn hoàn toàn. |
| `/admin/audit` | `GET` | Server Root Auth | Lịch sử audit log đầy đủ với bộ lọc hành động, đối tượng và người thực hiện. |
| `/api/admin/overview` | `GET` | `requireApiRoot` | Trả về JSON tổng quan hệ thống phục vụ polling/refresh. |
| `/api/admin/settings` | `GET`, `POST` | `requireApiRoot` | Lấy danh sách cài đặt hoặc cập nhật ghi đè runtime (yêu cầu CSRF origin & reason). |
| `/api/admin/settings/[key]` | `DELETE` | `requireApiRoot` | Khôi phục cài đặt về mặc định (yêu cầu CSRF origin & reason). |
| `/api/admin/jobs` | `GET` | `requireApiRoot` | Lấy snapshot tình trạng tác vụ và lịch sử thực thi gần đây. |
| `/api/admin/jobs/[key]/run` | `POST` | `requireApiRoot` | Kích hoạt thực thi thủ công tác vụ thuộc allowlist (yêu cầu CSRF origin & reason). |

### UI performance compliance

In accordance with `docs/UI_LESSONS_LEARNED.md`, the Root Admin Control Plane UI strictly adheres to:
- No `transition-all` declarations anywhere in admin components.
- Zero `backdrop-filter` or `backdrop-blur-*` surfaces.
- All navigation links specify `prefetch={false}`.
- Lightweight, dimensionally stable modal dialogs without nested scroll-traps or layout shift.

The `/insights` landing page is a single scrollable dashboard with no primary section navigator: post-session market context and research modules remain visible, while the large Top 100 rating table is an explicit user-opened disclosure. Duplicate VNIndex/Market Pulse summary cards were removed because the post-session dashboard already owns that context. Stale-data status is surfaced directly below the page hero. Inside the post-session section, overview, sectors, leaders, and history render continuously with no local tabs; wide screens use denser chart grids, and charts share a restrained flat semantic palette without SVG gradients. The global auth gate preserves server-verified content across transient Supabase token-refresh synchronization failures and rejects stale overlapping sync responses, preventing long-lived sessions from flashing the login shell.

1. `app/page.tsx` verifies the server session before any protected board load.
2. SSR assembles snapshots, batch quotes, and the shared 5-minute history snapshot in parallel.
3. The SSR model is kept in the UI cache with a short live-session TTL.
4. If SSR has usable multi-point history for at least 95% of Top 100, the browser skips the redundant first-mount `/api/market/intraday` bootstrap. Session rollover still forces a refresh.
5. The browser connects to DNSE WebSocket and subscribes to tick, top-price, OHLC, foreign, and index channels.
6. WebSocket callbacks are queued into `requestAnimationFrame`; quote/history writes go into detached ref-backed stores.
7. React publishes visible quote/history snapshots at most every 250ms (~4Hz). Sector and Top Movers ordering use a separate quote snapshot refreshed at most once per second.
8. `/api/market/intraday` prefers exact/today-latest cached snapshots before provider fan-out.
9. The 60-second stale-stream watchdog reconnects independently from REST/cache hydration.

Do not introduce a 100-request browser fan-out.

## Board performance status — 2026-08-21

The audit was triggered by visible lag and high laptop temperature. Confirmed hotspots and fixes:

- Removed `.board-stock-row { transform: translateZ(0) }`. It could promote roughly 100 rows into persistent GPU/compositor layers.
- Added `app/market-board-performance.module.css` for the authenticated board surface:
  - disable dense `backdrop-filter` blur utilities;
  - use `contain: layout style` on rows;
  - suppress row drop-shadow filters.
- `Sparkline` ignores the transient last live endpoint in its memo comparator, so SVG paths do not rebuild on every trade tick. Stable 5-minute history changes still redraw charts.
- `/api/market/intraday` uses today's latest known-good cache before launching the expensive provider path.
- `live-market-board-v2.tsx` now uses per-symbol ref-backed writes instead of cloning the entire quote/history outer map per DNSE frame.
- `MARKET_UI_COMMIT_MS` is 250ms (~4Hz), down from 100ms (~10Hz maximum parent update opportunities).
- Sector/Top Movers sorting uses `MARKET_ORDERING_REFRESH_MS = 1000`, decoupling ranking churn from live price paint.
- First-mount browser intraday bootstrap is skipped when SSR history coverage is already sufficient (>=95%).
- Vercel runtime inspection before these changes showed three 20-second timeout events across `/api/market/intraday` and `/api/market/index-candles` in the previous 24 hours.

These are architectural reductions in update/recompute opportunities, not a guaranteed CPU or temperature percentage. Browser/device profiling during a live market session remains the source of truth for actual client gains.

If production remains hot, profile before further throttling. The next likely boundary is splitting high-frequency row price paint from aggregate board statistics, or moving rows toward a subscription/store model. Do not combine that work with unrelated UI changes.

Do not reintroduce `content-visibility` or naive row virtualization without redesigning screenshots: the current screenshot flow needs the full board DOM, including off-screen sectors.

See `docs/market-board.md` and `docs/perf-market-board-state-buffer.md` for the detailed data/performance contract.

## Board UI invariants

- Six visual groups.
- Responsive grid: 1 column default, 2 at `sm`, 3 at `lg`, 6 at `xl`.
- Sector header height: 72px.
- Daily % uses the official/reference previous close, never session open.
- After close, both price and mini chart remain visible through snapshot/history fallback.
- Strong gainers use static emphasis; avoid permanent animations across 100 rows.
- Reduced-motion behavior must remain supported.
- Source-contract tests are not a substitute for real browser visual QA.

## Scanner and research

## Portfolio workspace

- `/portfolio` combines a Simplize-style overview (market value, unrealized/realized P&L, allocation) with a KFSP-style trading journal (transaction history, notes/tags, target and stop-loss) and multi-list watchlists with price alerts.
- Market prices must be read from `/api/market/intraday` at `histories[symbol].price`, with the latest valid point close as a fallback. `lib/portfolio/market-prices.ts` owns this boundary; never treat the response as a flat ticker map.
- Portfolio switching is race-guarded so a slower response from the previous portfolio cannot replace the active portfolio's transaction state.
- The portfolio shell renders `TopNav` before its `top-14` sticky workspace bar; omitting `TopNav` creates a visible 56px header gap. Transaction rows support edit as well as delete: the shared dialog prefills the selected row and persists through the user-scoped `PATCH /api/portfolio/[id]/transactions/[txId]` route.
- The dashboard's “Kỷ luật giao dịch” values are descriptive coverage metrics only. They must not be presented as advice, signal quality, or a win-rate estimate without a canonical closed-trade model.
- Dense ticker links keep `prefetch={false}`. Keep the workspace free of backdrop blur, CSS filter stacks, continuous motion, and unstable chart sizing.

### Wyckoff chart workspace

- `/insights/wyckoff?ticker=FPT&timeframe=1D` is the chart-first Top 100 workspace. It supports `1H`, `4H`, `1D`, `1W`, and `1M`; each ticker/timeframe is shareable by query string.
- The sidebar reads canonical Notion universe/latest Daily scans. The selected chart reads completed provider bars; `4H`, `1W`, and `1M` are deterministic aggregates. Daily bars are aligned to the canonical scan date.
- Future lines are conditional Bull/Base/Bear projections from phase, ATR, levels, and rule-engine probabilities. Do not label them as predicted prices.
- `docs/wyckoff-chart-unified-data.md` documents the Supabase unified schema. `/api/wyckoff/run` writes five timeframe snapshots plus bounded chart series; the page reads this model first and keeps a Notion/provider compatibility fallback during cutover.
- `scripts/chatgpt-plus-wyckoff-schedule-prompt.md` is the copy-ready ChatGPT Work scheduled-task prompt. It writes only to Notion staging and needs no QeoIndex bearer secret.
- Vercel calls `/api/wyckoff/ingest` at 17:00 ICT on weekdays. The machine-authenticated route claims the newest `Ready` Notion run, validates all 500 keys, publishes complete snapshots to Supabase, and marks the manifest `Ingested`; invalid runs fail closed.

### Authenticated Insights homepage

- `/insights` is available to every signed-in user, without a separate feature entitlement. Anonymous visitors remain on the login screen.
- Supabase `insights_stock_ratings` is read-only for `authenticated` through RLS and browser-safe column grants; `anon` has no grant. The KFSP Edge Function stages and atomically publishes complete daily snapshots at 07:00 ICT, while provider tokens and diagnostics remain service-role only.
- The provider sends live prices in VND; the sync owns the one-time conversion to thousands of VND and the stable RS aliases before publication. Production was initialized on 2026-08-22 with 1,752 rows and exactly 100 canonical Top 100 rows.
- The rating table defaults to Top 100 and fits its 11 core metrics without a forced horizontal minimum width. `Tất cả` renders aggregates from all current snapshot rows; the stock detail read-model is currently capped at top 500 composite rows plus exact Top 100, so sector drill-down is not yet a guaranteed all-stock sector list. The detail dialog adds a documented five-axis QeoIndex heuristic plus real 1D/7D/30D snapshot tracking while retaining the nine KFSP metric groups. Missing historical dates are not interpolated.
- Insights documentation index: `docs/insights-homepage.md`; plan/limits: `docs/insights-plan.md`; formulas: `docs/insights-rating-model.md`; design contract: `docs/insights-design.md`; engineering/operations runbook: `docs/insights-handover.md`.
- `/research/*`, the market board, and all operational/write APIs retain their existing auth/feature gates. See `docs/insights-homepage.md` for the rating ingestion contract.

- `scannerHistoryPolicy` remains canonical for runner/persistence/health:
  - fewer than 60 completed Daily bars: reject;
  - 60–199: persist `Incomplete`, force `LOW` confidence;
  - 200+: `Complete`, normal engine confidence.
- Same-date persistence is monotonic: provider regressions must not downgrade an already-complete result.
- Scanner health reports `Incomplete` and `Complete` separately.
- Never claim scanner completion from progress logs alone; inspect final job/scan/outbox counts.
- Canonical ticker thesis/history belongs in Notion; evidence documents belong in Google Drive according to the project research workflow.

## Environment and secrets

Use `.env.example` as the inventory. Main server-only categories are Notion, DNSE, Finhay OAuth, Redis, Supabase service role, scanner/monitor/cron, market maintenance, and Slack connector configuration.

- Never commit credentials.
- Never put a credential in `NEXT_PUBLIC_*`.
- The public Supabase URL and publishable/anon key are not service credentials; service role is server-only.
- Run `pnpm scan:secrets` before release.
- Any credential ever committed to history must be rotated even if history is later rewritten.

## HTTP hardening

`next.config.mjs` sets baseline headers globally: `nosniff`, `DENY` framing, strict-origin referrer policy, restrictive camera/microphone/geolocation permissions, and disabled DNS prefetch.

A strict CSP is deliberately deferred until the DNSE WebSocket/external-provider `connect-src` and nonce strategy are tested. Do not guess a CSP in production.

## Validation matrix

### Insights market workspace (2026-08-30)

- The post-close Insights header owns freshness messaging. A stale snapshot appears inline where the normalized-snapshot status normally sits; do not add a second alert below the header.
- Index cards precede the main visualization. The hero is a deterministic, non-animated stock bubble map ranked by the existing top-volume snapshot, with 1D/1W/1M/1Y values taken from KFSP metrics when present.
- The compact market workspace exposes three local views: market pulse, sector effort/result, and health history. Missing `effortPct` and long-period performance stay explicitly missing; never derive them from unrelated price or volume fields.
- Bubble circles use a stable flex layout rather than force simulation/canvas animation to protect chart and realtime rendering performance.

| Change area | Minimum checks |
| --- | --- |
| Universe/sectors/groups | `pnpm test:universe` |
| EOD/mini chart/DNSE merge | `pnpm test:intraday` |
| Board layout/performance contract | `pnpm test:board-contract` plus browser visual QA when available |
| Supabase/Auth/API security | `pnpm test:supabase` + Supabase Security Advisor |
| VNINDEX/VN30/HNXINDEX | `pnpm test:indexes` plus production API smoke after deployment |
| Scanner policy | `pnpm test:scanner-core` |
| Signal rules | `pnpm test:signal-core` |
| Core regression | `pnpm test:core` |
| Touched source | `pnpm lint:touched` |
| TypeScript/UI | `pnpm typecheck` and production build |
| Security/env | `pnpm scan:secrets` |

GitHub `Verify` runs secret scan, the core regression suite, touched lint, TypeScript, and a production Next.js build on pull requests. Pushes to `main` rerun the same release gate.

## Git and deployment workflow

Production has one normal deployment trigger: **Vercel Git Integration on `main`**.

```text
feature/work branch
  -> validation
  -> PR
  -> squash/merge once into main
  -> Vercel Git Integration creates one production deployment
  -> inspect deployment/logs
  -> smoke qeoindex.qeoqeo.com
```

Rules:

- `vercel.json` intends to disable Git deployments for every branch except `main`. Periodically verify the Vercel Git Integration setting because preview deployments have still been observed for feature-branch commits.
- Never manually deploy a feature branch to production.
- Do not run a second manual production deployment after merging the same release.
- If Vercel reports quota/rate-limit errors, stop retrying.
- Target invariant: one approved release merged to `main` -> one production deployment.

Supabase DB migrations are different: approved DDL/function changes apply immediately to the production Supabase project and are committed to `supabase/migrations/` in the same work branch so Git remains the schema record.

## Release checklist

1. Preserve unrelated work; never reset a user branch to isolate a task.
2. Run area tests, touched ESLint, TypeScript, production build, and secret scan.
3. For DB changes, run Supabase Security/Performance Advisors after migration.
4. Push the feature branch and wait for GitHub Verify.
5. Review the PR diff and any remaining operational warnings.
6. Merge once into `main` only after approval; let Vercel auto-deploy.
7. Observe the Git-triggered deployment to `READY`.
8. Smoke the official domain and changed APIs using actual data/error behavior, not only HTTP status.

## Fast debugging guide

| Symptom | First checks |
| --- | --- |
| Board is hot/laggy | Chrome/Safari Performance + Layers; inspect actual React commit frequency, row paint cost, aggregate/header recomputation, and open order-book windows. |
| Yesterday's chart/orderbook reappears after 09:00 | Verify `MARKET_SESSION_RESET_EVENT`, ATO hydration guards, and the Vietnam-time phase timer before inspecting providers. |
| `/api/market/intraday` is slow | Inspect Runtime Cache/Redis hit path and whether SSR history reuse suppressed redundant client bootstrap; compare Vercel timeout logs. |
| Charts exist but prices are `—` | Inspect SSR quote/reference selection and intraday cache validity. |
| Prices disappear after close | Verify latest-session history and Supabase snapshot fallback. |
| VNINDEX/VN30 are blank | Inspect `/api/market/indexes`, then DNSE index frames; sockets may be quiet after close. |
| Protected API works anonymously | Treat as P0; inspect `requireApiFeature`/machine bearer auth and RLS, never `AppAuthGate`. |
| User can see another user's rows | Treat as P0; inspect `auth.uid()` policy and ensure service role was not used for user-owned queries. |
| Scanner jobs stay processing | Check provider/internal timeouts and final database counts; avoid burst fan-out. |

## Known/deferred constraints

- ChatGPT Web Wyckoff staging uses the contract in `scripts/chatgpt-plus-wyckoff-schedule-prompt.md`. Notion run data source: `4efe8131-196a-4b4e-8a9c-dea48c51a554`; snapshot data source: `f9d84b24-965a-4008-a339-5a62db409ecf`. The production 17:00 ICT weekday cron validates all 500 snapshot keys and publishes only a `Ready` run. Chart OHLC series remain provider-backed because Notion stores analysis facts, not long bar arrays.

- Hosted Auth leaked-password protection still needs to be enabled in Supabase settings.
- CSP remains deferred pending a tested WebSocket/external-source policy.
- Further board throttling should be evidence-driven from authenticated live-session browser profiling; the 250ms quote / 1s ordering split is now the default contract.
- Automated browser screenshot tooling is not guaranteed in every agent runtime; deterministic source tests do not count as pixel QA.
