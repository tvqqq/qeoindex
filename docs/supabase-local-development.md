# Supabase local development

StockOS uses a project-scoped Supabase CLI. Supabase will become the canonical store for operational scanner and signal state in later PRs; this bootstrap does not switch production reads or writes.

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

## Secrets

Copy `supabase/.env.example` to `supabase/.env.local` for local Edge Functions. Real values are ignored by Git. Browser code may eventually receive only the Supabase URL and publishable key; service-role, DNSE, Telegram, and Notion credentials remain server-only.

When a remote project is created, link and deploy only after reviewing the target explicitly:

```bash
pnpm exec supabase login
pnpm exec supabase link --project-ref <PROJECT_REF>
pnpm exec supabase db push --dry-run --linked
```

This repository does not store the project ref, database password, access token, or production Edge Function secrets.
