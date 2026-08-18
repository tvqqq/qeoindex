# QeoIndex engineering handover

Last updated: 2026-08-18. This is the canonical fast-start document for agents and maintainers.

## Product and production

- Product: QeoIndex — a realtime/EOD Vietnamese stock board plus research, scanner, recommendation, and signal workflows.
- Brand slogan: `Đọc thị trường. Giữ kỷ luật.`
- Official domain: <https://qeoindex.qeoqeo.com>.
- Framework: Next.js 16 App Router, React 19, TypeScript, Tailwind CSS 4, pnpm.
- Vercel project: `tvqqq/stockos` remains the legacy infrastructure slug; it is not the product brand.
- Infrastructure fallback alias: <https://stockos-beryl.vercel.app>.
- Primary page: `app/page.tsx` renders `components/live-market-board-v2.tsx` inside the order-book provider.

Read `AGENTS.md` before editing. This repository uses a Next.js version with local, version-specific documentation under `node_modules/next/dist/docs/`; do not assume older Next.js behavior.

## Non-negotiable data boundaries

| Concern | Canonical source | Important rule |
| --- | --- | --- |
| Top 100 membership, rank, market cap, sector | Notion `Wyckoff Universe — Top 100 HOSE` | Notion is source of truth. Never silently replace membership with a hard-coded market list. |
| Daily scans and persistent research state | Notion | If Notion is unavailable, fail visibly. Market feeds are not a persistence substitute. |
| Intraday/EOD stock chart bootstrap | Yahoo Finance `.VN`, server-side | Keep fetches bounded and discard zero OHLC placeholders. |
| Realtime stocks and indices | DNSE WebSocket | Credentials and signed auth remain server-side. REST/EOD data stays visible when no live tick arrives. |
| Index bootstrap | TradingView Vietnam scanner, server-side | VNINDEX/VN30/HNXINDEX snapshot first; DNSE overwrites when live. |
| Shared market-board cache | Vercel Runtime Cache; optional Upstash Redis L2 | Cache failure must fail open to the provider. |
| Optional broker/live adapter | Finhay MCP OAuth | Tokens are stored in secure HTTP-only cookies and never exposed through `NEXT_PUBLIC_*`. |

The local `lib/wyckoff-universe.ts` constant defines the safety cap (`UNIVERSE_SIZE = 100`), not canonical production membership.

## Repository map

| Path | Responsibility |
| --- | --- |
| `app/page.tsx` | Reads Notion-backed scanner data and builds the market-board universe. |
| `components/live-market-board-v2.tsx` | Board state, Yahoo/index bootstrap, DNSE WebSocket lifecycle, filters, grouping, statistics. |
| `components/live-market-stock.tsx` | Compact stock rows, movers cards, price typography, mini charts, +3% highlight. |
| `lib/market-sectors.ts` | Canonical sector fallback and the six visual board groups. |
| `app/api/market/intraday/route.ts` | Bounded Top 100 Yahoo snapshot and two-level cache. |
| `lib/yahoo-history.ts`, `lib/intraday-5m.ts` | Provider parsing, latest-session fallback, normalization, merge logic. |
| `app/api/market/indexes/route.ts`, `lib/tradingview-index.ts` | Index snapshot fallback for VNINDEX/VN30/HNXINDEX. |
| `app/api/market/stream-auth/route.ts` | Server-side DNSE WebSocket authorization. |
| `components/orderbook/`, `lib/dnse-market-runtime.ts` | Order-book panel and DNSE session history/runtime. |
| `components/research/`, `app/research/` | Research, scanner, recommendation, signal, and review interfaces. |
| `lib/scanner-data.ts`, `lib/scanner-runner.ts` | Notion persistence reads and scanner orchestration. |
| `tests/market-board-visual-contract.test.ts` | Deterministic source-contract regression guards for board layout/EOD/highlight invariants; not screenshot QA. |
| `docs/market-board.md` | Detailed board data flow and regression expectations. |
| `docs/build-performance.md` | Measured build baseline, CI/cache policy, and build-optimization measurement rules. |

## Market-board lifecycle

