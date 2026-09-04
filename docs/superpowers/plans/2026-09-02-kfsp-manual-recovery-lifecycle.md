# KFSP Manual Recovery Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Root Admin KFSP/TTAI manual recovery report the actual asynchronous provider lifecycle rather than treating a queued `pg_net` dispatch as final success.

**Architecture:** The manual request UUID becomes the deterministic identity across Root Admin, dispatcher, and native KFSP sync run: `request_id == system_job_run_id == sync_run_id`. Postgres atomically owns queue/idempotency/active-run conflict; a shared Edge helper owns running/final transitions; scheduled KFSP runs remain unchanged.

**Tech Stack:** Next.js 16 / TypeScript, Supabase Postgres + pg_net + Vault, Supabase Edge Functions (Deno/TypeScript), Node test runner, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-02-kfsp-manual-recovery-lifecycle-design.md`

## Global Constraints

- Manual correlation is deterministic: `request_id == system_job_run_id == sync_run_id`.
- Vault credentials remain server-side and must never be returned or persisted in lifecycle summaries.
- `qeo_dispatch_kfsp_job` remains service-role-only.
- Root Admin returns queued/HTTP 202 after dispatch; only Edge provider completion may produce terminal success/failure.
- TTAI partial provider failure (`failed_count > 0`, HTTP 207) finalizes manual system telemetry as failed.
- A duplicate request ID with the same normalized payload is idempotent; a duplicate ID with a different normalized payload fails closed.
- A fresh different manual request for the same KFSP job conflicts while an existing run is `queued`/`running`; stale rows older than the effective `maxDurationMinutes` do not block recovery.
- Scheduled KFSP rating/TTAI cron behavior and canonical Top Stocks 200 logic remain unchanged.
- No temporary cron or polling scheduler is introduced for manual recovery.

---

### Task 1: RED regression contract for correlated manual lifecycle

**Files:**
- Modify: `tests/kfsp-canonical-universe-sync.test.ts`
- Modify: `tests/root-admin-jobs.test.ts`
- Create: `tests/kfsp-manual-recovery-lifecycle.test.ts`

**Interfaces:**
- Consumes: current `qeo_dispatch_kfsp_job(...)`, current Root Admin manual dispatch path, current KFSP Edge Function source.
- Produces: executable RED contract for migration columns/RPC args, async Root Admin behavior, Edge lifecycle helper, idempotency/conflict/stale rules.

- [ ] **Step 1: Add migration/source assertions that must fail before implementation**

Add a new lifecycle migration path constant and assertions equivalent to:

```ts
const lifecycleMigrationPath = "supabase/migrations/20260902060000_kfsp_manual_recovery_lifecycle.sql"
assert.ok(existsSync(lifecycleMigrationPath))
const lifecycle = readFileSync(lifecycleMigrationPath, "utf8")
assert.match(lifecycle, /system_job_run_id uuid/i)
assert.match(lifecycle, /sync_run_id uuid/i)
assert.match(lifecycle, /status text/i)
assert.match(lifecycle, /p_actor_user_id uuid/i)
assert.match(lifecycle, /p_max_duration_minutes integer/i)
assert.match(lifecycle, /KFSP_REQUEST_ID_CONFLICT/i)
assert.match(lifecycle, /status in \('queued', 'running'\)/i)
assert.match(lifecycle, /net\.http_post/i)
```

- [ ] **Step 2: Add Root Admin source assertions that require KFSP to bypass synchronous terminalization**

In `tests/root-admin-jobs.test.ts`, require:

```ts
assert.match(jobs, /runKfspRecoveryDispatch/)
assert.match(jobs, /p_actor_user_id: input\.actorUserId/)
assert.match(jobs, /p_max_duration_minutes/)
assert.match(jobs, /state: "queued"/)
```

and assert the KFSP branch occurs before the generic `executeSystemJob()` path so KFSP is not finalized synchronously.

- [ ] **Step 3: Add focused Edge lifecycle contract test**

Create `tests/kfsp-manual-recovery-lifecycle.test.ts` and assert:

```ts
const helper = readFileSync("supabase/functions/_shared/kfsp-manual-lifecycle.ts", "utf8")
assert.match(helper, /beginManualKfspLifecycle/)
assert.match(helper, /finalizeManualKfspLifecycle/)
assert.match(helper, /duplicate/)
assert.doesNotMatch(helper, /access_token|x-kfsp-sync-secret/i)

