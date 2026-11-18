# QeoIndex engineering handover

Last reviewed for Claude Cowork onboarding: 2026-11-18 (ICT).

Architecture and operational evidence below is dated explicitly. This documentation pass is not a new production health or deployment certification.

This document is the canonical fast-start for the active production architecture. Historical architecture is preserved in Git history and explicitly historical design/plan documents; when historical material conflicts with this file, this file wins.

Read `AGENTS.md` first and `docs/README.md` for the complete documentation map. Linear owns current work status; this file owns durable architecture and operations, not mutable task/branch state.


## Claude Cowork: start here

This is a Vietnamese market board and research workspace: realtime quotes/orderbooks, Insights, stock charts, portfolio/risk/performance, research reports, Wyckoff and deterministic/optional LLM Council. Preserve truthful data and responsive interaction. Missing evidence must remain unavailable; a green UI must never be created with synthetic prices, zero-filled unknown metrics or current data substituted for history.

### First-session sequence

1. Open the actual project folder. The owner's existing checkout is `/Users/quyentat/_www/qeoindex`; the remote is [tvqqq/qeoindex](https://github.com/tvqqq/qeoindex).
2. Read `CLAUDE.md`, `AGENTS.md`, [docs index](./README.md), this file, and the touched domain docs. Cowork must explicitly open these files if it does not process Claude Code's `@AGENTS.md` import.
3. Inspect branch, HEAD, working changes and open PRs through available GitHub/file tools. A local checkout can lag remote main; do not reset, overwrite unrelated edits or assume local docs represent the deployed revision.
4. Read the exact requested Linear issue, description, recent comments, related/blocking work and acceptance criteria. [QeoIndex project](https://linear.app/qeoindex/project/qeoindex-a1a694f2af52) is a starting point; the workspace also contains other products. Do not implement a Finqeo or POS issue in this repository solely because it has a QEO identifier.
5. Confirm goal, scope, non-goals and observable acceptance. Follow the engineering handoff workflow below, then inspect the smallest relevant code path and existing tests.
6. Before UI work, read [UI_LESSONS_LEARNED.md](./UI_LESSONS_LEARNED.md). Before Next.js implementation, read the matching version's guides under `node_modules/next/dist/docs/`; do not rely on remembered framework APIs.
7. Make the smallest authorized change through a feature branch/PR. Use GitHub Actions for executable validation under the inline-only policy. Capture limitations honestly.

If Cowork lacks a connector, browser session or approved model, finish the file-based investigation/specification it can perform and identify the exact missing capability. Do not invent command results, pretend to be another model or mark work Done from documentation alone.

### Engineering responsibility and handoff

The owner's workflow is **Astra Light → Sol Light → Luna Max → Sol Light → Astra Light**. The labels express distinct responsibilities; use the owner's approved model mappings if those exact models are available.

- **Astra:** read product/context/Linear, decide WHAT and WHY, acceptance and architecture guardrails; coordinate the issue and final acceptance.
- **Sol:** inspect actual code/data flow, reuse existing patterns, resolve technical questions and produce the implementation specification.
- **Luna:** implement only the approved specification; report files, behavior and validation evidence.
- **Sol:** review and pair on correctness, edge cases, complexity, data integrity, performance and tests.
- **Astra:** accept against criteria, verify CI and relevant runtime evidence, close the loop in Linear.

Do not have every model independently rediscover or redesign the project. A handoff packet contains Goal, Product Behavior, Scope, Non-goals, Acceptance Criteria, Architecture Guardrails, Domain Knowledge, Constraints and only genuine Open Technical Questions. Sol's non-trivial implementation spec contains Objective, Current Flow, Target Flow, Code Path, Files/Modules, Data Flow and appropriate verification. Keep it in the issue or a scoped design record, not a new repo-wide status dump.

### Repository map and ownership

Paths below are relative to repository root. Inspect exact files before editing; this is an ownership map, not a guarantee every historical API is enabled on Firebase.

| Area | Entry / owner | Read next |
| --- | --- | --- |
| Application shell and routes | `app/`, `components/` | `app/layout.tsx`, touched route and shared UI |
| Board and realtime | `app/board/`, `modules/market/board/`, `modules/market/realtime/` | [market-board.md](./market-board.md), relay README |
| Market API and providers | `app/api/market/`, `modules/market/providers/`, `modules/market/universe/` | Auth boundary, data contract and provider adapter |
| Stock/chart data | `modules/market/chart-data/`, `modules/market/history/`, `modules/shared/charts/` | [chart-data.md](./chart-data.md), timeframe/price-basis code |
| Insights and rating | `app/insights/`, `modules/research/insights/` | [insights-homepage.md](./insights-homepage.md), rating model |
| Portfolio | `app/portfolio/`, `modules/portfolio/` | Module README, trades/P&L, risk and performance code |
| Research/reports | `app/research/`, `app/reports/`, `modules/research-reports/`, `modules/notion/` | Touched module README and provider configuration |
| Wyckoff / EOD / Council | `modules/wyckoff/`, `modules/eod/`, `modules/ai-council/`, `workflows/` | EOD runbook and independent worker README |
| Authentication / administration | `modules/auth/`, `modules/admin/`, `app/api/auth/`, `app/admin/` | [auth.md](./auth.md), [security.md](./security.md) |
| Persistence / shared cache | `modules/shared/supabase/`, `modules/shared/cache/`, `supabase/` | Migrations, generated types, hosting cache adapter |
| Independent realtime service | `services/market-realtime-worker/` (Go) | [Worker README](../services/market-realtime-worker/README.md) |
| Independent EOD service | `services/eod-worker/` (Node) | [Worker README](../services/eod-worker/README.md) |
| Private operations | `services/ops-dashboard/`, `services/beszel/`, `ops/` | [Ops dashboard](./operations/ops-dashboard.md), [Beszel](./operations/beszel.md) |
| Verification | `tests/`, `scripts/`, `.github/workflows/` | `package.json`, `scripts/verify-test-contracts.mjs`, suite runner and CI YAML |

### Runtime and data flow

```text
Authenticated browser
  -> Next.js server session / feature authorization
  -> published Supabase reads + bounded Upstash cache + provider adapters
  -> server model / API response -> UI

Browser -> authenticated short-lived relay token -> independent Go relay
  -> bounded in-memory live delivery
  -> asynchronous Supabase checkpoints for hydration/recovery

Independent EOD timer -> EOD v4 readiness / history / Wyckoff
  -> validated Supabase publication -> deterministic Council / downstream work
```

Board SSR must not fan out cold provider-history requests for the full universe. The existing cache-only history seed and later browser bootstrap are intentional. Relay checkpoints are recovery storage, not the canonical live browser transport. Preserve bounded queues, latest-wins semantics where appropriate, ordered execution events, explicit continuity gaps and session-day freshness.

Quotes on the Board are normalized in thousands of VND; input price thresholds are VND. Liquidity filters use canonical 50-session average volume rather than today's accumulating volume. Universe identity is exact published membership, not a hardcoded ticker list or a matching count. Trading-day comparisons use `Asia/Ho_Chi_Minh` and the owned trading calendar; lunch/pre-open inactivity is not automatically a dead feed. Verify each touched adapter's units/time semantics before reuse.

Raw/adjusted price basis, real zero vs unknown, current vs prior session and completed vs live bars are separate meanings. Preserve provenance, partial coverage and explicit unavailable states. Only supported timeframe-engine aggregations may be displayed; never manufacture intraday candles from Daily bars. Do not assume old September timeframe limitations describe every later chart feature: inspect the current engine and tests.

### Configuration and access

The inspected package specifies Next.js `16.3.6`, React `19`, TypeScript and `pnpm@10.28.0`; re-read `package.json` and lockfile at the target commit. Firebase setup records Node 24. Existing install/build folders are not proof that the current branch was validated.

Read key names from the target revision's `.env.example`, `apphosting.yaml` and service example files. Never copy real `.env.local`, `.env.production.local`, provider tokens or protected host environment files into handoffs.

| Configuration | Purpose / boundary |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser-safe connection identifiers; Auth/RLS still required |
| `SUPABASE_SERVICE_ROLE_KEY` | Trusted server infrastructure only; never user-owned row access |
| `APP_URL` | Approved public origin; origin guards must support configured Firebase proxy origins without trusting arbitrary forwarded headers |
| `QEO_HOSTING_PROVIDER=firebase` | Hosting adapter selection; build/runtime scopes matter |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Shared cache; required for acceptable multi-instance Firebase behavior |
| `NEXT_PUBLIC_QEO_MARKET_REALTIME_URL` | Browser WSS endpoint |
| `QEO_MARKET_REALTIME_SIGNING_SECRET` | Server signer must match independent relay; secret references only |
| `ROOT_ADMIN_USER_IDS` | Server-only existing Supabase Auth UUID allowlist |
| Provider / machine / optional research keys | Use exact owning adapter and `.env.example`; do not enable missing services by guessing |

Use connected GitHub for repository operations, Linear for issue state, Firebase/Cloud Run for frontend rollout evidence, Supabase for durable data evidence and approved host access for worker evidence. A Cowork sandbox may not share the Mac path or authenticated browser session; verify actual access first. Record missing access by resource/action, never by secret value.

### Security and performance checklist

- `AppAuthGate` is UX; server session verification and feature authorization protect data.
- User-owned data uses a user-scoped client/JWT and RLS; service-role is infrastructure-only.
- Root access uses UUID allowlists. Machine endpoints require their own secret. Preserve origin checks, HttpOnly cookies and cross-user isolation.
- Keep private operations outside the public Next.js route tree and do not widen network bindings.
- Avoid large persistent blur/backdrop/filter effects, `transition-all`, decorative root typography, chart-container resizing and automatic viewport prefetch on dense ticker links.
- Diagnose React renders, layout, paint/compositing and background fetch/navigation together before blaming chart code.
- Full-universe historical writes require dated sample/coverage/overlap validation; a provider response alone is insufficient.

### Validation, release and completion

`AGENTS.md` prohibits shell/build/test/lint/typecheck/deploy commands by default. Commands documented here and in domain READMEs describe CI/operator contracts; they are **not** blanket permission to run them from Cowork. Do not bypass the policy by using SSH, a remote terminal or a REPL process launcher.

Read CI YAML and `package.json` for actual gates; `Verify / verify` is the documented protected-branch check. A normal source/docs PR needs secret scanning, current tests, touched lint, typecheck and production build evidence. Use targeted domain suites when relevant. Real-browser QA is mandatory for material chart/realtime UI changes; a source-contract test cannot prove smooth interaction.

DB changes add drift/replay/generated-type parity and recovery gates. The resource-specific Supabase deployment rules in `AGENTS.md` still apply to approved resource changes; do not treat them as permission for a risky production migration or skip prerequisite evidence. This documentation task changes no Supabase resource.

For a routine authorized change: feature branch → reviewed PR → exact-head required CI/reviews green → squash merge → one configured Git frontend rollout → serving-SHA/runtime smoke → meaningful Linear completion note. For worker changes also verify the separately released image and scheduling owner. If a check fails, preserve the PR and report the actual blocker; do not force merge or claim release from a successful build alone.

Completion evidence should state: issue/goal, changed behavior, files/PR/merge SHA, exact CI run/head, provider rollout/serving SHA when applicable, browser/runtime observations, acceptance achieved and remaining limits. Keep mutable status in Linear; update this canonical handover only for durable architecture/operations changes.

### Troubleshooting routes

| Symptom | First useful evidence | Guardrail |
| --- | --- | --- |
| Login or token 403 after hosting change | Configured origin guard, `APP_URL`, proxy-origin tests, server session | Do not trust arbitrary forwarded headers or remove origin checks |
| Board loads slowly | Auth/canonical/seed/cache stage timing, cache-only SSR path | Do not restore full-universe cold-history fanout |
| Realtime quiet or repeatedly reconnecting | Trading window, token route, exact origin allowlist, signer match, relay health/epoch/gap | Do not start off-schedule or add a second ingestion producer just to get a green status |
| Chart empty/partial | Symbol mapping, price basis, canonical range, provenance/coverage and API errors | Do not fabricate bars or turn unknown into zero |
| EOD failed/pending | Parent run + phase records, frozen universe, readiness, worker image revision | Dispatch is not success; avoid full reruns as an image smoke |
| Firebase build green but rollout fails | App Hosting rollout, Cloud Run traffic/tags, secret-version dependencies | Do not repeatedly rebuild or reactivate an exposed key |
| Portfolio incomplete | User ownership, funding/trades history, RAW Daily read path | Preserve insufficient-history/funding states |
| Historical valuation missing | Persisted date-specific universe/metrics/coverage | No today-for-history substitution or unvalidated bulk writes |


## Production baseline

This topology follows the dated hosting evidence below; verify current serving and scheduler state before operational changes.

- Product: QeoIndex.
- Production domain: `https://qeoindex.qeoqeo.com`.
- Frontend: Firebase App Hosting, project `qeoindex-vn`, backend `qeoindex-web`, region `asia-southeast1`.
- Preserved former frontend: Vercel project `tvqqq/stockos`; do not assume it is a runnable rollback target.
- Supabase project: `qeoindex` (`glwhhrmejlonhyorvtzm`, Singapore).
- Canonical stock universe: latest published `vn_top_stocks`, maximum 200 tickers.
- EOD execution owner: independent Node worker on UpCloud, `qeo-eod.timer`, 15:01 ICT weekdays; readiness gates still determine publishability.
- The former Supabase `qeoindex-eod-pipeline-1515-ict` scheduler is recorded inactive. Verify live ownership before any scheduling change; never enable a second owner.

Scheduler dispatch is not execution success; use `system_job_runs` and `system_job_phases` for durable EOD evidence.

## Active Wyckoff contract — 1D + 1W only

Wyckoff operational analysis supports exactly two completed-bar timeframes:

- `1D`: canonical raw timeframe.
- `1W`: deterministic weekly aggregation derived from raw Daily bars.

`1H`, `4H`, and `1M` are not active Wyckoff persistence contracts. They must not be written to active Wyckoff snapshots, chart-series read models, UI tabs, watchlist columns, or EOD expected-count calculations.

For `N` canonical stocks:

```text
expected Wyckoff snapshots = N × 2
```

At the current maximum universe of 200 tickers this is 400 snapshots per healthy EOD run.

### Raw OHLCV storage

Persistent Wyckoff raw OHLCV stores `1D` only in `market_ohlcv_history`. Weekly bars are derived from Daily.

A ticker with genuine listing history shorter than the normal bootstrap horizon must transition to bounded Daily delta refresh after a successful full bootstrap rather than repeating a full-history request every EOD. `market_ohlcv_bootstrap_state` records that bootstrap completion state.

The DNSE Daily bootstrap keeps the 366-day fast request window for normal tickers. Retry splitting is limited to transient network/timeout/408/425/429/5xx failures and does not recursively retry auth/permission or explicit non-transient 4xx failures.

See `docs/wyckoff-chart-unified-data.md` for the domain-specific storage/read contract.

## Interactive chart-data contract — raw 1m hot/cold

Interactive stock charts have a separate canonical raw `1m` subsystem. It does not widen or replace the Daily-only Wyckoff/EOD contract above.

- Hot `1m` rows: `chart_ohlcv_intraday`.
- Batch provenance: `chart_ohlcv_provenance_batches`.
- Cold manifests: `chart_ohlcv_cold_manifests`.
- Cold objects: private Supabase Storage bucket `chart-ohlcv`, checksum-addressed `.ndjson.gz`.
- Browser boundary: authenticated `GET /api/market/ohlcv`.
- Baseline feature migration: `20260905065836_qeo92_chart_ohlcv_intraday`; this is not a statement that later production migrations are absent.

The canonical chart-data service validates OHLCV, sorts/deduplicates deterministically, and merges overlapping sources with `hot > cold > daily > provider` precedence. Overlap disagreement is retained as integrity evidence rather than silently hidden. Cold objects must pass SHA-256 verification before their bars participate in a read.

DNSE exact-range `1m` history is the current provider backfill path. Provider failure must never generate synthetic candles or fake OHLCV fallbacks.

Derived intraday timeframes are a separate timeframe-engine concern. Until that engine consumes canonical raw `1m`, unsupported `15m`, `30m`, `1h`, `2h`, `4h`, and similar chart selections must render an explicit unavailable state rather than derive fake candles from Daily bars.

See `docs/chart-data.md` for the detailed interactive-chart persistence/read contract.

## EOD v4 DAG contract

Current-session dependency flow:

1. `KFSP_RATING_REFRESH` refreshes rating data and freezes the exact canonical universe identity.
2. `TTAI_REFRESH` and `MARKET_CLOSE_COLLECT` run as bounded sibling branches.
3. `EOD_READY` verifies exact frozen membership and same-session rating/final-market evidence.
4. `HISTORY_REFRESH` persists Daily-only history in bounded batches/concurrency.
5. Verified no-trade Daily repair runs when required.
6. `WYCKOFF_BUILD` produces exactly `universeCount × 2` 1D/1W snapshots; current-session failures are ticker-isolated where the v4 fault-isolation contract permits it.
7. `SUPABASE_VALIDATE` and `SUPABASE_PUBLISH` verify/publish the canonical operational read model.
8. `AI_COUNCIL_DETERMINISTIC` consumes the healthy published session.
9. `MARKET_SYNTHESIS` runs downstream of deterministic Council.
10. `AI_COUNCIL_LLM` runs selectively/cost-bounded; deterministic Council remains authority.
11. `RETENTION_CLEANUP` runs Supabase-only safe retention and never age-prunes canonical raw Daily history.
12. Notion receives one downstream analytical/audit summary; it is not operational state.
13. `COMPLETE` closes the parent run with `architecture = supabase-first-eod-v4-dag`.

Run key format:

`WYCKOFF-YYYY-MM-DD-EOD-v4`

Historical backfills remain Supabase-only. They verify persistent historical rating/OHLCV evidence and never substitute today's provider market data for a past session.

### EOD invariants

- READY and market-close retry behavior remain fail-closed.
- Exact universe identity/membership matters; count-only equality is insufficient.
- `HISTORY_REFRESH` accounts for every requested ticker and persists Daily only.
- Wyckoff expected count is exactly `universeCount × 2`.
- Operational publication is Supabase-first.
- Google Drive is not part of the active EOD graph.
- Per-ticker Notion operational archive is not part of the active EOD graph.
- Notion analytical summary is downstream and cannot rewrite already-published operational evidence.

See `docs/automation/CRON_WORKFLOW_TOP_STOCKS_200.md` for the canonical EOD runbook.

## Storage lifecycle

Supabase is the operational hot store. Notion is a compact analytical/audit sink only.

For EOD/Wyckoff, raw Daily retention is intentionally fail-closed while Weekly analysis is derived from Daily and no independently verified cold-history hydration/restore path is part of that architecture.

Interactive chart history is a separate exception with an explicit verified hot/cold path: raw `1m` may move between `chart_ohlcv_intraday` and private `chart-ohlcv` objects only through manifest/checksum-aware chart-data code. This does not authorize age-pruning `market_ohlcv_history`.

The active EOD retention implementation only calls approved Supabase cleanup RPCs for transient/terminal evidence such as telemetry, staging, expired raw evidence and build artifacts. It must not delete `market_ohlcv_history` Daily bars merely by age.

Legacy EOD archive-ledger concepts such as `eod_archive_checkpoints`, `market_ohlcv_archive_ranges`, Drive manifests/SHA coverage and per-ticker Notion archive status are not active retention authority. They are unrelated to the current interactive-chart cold manifest contract. Under QEO-65 legacy objects may be physically dropped only after zero-consumer repository + production dependency proof and a no-`CASCADE` migration.

## Database migration safety

Database changes must preserve these gates:

- migration drift reconciliation;
- clean local replay;
- generated Supabase type parity;
- destructive recovery rehearsal where applicable;
- no unexplained production/repository ledger divergence;
- no `CASCADE` for QEO-65 legacy-object deletion.

Important existing migration contracts include:

- `20260901190000_wyckoff_daily_weekly_storage_cutover.sql`: active raw `1D`, active Wyckoff `1D/1W`, bootstrap state and storage constraints.
- `20260901193000_clean_rebuild_top_stocks_200.sql`: approved one-shot rebuild of rebuildable operational state; its production ledger timestamp is reconciled through `supabase/migration-equivalence.json`.
- `20260902011529_clean_rebuild_market_snapshot_trigger.sql`: service-role-only bootstrap of fresh canonical market snapshots after destructive rebuild.
- `20260905065836_qeo92_chart_ohlcv_intraday.sql`: isolated interactive-chart `1m` hot/provenance/cold-manifest schema and private cold Storage bucket; it must not relax the Daily-only `market_ohlcv_history` invariant.

Do not replay SQL merely to make timestamps look identical. `pnpm db:drift:verify` is the reviewed reconciliation gate.

## Clean-rebuild acceptance sequence

After an explicitly approved one-shot rebuild:

1. trigger and verify a new published canonical universe;
2. verify exact membership;
3. bootstrap fresh canonical market snapshots;
4. verify exact same-session snapshot coverage;
5. dispatch EOD only after READY prerequisites exist;
6. verify Daily-only persistent history;
7. verify `universeCount × 2` Wyckoff snapshots;
8. verify downstream phases report their real status.

Do not bypass or weaken `EOD_READY` to make a rebuild appear healthy.

## Manual EOD acceptance

A current-session manual smoke is accepted only when evidence shows:

- `EOD_READY`: exact canonical universe complete for the session;
- `MARKET_CLOSE_COLLECT`: healthy same-session evidence;
- `HISTORY_REFRESH`: complete accounting for every requested ticker;
- persistent raw OHLCV contains `1D` only after a clean rebuild;
- Wyckoff expected count = `universeCount × 2`;
- `SUPABASE_PUBLISH`: same validation hash and exact ticker set;
- deterministic AI Council completes for the healthy canonical universe;
- market synthesis / LLM / retention / analytical summary report their real states;
- `COMPLETE` closes the parent run without hidden skipped critical phases and records `supabase-first-eod-v4-dag`.

For fast troubleshooting, inspect `system_job_runs`, `system_job_phases`, latest `market_universe_runs`, `stock_orderbook_snapshots`, `wyckoff_scan_runs`, `market_ohlcv_history`, and `market_ohlcv_bootstrap_state` before interpreting EOD UI state. For interactive chart-data issues, separately inspect `chart_ohlcv_intraday`, `chart_ohlcv_provenance_batches`, `chart_ohlcv_cold_manifests`, and the canonical chart-data API/service path.

## Hosting evidence and ownership

The [QEO-45 discussion](https://linear.app/qeoindex/issue/QEO-45) records production cutover on **2026-11-05**: Firebase custom domain Connected, HTTPS serving source `5404b074bbbc2cb7c2df2aef7384c75094f38b49`, existing Supabase session recognized and authenticated Board rendered. The domain was removed from Vercel `stockos`; that project's Cron Jobs were disabled. This is dated acceptance evidence, not a claim about today's serving revision.

Firebase revision rollback 006 → 005 → 006 was tested with traffic-only changes. This does not certify the quota-paused former Vercel runtime as a ready rollback. See [hosting-firebase.md](./hosting-firebase.md) for configuration, origin handling, cache, secret rotation and rollback gates.

Important discrepancies remain in older repository text: `AGENTS.md` still names Vercel as the production deployment owner; historical runbooks may name the former Supabase 15:15 EOD schedule. Preserve its PR protection, CI-only execution and no-duplicate-deployment rules. For deployment-affecting work, reconcile provider ownership with the latest approved Linear direction and actual provider configuration before any operational mutation. Do not restore the old topology just to match old prose.

Frontend, realtime and EOD are independently deployed:
- Firebase serves Next.js SSR, APIs and authenticated token issuance.
- The Go relay runs independently on `qeo-onidel`, exposed through `wss://realtime.qeoqeo.com/ws`.
- The EOD Node worker owns its separately built image and timer. A frontend merge does not update that image.
- Supabase remains Auth/Postgres/Storage and durable run evidence; Upstash is the shared cache.
- Workflow-managed starts and direct Council jobs return explicit 503 pauses on Firebase. That does not pause deterministic Council inside the independent EOD graph.

Before declaring a later release complete, read the serving SHA/rollout, active scheduler and actual worker image revision. Do not infer any of them from a Git merge.

### Acceptance limits to recheck when relevant

The migration discussion did not establish normal-market realtime handshake/data acceptance or representative full-session cost/performance. Board cutover smoke occurred during lunch. The 2026-11-04 independent EOD run recorded a Wyckoff chart-series SQL statement timeout; frontend migration did not fix or retry it. Recheck latest run/phase records before treating that historical failure as either still open or resolved. Notion setup was explicitly skipped for the migration.

These are evidence limits, not a prioritized backlog. Linear owns current status and next work.

## Required release gates

### ChatGPT inline code → automatic PR / merge / production

For normal QeoIndex coding requests, the request itself authorizes ChatGPT to implement inline through the GitHub Connector, review the diff, open a PR, wait for required GitHub Actions and reviews, then **squash-merge into `main` without asking again**. The configured frontend Git integration handles its rollout after that merge. The latest recorded production frontend is Firebase; verify current provider ownership as described above. Track work in Linear, verify the deployed merge SHA and provider rollout state, and collect available production smoke evidence before marking Done.

This does not authorize bypassing GitHub protections, running remote/local command-based verification, additional manual deployments, destructive operations, or unreviewed high-risk database/infrastructure/security changes. Stop and report those blockers or request a decision if necessary. Keep one release to one intended frontend rollout; avoid duplicate manual deployments or unnecessary release commits.

For normal source/docs changes:

- `pnpm test:manifest`
- `pnpm test:current`
- `pnpm lint:touched`
- `pnpm typecheck`
- `pnpm build`

`pnpm verify:pr` runs the PR-level secret scan, manifest/current tests, touched lint and typecheck as one command.

For DB-changing releases, additionally run:

- `pnpm db:drift:verify`
- `pnpm db:replay:verify`
- `pnpm db:types:verify`
- DB safety tests/rehearsal required by the touched migration class.

Production acceptance requires the exact GitHub head to be green, the intended frontend rollout to serve the accepted SHA (Firebase App Hosting `Current`, or the verified active provider's equivalent), and runtime smoke evidence. Worker changes additionally require their own image-revision/runtime acceptance.

## Documentation lifecycle

- `docs/HANDOVER.md` is the sole repo-wide architecture handover.
- `docs/README.md` is the navigation/lifecycle index.
- Domain docs may own detailed contracts, but must link back to the canonical architecture rather than duplicate mutable task status.
- Linear owns current task/priority/blocker state. Git history and explicit historical specs/plans preserve old implementation context.
- Do not create `NEXT_AGENT_HANDOFF.md`, `HANDOVER-LEGACY.md`, or similar competing repo-wide status snapshots.
- When architecture changes, update the affected Active docs in the same PR; do not rewrite historical plans to make them look current.
