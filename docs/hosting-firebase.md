# QeoIndex → Firebase App Hosting (staging acceptance before DNS cutover)

Tracking: [QEO-45](https://linear.app/qeoindex/issue/QEO-45).
Production domain: `https://qeoindex.qeoqeo.com`.
Firebase project target: `qeoindex-vn` (https://console.firebase.google.com/u/0/project/qeoindex-vn/overview).
Backend: `qeoindex-web`, region `asia-southeast1`.
Staging: `https://qeoindex-web--qeoindex-vn.asia-southeast1.hosted.app`.
The original `qeoindex` project is not the selected deployment target.
GitHub: `tvqqq/qeoindex`, branch `main`, root `/`.

**Code portability is not deployment acceptance.** A real Firebase App Hosting
backend, its build logs, secrets, runtime tests, and custom DNS still require
provider-side setup. Do not switch the production domain on a CI build alone.

## Why

- Vercel Hobby Fluid Active CPU reached ~3h50/4h (user screenshot dated 2026-11-04);
  `stockos` accounted for 99.3% of team usage. Route-level CPU attribution is
  unavailable; earlier Vercel errors in intraday/metric-history are NOT proof.
- PR #664 added per-instance cold-miss coalescing, bounded metric replay cache
  and authenticated production origin checks.
- PR #665 removed Vercel Cron declarations and paused Supabase cron jobs
  that call Vercel. The **previous deployed Vercel Cron remains active unless
  separately disabled in Vercel Settings** or a new deployment replaces it.
- Current EOD owner: independent UpCloud `qeo-eod.timer` at 15:01 ICT
  weekdays. Verified from `services/eod-worker` and `system_job_runs`.
  Keep it running; do NOT deploy it into App Hosting.

## Runtime contract

| Component | Firebase behavior | Hard acceptance gate |
| --- | --- | --- |
| Next.js SSR / API | Firebase App Hosting adapter; Node 24 | Verify actual build of Next.js 16.3.6 and authenticated end-to-end routes |
| Supabase Auth, RLS, storage | Existing Supabase `glwhhrmejlonhyorvtzm` in Singapore | Copy public keys and service-role secret with build/runtime scopes; no auth leaks |
| UI/market caches | `getHostingCache` returns no-op for Vercel-specific L1; existing Upstash Redis is shared L2 | **Redis credentials required** for acceptable multi-instance CPU; verify invalidation |
| Managed workflow starts | 503 `WORKFLOW_PAUSED_FOR_FIREBASE_MIGRATION` on Firebase; Vercel unaffected | Separate durable worker needed before re-enabling |
| Direct AI Council jobs | Explicitly paused (503) on Firebase | Does not disable deterministic Council inside independently deployed UpCloud EOD |
| Cron jobs | No Vercel `crons` in source; Supabase Vercel-targeting jobs inactive | Never run two scheduling owners |
| Slack alerts | Direct `SLACK_BOT_TOKEN` on Firebase, or Vercel Connect on Vercel | Firebase staging `QEO_ALERTS_ENABLED=false` |
| Vercel Analytics / Speed Insights | Not rendered on Firebase | Use Firebase/Cloud Run logs/metrics |

`QEO_HOSTING_PROVIDER=firebase` is set from `apphosting.yaml` for
BUILD and RUNTIME. Vercel builds omit it and retain Workflow World,
Runtime Cache, analytics, and existing routes. No schema changes are
necessary just to migrate the frontend.

## Console setup for Firebase project `qeoindex-vn`

1. In Firebase Console → **App Hosting**, enable **Blaze billing** if prompted.
   A billing budget alert is not a hard $0 cap. `apphosting.yaml` configures
   `cpu: 1`, `memoryMiB: 1024`, `minInstances: 0`, `maxInstances: 2`,
   `concurrency: 40`, and `cpuAlwaysAllocated: false`. Monitor costs.
2. Create one backend (suggested name: `qeoindex-web`), GitHub repo
   `tvqqq/qeoindex`, live branch `main`, root `/`, region Singapore
   `asia-southeast1` if available, Node 24. Keep Firebase's default
   subdomain as **staging**; do not attach production DNS yet.
3. In backend Settings → Environment, configure **BUILD+RUNTIME** public
   values `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
   Set `APP_URL` to Firebase's assigned staging origin, update after DNS
   cutover. Firebase console variables override `apphosting.yaml` values;
   do not overwrite `QEO_HOSTING_PROVIDER=firebase` or staging alert flag.
4. Use Firebase Secret Manager/App Hosting secret references for
   `SUPABASE_SERVICE_ROLE_KEY`, `UPSTASH_REDIS_REST_URL` and
   `UPSTASH_REDIS_REST_TOKEN`. The Redis URL is not necessarily secret,
   but credentials should never be pasted into source control.
   For optional screens, configure Notion data-source IDs/API token,
   provider keys, and other entries from `.env.example`.
   Keep `OPENAI_API_KEY`, Council scheduler secrets, and
   `QEO_ALERTS_ENABLED` off unless truly needed.
5. Trigger a single App Hosting rollout of the reviewed main commit. Review
   its *actual* framework adapter logs and test the assigned URL; the
   GitHub Firebase-compat workflow only verifies an alternate Next.js build.
   Next.js 16.x may have preview support, so a passing GitHub build alone
   is not sufficient.
6. Smoke anonymous → login → authenticated market board (Top 200),
   intraday mini-charts, stock OHLCV, portfolio, research, administration
   permission checks and origin protection. Verify canonical Supabase reads
   and RLS, Upstash cache hits/TTL/invalidation, Next images, SSR RSC,
   browser realtime WebSocket connectivity, and logs.
7. Confirm disabled workflow/Council endpoints return 503 and do not
   enqueue any jobs. Observe the independent EOD `qeo-eod.timer` ownership.
   After at least one normal market session, compare vCPU, requests, latency,
   bandwidth and projected Cloud Run cost to the Vercel baseline.
8. Only then connect `qeoindex.qeoqeo.com` to Firebase in Console,
   update `APP_URL`/Auth redirect allowlists/OAuth callbacks and confirm
   DNS/TLS. Keep the prior Vercel deployment available as rollback with
   its Cron Jobs disabled. A quota-paused Vercel team is not a ready rollback;
   resolve availability and matching signer configuration before claiming it is tested.

## Previously disabled production schedules (2026-11-04)

`cron.job` records in Supabase project `glwhhrmejlonhyorvtzm`:

- Inactive: `qeoindex-eod-pipeline-1515-ict` (already inactive, replaced
  by independent EOD worker), `research-reports-daily-0705-ict`,
  `qeoindex-chart-universe-bootstrap-retry`.
- Active: `sync-universe-5m`, `sync-universe-5m-afternoon`,
  `market-universe-monthly-0710-ict` (all Supabase Edge),
  and `qeo-board-intraday-minute` (in-database).
- `system_settings['ai_council.llm_enabled']=false` pauses LLM Council
  but is not a global gate for the separately deployed EOD worker.

For **old Vercel deployment Cron Jobs**, open
Vercel → `stockos` → Settings → Cron Jobs → **Disable Cron Jobs**.
Source config `crons: []` applies to future deployments only.

## Realtime relay configuration and signing-key rotation

The independent realtime relay remains on `qeo-onidel`; do not deploy it into
App Hosting or change the independent EOD worker. Configure the frontend
`NEXT_PUBLIC_QEO_MARKET_REALTIME_URL=wss://realtime.qeoqeo.com/ws` and a
Secret Manager reference for server-only `QEO_MARKET_REALTIME_SIGNING_SECRET`.
The signing value must match the relay's protected environment file at
`/opt/qeoindex/env/market-realtime-worker.env` (mode `0600`). Its
`QEO_MARKET_REALTIME_ALLOWED_ORIGINS` must explicitly include production and
the Firebase staging origin; do not use a wildcard. Preserve its market-hours
service schedule. Root administration requires the existing Supabase Auth UUID
allowlist in server-only `ROOT_ADMIN_USER_IDS`, never an email allowlist.

Rotate in this order:

1. Create a new Secret Manager version without disabling versions still used
   by serving, tagged, or rollback revisions. Keep values out of logs and Git.
2. Synchronize the relay and the frontend signer during a controlled window;
   preserve a protected rollback configuration and verify the values match
   without printing them. Do not start the relay outside its normal schedule
   merely to claim live market acceptance.
3. Let the next reviewed Git rollout pin the new version. Verify its runtime
   reference, authenticated token path, and relay handshake during market hours.
4. Before disabling an old version, inspect **all retained Cloud Run revision
   tags and traffic assignments**, as well as rollback dependencies. Remove
   stale tags from failed revisions that are no longer needed. A tagged revision
   referencing a disabled secret can block a later traffic update even at 0%.
5. Disable the old version only after dependent revisions and rollback plans
   have been handled. Do not reactivate an exposed key to repair routing.

If a build succeeds but routing fails because of a stale revision tag, inspect
Cloud Run Revision History, remove only the obsolete tag, and use an already
built healthy revision for a controlled staging recovery. Do not rebuild
repeatedly. Verify a subsequent legitimate Git rollout reaches App Hosting
`Current` without manual traffic recovery before declaring Git deployment
healthy. A successful Cloud Build alone does not prove rollout success.

## Rollback / reactivation

If Firebase staging fails, do not change DNS. After production cutover,
rollback points DNS to a verified, runnable Vercel deployment and restores
`APP_URL`/auth domains, **without** enabling a duplicate cron.
To reactivate paused Supabase jobs later, selectively call
`cron.alter_job(job_id := ..., active := true)` only after verifying
the new durable workflow owner. Remove the QEO-45
`ai_council.llm_enabled` override only upon explicit Council reactivation.

## Official sources

- https://firebase.google.com/docs/app-hosting/get-started
- https://firebase.google.com/docs/app-hosting/configure
- https://firebase.google.com/docs/app-hosting/frameworks-tooling
- https://firebase.google.com/docs/app-hosting/costs
- https://workflow-sdk.dev/worlds/postgres