assert.match(ratingSync, /beginManualKfspLifecycle/)
assert.match(ratingSync, /finalizeManualKfspLifecycle/)
assert.match(ttaiSync, /beginManualKfspLifecycle/)
assert.match(ttaiSync, /finalizeManualKfspLifecycle/)
```

Also assert both Edge Functions use the manual request UUID as the native run ID only for `source === "manual_recovery_rpc"`, while scheduled paths still use `crypto.randomUUID()`.

- [ ] **Step 4: Run RED tests**

Run:

```bash
node --test tests/kfsp-canonical-universe-sync.test.ts tests/root-admin-jobs.test.ts tests/kfsp-manual-recovery-lifecycle.test.ts
```

Expected: FAIL because lifecycle migration/helper/async Root Admin behavior do not yet exist.

- [ ] **Step 5: Commit RED contract**

```bash
git add tests/kfsp-canonical-universe-sync.test.ts tests/root-admin-jobs.test.ts tests/kfsp-manual-recovery-lifecycle.test.ts
git commit -m "test: require correlated KFSP recovery lifecycle"
```

---

### Task 2: Atomic Postgres queue, idempotency, and active-run conflict

**Files:**
- Create: `supabase/migrations/20260902060000_kfsp_manual_recovery_lifecycle.sql`
- Modify: `tests/kfsp-canonical-universe-sync.test.ts`
- Test: `tests/kfsp-manual-recovery-lifecycle.test.ts`

**Interfaces:**
- Consumes: `public.kfsp_manual_dispatch_runs`, `public.system_job_runs`, Vault secret `kfsp_sync_secret`, pg_net.
- Produces: upgraded `public.qeo_dispatch_kfsp_job(text, uuid, text, text[], boolean, text, uuid, integer)` returning stable queue evidence.

- [ ] **Step 1: Extend the dispatch audit table without breaking historical rows**

Migration must add:

```sql
alter table public.kfsp_manual_dispatch_runs
  add column if not exists system_job_run_id uuid references public.system_job_runs(id) on delete set null,
  add column if not exists sync_run_id uuid,
  add column if not exists status text,
  add column if not exists started_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists final_summary jsonb,
  add column if not exists error_code text,
  add column if not exists error_message text;
```

Backfill historical rows to `status='succeeded'` only when they already have `net_request_id` and predate QEO-14; do not invent sync-run correlation for them. Add check constraints for status and JSON object shape, plus partial unique indexes on non-null `system_job_run_id` and `sync_run_id`.

- [ ] **Step 2: Replace dispatcher signature and normalize idempotency payload**

New function arguments:

```sql
p_job_key text,
p_request_id uuid,
p_reason text,
p_tickers text[] default null,
p_force boolean default false,
p_requested_by text default null,
p_actor_user_id uuid default null,
p_max_duration_minutes integer default 15
```

Validate `p_max_duration_minutes between 1 and 240`.

Build the normalized request body first. When `request_id` already exists:

```sql
if existing.job_key <> p_job_key
   or existing.reason <> btrim(p_reason)
   or existing.request_body <> v_body then
  raise exception 'KFSP_REQUEST_ID_CONFLICT';
