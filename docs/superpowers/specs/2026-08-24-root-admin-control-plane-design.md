# Root Admin Control Plane Design

**Status:** Approved for implementation planning on 2026-08-24  
**Owner:** Current QeoIndex user, identified by Supabase Auth UUID  
**Route:** `/admin`

## Purpose

Build a root-only operational control plane for QeoIndex. The page inventories system configuration, resolves a typed allowlist of runtime-safe overrides, monitors scheduled and manually triggered jobs across Vercel and Supabase, permits bounded manual reruns, and records an immutable audit trail.

The control plane is not a deployment manager, secret manager, or generic environment editor. It must expose the whole known configuration and job inventory while preserving different mutation policies for runtime-safe, build-time, infrastructure, and secret values.

## Decisions

- Root authorization uses a server-only comma-separated `ROOT_ADMIN_USER_IDS` allowlist of Supabase Auth UUIDs.
- The current signed-in user is the initial and only intended root. The UUID is configured in local/Vercel environment state and is never committed.
- Root is not a database role and cannot be granted by a browser write.
- The MVP uses an app-owned control plane: a TypeScript catalog plus Supabase runtime state and telemetry.
- The UI shows all known configuration categories. Only catalog entries marked runtime-safe are editable.
- Build-time and infrastructure values are read-only. Secret values are never returned; only `configured` or `missing` is returned.
- Cron expressions, provider management configuration, deployments, and secret rotation are outside the mutation scope.
- Manual job execution is an explicit per-job allowlist. Destructive or duplicate-prone jobs remain disabled.

## Security Boundary

`AppAuthGate` remains a UX gate. Root authorization is enforced independently on every server page load and every admin API call.

```text
Supabase Auth session
  -> verified HttpOnly server session
  -> server user.id
  -> ROOT_ADMIN_USER_IDS exact UUID match
  -> root-only server service
  -> service-role Supabase client
  -> admin tables with no browser grants
```

### Root helpers

`lib/auth/root.ts` owns strict parsing and authorization:

- `parseRootAdminUserIds(raw?: string): Set<string>` accepts canonical UUIDs only and ignores invalid entries.
- `isRootAdminUserId(userId: string, raw?: string): boolean` performs an exact membership check and fails closed when unconfigured.
- `requireApiRoot()` wraps `requireApiUser()` and returns HTTP 403 for a signed-in non-root user.
- Server pages call `getServerAuthContext()` and `isRootAdminUserId()`; `/admin` calls `notFound()` for anonymous or non-root access.

The root boolean may be passed from the root server layout into the existing client auth context so `TopNav` can render an Admin link. This is only navigation UX and never authorization.

### Mutation safeguards

- Admin mutations accept same-origin requests only. The handler compares the request `Origin` against the configured production/local app origin and fails closed in production when it cannot establish an allowed origin.
- Payloads are parsed and validated against the code catalog. Arbitrary setting keys and arbitrary job keys are rejected.
- Settings use optimistic concurrency through a monotonically increasing `version`; stale writes return HTTP 409 with the current sanitized record.
- High-impact editable settings and every manual job run require a non-empty reason between 8 and 240 characters.
- Responses and audit rows pass through a sanitizer that removes secret-like keys, bearer values, tokens, cookies, authorization headers, raw provider payloads, and stack traces.
- API responses use `Cache-Control: private, no-store, max-age=0`.

## Control-Plane Catalog

`lib/admin/catalog.ts` is the source of truth for configuration and job metadata. It is code-reviewed and cannot be extended through the UI.

### Configuration entry

```ts
type AdminSettingDefinition = {
  key: string
  group: "system" | "provider" | "cache" | "market" | "scanner" |
    "signals" | "wyckoff" | "ai_council" | "ui" | "integration"
  label: string
  description: string
  type: "boolean" | "integer" | "number" | "string" | "enum" |
    "ticker_list" | "url"
  source: "runtime" | "environment" | "code" | "build"
  envKey?: string
  defaultValue?: unknown
  editable: boolean
  sensitivity: "public" | "internal" | "secret"
  impact: "low" | "medium" | "high"
  requiresDeployment: boolean
  validate(value: unknown): AdminValidationResult
}
```