1. The server page reads the active Top 100 and latest Daily scans from Notion.
2. The browser requests `/api/market/intraday` once for the full symbol list.
3. The server fetches Yahoo 5-minute bars with concurrency `12`, validates positive OHLC, selects today or the latest completed session, and returns chart plus quote atomically.
4. The UI derives display prices in this order: DNSE live quote → Yahoo chart close → latest Notion Daily close.
5. `/api/market/indexes` hydrates VNINDEX, VN30, and HNXINDEX. DNSE index events replace bootstrap values when available.
6. The DNSE socket subscribes to tick, top-price, OHLC, and index channels; a 60-second stale watchdog reconnects automatically.

Do not introduce a 100-request browser fan-out. Provider calls belong on the server and must retain explicit timeouts (normally 8 seconds).

## Current board structure and UI invariants

The board has six visual groups:

1. Ngân hàng
2. Chứng khoán
3. Tiêu dùng & Bán lẻ
4. Bất động sản
5. Công nghiệp & Vật liệu + Công nghệ
6. Các ngành còn lại

`Năng lượng`, `Điện & Utilities`, `Hàng không & Du lịch`, `Bảo hiểm`, and `Logistics` render inside `Các ngành còn lại`; their canonical sector values remain unchanged.

Responsive grid: one column by default, two at `sm`, three at `lg`, and all six on one row at `xl`. Group headers use a fixed `72px` height. Stock rows have strong separators, a larger ticker than price, no visible rank, and a restrained green pulse at `changePercent >= 3`. Preserve the `prefers-reduced-motion` fallback in `app/globals.css`.

`tests/market-board-visual-contract.test.ts` enforces the source-level contract for these invariants and the after-close price/chart fallback. It does not replace real browser screenshot/pixel visual QA.

## EOD and provider correctness

- After the close, both price and mini chart must remain visible.
- Yahoo may return zero-priced candles outside the session. `normalizeFiveMinuteBars` and the Yahoo parser reject them; cache validation also requires positive price/reference/points.
- If today's session is unavailable (weekend/holiday/provider delay), use the latest session within the seven-day Yahoo window.
- Index values cannot depend only on DNSE: there may be no post-close WebSocket frame.
- SSI iBoard worked from a local network but returned HTTP 403 from Vercel's datacenter. Do not restore it as the production index fallback without a live Vercel smoke test.
- Keep provider provenance explicit. A successful fallback is not the same as a healthy primary provider.

## Scanner and operations

- `/api/scanner/run` accepts GET/POST and requires `SCANNER_RUN_SECRET` or `CRON_SECRET` in production.
- Limit and offset are bounded by `UNIVERSE_SIZE`.
- `/api/scanner/health` checks one symbol by default; `?coverage=1` checks the full Notion universe in batches of ten.
- Market-history providers use bounded timeouts. Do not reintroduce unbounded `pg_net` or provider fan-out.
- `scannerHistoryPolicy` is the canonical runner/persistence/health policy: fewer than 60 completed Daily bars are rejected; 60–199 bars are persisted as `Incomplete` with forced `LOW` confidence; 200 or more bars are persisted as `Complete` and can use the engine confidence normally.
- Same-date persistence is monotonic: an existing `Complete` row is skipped even if a provider later returns only `Incomplete` history; an `Incomplete` row is skipped while history remains incomplete, but is rerun when history reaches `Complete` so it can upgrade. Provider-history regression must not downgrade already-complete persisted research.
- Scanner health treats both `Incomplete` and `Complete` histories as scannable, reports them separately, and preserves provider provenance. Fewer than 60 bars remain insufficient.
- Never claim a batch completed from progress logs alone. Query final run/job/scan/outbox counts.

## Environment and security

Use `.env.example` as the inventory. Main categories are Notion data-source IDs/token, DNSE credentials and URLs, optional Upstash Redis, Finhay OAuth, scanner/monitor/cron secrets, and Slack connector configuration.

- Never commit credentials or put them in `NEXT_PUBLIC_*` variables.
- Never print tokens in logs or handover documents.
- Run `pnpm scan:secrets` before release.
- DNSE credentials exposed before the P0 cleanup must remain rotated; see `docs/security.md`.
- Legacy identifiers such as existing `stockos_*` cookie names or connector IDs may be retained deliberately to preserve sessions/integrations; do not treat them as public branding.

## Validation matrix