end if;
```

If it matches, return original `request_id`, `job_key`, `net_request_id`, `system_job_run_id`, `sync_run_id`, `status`, `duplicate=true` without another HTTP call.

- [ ] **Step 3: Enforce active-run conflict before inserting a new request**

Query `system_job_runs` for the same `job_key`, `trigger='manual'`, status in `queued/running`, different ID, and:

```sql
started_at > now() - make_interval(mins => p_max_duration_minutes)
```

If found, raise a sanitized `KFSP_ACTIVE_RUN_CONFLICT:<uuid>` error. Older rows do not block the new request.

- [ ] **Step 4: Insert queued system telemetry and dispatch row atomically**

Insert `system_job_runs` with:

```sql
id = p_request_id
job_key = p_job_key
provider = 'supabase_pg_net'
trigger = 'manual'
actor_user_id = p_actor_user_id
status = 'queued'
started_at = now()
summary = jsonb_build_object('state','queued','request_id',p_request_id)
```

Insert `kfsp_manual_dispatch_runs` with the same UUID and `status='queued'`, then queue exactly one `net.http_post` and save `net_request_id`.

- [ ] **Step 5: Keep privilege boundary explicit**

Revoke all overloads from `public, anon, authenticated`; grant only the new signature to `service_role`. The function remains `security definer set search_path=''`.

- [ ] **Step 6: Run lifecycle DB/source tests**

```bash
node --test tests/kfsp-canonical-universe-sync.test.ts tests/kfsp-manual-recovery-lifecycle.test.ts
```

Expected: migration/dispatcher assertions PASS; Edge/helper assertions remain RED.

- [ ] **Step 7: Commit DB lifecycle**

```bash
git add supabase/migrations/20260902060000_kfsp_manual_recovery_lifecycle.sql tests/kfsp-canonical-universe-sync.test.ts tests/kfsp-manual-recovery-lifecycle.test.ts
git commit -m "feat: queue correlated KFSP manual recovery"
```

---

### Task 3: Shared Edge lifecycle helper

**Files:**
- Create: `supabase/functions/_shared/kfsp-manual-lifecycle.ts`
- Test: `tests/kfsp-manual-recovery-lifecycle.test.ts`

**Interfaces:**
- Consumes: a service-role Supabase client, `jobKey`, request body, native sync-run ID.
- Produces:

```ts
export type ManualKfspContext = {
  requestId: string
  jobKey: "kfsp.rating_daily" | "kfsp.ttai_history"
  syncRunId: string
}