The first release inventories every key in `.env.example`, every additional `process.env` key used by application code, the four Vercel cron schedules, the active Supabase `pg_cron` jobs, and important code-owned safety constants. Duplicate aliases such as `NOTION_TOKEN` and `NOTION_API_KEY` are represented as one capability with documented precedence.

Initial runtime-editable settings are deliberately bounded:

| Key | Type and bounds | Runtime consumer |
| --- | --- | --- |
| `admin.refresh_interval_seconds` | integer 15-300, default 30 | Admin polling interval |
| `admin.job_history_limit` | integer 20-200, default 50 | Admin job history query |
| `scanner.manual_run_limit` | integer 1-100, default 100 | Default bounded manual scanner run |
| `ai_council.llm_enabled` | boolean | AI Council debate selection |
| `ai_council.llm_max_tickers` | integer 1-6, default 3 | AI Council LLM run cap |
| `ai_council.llm_tickers` | canonical ticker list, max 100 | Explicit debate watchlist |
| `ai_council.research_tickers` | canonical ticker list, max 100 | Curated research context |

Existing safety contracts remain read-only in MVP, including the Top 100 cap, scanner 60/200-bar policy, Wyckoff 500-snapshot completeness rule, provider concurrency ceiling 12, provider timeout ceilings, market-session schedules, cron expressions, cache namespace versions, and AI model/effort routing. They remain visible with source and deployment requirements.

### Resolution

For an editable runtime key:

```text
valid Supabase override -> environment value -> code default
```

For read-only entries, the catalog reports the environment/build/code source without creating an override. Secret entries return readiness only.

`lib/admin/settings.ts` loads all overrides in one service-role query, validates stored values again, and produces a typed snapshot. The snapshot is cached briefly and invalidated after a successful update. A Supabase read failure falls back to environment/code defaults and marks the snapshot `degraded`; it never prevents protected product pages from loading.

Runtime consumers use focused helpers rather than accessing the generic catalog. For example, AI Council uses `getAiCouncilRuntimeConfig()` and the admin page uses `getAdminUiConfig()`. Existing defaults must remain byte-for-byte equivalent when no override exists.

## Persistence

A migration creates three private tables.

### `system_settings`

- `key text primary key`
- `value jsonb not null`
- `version bigint not null default 1`
- `updated_by uuid references auth.users(id) on delete set null`
- `change_reason text not null`
- `created_at`, `updated_at timestamptz`

Updates are performed through a server service using a compare-and-swap filter on `(key, version)`. Inserts use version 1. Resets delete the override and expose the next fallback source.

### `system_job_runs`

- `id uuid primary key default gen_random_uuid()`
- `job_key text not null`
- `provider text not null`
- `trigger text` constrained to `schedule`, `manual`, `workflow`, or `external`
- `status text` constrained to `queued`, `running`, `succeeded`, `failed`, or `skipped`
- nullable `actor_user_id`, `provider_run_id`, `started_at`, `finished_at`, `duration_ms`
- sanitized `summary jsonb`, `error_code`, and `error_message`
- `created_at timestamptz`

Indexes support latest run by job and recent global history. A manual runner rejects a second recent `queued` or `running` row for the same job with HTTP 409. Runs older than the catalog's maximum duration are presented as stale rather than blocking forever.

### `system_audit_log`

- generated identity primary key
- `actor_user_id uuid`
- `action`, `target_type`, `target_key`
- sanitized `before_value`, `after_value jsonb`
- `reason`, `request_id`, `success`, optional `error_message`
- `created_at timestamptz`

