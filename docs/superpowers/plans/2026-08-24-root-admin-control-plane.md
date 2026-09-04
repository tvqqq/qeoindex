# Root Admin Control Plane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a root-only `/admin` control plane that inventories configuration, applies typed runtime-safe settings, monitors QeoIndex jobs, permits bounded manual reruns, and records sanitized audit history.

**Architecture:** A server-only Supabase UUID allowlist establishes root authority. A code-reviewed TypeScript catalog defines every visible setting/job and its mutation policy; private Supabase tables store runtime overrides, normalized job telemetry, and audit rows. Admin APIs compose sanitized source adapters, while the browser receives no service credential, bearer secret, raw provider payload, or secret value.

**Tech Stack:** Next.js 16.3 App Router, React 19, TypeScript 5.7, Tailwind CSS 4, Supabase Postgres/RLS/service role, Node test runner, pnpm.

**Spec:** `docs/superpowers/specs/2026-08-24-root-admin-control-plane-design.md`

## Global Constraints

- Root is an exact Supabase Auth UUID in server-only `ROOT_ADMIN_USER_IDS`; fail closed when the allowlist is missing or malformed.
- `/admin` returns 404 to anonymous/non-root users; admin APIs return 401 for anonymous users and 403 for authenticated non-root users.
- All known settings/jobs are inventoried, but only catalog entries marked runtime-safe or manual-safe are mutable.
- Build/infrastructure configuration is read-only; secret values are never loaded into an API payload or persisted audit payload.
- Cron expressions, deployments, environment writes, provider management APIs, and secret rotation are outside scope.
- Existing application behavior is unchanged when no runtime override exists or the admin persistence layer is unavailable.
- Scheduled product jobs fail open on telemetry failure; root mutations fail closed when authorization, validation, persistence, or required audit cannot complete.
- Every mutation validates same-origin, expected setting version, catalog key, typed value, reason, and manual policy.
- UI performance rules from `AGENTS.md` and `docs/UI_LESSONS_LEARNED.md` apply: no persistent blur/filter stacks, no `transition-all`, bounded polling, `prefetch={false}`.
- Supabase migrations must revoke `anon`/`authenticated`, grant only `service_role`, pass schema tests, then be applied with `npx supabase db push` per repository policy.
- Do not push or merge `main`; Vercel production deployment remains a separate approved Git-integration release.

---

## File Map

| Path | Responsibility |
| --- | --- |
| `modules/auth/root-id.ts` | Pure UUID parsing and membership logic. |
| `modules/auth/root.ts` | Server-only root page/API authorization. |
| `modules/admin/types.ts` | Serializable admin setting, job, audit, and overview contracts. |
| `modules/admin/catalog.ts` | Code-reviewed setting/environment/job inventory and validation. |
| `modules/admin/redact.ts` | Bounded recursive sanitizer for persisted/returned diagnostics. |
| `modules/admin/request-security.ts` | Same-origin and mutation-reason validation. |
| `modules/admin/settings.ts` | Service-role runtime resolution and atomic setting mutation RPC calls. |
| `modules/admin/job-health.ts` | Pure job state/freshness derivation. |
| `modules/admin/job-telemetry.ts` | Best-effort/required normalized run lifecycle. |
| `modules/admin/manual-jobs.ts` | Explicit root-manual dispatch allowlist. |
| `modules/admin/system-overview.ts` | Partial-failure source adapters and sanitized overview assembly. |
| `lib/jobs/market-sync-universe.ts` | Reusable market sync business operation extracted from its route. |
| `app/api/admin/system/route.ts` | Root-only read model. |
| `app/api/admin/settings/[key]/route.ts` | Root-only typed upsert/reset endpoints. |
| `app/api/admin/jobs/[key]/run/route.ts` | Root-only bounded manual runner. |
| `app/admin/page.tsx` | Server authorization boundary and initial overview load. |
| `app/admin/loading.tsx` | Stable admin loading shell. |
| `components/admin/admin-dashboard.tsx` | Client refresh and mutation orchestration. |
| `components/admin/admin-overview.tsx` | System/source status view. |
| `components/admin/admin-jobs.tsx` | Job status and confirmation dialog. |
| `components/admin/admin-settings.tsx` | Grouped typed setting editor. |
| `components/admin/admin-audit.tsx` | Sanitized audit list. |
| `supabase/migrations/20260824120000_root_admin_control_plane.sql` | Private settings/runs/audit tables and service-role RPCs. |
| `tests/root-admin-*.test.ts` | Security, schema, catalog, job-health, API, and UI contracts. |

---

### Task 1: Establish the root authorization boundary

**Files:**
- Create: `modules/auth/root-id.ts`
- Create: `modules/auth/root.ts`
- Modify: `.env.example`
- Modify: `modules/auth/server.ts`
- Test: `tests/root-admin-auth.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `parseRootAdminUserIds(raw?: string): ReadonlySet<string>`
- Produces: `isRootAdminUserId(userId: string, raw?: string): boolean`
- Produces: `requireApiRoot(): Promise<{ok:true; context:ServerAuthContext}|{ok:false; response:NextResponse}>`
- Produces: `getRootPageContext(): Promise<ServerAuthContext|null>`

- [ ] **Step 1: Read the version-specific Next.js security references**

Read completely before editing:

```bash
sed -n '1,2200p' node_modules/next/dist/docs/01-app/02-guides/authentication.md
sed -n '1,800p' node_modules/next/dist/docs/01-app/02-guides/data-security.md
sed -n '1,320p' node_modules/next/dist/docs/01-app/02-guides/environment-variables.md
sed -n '1,280p' node_modules/next/dist/docs/01-app/03-api-reference/04-functions/not-found.md
```

Expected: confirm authorization belongs in the data-access/server layer, environment values without `NEXT_PUBLIC_` stay server-only, and `notFound()` terminates page rendering.

- [ ] **Step 2: Write failing pure authorization tests**

Create `tests/root-admin-auth.test.ts` with these cases:

```ts
import assert from "node:assert/strict"
import test from "node:test"

import { isRootAdminUserId, parseRootAdminUserIds } from "../modules/auth/root-id.ts"

const ROOT = "11111111-1111-4111-8111-111111111111"
const OTHER = "22222222-2222-4222-8222-222222222222"

test("root allowlist accepts exact canonical UUID entries", () => {
  assert.deepEqual([...parseRootAdminUserIds(` ${ROOT},${OTHER} `)], [ROOT, OTHER])
  assert.equal(isRootAdminUserId(ROOT, `${ROOT},${OTHER}`), true)
})

