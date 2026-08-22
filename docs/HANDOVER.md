# QeoIndex engineering handover

Last updated: 2026-08-21. This is the canonical fast-start document for agents and maintainers.

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

## Market-board lifecycle

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

### Authenticated Insights homepage

- `/insights` is available to every signed-in user, without a separate feature entitlement. Anonymous visitors remain on the login screen.
- Supabase `insights_stock_ratings` is read-only for `authenticated` through RLS and browser-safe column grants; `anon` has no grant. The KFSP Edge Function stages and atomically publishes complete daily snapshots at 07:00 ICT, while provider tokens and diagnostics remain service-role only.
- The provider sends live prices in VND; the sync owns the one-time conversion to thousands of VND and the stable RS aliases before publication. Production was initialized on 2026-08-22 with 1,752 rows and exactly 100 canonical Top 100 rows.
- The rating table supports Top 100/sector filtering, metric tooltips, row keyboard activation, and a nine-tab detail dialog matching the KFSP watchlist contract. The shared KFSP catalog also owns the canonical Top 100 ticker array used by the market board.
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
| `/api/market/intraday` is slow | Inspect Runtime Cache/Redis hit path and whether SSR history reuse suppressed redundant client bootstrap; compare Vercel timeout logs. |
| Charts exist but prices are `—` | Inspect SSR quote/reference selection and intraday cache validity. |
| Prices disappear after close | Verify latest-session history and Supabase snapshot fallback. |
| VNINDEX/VN30 are blank | Inspect `/api/market/indexes`, then DNSE index frames; sockets may be quiet after close. |
| Protected API works anonymously | Treat as P0; inspect `requireApiFeature`/machine bearer auth and RLS, never `AppAuthGate`. |
| User can see another user's rows | Treat as P0; inspect `auth.uid()` policy and ensure service role was not used for user-owned queries. |
| Scanner jobs stay processing | Check provider/internal timeouts and final database counts; avoid burst fan-out. |

## Known/deferred constraints

- Hosted Auth leaked-password protection still needs to be enabled in Supabase settings.
- CSP remains deferred pending a tested WebSocket/external-source policy.
- Further board throttling should be evidence-driven from authenticated live-session browser profiling; the 250ms quote / 1s ordering split is now the default contract.
- Automated browser screenshot tooling is not guaranteed in every agent runtime; deterministic source tests do not count as pixel QA.