The three tables enable RLS, revoke all privileges from `anon` and `authenticated`, and grant only `service_role`. The migration also exposes a `security definer` RPC executable only by `service_role` that returns a sanitized Supabase cron snapshot. It exposes job name, schedule, active status, last start/end and normalized status; it never returns SQL command text, Vault content, headers, or raw response messages.

## Job Inventory and Telemetry

The job catalog normalizes these sources:

### Vercel Cron

- `signals.daily` — `0 0 * * 1-5` UTC / 07:00 ICT weekdays; manual run disabled because duplicate workflows are unsafe.
- `wyckoff.ingest` — `0 10 * * 1-5` UTC / 17:00 ICT weekdays; manual run requires confirmation.
- `ai_council.daily` — `15 10 * * 1-5` UTC / 17:15 ICT weekdays; manual run disabled in MVP to avoid duplicate publication.
- `ai_council.debate_daily` — `25 10 * * 1-5` UTC / 17:25 ICT weekdays; manual run disabled in MVP because it is duplicate-prone and cost-bearing.

### Supabase `pg_cron`

- `sync-universe-5m` — five-minute market-session sync.
- `sync-universe-eod-1450` — closing snapshot sync.
- `kfsp-rating-daily-7am-ict` — KFSP rating publication.
- `kfsp-ttai-history-hourly` — incremental TTAI history refresh.

Supabase cron entries are read-only in MVP. Their schedule and active flag come from the sanitized RPC, while application run tables such as `kfsp_rating_sync_runs` and `kfsp_ttai_sync_runs` provide domain outcomes.

### Manual/machine operations

- `scanner.run` — allowed with bounded `limit` and `offset`.
- `signals.monitor` — allowed with explicit confirmation; it does not start the daily workflow.
- `market.sync_universe` — allowed with explicit confirmation.
- `market.cache_invalidate` — disabled because it is destructive.
- `wyckoff.run` — disabled until its overlap with the canonical external staging workflow is resolved.

Each instrumented app job uses `executeSystemJob()` to create and finalize a `system_job_runs` row. Provider-native identifiers such as a Vercel Workflow `runId` are stored separately. Errors are logged in full to server logs but persisted and returned only after sanitization.

Health is derived, never hand-authored:

- `healthy`: last expected run succeeded and is within its freshness window.
- `degraded`: skipped/partial domain result or a source adapter failed while other data loaded.
- `failing`: most recent completed run failed.
- `stale`: no completion within the catalog freshness window or a running row exceeded maximum duration.
- `unknown`: insufficient telemetry, including newly instrumented jobs before their first run.

The page distinguishes scheduled business time in `Asia/Ho_Chi_Minh` from the provider's UTC expression and from downstream ingestion time.

## Admin API

All routes use the Node.js runtime and are force-dynamic.

| Method and route | Purpose |
| --- | --- |
| `GET /api/admin/system` | Sanitized overview, source health, environment inventory, resolved settings, job status and recent audit rows |
| `PATCH /api/admin/settings/[key]` | Create/update one typed override with expected version and reason |
| `DELETE /api/admin/settings/[key]` | Reset one override with expected version and reason |
| `POST /api/admin/jobs/[key]/run` | Execute one allowlisted manual job with reason, confirmation and bounded parameters |

The overview is assembled with `Promise.allSettled`. Failure of Supabase cron inspection, Slack health, a provider-domain run table, or runtime settings produces a source-level degraded card while the remainder of the page still loads.

## User Interface

`/admin` is a server-protected page that renders a focused client dashboard. It uses the existing QeoIndex visual language without expensive blur/filter stacks or ambient animation.

The page contains four views:

1. **Overview** — root identity, deployment/build metadata, Supabase/Redis/Notion/DNSE/Slack readiness, job health counts, degraded sources and last refresh.
2. **Jobs** — responsive job table/cards with source, ICT schedule, UTC expression, last result, duration, freshness, next expected window and allowed action. Manual runs open a confirmation dialog requiring a reason.
3. **Settings** — searchable grouped inventory showing resolved value or readiness, source, override/default state, editability, validation bounds and deployment requirement. Save/reset operates per setting.
4. **Audit** — newest-first root mutations and manual runs with actor, target, reason, timestamp and result. Secret-like values are never rendered.

