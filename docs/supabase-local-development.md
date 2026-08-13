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

## Secrets

Copy `supabase/.env.example` to `supabase/.env.local` for local Edge Functions. Real values are ignored by Git. Browser code may eventually receive only the Supabase URL and publishable key; service-role, DNSE, Telegram, and Notion credentials remain server-only.

When a remote project is created, link and deploy only after reviewing the target explicitly:

```bash
pnpm exec supabase login
pnpm exec supabase link --project-ref <PROJECT_REF>
pnpm exec supabase db push --dry-run --linked
```

This repository does not store the project ref, database password, access token, or production Edge Function secrets.