export async function beginManualKfspLifecycle(...): Promise<{ context: ManualKfspContext | null; duplicate: boolean }>
export async function finalizeManualKfspLifecycle(...): Promise<void>
```

- [ ] **Step 1: Implement strict manual-context parsing**

Recognize manual lifecycle only when:

```ts
requestBody?.source === "manual_recovery_rpc"
```

and `request_id` matches UUID format. Scheduled requests return `{ context: null, duplicate: false }` and make no manual telemetry writes.

- [ ] **Step 2: Implement begin transition**

The helper must verify the correlated `kfsp_manual_dispatch_runs` row exists with matching job key and `system_job_run_id=requestId`. It binds `sync_run_id=requestId`, sets dispatch status `running`, and updates `system_job_runs` to:

```ts
{
  status: "running",
  provider_run_id: requestId,
  summary: { state: "running", request_id: requestId, sync_run_id: requestId }
}
```

If the native sync-run row already exists for this deterministic ID, return `duplicate: true` before provider work.

- [ ] **Step 3: Implement sanitized terminal finalization**

Success writes only bounded summary fields supplied by the caller and sets dispatch/system rows to succeeded with timestamps/duration. Failure limits `error_code` and `error_message`, sets both rows failed, and never persists headers, tokens, Vault values, or raw provider payloads.

- [ ] **Step 4: Run helper contract test**

```bash
node --test tests/kfsp-manual-recovery-lifecycle.test.ts
```

Expected: shared-helper assertions PASS; Edge integration assertions may remain RED.

- [ ] **Step 5: Commit helper**

```bash
git add supabase/functions/_shared/kfsp-manual-lifecycle.ts tests/kfsp-manual-recovery-lifecycle.test.ts
git commit -m "feat: add KFSP manual lifecycle helper"
```

---

### Task 4: Correlate KFSP rating provider execution

**Files:**
- Modify: `supabase/functions/kfsp-rating-sync/index.ts`
- Test: `tests/kfsp-manual-recovery-lifecycle.test.ts`
- Test: `tests/kfsp-canonical-universe-sync.test.ts`

**Interfaces:**
- Consumes: shared manual lifecycle helper and current rating sync pipeline.
- Produces: manual rating execution that uses `request_id` as `kfsp_rating_sync_runs.id` and finalizes actual provider result.

- [ ] **Step 1: Parse request body once after authentication**

Read JSON safely and derive:

```ts
const isManual = requestBody?.source === "manual_recovery_rpc"
const manualRequestId = isManual ? parseManualRequestId(requestBody) : null
const syncRunId = manualRequestId ?? crypto.randomUUID()
```

Scheduled requests preserve current random-ID behavior.

- [ ] **Step 2: Insert native rating run and transition manual lifecycle to running**

For manual execution, use deterministic `syncRunId`. If the insert conflicts because the same manual request was already delivered, return the existing execution evidence without repeating provider calls. Then call `beginManualKfspLifecycle` before login/filter/provider work.

- [ ] **Step 3: Finalize actual rating success**

After `publish_kfsp_rating_snapshot` succeeds, call finalizer with sanitized summary:

```ts
{
  as_of_date: asOfDate,
  published_count,
  universe_count: canonicalTickers.length,
  provider_candidate_count: providerRows.length,
  token_refreshed: tokenRefreshed,
  contract_version: KFSP_CONTRACT_VERSION,
}
```

- [ ] **Step 4: Finalize rating failure**

Existing native run failure update remains. Additionally call manual finalizer with bounded error code/message. If final lifecycle persistence itself fails, log the lifecycle error and return a provider error response; never emit a fabricated terminal success.

- [ ] **Step 5: Run rating regression tests**

```bash
node --test tests/kfsp-manual-recovery-lifecycle.test.ts tests/kfsp-canonical-universe-sync.test.ts
```

Expected: rating manual/scheduled source assertions PASS.

- [ ] **Step 6: Commit rating integration**

```bash
git add supabase/functions/kfsp-rating-sync/index.ts tests/kfsp-manual-recovery-lifecycle.test.ts tests/kfsp-canonical-universe-sync.test.ts
git commit -m "feat: correlate KFSP rating recovery outcome"
```

---

### Task 5: Correlate TTAI provider execution and partial failure

**Files:**
- Modify: `supabase/functions/kfsp-ttai-history-sync/index.ts`
- Test: `tests/kfsp-manual-recovery-lifecycle.test.ts`
- Test: `tests/kfsp-canonical-universe-sync.test.ts`

**Interfaces:**
- Consumes: shared lifecycle helper and current `{tickers, force}` TTAI request handling.
- Produces: deterministic manual TTAI run with correct terminal failure semantics for partial failures.

- [ ] **Step 1: Derive deterministic manual run ID without changing scheduled behavior**

Use request UUID for `runId` only when `source === "manual_recovery_rpc"`; otherwise continue `crypto.randomUUID()`.

- [ ] **Step 2: Transition manual lifecycle before provider ticker work**

After canonical/request validation and native run creation, call `beginManualKfspLifecycle`. Duplicate deterministic delivery must return existing evidence and skip all provider ticker fetches.

- [ ] **Step 3: Finalize zero-candidate success**

When there is no new financial period, keep native status `completed` and finalize manual telemetry succeeded with:

```ts
{ candidate_count: 0, processed: 0, failed: 0, skipped: 0, reason: "NO_NEW_FINANCIAL_PERIOD" }
```

- [ ] **Step 4: Finalize normal/partial result from counts**

For `failed === 0`, finalize succeeded. For `failed > 0`, finalize failed with sanitized summary:

```ts
{
  latest_rating_date: latestDate,
  candidate_count: candidates.length,
  processed,
  failed,
  skipped,
  universe_count: canonicalTickers.length,
}
```

Keep the HTTP 207 response for partial provider failure.

- [ ] **Step 5: Finalize fatal exceptions**

Keep native TTAI run failure update and also fail correlated system/dispatch telemetry.

- [ ] **Step 6: Run TTAI regression tests**

```bash
node --test tests/kfsp-manual-recovery-lifecycle.test.ts tests/kfsp-canonical-universe-sync.test.ts
```

Expected: TTAI lifecycle, partial-failure, duplicate-delivery, and scheduled-behavior assertions PASS.

- [ ] **Step 7: Commit TTAI integration**

```bash
git add supabase/functions/kfsp-ttai-history-sync/index.ts tests/kfsp-manual-recovery-lifecycle.test.ts tests/kfsp-canonical-universe-sync.test.ts
git commit -m "feat: correlate TTAI recovery outcome"
```

---

### Task 6: Make Root Admin KFSP dispatch explicitly asynchronous

**Files:**
- Modify: `modules/admin/jobs.ts`
- Modify: `app/api/admin/jobs/[key]/run/route.ts` only if response shape requires explicit queued state
- Modify: `tests/root-admin-jobs.test.ts`

**Interfaces:**
- Consumes: upgraded dispatcher RPC and effective job catalog `maxDurationMinutes`.
- Produces: Root Admin response `{ ok: true, queued: true, state: "queued", requestId, systemJobRunId, netRequestId, duplicate }` without synchronous `executeSystemJob()` terminalization.

- [ ] **Step 1: Pass actor UUID and bounded max duration into dispatcher**

Resolve the effective/base job definition and call:

```ts
supabase.rpc("qeo_dispatch_kfsp_job", {
  p_job_key: input.key,
  p_request_id: input.requestId,
  p_reason: input.reason,
  p_tickers: isTtai ? tickers : null,
  p_force: isTtai ? input.params?.force === true : false,
  p_requested_by: input.actorUserId,
  p_actor_user_id: input.actorUserId,
  p_max_duration_minutes: definition?.maxDurationMinutes ?? 15,
})
```

- [ ] **Step 2: Route KFSP before generic synchronous telemetry wrapper**

Inside `dispatchManualAdminJob()`, after allowlist/reason/confirmation validation:

```ts
if (input.key === "kfsp.rating_daily" || input.key === "kfsp.ttai_history") {
  const summary = await runKfspRecoveryDispatch(input)
  await writeAuditLog({ success: true, afterValue: summary, ... })
  return {
    ok: true,
    jobKey: input.key,
    runId: String(summary.systemJobRunId ?? input.requestId),
    durationMs: Date.now() - startTime,
    summary,
  }
}
```

Do not call `executeSystemJob()` for the two KFSP manual keys.

- [ ] **Step 3: Preserve generic manual jobs unchanged**

`market.sync_universe`, `scanner.run`, `signals.monitor`, and `wyckoff.ingest` continue using `executeSystemJob()` exactly as before.

- [ ] **Step 4: Keep 202 queued semantics**

API route continues returning 202 when `summary.queued === true`. Ensure any user-facing summary/state says queued rather than succeeded.

- [ ] **Step 5: Run Root Admin tests**

```bash
node --test tests/root-admin-jobs.test.ts tests/kfsp-manual-recovery-lifecycle.test.ts
```

Expected: all PASS.

- [ ] **Step 6: Commit Root Admin async path**

```bash
git add modules/admin/jobs.ts app/api/admin/jobs/[key]/run/route.ts tests/root-admin-jobs.test.ts tests/kfsp-manual-recovery-lifecycle.test.ts
git commit -m "fix: keep KFSP manual recovery queued until provider completion"
```

---

### Task 7: Full verification, deployment, and production acceptance

**Files:**
- Modify only if verification exposes a regression.
- Evidence targets: GitHub Actions, Supabase migration/Edge deployment, production DB rows, Vercel deployment.

**Interfaces:**
- Consumes: completed QEO-14 branch.
- Produces: production evidence satisfying QEO-14 acceptance and Linear closure.

- [ ] **Step 1: Run focused and full local/CI-equivalent verification**

Run:

```bash
node --test tests/kfsp-canonical-universe-sync.test.ts tests/kfsp-manual-recovery-lifecycle.test.ts tests/root-admin-jobs.test.ts
pnpm lint
pnpm exec tsc --noEmit
pnpm build
```

Expected: all commands succeed; warnings may remain only if they are existing non-blocking repository warnings.

- [ ] **Step 2: Open PR and require fresh Verify on final HEAD**

Verify at minimum:

- Core regression suite
- KFSP canonical universe regression
- QEO-14 manual lifecycle regression
- Canonical 200 UI regression
- touched lint
- TypeScript
- production build

Do not merge on stale CI evidence from an earlier HEAD/base.

- [ ] **Step 3: Apply migration once after CI is green**

Apply `20260902060000_kfsp_manual_recovery_lifecycle.sql` through Supabase migration tooling. Confirm the new dispatcher signature and service-role grants are live.

- [ ] **Step 4: Deploy both Edge Functions once**

Deploy only:

```text
kfsp-rating-sync
kfsp-ttai-history-sync
```

Avoid repeated deploys unless verification finds a real issue.

- [ ] **Step 5: Run one bounded manual TTAI production smoke**

Use one canonical ticker, `force=true`, a fresh UUID, and a clear recovery reason. Capture the UUID before dispatch.

Verify with SQL that exactly one row exists in each correlation target:

```sql
select request_id, system_job_run_id, sync_run_id, status, net_request_id
from public.kfsp_manual_dispatch_runs
where request_id = '<uuid>';