Polling defaults to 30 seconds, runs only while the page is visible, and can be changed through the runtime setting. A manual refresh button is always available. Mutations pause polling and reconcile from the server response. No optimistic value is treated as saved until the server returns the new version.

The Admin navigation item uses `prefetch={false}` and renders only when the server-authenticated root boolean is true. Mobile layouts use stacked cards instead of forcing a wide table.

## Error Handling

- Root auth and service-role absence fail closed.
- Overview sources fail independently and expose a short sanitized diagnostic.
- Invalid catalog definitions fail tests/build; invalid persisted overrides are ignored at runtime and surfaced as degraded.
- Setting conflicts return 409 and prompt the UI to reload the current value.
- Manual execution conflicts return 409 with the active run ID.
- Provider/API failures finalize the telemetry row as failed and create a failed audit row.
- Audit failure blocks a setting mutation from being reported as successful. Job execution retains its telemetry result even if the secondary audit write fails, and the response reports degraded audit state.
- Persisted summaries cap arrays, object depth, strings, and total encoded bytes.

## Testing and Acceptance

### Deterministic tests

- UUID allowlist parsing and fail-closed root checks.
- Root API/page source contracts and non-root behavior.
- Catalog uniqueness, complete environment inventory, validation bounds, secret redaction and resolution precedence.
- Migration tables, RLS, grants and sanitized cron RPC contract.
- Optimistic concurrency, reset fallback, audit payload sanitization and degraded settings fallback.
- Job health derivation, stale detection, manual policy and concurrent-run rejection.
- Admin API method/auth/origin/payload contracts.
- Navigation exposes Admin only through the server-provided root capability and disables prefetch.
- Admin UI contains no `backdrop-blur`, large CSS filter stack, `transition-all`, or aggressive polling.

### Required local validation

```bash
pnpm test:core
pnpm test:supabase
pnpm lint:touched
pnpm typecheck
pnpm scan:secrets
pnpm exec next build --webpack
```

If the implementation adds a Supabase migration, repository policy requires applying it with `npx supabase db push` after local schema tests pass. A release still follows the normal feature branch -> PR -> approved merge to `main` -> single Vercel Git deployment flow. No manual production deployment is allowed.

### Browser acceptance

- Anonymous and normal users cannot open `/admin` or any admin API.
- The configured root sees the Admin navigation item and page.
- No response or rendered HTML contains a configured secret value.
- A runtime setting can be saved, observed in its real consumer, audited, conflicted with a stale version, and reset to its fallback.
- Each enabled manual action records one run and one audit entry; disabled jobs cannot be invoked by constructing an API request.
- Vercel and Supabase jobs display separate provider/source, UTC expression and ICT business timing.
- The page remains readable on mobile and stable during refresh/manual execution.

## Delivery Slices

1. Root authorization and private persistence.
2. Complete read-only inventory and normalized system overview.
3. Typed runtime settings with AI Council and admin consumers.
4. Job telemetry and bounded manual actions.
5. Admin UI, audit view, documentation and browser verification.

Each slice must leave tests passing and preserve existing behavior when `ROOT_ADMIN_USER_IDS` or Supabase admin tables are not configured.

## Explicitly Deferred

- Editing cron expressions, enabling/disabling provider schedules, or changing timezone rules.
- Editing Vercel/Supabase environment variables or secrets.
- Triggering deployments or applying production environment changes from the UI.
- Multi-role RBAC, delegated admins, invitations, approval workflows, or impersonation.
- Secret rotation, secret reveal, raw logs, stack traces, SQL consoles, arbitrary HTTP calls, or arbitrary JSON settings.
- Automatic retry policies and alert-rule editing.
- Cross-project infrastructure management.
