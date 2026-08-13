# Supabase local development

StockOS uses a project-scoped Supabase CLI. Supabase migrations now define the canonical operational schema for scanner runs, recommendations, signal events, and delivery outboxes. Production reads and writes are not switched on yet; Edge Functions and schedulers remain deferred to later PRs.

## Prerequisites

- Node.js 20.9 or newer
- pnpm
- a Docker-compatible runtime such as Docker Desktop or OrbStack

Do not expose the local Supabase services to the public internet.

## Start and validate

```bash
pnpm install
pnpm supabase:start
pnpm supabase:reset
pnpm supabase:lint
pnpm supabase:test
pnpm supabase:test:concurrency
pnpm supabase:types
```

The local API runs at `http://127.0.0.1:54321` and Studio at `http://127.0.0.1:54323` with the committed default configuration.

Stop services when finished:

```bash
pnpm supabase:stop
```

## Migration workflow

Create timestamped migrations instead of editing a remote database directly:

```bash
pnpm exec supabase migration new descriptive_name
pnpm supabase:reset
pnpm supabase:lint
pnpm supabase:types
```

Commit migrations and the regenerated `lib/supabase/database.types.ts` together. Use explicit `--local` or `--linked` flags because Supabase CLI defaults differ by command.

## Operational signal contract

- `trade_recommendations` stores durable BUY positions and their terminal result. A partial unique index permits only one open recommendation per ticker.
- `signal_events` stores immutable BUY/SELL/EXIT_FAIL/WATCH events. Its idempotency key prevents replayed scanner work from producing duplicate events.
- `monitor_runs` records scheduler execution and coverage metrics.
- `notification_outbox` and `notion_sync_outbox` make downstream delivery retryable without coupling external APIs to the signal transaction.
- `create_buy_signal(...)` atomically creates the recommendation, event, and both outbox records. A concurrent second BUY for the same ticker returns `duplicate`.
- `close_recommendation(...)` locks the open recommendation, records the terminal event and calculated return/alpha, and creates the delivery work atomically.

All operational tables have RLS enabled with no browser-facing policies. The RPCs are executable only by `service_role`; never call them from client components or expose that key to the browser.

The pgTAP suite covers transaction behavior, replay idempotency, calculations, RLS, and privileges. The separate concurrency script uses two database connections to prove the one-open-position invariant under a real race.

## Signal monitor Edge Function

`supabase/functions/signal-monitor` is the operational intraday monitor. It reads the latest Daily scans and open recommendations from Supabase, collects a DNSE WebSocket snapshot, evaluates EXIT before BUY, and commits signals through the transaction RPCs. Telegram and Notion delivery remain asynchronous outbox work.

The function accepts only `POST` with `Authorization: Bearer <SIGNAL_MONITOR_SECRET>`. JWT verification is disabled at the gateway because scheduler calls use this dedicated secret; the handler fails closed when the secret is absent, too short, or incorrect. Each UTC minute has one durable `monitor_runs` claim, so repeated scheduler delivery is a no-op.

For local runtime testing, populate the ignored `supabase/.env.local` and run:

```bash
pnpm exec supabase functions serve --env-file supabase/.env.local --no-verify-jwt
curl -X POST \
  -H "Authorization: Bearer $SIGNAL_MONITOR_SECRET" \
  http://127.0.0.1:54321/functions/v1/signal-monitor
```

Do not use `force` to bypass market-session checks in production. The initial session guard handles weekdays and the HOSE morning/afternoon windows; exchange-holiday support remains deferred to the future `market_calendar` phase.

## Outbox workers

`telegram-dispatch` and `notion-sync` consume bounded batches through transactional claim RPCs using `FOR UPDATE SKIP LOCKED`. Both require `POST` with `Authorization: Bearer <OUTBOX_DISPATCH_SECRET>`. They increment attempts on claim, retry failures with exponential backoff, and mark the fifth failed attempt `dead` for operator review.

Telegram delivery records `sent_at` and the returned message ID. Notion create operations store the resulting page ID on the Supabase recommendation/event so later updates address the same page. Within a claimed batch, recommendation creates are processed before dependent signal-event pages. A downstream failure changes only its outbox item; the committed signal and recommendation remain canonical and untouched.

Optional `TELEGRAM_API_BASE_URL` and `NOTION_API_BASE_URL` overrides exist only for offline local tests such as `scripts/mock-outbox-apis.mjs`. Leave both unset in production.

## Next.js signal read-path

The signal dashboard selects its operational repository explicitly with `STOCKOS_OPERATIONAL_BACKEND=notion|supabase`. The default remains `notion` until a remote Supabase project is provisioned and backfilled. Set `SUPABASE_URL` and server-only `SUPABASE_SERVICE_ROLE_KEY`, then switch the flag to `supabase` to read recommendations and events directly in the Server Component without a browser API round trip.

The selected backend and configuration state are visible in the dashboard. A Supabase read failure is shown and logged; it does not silently fall back to Notion. Never prefix the service-role key with `NEXT_PUBLIC_`.

## Cron activation

The Cron migration installs `pg_cron`, `pg_net`, and guarded installer functions, but deliberately creates no active jobs. Before activation, create these Vault secrets in the reviewed remote project:

- `project_url`: the project URL without a trailing slash;
- `signal_monitor_secret`: the same value configured as the Edge Function `SIGNAL_MONITOR_SECRET`;
- `outbox_dispatch_secret`: the same value configured as `OUTBOX_DISPATCH_SECRET`.
- `scanner_run_secret`: the same value configured as `SCANNER_RUN_SECRET`.

Then run `select * from public.install_stockos_cron();` as an administrator and verify exactly five jobs plus their first entries in `cron.job_run_details`. The signal monitor runs every minute Monday-Friday and still fails closed outside HOSE sessions; both outbox consumers run every minute. At 09:00 UTC (16:00 ICT) Monday-Friday the Daily scanner orchestrator idempotently queues the active 50-ticker universe. Its worker claims at most five jobs per invocation during the bounded 09:00–11:59 UTC window. Use `select public.uninstall_stockos_cron();` for a recoverable rollback.

## Supabase Daily scanner

`stock_universe` is versioned and seeded with the current Top 50 HOSE snapshot. `scanner_runs` and `scanner_jobs` make orchestration, bounded claims, retries, and dead work observable. `daily_scans` is idempotent on ticker, scan date, and engine version. The worker preserves the required history policy: fewer than 60 completed bars fail and retry, 60–199 persist as `Incomplete` with `LOW` confidence, and at least 200 persist as `Complete`. Every row records the actual provider and provider detail. A Notion mirror item is queued only after the Supabase write succeeds; mirror failure cannot roll back the scan.

PR 8 does not switch the web scanner read-path. That remains an explicit PR 9 change after remote scanner jobs and row counts are verified.

## Secrets

Copy `supabase/.env.example` to `supabase/.env.local` for local Edge Functions. Real values are ignored by Git. Browser code may eventually receive only the Supabase URL and publishable key; service-role, DNSE, Telegram, and Notion credentials remain server-only.

When a remote project is created, link and deploy only after reviewing the target explicitly:

```bash
pnpm exec supabase login
pnpm exec supabase link --project-ref <PROJECT_REF>
pnpm exec supabase db push --dry-run --linked
```

This repository does not store the project ref, database password, access token, or production Edge Function secrets.