select id, job_key, trigger, status, provider_run_id, summary, error_code
from public.system_job_runs
where id = '<uuid>';

select id, status, processed_count, failed_count, completed_at
from public.kfsp_ttai_sync_runs
where id = '<uuid>';
```

Expected: same UUID across all three; terminal system status matches provider result.

- [ ] **Step 6: Verify duplicate request idempotency**

Retry the exact same UUID/job/reason/tickers/force. Confirm:

```text
duplicate = true
same net_request_id
same system_job_run_id
same sync_run_id
one native sync row only
```

- [ ] **Step 7: Verify active-run conflict and stale semantics without harming production**

Use transactional/test SQL or a controlled fixture to prove a fresh different queued/running row blocks a second request and a row older than the job max duration does not. Do not leave synthetic active rows behind.

- [ ] **Step 8: Verify scheduler invariants**

Confirm production still has only the intended KFSP schedules:

```text
kfsp-rating-daily-7am-ict -> 07:00 ICT
kfsp-ttai-history-daily-0710-ict -> 07:10 ICT
```

No temporary rebuild/recovery cron is allowed.

- [ ] **Step 9: Merge only after final fresh evidence**

Squash merge after final PR HEAD Verify is green. Then confirm the Vercel production deployment for the merge commit reaches `READY` with `aliasError=null`.

- [ ] **Step 10: Update Linear QEO-14 to Done with audit evidence**

Comment with:

- PR and merge SHA;
- Verify run and all required green checks;
- migration and Edge Function deployment evidence;
- production correlation smoke UUID and terminal status;
- duplicate retry evidence;
- active/stale conflict evidence;
- scheduler invariant evidence;
- Vercel production READY evidence.

Move QEO-14 to **Done** only after all acceptance checks above are true.
