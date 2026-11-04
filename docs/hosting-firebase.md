# Firebase App Hosting migration — staging ONLY

This is **not** a production cutover. Canonical operations remain
[HANDOVER.md](./HANDOVER.md), tracked in [QEO-45](https://linear.app/qeoindex/issue/QEO-45).

## Evidence and CPU investigation (2026-11-04)

- User screenshot: Vercel Hobby Fluid Active CPU 3h50/4h (95.8%),
  `stockos` accounts for 99.3% of team usage.
- Runtime error clusters identify timeouts in `/api/market/intraday` and
  `/api/market/metric-history`. These **do not** establish CPU attribution.
- Connected Vercel observability schema and billing APIs return 404. Hobby
  runtime logs have ~1h retention, so route-level CPU cannot yet be proven.
- Current mitigations: per-instance single-flight for 5m intraday cache
  misses; complete writes to shared cache before response; 20s per-user
  memoization for authenticated metric replay. Verify effects with
  comparable traffic windows before claiming quantified CPU savings.

## Firebase requirements

1. Enable Blaze billing for Firebase App Hosting. Free tier is an allowance,
   not a hard $0 guarantee. Set budget alerts and Cloud Run spend caps.
2. Create a separate **staging backend** linked to `tvqqq/qeoindex`.
   Keep the production domain `qeoindex.qeoqeo.com` unchanged.
3. Configure Node 24 and verify the actual Next.js 16.3.6 App Hosting
   build. Recent framework versions may have preview support.
4. Store secrets only in Firebase Secret Manager/console, never in Git.
   Migrate keys in `.env.example`: Supabase auth/service role, providers,
   Redis, OpenAI, schedulers, root-admin, and alerting.
5. Set `APP_URL` for staging origin; validate callback URLs and app origins.
   `NODE_ENV=production` must never allow localhost mutation origins.

## Blocking runtime compatibility gates

- **Durable workflows:** `withWorkflow(nextConfig)` and `workflow/api`
  depend on managed durable backend on Vercel. EOD, AI Council,
  Daily Signals, report analysis, retries and callbacks must move to a
  proven Postgres World/worker implementation, or an already accepted
  Supabase-first worker, with identical persistence/step semantics.
  Merely running Next.js on Firebase does NOT migrate workflow storage.
- **Cache:** Replace `@vercel/functions` `getCache` calls in
  `modules/shared/cache/ui-data-cache.ts`,
  `modules/market/realtime/intraday-5m-service.ts`,
  and `app/api/market/cache/invalidate/route.ts` with a portable
  adapter (Upstash Redis already exists as optional L2). Verify TTLs,
  invalidation and degraded fallback.
- **Scheduler:** `vercel.json` runs `/api/signals/daily` at 07:00 ICT.
  Migrate to Supabase `pg_cron` with machine-secret authorization and
  idempotency. The canonical EOD Supabase cron already runs at 15:15 ICT.
  Prevent duplicate dispatches during cutover.
- **Alerts:** `@vercel/connect` is used for Slack token provisioning.
  Introduce a portable token/alert mechanism and verify failure handling.
- **Network & security:** smoke Supabase SG connectivity and RLS,
  authenticated cookies, origin controls, OAuth callback, streaming
  providers, Next image/PDF, and CDN/SSR behavior on Firebase.

## Rollout gate (never skip)

1. Get GitHub CI green and merge performance/staging config once.
   Do not manually invoke a second Vercel deployment.
2. Connect Firebase staging, set envs, and inspect build logs.
3. Smoke public/login, board, chart, portfolio, insights, admin mutation
   protections, cache invalidation and latency.
4. Run controlled EOD, Signals Daily, AI Council and research workflow
   acceptance **without double-writing production state**.
5. Compare CPU/requests/bandwidth and potential Blaze costs against current
   usage over a complete trading session.
6. Only then switch the production domain and disable old scheduling in a
   coordinated change. Rollback by restoring old routing and scheduler
   ownership; confirm no two active EOD jobs exist.

## Official docs

- https://firebase.google.com/docs/app-hosting/configure
- https://firebase.google.com/docs/app-hosting/costs
- https://firebase.google.com/docs/app-hosting/frameworks-tooling
- https://github.com/vercel/workflow