test("root allowlist rejects malformed, case-mutated, partial and empty values", () => {
  assert.deepEqual([...parseRootAdminUserIds(`bad,${ROOT.toUpperCase()},${ROOT.slice(0, 12)}`)], [])
  assert.equal(isRootAdminUserId(ROOT, ""), false)
  assert.equal(isRootAdminUserId(ROOT, undefined), false)
  assert.equal(isRootAdminUserId(`${ROOT}x`, ROOT), false)
})
```

- [ ] **Step 3: Run the test and verify the missing-module failure**

Run:

```bash
node --test tests/root-admin-auth.test.ts
```

Expected: FAIL because `modules/auth/root-id.ts` does not exist.

- [ ] **Step 4: Implement pure UUID parsing**

Create `modules/auth/root-id.ts`:

```ts
const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

export function parseRootAdminUserIds(raw = ""): ReadonlySet<string> {
  return new Set(raw.split(",").map((value) => value.trim()).filter((value) => CANONICAL_UUID.test(value)))
}

export function isRootAdminUserId(userId: string, raw = ""): boolean {
  return CANONICAL_UUID.test(userId) && parseRootAdminUserIds(raw).has(userId)
}
```

- [ ] **Step 5: Add the server-only root data-access layer**

Create `modules/auth/root.ts` using this control flow:

```ts
import "server-only"

import { NextResponse } from "next/server"
import { getServerAuthContext, requireApiUser, type ServerAuthContext } from "@/modules/auth/server"
import { isRootAdminUserId } from "@/modules/auth/root-id"

const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" }

export function isConfiguredRootUserId(userId: string) {
  return isRootAdminUserId(userId, process.env.ROOT_ADMIN_USER_IDS)
}

export async function getRootPageContext(): Promise<ServerAuthContext | null> {
  const context = await getServerAuthContext()
  return context && isConfiguredRootUserId(context.user.id) ? context : null
}

export async function requireApiRoot() {
  const auth = await requireApiUser()
  if (!auth.ok) return auth
  if (!isConfiguredRootUserId(auth.context.user.id)) {
    return {
      ok: false as const,
      response: NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403, headers: NO_STORE }),
    }
  }
  return auth
}
```

Do not add root to `UserFeatureKey`, `profiles`, `user_preferences`, or `user_features`.

- [ ] **Step 6: Document configuration without committing the UUID**

Append to `.env.example`:

```dotenv
# Root admin Supabase Auth UUID allowlist. Server-only; comma-separated; never use email.
ROOT_ADMIN_USER_IDS=

# Canonical same-origin base used to validate root mutations.
APP_URL=https://qeoindex.qeoqeo.com
```

Add `modules/auth/root-id.ts` and `modules/auth/root.ts` to `lint:touched`. Add `tests/root-admin-auth.test.ts` to `test:core` and `test:supabase`.

- [ ] **Step 7: Run the focused and security tests**

Run:

```bash
node --test tests/root-admin-auth.test.ts tests/auth-api-contract.test.ts
pnpm lint:touched
pnpm typecheck
```

Expected: all pass.

- [ ] **Step 8: Commit the root boundary**

```bash
git add .env.example modules/auth/root-id.ts modules/auth/root.ts package.json tests/root-admin-auth.test.ts
git commit -m "feat(admin): add root authorization boundary"
```

---

### Task 2: Add private control-plane persistence

**Files:**
- Create: `supabase/migrations/20260824120000_root_admin_control_plane.sql`
- Create: `tests/root-admin-schema.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces tables: `public.system_settings`, `public.system_job_runs`, `public.system_audit_log`
- Produces RPC: `public.qeo_admin_set_system_setting(text,jsonb,bigint,uuid,text,uuid): jsonb`
- Produces RPC: `public.qeo_admin_reset_system_setting(text,bigint,uuid,text,uuid): jsonb`
- Produces RPC: `public.qeo_admin_cron_snapshot(): jsonb`

- [ ] **Step 1: Write failing schema-contract tests**

Create `tests/root-admin-schema.test.ts` that reads the migration and asserts the security contract:

```ts
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const sql = readFileSync(new URL("../supabase/migrations/20260824120000_root_admin_control_plane.sql", import.meta.url), "utf8")

test("control-plane tables are private service-role data", () => {
  for (const table of ["system_settings", "system_job_runs", "system_audit_log"]) {
    assert.match(sql, new RegExp(`create table if not exists public\\.${table}`))
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`))
    assert.match(sql, new RegExp(`revoke all privileges on table public\\.${table} from anon, authenticated`))
    assert.match(sql, new RegExp(`grant all privileges on table public\\.${table} to service_role`))
  }
})

test("setting mutation RPCs are atomic and service-role only", () => {
  assert.match(sql, /qeo_admin_set_system_setting/)
  assert.match(sql, /qeo_admin_reset_system_setting/)
  assert.match(sql, /insert into public\.system_audit_log/)
  assert.match(sql, /grant execute on function public\.qeo_admin_set_system_setting[\s\S]*to service_role/)
  assert.doesNotMatch(sql, /grant execute[\s\S]*to authenticated/)
})

test("cron snapshot never exposes command, vault, headers or return_message", () => {
  const start = sql.indexOf("create or replace function public.qeo_admin_cron_snapshot")
  const body = sql.slice(start)
  assert.notEqual(start, -1)
  assert.doesNotMatch(body, /jsonb_build_object\([^)]*command/i)
  assert.doesNotMatch(body, /return_message/)
  assert.doesNotMatch(body, /decrypted_secret|authorization|headers/i)
})
```

- [ ] **Step 2: Verify the schema test fails**

Run:

```bash
node --test tests/root-admin-schema.test.ts
```

Expected: FAIL because the migration is absent.

- [ ] **Step 3: Create tables, constraints, triggers and indexes**

Implement the exact columns from the spec. Required SQL details:

```sql
begin;