| Change area | Minimum targeted checks |
| --- | --- |
| Universe/sectors/groups | `pnpm test:universe` |
| EOD/mini chart/DNSE merge | `pnpm test:intraday` |
| Board layout/highlight/source contract | `pnpm test:board-contract` plus browser visual QA when tooling is available |
| VNINDEX/VN30/HNXINDEX | `pnpm test:indexes` plus production `/api/market/indexes` smoke |
| Scanner policy | `pnpm test:scanner-core` |
| Signal rules | `pnpm test:signal-core` |
| Core regression suite | `pnpm test:core` |
| Scanner/UI files touched by current improvement | `pnpm lint:touched` |
| Any TypeScript/UI change | targeted ESLint, `pnpm typecheck`, `pnpm build --webpack` |
| Security/env change | `pnpm scan:secrets` |

`pnpm build` runs `test:core`, cached `lint:touched`, and `scan:secrets` through `prebuild`; the subsequent Next.js production build performs the production TypeScript check. GitHub Verify additionally runs standalone `pnpm typecheck`. Full `pnpm lint` still has pre-existing warnings outside the market-board scope; broad lint cleanup remains a separate change. See `docs/build-performance.md` for the measured build/cache policy.

## Git and deployment workflow

Production deployment has exactly one normal trigger: **Vercel Git Integration on `main`**.

```text
feature/work branch
  -> local validation
  -> commit + push branch
  -> PR / squash or merge once into main
  -> Vercel Git Integration creates one production deployment
  -> inspect deployment status/logs
  -> smoke qeoindex.qeoqeo.com and changed APIs
```

Rules:

- `vercel.json` intentionally disables Git deployments for every branch except `main`.
- Work branches are for development and validation; they must not create Vercel deployments.
- Merging/pushing an approved release to `main` is the deployment action. Do not also run `vercel --prod`, `vercel deploy --prod`, a Deploy Hook, or a second API deployment for the same release.
- Vercel CLI/MCP/API may be used to inspect deployments and logs. Inspection is not a reason to create another deployment.
- Manual production deployment is an exceptional recovery path only. It requires explicit user authorization and confirmation that Git auto-deploy will not also run for that release.
- If the deployment API returns a quota/rate-limit error, stop retrying. Do not create repeated deployment attempts while waiting for the quota window to recover.
- Target invariant: **one approved release merged to `main` → one Vercel production deployment**.

## Release checklist

1. Review `git status` and preserve unrelated user changes.
2. Run area-specific tests and targeted ESLint.
3. Run `pnpm typecheck` and `pnpm build --webpack`.
4. Run `pnpm scan:secrets` for release/security-sensitive changes.
5. Commit and push the work branch. Do not create a manual Vercel production deployment.
6. When the release is approved, merge/squash once into `main`. The `main` update triggers Vercel Git Integration automatically.
7. Observe the Git-triggered deployment until it reaches `READY`. Do not redeploy merely to verify it.
8. Smoke the official page `qeoindex.qeoqeo.com` and any changed API. For market data, inspect actual values/errors, not only HTTP status.
9. If Vercel is quota/rate limited, report the release as blocked and stop deployment retries until the limit resets.

## Fast debugging guide

| Symptom | First checks |
| --- | --- |
| Charts exist but prices are `—` | Inspect `/api/market/intraday`; reject zero closes/reference and invalidate old cache version. |
| Prices disappear after close | Verify Yahoo latest-session fallback and UI display-quote order. |
| VNINDEX/VN30 are blank | Inspect `/api/market/indexes`, then DNSE index frames; do not assume the socket emits after close. |
| `History 98/100`, `Có giá 0/100` | Ensure derived display quotes use chart/Notion fallback consistently across cards and counters. |
| Scanner jobs stay `processing` | Check provider/internal timeouts and final database counts; avoid burst fan-out. |
| Notion page fails locally | Configure `NOTION_API_KEY` and data-source IDs; the unavailable state is intentional. |

## Deferred/known constraints

- UPCOM-INDEX currently relies on DNSE because the server snapshot covers VNINDEX, VN30, and HNXINDEX only. A temporary TradingView candidate-symbol probe was removed after Vercel preview protection prevented reliable provider verification; do not add an unverified fallback.
- Automated browser screenshot tooling is not guaranteed in every Codex runtime; source-contract tests do not count as screenshot/pixel visual QA.
- The current working tree may contain a larger unreleased feature set. Never reset or overwrite unrelated changes to isolate a documentation task.