create table if not exists public.system_settings (
  key text primary key check (key ~ '^[a-z0-9_]+([.][a-z0-9_]+)*$'),
  value jsonb not null,
  version bigint not null default 1 check (version > 0),
  updated_by uuid references auth.users(id) on delete set null,
  change_reason text not null check (char_length(change_reason) between 8 and 240),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.system_job_runs (
  id uuid primary key default gen_random_uuid(),
  job_key text not null check (job_key ~ '^[a-z0-9_]+([.][a-z0-9_]+)*$'),
  provider text not null,
  trigger text not null check (trigger in ('schedule','manual','workflow','external')),
  status text not null check (status in ('queued','running','succeeded','failed','skipped')),
  actor_user_id uuid references auth.users(id) on delete set null,
  provider_run_id text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  duration_ms bigint check (duration_ms is null or duration_ms >= 0),
  summary jsonb not null default '{}'::jsonb check (jsonb_typeof(summary) = 'object'),
  error_code text,
  error_message text,
  created_at timestamptz not null default now()
);

create table if not exists public.system_audit_log (
  id bigint generated always as identity primary key,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  target_type text not null,
  target_key text not null,
  before_value jsonb,
  after_value jsonb,
  reason text not null check (char_length(reason) between 8 and 240),
  request_id uuid not null,
  success boolean not null,
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists system_job_runs_job_started_idx on public.system_job_runs(job_key, started_at desc);
create index if not exists system_job_runs_started_idx on public.system_job_runs(started_at desc);
create index if not exists system_audit_log_created_idx on public.system_audit_log(created_at desc);
```

Reuse `public.qeo_touch_updated_at()` for `system_settings`. Enable RLS, revoke `anon`/`authenticated`, and grant tables plus required sequences to `service_role`.

- [ ] **Step 4: Add atomic compare-and-swap setting RPCs**

Both functions must be `security invoker`, use fully qualified table names, accept `expected_version = 0` only for insert/reset of an absent row, and return one of:

```json
{"ok":true,"record":{"key":"ai_council.llm_enabled","value":true,"version":2}}
{"ok":false,"conflict":true,"record":{"key":"ai_council.llm_enabled","value":false,"version":2}}
```

The set function updates with:

```sql
update public.system_settings
set value = p_value,
    version = version + 1,
    updated_by = p_actor_user_id,
    change_reason = p_reason,
    updated_at = now()
where key = p_key and version = p_expected_version
returning * into v_after;
```

Insert exactly one `system_audit_log` row in the same transaction after a successful insert/update/delete. The reset function deletes only when `version = p_expected_version`, audits the removed value, and returns `record: null`.

- [ ] **Step 5: Add the sanitized Supabase cron RPC**

Use a `security definer` SQL function with `set search_path = ''`. Join each `cron.job` to only its latest `cron.job_run_details` row and return these keys:

```sql
jsonb_build_object(
  'jobId', job.jobid,
  'jobName', job.jobname,
  'schedule', job.schedule,
  'active', job.active,
  'lastStatus', latest.status,
  'lastStartedAt', latest.start_time,
  'lastFinishedAt', latest.end_time
)
```

Do not select `command`, `return_message`, `username`, database connection data, headers, or Vault data. Revoke from `public`, `anon`, `authenticated`; grant execute only to `service_role`.

- [ ] **Step 6: Run local schema and core tests**

Add the test to `test:core` and `test:supabase`, then run:

```bash
node --test tests/root-admin-schema.test.ts tests/supabase-auth-schema.test.ts
pnpm test:supabase
```

Expected: all pass.

- [ ] **Step 7: Apply the reviewed migration to the linked production project**

Per repository policy, after reviewing the SQL diff and confirming the CLI points to Supabase project `glwhhrmejlonhyorvtzm`, run:

```bash
npx supabase db push
```

Expected: `20260824120000_root_admin_control_plane.sql` is applied exactly once. If project linkage, credentials, or network access is unavailable, stop this step and report it; do not create an alternative database or expose credentials.

- [ ] **Step 8: Commit persistence**

```bash
git add supabase/migrations/20260824120000_root_admin_control_plane.sql tests/root-admin-schema.test.ts package.json
git commit -m "feat(admin): add private control-plane persistence"
```

---

### Task 3: Build the typed inventory, validation, and redaction layer

**Files:**
- Create: `modules/admin/types.ts`
- Create: `modules/admin/catalog.ts`
- Create: `modules/admin/redact.ts`
- Create: `modules/admin/request-security.ts`
- Create: `tests/root-admin-catalog.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `ADMIN_SETTING_CATALOG`, `ADMIN_JOB_CATALOG`, `ADMIN_ENVIRONMENT_INVENTORY`
- Produces: `validateAdminSetting(key,value): AdminValidationResult`
- Produces: `sanitizeAdminValue(value, options?): unknown`
- Produces: `validateAdminMutationRequest(request): {ok:true}|{ok:false;status:number;error:string}`
- Produces: `validateChangeReason(value): string|null`

- [ ] **Step 1: Write failing catalog/redaction tests**

Cover uniqueness, every editable setting, secret readiness, ticker normalization, bounded diagnostics, origin checks, and exact inventory coverage:

```ts
test("runtime setting keys are unique and validate their documented bounds", () => {
  const keys = ADMIN_SETTING_CATALOG.map((entry) => entry.key)
  assert.equal(new Set(keys).size, keys.length)
  assert.equal(validateAdminSetting("ai_council.llm_max_tickers", 6).ok, true)
  assert.equal(validateAdminSetting("ai_council.llm_max_tickers", 7).ok, false)
  assert.deepEqual(validateAdminSetting("ai_council.llm_tickers", " fpt,MSN,fpt "), {
    ok: true,
    value: ["FPT", "MSN"],
  })
})

test("sanitizer removes secret-shaped fields and bounds nested output", () => {
  const value = sanitizeAdminValue({ authorization: "Bearer abc", token: "abc", ok: true, nested: { cookie: "x" } })
  assert.deepEqual(value, { authorization: "[REDACTED]", token: "[REDACTED]", ok: true, nested: { cookie: "[REDACTED]" } })
})
```

Inventory coverage test must parse `.env.example` assignments and compare them to `ADMIN_ENVIRONMENT_INVENTORY`, then add the application-only keys `NOTION_TOKEN`, `SUPABASE_URL`, `APP_URL`, `NEXT_PUBLIC_APP_URL`, `ROOT_ADMIN_USER_IDS`, `QSTASH_TOKEN`, `NODE_ENV`, `VERCEL_ENV`, `VERCEL_URL`, `VERCEL_PROJECT_PRODUCTION_URL`, `VERCEL_GIT_COMMIT_SHA`, `VERCEL_GIT_PREVIOUS_SHA`, `NEXT_PUBLIC_GIT_COMMIT_SHA`, `NEXT_PUBLIC_GIT_COMMIT_DATE`, and `NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA`.

- [ ] **Step 2: Verify tests fail**

```bash
node --test tests/root-admin-catalog.test.ts
```

Expected: FAIL because the admin modules do not exist.

- [ ] **Step 3: Implement shared serializable types**

Define exact unions in `modules/admin/types.ts`:

```ts
export type AdminSettingGroup = "system" | "provider" | "cache" | "market" | "scanner" | "signals" | "wyckoff" | "ai_council" | "ui" | "integration"
export type AdminSettingKind = "boolean" | "integer" | "number" | "string" | "enum" | "ticker_list" | "url"
export type AdminSource = "runtime" | "environment" | "code" | "build"
export type AdminSensitivity = "public" | "internal" | "secret"
export type AdminImpact = "low" | "medium" | "high"
export type AdminJobStatus = "healthy" | "degraded" | "failing" | "stale" | "unknown"
export type AdminManualPolicy = "disabled" | "allowed" | "confirm"
```

Also define `AdminSettingDefinition`, `ResolvedAdminSetting`, `AdminEnvironmentItem`, `AdminJobDefinition`, `AdminJobView`, `AdminAuditView`, `AdminSourceHealth`, and `AdminSystemOverview`. Keep them JSON-serializable; do not expose Supabase client/database row types to React.

- [ ] **Step 4: Implement the explicit setting catalog**

The editable entries must be exactly:

```ts
admin.refresh_interval_seconds       // integer 15..300, default 30
admin.job_history_limit              // integer 20..200, default 50
scanner.manual_run_limit             // integer 1..100, default 100
ai_council.llm_enabled               // boolean, env AI_COUNCIL_LLM_ENABLED, default true
ai_council.llm_max_tickers           // integer 1..6, env AI_COUNCIL_LLM_MAX_TICKERS, default 3
ai_council.llm_tickers               // ticker_list max 100, env AI_COUNCIL_LLM_TICKERS, default []
ai_council.research_tickers          // ticker_list max 100, env AI_COUNCIL_RESEARCH_TICKERS, default ["MSN"]
```

Add read-only definitions for the Top 100 cap, scanner 60/200 bars, Wyckoff 500 snapshots, intraday provider concurrency 12, Notion timeout 10,000ms, AI call timeout 25,000ms, Vercel cron expressions, cache namespaces, AI model/effort routes, and provider URLs. Mark safety contracts `impact: "high"`, `editable: false`, and document their code source.

Implement validation without adding a schema dependency. Ticker lists accept comma-separated strings or arrays, uppercase and deduplicate, enforce `/^[A-Z0-9]{2,12}$/`, and cap at 100.

- [ ] **Step 5: Implement the complete environment inventory**

Create one entry per key detected by the test. Classify credentials/tokens/passwords/keys/secrets and `ROOT_ADMIN_USER_IDS` as `sensitivity: "secret"` so only readiness is returned. Public URLs and Git build metadata may return sanitized values. Internal IDs/model names/channels may return values but never become editable unless they correspond to one of the seven runtime settings.

Do not read `process.env` at module initialization in the catalog; definitions carry `envKey`, and server assembly resolves values per request/snapshot.

- [ ] **Step 6: Implement bounded redaction and request security**

`sanitizeAdminValue()` must:

- redact case-insensitive key names matching `authorization|cookie|password|secret|token|api[_-]?key|service[_-]?role|client[_-]?secret`;
- cap depth at 5, arrays at 25 items, strings at 800 characters, object keys at 50, and encoded output at 16 KiB;
- convert `Error` to `{name,message}` without `stack`;
- return `"[TRUNCATED]"` markers rather than throwing on oversized diagnostics.

`validateAdminMutationRequest()` compares `Origin` exactly to `APP_URL`, then `NEXT_PUBLIC_APP_URL`, then the production Vercel URL. In non-production only, also allow `http://localhost:3000` and `http://127.0.0.1:3000`. Missing/mismatched Origin returns 403.

- [ ] **Step 7: Run catalog, secret and type validation**

```bash
node --test tests/root-admin-catalog.test.ts
pnpm scan:secrets
pnpm lint:touched
pnpm typecheck
```

Expected: all pass and the inventory test proves no current `.env.example` key is absent.

- [ ] **Step 8: Commit the catalog layer**

```bash
git add modules/admin/types.ts modules/admin/catalog.ts modules/admin/redact.ts modules/admin/request-security.ts tests/root-admin-catalog.test.ts package.json
git commit -m "feat(admin): add typed control-plane catalog"
```

---

### Task 4: Resolve and mutate runtime settings safely

**Files:**
- Create: `modules/admin/settings.ts`
- Create: `tests/root-admin-settings.test.ts`
- Modify: `modules/ai-council/llm.ts`
- Modify: `modules/ai-council/research-context.ts`
- Modify: `app/api/ai-council/debate-daily/route.ts`
- Modify: `tests/ai-council-prompt-evidence.test.ts`
- Modify: `tests/ai-council-research-context.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `loadAdminSettingsSnapshot(): Promise<AdminSettingsSnapshot>`
- Produces: `setAdminSetting(input): Promise<AdminSettingMutationResult>`
- Produces: `resetAdminSetting(input): Promise<AdminSettingMutationResult>`
- Produces: `getAiCouncilRuntimeConfig(): Promise<AiCouncilRuntimeConfig>`
- Consumes: migration RPCs and `ADMIN_SETTING_CATALOG`

- [ ] **Step 1: Write failing resolution tests using dependency injection**

Keep pure resolution testable without importing `server-only`. Export a pure `resolveAdminSettings(definitions, rows, env)` helper and cover:

```ts
test("runtime overrides beat environment and defaults", () => {
  const snapshot = resolveAdminSettings(ADMIN_SETTING_CATALOG, [
    { key: "ai_council.llm_max_tickers", value: 5, version: 2, updated_at: "2026-08-24T00:00:00Z" },
  ], { AI_COUNCIL_LLM_MAX_TICKERS: "4" })
  assert.equal(snapshot.byKey["ai_council.llm_max_tickers"].value, 5)
  assert.equal(snapshot.byKey["ai_council.llm_max_tickers"].resolvedFrom, "runtime")
})

test("invalid persisted values degrade and fall back", () => {
  const snapshot = resolveAdminSettings(ADMIN_SETTING_CATALOG, [
    { key: "ai_council.llm_max_tickers", value: 99, version: 1, updated_at: "2026-08-24T00:00:00Z" },
  ], { AI_COUNCIL_LLM_MAX_TICKERS: "4" })
  assert.equal(snapshot.degraded, true)
  assert.equal(snapshot.byKey["ai_council.llm_max_tickers"].value, 4)
})
```

- [ ] **Step 2: Verify the settings test fails**

```bash
node --test tests/root-admin-settings.test.ts
```

Expected: FAIL because `modules/admin/settings.ts` is absent.

- [ ] **Step 3: Implement one-query resolution and fail-safe caching**

`loadAdminSettingsSnapshot()` must query:

```ts
supabase.from("system_settings").select("key,value,version,updated_by,change_reason,updated_at")
```

Resolve all definitions in one pass. When service role or the query is unavailable, return valid environment/default values with `degraded: true` and a sanitized source error. Cache the successful snapshot for at most 15 seconds in a module-local entry keyed only by the catalog version; export `invalidateAdminSettingsCache()` and call it after mutation. Do not use undocumented Next.js cache APIs in this task.

- [ ] **Step 4: Implement atomic set/reset calls**

Use the RPCs from Task 2. Required input:

```ts
type AdminSettingMutationInput = {
  key: string
  value?: unknown
  expectedVersion: number
  actorUserId: string
  reason: string
  requestId: string
}
```

Validate the catalog entry and normalized value before RPC. Map `{conflict:true}` to `{ok:false, conflict:true, current}`. Never send an unvalidated value or secret/read-only key to Supabase.

- [ ] **Step 5: Wire the four AI Council runtime overrides into real consumers**

Add:

```ts
export type AiCouncilRuntimeConfig = {
  llmEnabled: boolean
  maxTickers: number
  tickers: string[]
  researchTickers: string[]
}
```

Change `runSelectedAiCouncilLlmDebates()` params to accept `runtimeConfig?: AiCouncilRuntimeConfig`; use its `llmEnabled`, `maxTickers`, and `tickers` instead of rereading those three environment variables when present. Change `configuredCouncilResearchTickers(raw?: string | string[])` to accept the resolved list while preserving the existing env/default behavior when omitted.

In `app/api/ai-council/debate-daily/route.ts`, load `getAiCouncilRuntimeConfig()` once, pass `researchTickers` into `configuredCouncilResearchTickers()` and pass the same config into `runSelectedAiCouncilLlmDebates()`. Preserve model/effort environment routing and `OPENAI_API_KEY` readiness exactly.

- [ ] **Step 6: Extend deterministic AI Council tests**

Add cases proving runtime `llmEnabled: false`, runtime max 1, explicit ticker normalization, and research ticker override work without mutating `process.env`. Existing environment-only tests must continue to pass.

- [ ] **Step 7: Run focused and Council regression tests**

```bash
node --test tests/root-admin-settings.test.ts tests/ai-council-prompt-evidence.test.ts tests/ai-council-research-context.test.ts
pnpm test:council
pnpm lint:touched
pnpm typecheck
```

Expected: all pass; no override preserves current Council behavior.

- [ ] **Step 8: Commit runtime settings**

```bash
git add modules/admin/settings.ts modules/ai-council/llm.ts modules/ai-council/research-context.ts app/api/ai-council/debate-daily/route.ts tests/root-admin-settings.test.ts tests/ai-council-prompt-evidence.test.ts tests/ai-council-research-context.test.ts package.json
git commit -m "feat(admin): add typed runtime settings"
```

---

### Task 5: Normalize job health and telemetry

**Files:**
- Create: `modules/admin/job-health.ts`
- Create: `modules/admin/job-telemetry.ts`
- Create: `tests/root-admin-job-health.test.ts`
- Modify: `modules/admin/catalog.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `deriveAdminJobStatus(definition, latestRun, now): AdminJobStatus`
- Produces: `executeSystemJob<T>(input): Promise<SystemJobExecution<T>>`
- Consumes: `system_job_runs`, `sanitizeAdminValue`, `ADMIN_JOB_CATALOG`

- [ ] **Step 1: Write failing status tests**

Cover success, failure, skipped/degraded, stale success, stale running, and no telemetry:

```ts
const definition = {
  key: "wyckoff.ingest",
  freshnessMinutes: 26 * 60,
  maxDurationMinutes: 5,
} as AdminJobDefinition

test("job health is derived from result and freshness", () => {
  const now = new Date("2026-08-24T12:00:00Z")
  assert.equal(deriveAdminJobStatus(definition, null, now), "unknown")
  assert.equal(deriveAdminJobStatus(definition, { status: "failed", startedAt: "2026-08-24T10:00:00Z", finishedAt: "2026-08-24T10:01:00Z" }, now), "failing")
  assert.equal(deriveAdminJobStatus(definition, { status: "running", startedAt: "2026-08-24T11:50:00Z", finishedAt: null }, now), "stale")
})
```

- [ ] **Step 2: Run and verify failure**

```bash
node --test tests/root-admin-job-health.test.ts
```

Expected: FAIL because health/telemetry modules are absent.

- [ ] **Step 3: Define the exact job catalog**

Add these keys and policies:

| Key | Provider | Manual policy |
| --- | --- | --- |
| `signals.daily` | `vercel_cron_workflow` | `disabled` |
| `wyckoff.ingest` | `vercel_cron` | `confirm` |
| `ai_council.daily` | `vercel_cron` | `disabled` |
| `ai_council.debate_daily` | `vercel_cron` | `disabled` |
| `market.sync_5m` | `supabase_pg_cron` | `disabled` |
| `market.sync_eod` | `supabase_pg_cron` | `disabled` |
| `kfsp.rating_daily` | `supabase_pg_cron` | `disabled` |
| `kfsp.ttai_history` | `supabase_pg_cron` | `disabled` |
| `scanner.run` | `machine` | `allowed` |
| `signals.monitor` | `machine` | `confirm` |
| `market.sync_universe` | `machine` | `confirm` |
| `market.cache_invalidate` | `machine` | `disabled` |
| `wyckoff.run` | `machine` | `disabled` |

Store both UTC cron and human ICT schedule strings for scheduled entries. Give every job a concrete `freshnessMinutes` and `maxDurationMinutes`; derive them from its interval plus a bounded grace period, not from UI copy.

- [ ] **Step 4: Implement pure job health**

Rules must match the spec exactly. Parse timestamps defensively. A `running` row becomes stale after `maxDurationMinutes`; a completed success becomes stale after `freshnessMinutes`; `skipped` maps degraded; failure wins over freshness while it remains the latest run.

- [ ] **Step 5: Implement best-effort/required telemetry**

Use this signature:

```ts
export async function executeSystemJob<T>({
  jobKey,
  trigger,
  actorUserId = null,
  providerRunId = null,
  telemetry = "best_effort",
  run,
  summarize = () => ({}),
}: {
  jobKey: string
  trigger: "schedule" | "manual" | "workflow" | "external"
  actorUserId?: string | null
  providerRunId?: string | null
  telemetry?: "best_effort" | "required"
  run: () => Promise<T>
  summarize?: (result: T) => Record<string, unknown>
}): Promise<{ runId: string | null; result: T }>
```

Insert `running`, call `run`, then update `succeeded`; on error update `failed` with `sanitizeAdminValue()` and rethrow. For `best_effort`, log telemetry persistence failures and still run the job. For `required`, fail before executing when the run row cannot be created. Cap summaries before persistence.

- [ ] **Step 6: Run focused validation**

```bash
node --test tests/root-admin-job-health.test.ts tests/root-admin-catalog.test.ts
pnpm lint:touched
pnpm typecheck
```

Expected: all pass.

- [ ] **Step 7: Commit telemetry primitives**

```bash
git add modules/admin/catalog.ts modules/admin/job-health.ts modules/admin/job-telemetry.ts tests/root-admin-job-health.test.ts package.json
git commit -m "feat(admin): add normalized job telemetry"
```

---

### Task 6: Instrument scheduled jobs and add bounded manual dispatch

**Files:**
- Create: `lib/jobs/market-sync-universe.ts`
- Create: `modules/admin/manual-jobs.ts`
- Modify: `app/api/signals/daily/route.ts`
- Modify: `app/api/wyckoff/ingest/route.ts`
- Modify: `app/api/ai-council/daily/route.ts`
- Modify: `app/api/ai-council/debate-daily/route.ts`
- Modify: `app/api/scanner/run/route.ts`
- Modify: `app/api/signals/monitor/route.ts`
- Modify: `app/api/market/sync-universe/route.ts`
- Create: `tests/root-admin-manual-jobs.test.ts`
- Modify: `tests/auth-api-contract.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `runMarketUniverseSync(): Promise<MarketUniverseSyncResult>`
- Produces: `dispatchManualAdminJob(input): Promise<{runId:string; summary:unknown}>`
- Consumes: job catalog, `executeSystemJob`, existing domain functions.

- [ ] **Step 1: Write failing dispatch policy tests**

Assert that only these four keys have dispatchers:

```ts
assert.deepEqual(listManualAdminJobKeys(), [
  "market.sync_universe",
  "scanner.run",
  "signals.monitor",
  "wyckoff.ingest",
])
```

Assert `signals.daily`, both AI Council jobs, both Supabase sync jobs, cache invalidation, and `wyckoff.run` throw `AdminJobNotRunnableError` before any handler is called. Assert scanner limit/offset are integer-bounded to `1..100` and `0..99`.

- [ ] **Step 2: Verify focused test failure**

```bash
node --test tests/root-admin-manual-jobs.test.ts
```

Expected: FAIL because `manual-jobs.ts` is absent.

- [ ] **Step 3: Extract the market sync business function without behavior change**

Move the body after machine authorization from `app/api/market/sync-universe/route.ts` into `runMarketUniverseSync()` in `lib/jobs/market-sync-universe.ts`. Return a typed object instead of `NextResponse`; preserve the 10-second provider timeout, Top 100 allowlist, zero-value rejection behavior, Supabase upsert, count, source, and duration.

The route remains POST-only and maps typed operational errors to the existing 502/503 JSON responses. Run `tests/auth-api-contract.test.ts` after the extraction.

- [ ] **Step 4: Implement explicit manual dispatch**

The dispatcher mapping must call domain functions directly:

```ts
"scanner.run"          -> runScannerUniverse({ limit, offset })
"signals.monitor"      -> runSignalMonitor({ force: true })
"market.sync_universe" -> runMarketUniverseSync()
"wyckoff.ingest"       -> ingestLatestReadyWyckoffRun()
```

Before running, query the newest `queued`/`running` `system_job_runs` row for the same key. Return a conflict when it is younger than that job's `maxDurationMinutes`; treat an older row as stale and allow a new run. Execute with `telemetry: "required"`, `trigger: "manual"`, and the root actor UUID.

- [ ] **Step 5: Instrument scheduled and machine routes**

Wrap existing domain execution with `executeSystemJob(... telemetry: "best_effort")`:

- Vercel cron trigger is `schedule`; `signals.daily` stores returned Workflow `runId` in the run summary/provider field.
- Existing machine endpoints use trigger `external`.
- Manual admin dispatch does not call the machine HTTP routes and does not pass bearer secrets through internal HTTP.

Do not change machine authorization, supported methods, max durations, job response shapes, or current allow-unconfigured development behavior.

- [ ] **Step 6: Extend source-contract security tests**

Update `tests/auth-api-contract.test.ts` to assert all instrumented routes still call `isMachineRequestAuthorized` before `executeSystemJob`, and destructive cache invalidation remains POST-only and absent from the manual dispatcher.

- [ ] **Step 7: Run regression tests**

```bash
node --test tests/root-admin-manual-jobs.test.ts tests/auth-api-contract.test.ts tests/scanner-policy.test.ts tests/signal-engine.test.ts
pnpm test:core
pnpm lint:touched
pnpm typecheck
```

Expected: all pass; machine endpoint responses remain compatible.

- [ ] **Step 8: Commit job integration**

```bash
git add lib/jobs/market-sync-universe.ts modules/admin/manual-jobs.ts app/api/signals/daily/route.ts app/api/wyckoff/ingest/route.ts app/api/ai-council/daily/route.ts app/api/ai-council/debate-daily/route.ts app/api/scanner/run/route.ts app/api/signals/monitor/route.ts app/api/market/sync-universe/route.ts tests/root-admin-manual-jobs.test.ts tests/auth-api-contract.test.ts package.json
git commit -m "feat(admin): instrument jobs and manual reruns"
```

---

### Task 7: Assemble the sanitized overview and root APIs

**Files:**
- Create: `modules/admin/system-overview.ts`
- Create: `app/api/admin/system/route.ts`
- Create: `app/api/admin/settings/[key]/route.ts`
- Create: `app/api/admin/jobs/[key]/run/route.ts`
- Create: `tests/root-admin-api-contract.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `loadAdminSystemOverview(actorUserId): Promise<AdminSystemOverview>`
- Produces HTTP contracts specified in the design spec.
- Consumes: `requireApiRoot`, request security, settings, manual jobs, Supabase cron RPC.

- [ ] **Step 1: Write failing API source and pure-handler tests**

Assert every admin route:

- imports/calls `requireApiRoot()` before any service-role operation;
- mutation routes call `validateAdminMutationRequest()`;
- exports only specified HTTP methods;
- sets Node runtime, force-dynamic, and no-store headers;
- does not reference a raw secret value in response construction;
- maps setting conflicts and active job conflicts to 409.

Add pure request-body parser tests for wrong types, missing reason, reason length, arbitrary setting/job keys, negative versions, and invalid scanner parameters.

- [ ] **Step 2: Verify API tests fail**

```bash
node --test tests/root-admin-api-contract.test.ts
```

Expected: FAIL because the routes are absent.

- [ ] **Step 3: Implement partial-failure overview assembly**

Use `Promise.allSettled` for these adapters:

1. resolved settings/environment inventory;
2. recent `system_job_runs` using `admin.job_history_limit`;
3. `qeo_admin_cron_snapshot()`;
4. latest `kfsp_rating_sync_runs` and `kfsp_ttai_sync_runs` domain rows;
5. newest 50 `system_audit_log` rows;
6. service readiness derived from environment without returning secret values;
7. existing `getSlackOpsHealth()` sanitized to readiness/error only.

Return `sources: AdminSourceHealth[]`; one rejected adapter marks only that source degraded. Never call browser-facing health endpoints over HTTP from the server.

- [ ] **Step 4: Implement `GET /api/admin/system`**

Authorize root, call the overview service, return:

```ts
NextResponse.json({ ok: true, overview }, { headers: NO_STORE_HEADERS })
```

If root auth succeeds but service role is missing, return 503 with a sanitized message. Anonymous and non-root responses come directly from the auth helper.

- [ ] **Step 5: Implement atomic setting PATCH/DELETE**

PATCH body:

```json
{"value":3,"expectedVersion":1,"reason":"Reduce bounded daily LLM cost"}
```

DELETE body:

```json
{"expectedVersion":2,"reason":"Restore the environment fallback"}
```

Generate `requestId` with `crypto.randomUUID()`, validate origin/reason/key/value, call the settings service, and return the current sanitized record. Map validation to 400, origin to 403, conflict to 409, service failure to 503.

- [ ] **Step 6: Implement manual job POST**

Body:

```json
{
  "reason": "Re-run after the upstream provider recovered",
  "confirmed": true,
  "params": { "limit": 100, "offset": 0 }
}
```

For `manualPolicy: "confirm"`, require `confirmed === true`. For `allowed`, confirmation is optional but reason remains required. After execution, write a sanitized `system_audit_log` row with action `job.manual_run`, run ID, actor UUID, target key and result. Return 202 only for a provider workflow that was merely queued; otherwise return 200 after completion.

- [ ] **Step 7: Run API and security regression**

```bash
node --test tests/root-admin-api-contract.test.ts tests/root-admin-auth.test.ts tests/auth-api-contract.test.ts
pnpm test:supabase
pnpm lint:touched
pnpm typecheck
pnpm scan:secrets
```

Expected: all pass.

- [ ] **Step 8: Commit root APIs**

```bash
git add modules/admin/system-overview.ts app/api/admin/system/route.ts app/api/admin/settings/'[key]'/route.ts app/api/admin/jobs/'[key]'/run/route.ts tests/root-admin-api-contract.test.ts package.json
git commit -m "feat(admin): add root control-plane APIs"
```

---

### Task 8: Build the root-only admin interface and navigation capability

**Files:**
- Create: `app/admin/page.tsx`
- Create: `app/admin/loading.tsx`
- Create: `components/admin/admin-dashboard.tsx`
- Create: `components/admin/admin-overview.tsx`
- Create: `components/admin/admin-jobs.tsx`
- Create: `components/admin/admin-settings.tsx`
- Create: `components/admin/admin-audit.tsx`
- Modify: `app/layout.tsx`
- Modify: `components/auth/app-auth-gate.tsx`
- Modify: `components/top-nav.tsx`
- Create: `tests/root-admin-ui.test.ts`
- Modify: `tests/navigation-prefetch.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `getRootPageContext`, `loadAdminSystemOverview`, admin JSON APIs.
- Produces: `RootCapabilityContext` with `isRootAdmin: boolean` for navigation UX only.

- [ ] **Step 1: Write failing UI/security contract tests**

Assert:

```ts
assert.match(source("app/admin/page.tsx"), /getRootPageContext/)
assert.match(source("app/admin/page.tsx"), /notFound\(\)/)
assert.match(source("components/top-nav.tsx"), /prefetch=\{false\}/)
assert.match(source("components/top-nav.tsx"), /isRootAdmin/)
```

For every new admin component, assert absence of `backdrop-blur`, `backdrop-filter`, `drop-shadow(`, and `transition-all`. Assert polling checks `document.visibilityState`, minimum interval 15 seconds, and cleanup calls `clearInterval`.

- [ ] **Step 2: Verify UI tests fail**

```bash
node --test tests/root-admin-ui.test.ts tests/navigation-prefetch.test.ts
```

Expected: FAIL because the admin page/components are absent.

- [ ] **Step 3: Pass the server root capability through the existing auth gate**

In `app/layout.tsx`, retain the verified context rather than converting immediately to a boolean:

```ts
const serverAuth = await getServerAuthContext()
const isRootAdmin = Boolean(serverAuth && isConfiguredRootUserId(serverAuth.user.id))
```

Pass both `serverSessionPresent` and `isRootAdmin` to `AppAuthGate`. In the client gate, provide a small React context with `useRootCapability()`. This boolean may control navigation only; add a comment and test preventing it from being imported into admin APIs.

- [ ] **Step 4: Add the root-only navigation item**

When `isRootAdmin` is true, render an Admin link with `Settings`/`Shield` icon, `href="/admin"`, `prefetch={false}`, and active styling for `/admin`. Keep the current compact nav responsive and do not move admin into the public Insights list.

- [ ] **Step 5: Implement the protected page and stable loading shell**

`app/admin/page.tsx`:

```tsx
export const dynamic = "force-dynamic"

export default async function AdminPage() {
  const root = await getRootPageContext()
  if (!root) notFound()
  const overview = await loadAdminSystemOverview(root.user.id)
  return <AdminDashboard initialOverview={overview} />
}
```

Render `TopNav` and a dimensionally stable loading skeleton. Do not reveal the root UUID in visible copy; display the verified email only if already available from the session.

- [ ] **Step 6: Implement the four focused views**

- `admin-overview.tsx`: status counts, deployment metadata, service readiness, degraded-source callouts.
- `admin-jobs.tsx`: responsive job cards/table, UTC plus ICT schedule, last status/duration/freshness, disabled/confirm/allowed action states, reason dialog.
- `admin-settings.tsx`: search, group filters, source/readiness badges, typed input per setting kind, per-row save/reset, version conflict reload.
- `admin-audit.tsx`: newest-first sanitized events; never render generic object JSON without passing through the server-provided display shape.

Use existing `Button`, `Card`, `Dialog`, `Input`, `Select`, `Table`, `Badge`, and `Tooltip` primitives where they reduce duplication. Split files as mapped; do not place all tabs and mutation logic in one component.

- [ ] **Step 7: Implement bounded refresh behavior**

`admin-dashboard.tsx` fetches `/api/admin/system` at the resolved interval, with a hard client clamp of 15-300 seconds. Refresh only while `document.visibilityState === "visible"`; pause while a mutation is in flight; abort old fetches on cleanup; provide a manual Refresh button. Reconcile the full server overview after every successful mutation.

- [ ] **Step 8: Run UI and browser-static checks**

```bash
node --test tests/root-admin-ui.test.ts tests/navigation-prefetch.test.ts
pnpm lint:touched
pnpm typecheck
```

Expected: all pass.

- [ ] **Step 9: Commit the admin UI**

```bash
git add app/admin components/admin app/layout.tsx components/auth/app-auth-gate.tsx components/top-nav.tsx tests/root-admin-ui.test.ts tests/navigation-prefetch.test.ts package.json
git commit -m "feat(admin): add root operations dashboard"
```

---

### Task 9: Document operations, validate end-to-end, and prepare handoff

**Files:**
- Modify: `docs/HANDOVER.md`
- Modify: `docs/auth.md`
- Create: `docs/admin-control-plane.md`
- Modify: `docs/UI_LESSONS_LEARNED.md`
- Modify: `package.json`

**Interfaces:**
- Produces: operator runbook and release evidence.
- Consumes: all earlier tasks.

- [ ] **Step 1: Write the operator runbook**

Document:

- root UUID configuration and fail-closed behavior;
- how to obtain the current authenticated UUID from the app's authenticated `/api/me` response without committing it;
- local and Vercel `ROOT_ADMIN_USER_IDS` setup;
- complete setting groups, resolution precedence, editability rules and reset behavior;
- Vercel versus Supabase job sources, UTC versus ICT timing, manual policies and stale thresholds;
- migration/RPC/table names and security grants;
- conflict, degraded-source, telemetry, audit and manual-run troubleshooting;
- explicit deferred scope and single-deployment Git workflow.

Never paste a real user UUID, token, credential, cookie, provider payload, or production environment value into docs.

- [ ] **Step 2: Update canonical handover/auth/UI lessons**

Add `/admin`, `modules/auth/root.ts`, admin APIs and private tables to `docs/HANDOVER.md` and `docs/auth.md`. Record the UI lesson that operations dashboards poll only while visible, clamp intervals, avoid repaint-heavy effects, and preserve partial source results.

- [ ] **Step 3: Run the complete repository validation matrix**

Run in order:

```bash
pnpm test:core
pnpm test:supabase
pnpm lint:touched
pnpm typecheck
pnpm scan:secrets
pnpm exec next build --webpack
```

Expected: every command exits 0. If full `pnpm lint` is also run and fails from inherited configuration debt, report it separately; do not substitute it for `lint:touched` or claim it passed.

- [ ] **Step 4: Perform local real-browser acceptance**

Start the app without printing environment values:

```bash
pnpm dev
```

Verify with the current authenticated root UUID configured locally:

1. root sees Admin link and `/admin`;
2. normal/anonymous session receives 404 page and admin API rejects access;
3. browser network/HTML contains no credential value;
4. save `admin.refresh_interval_seconds`, observe version/audit, provoke a stale-version 409, then reset;
5. run `scanner.run` with limit 1 and verify one run plus audit row;
6. direct request to disabled `market.cache_invalidate` admin dispatch is rejected;
7. Supabase cron entries show UTC and ICT timing separately;
8. background the tab and verify polling pauses;
9. inspect mobile and desktop layouts and check console/network errors.

Do not trigger `signals.daily`, AI Council publication/debate, cache invalidation, a deployment, or another production-affecting action during browser verification.

- [ ] **Step 5: Inspect the final diff and migration state**

```bash
git status --short
git diff --check
git log --oneline --decorate -12
npx supabase migration list
```

Expected: only intended admin changes, no secrets, migration shown applied locally/remote as appropriate, and no uncommitted generated artifacts.

- [ ] **Step 6: Commit documentation and validation metadata**

```bash
git add docs/HANDOVER.md docs/auth.md docs/admin-control-plane.md docs/UI_LESSONS_LEARNED.md package.json
git commit -m "docs: hand over root admin operations"
```

- [ ] **Step 7: Stop at release approval**

Prepare a concise handoff containing branch name, commits, validation outputs, Supabase migration application result, local browser evidence, configuration still required, and deferred scope. Do not push/merge `main` or run a manual Vercel production deployment. The approved release path is one PR/squash into `main`, one Vercel Git-triggered production deployment, then authenticated production smoke.

---

## Plan Self-Review Checklist

- Every design requirement maps to Tasks 1-9.
- Root authorization is independent of client UX and existing feature entitlements.
- All known environment/configuration categories are inventoried; only seven runtime-safe keys are initially editable.
- All scheduled providers are visible; only four directly reusable, bounded machine operations are manually dispatchable.
- Settings changes are compare-and-swap plus audit in one database transaction.
- Scheduled jobs remain operational when telemetry persistence is degraded.
- No step edits cron schedules, secrets, deployments, provider management state, or `main`.
- Migration, security, type, lint, build, secret scan and real-browser checks are explicit.
