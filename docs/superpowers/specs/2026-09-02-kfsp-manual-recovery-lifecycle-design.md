# KFSP Manual Recovery Lifecycle Design

## Context

QEO-13 shipped a safe one-shot Root Admin recovery path for `kfsp.rating_daily` and `kfsp.ttai_history`. The dispatcher keeps Vault credentials server-side, records `request_id`, caller/reason, and queues the Edge Function through `pg_net`.

The remaining defect is lifecycle correlation. Root Admin currently wraps the one-shot dispatcher in `executeSystemJob()`. That helper treats a returned dispatch response as a completed job and immediately finalizes `system_job_runs.status = succeeded`, even though `net.http_post` only proves the Edge request was queued. The rating and TTAI Edge Functions then create independent provider sync-run UUIDs and do not bind the manual request back to Root Admin telemetry.

As a result, an operator can see a manual recovery reported as successful even when the provider execution later fails, and there is no durable request → system job → provider run correlation.

## Decision

Implement a correlated asynchronous lifecycle for manual KFSP recovery.

A manual recovery has one durable request UUID. For new manual KFSP runs, that UUID is also used as the `system_job_runs.id` and as the native KFSP sync-run ID. This deliberately makes correlation deterministic and race-safe:

`request_id == system_job_run_id == sync_run_id`

Scheduled KFSP runs remain unchanged and continue to generate independent random sync-run IDs.

The one-shot dispatcher remains the only component that reads the Vault-backed KFSP sync secret. No new scheduler or temporary cron path is introduced.

## Lifecycle

### Queue

Root Admin validates the existing manual confirmation/reason/ticker rules and calls `qeo_dispatch_kfsp_job(...)`.

The dispatcher performs the manual lifecycle transition atomically inside Postgres:

1. Validate `job_key`, `request_id`, reason, and TTAI ticker payload.
2. Look up an existing `kfsp_manual_dispatch_runs` row for the same `request_id`.
3. If it exists and its job/payload differs, fail with an idempotency conflict rather than silently reusing the request ID.
4. If it exists and matches, return the original dispatch/system-run evidence with `duplicate = true`; do not call `net.http_post` again.
5. Before creating a new request, inspect `system_job_runs` for another fresh `queued` or `running` run for the same KFSP job. A fresh different request conflicts; an older run is considered stale by the existing `maxDurationMinutes` health rule and does not block recovery.
6. Insert `system_job_runs` with `id = request_id`, `trigger = manual`, and `status = queued`.
7. Insert the correlated `kfsp_manual_dispatch_runs` row.
8. Queue exactly one `net.http_post` using the Vault secret.
9. Save `net_request_id` and return HTTP/API evidence as queued, not final success.

The dispatcher does not mark the system job `succeeded`.

### Start

For `source = manual_recovery_rpc`, both KFSP Edge Functions parse and validate `request_id` before provider work.

The native sync-run ID is set to the request UUID. The Edge Function then:

1. Inserts its native sync-run row using that deterministic ID.
2. If the native row already exists, treats the invocation as duplicate delivery and does not start a second provider execution.
3. Binds `kfsp_manual_dispatch_runs.sync_run_id` to the deterministic sync-run ID.
4. Sets `kfsp_manual_dispatch_runs.status = running` and `started_at`.
5. Sets the correlated `system_job_runs.status = running` and `provider_run_id = sync_run_id`.

Scheduled invocations do not execute these manual-correlation writes.

### Complete

The Edge Function owns the final manual result because it has the actual provider outcome.

On success:

- finish the existing native KFSP sync-run row as today;
- update `kfsp_manual_dispatch_runs.status = succeeded`, `completed_at`, and a sanitized result summary;
- update `system_job_runs.status = succeeded`, `finished_at`, `duration_ms`, `provider_run_id`, and sanitized `summary`.

On failure:

- finish the native KFSP sync-run row as failed as today;
- update `kfsp_manual_dispatch_runs.status = failed`, `completed_at`, sanitized `error_code`/`error_message`, and sanitized summary where available;
- update `system_job_runs.status = failed`, `finished_at`, `duration_ms`, sanitized `error_code`/`error_message`, and provider evidence.

For TTAI, `failed_count > 0` / HTTP 207 is a failed manual recovery in Root Admin telemetry even though some ticker writes may have succeeded. The persisted summary must include counts such as `candidate_count`, `processed`, `failed`, and `skipped`, but never provider credentials or raw provider payloads.

## Data Model

Extend `public.kfsp_manual_dispatch_runs` with nullable correlation/finalization columns so historical QEO-13 rows remain valid:

- `system_job_run_id uuid references public.system_job_runs(id) on delete set null`
- `sync_run_id uuid`
- `status text` constrained to `queued`, `running`, `succeeded`, `failed`
- `started_at timestamptz`
- `completed_at timestamptz`
- `final_summary jsonb` constrained to a JSON object when non-null
- `error_code text`
- `error_message text`

Add partial unique indexes for non-null `system_job_run_id` and non-null `sync_run_id` so one manual dispatch cannot correlate to multiple system/provider runs.

Do not add a second scheduler table. Do not duplicate the full provider response in the dispatch table.

No schema change is required for `system_job_runs`; its existing states already include `queued`, `running`, `succeeded`, and `failed`, and it already has `provider_run_id`, summary, timestamps, and error fields.

No `request_id` column is required on `kfsp_rating_sync_runs` or `kfsp_ttai_sync_runs` because the deterministic manual sync-run ID equals the request UUID. Their existing primary keys provide the at-most-once native-run constraint.

## Root Admin Changes

KFSP manual recovery must bypass the synchronous-completion behavior of generic `executeSystemJob()`.

`dispatchManualAdminJob()` keeps the existing allowlist, confirmation gate, reason validation, TTAI ticker validation, and audit log. For the two KFSP jobs it calls the one-shot dispatcher directly and returns a queued result. Other manual jobs continue using `executeSystemJob()` unchanged.

The success bit in `system_audit_log` for the initial `job.run` action means the dispatch request was accepted/queued. The actual provider outcome is represented by `system_job_runs` and native KFSP run tables.

The API continues returning HTTP 202 when the dispatcher returns queued evidence. It must not translate queued state into final success text.

## Active-Run Conflict and Stale Handling

The original Root Admin control-plane invariant is restored for KFSP recovery: a different manual request cannot start while the same job has a fresh `queued` or `running` system run.

The freshness threshold reuses each effective job definition's existing `maxDurationMinutes`; the app passes this bounded value into the dispatcher contract or otherwise enforces the same value in the server-side queue path. No new configurable timeout is introduced for QEO-14.

A `queued` or `running` row older than the bounded maximum duration is surfaced as stale/unhealthy by the existing Admin health derivation and no longer blocks a subsequent recovery. QEO-14 does not add a background cleanup scheduler solely to mutate stale rows.

## Idempotency Rules

1. One `request_id` can represent only one job and one normalized payload.
2. Retrying the same request ID with the same job/payload returns the original evidence and does not enqueue another HTTP request.
3. Reusing a request ID with a different job, ticker list, force flag, or reason fails closed with a request-ID conflict.
4. Manual Edge delivery uses the request UUID as the native sync-run primary key; duplicate delivery cannot create a second native run.
5. A fresh different request for the same job conflicts while the previous manual run is still queued/running.

## Shared Edge Lifecycle Helper

Create a focused shared helper under `supabase/functions/_shared/` for manual lifecycle correlation so rating and TTAI do not implement divergent telemetry behavior.

The helper is responsible only for:

- recognizing a validated manual recovery context;
- binding dispatch → sync run;
- transitioning system/dispatch telemetry to running;
- finalizing success/failure with sanitized summaries/errors;
- identifying duplicate manual delivery.

Provider authentication, provider normalization, canonical-universe validation, rating publication, and TTAI history normalization stay in their existing Edge Functions.

## Error Handling

Lifecycle telemetry must fail closed before provider work when a manual request cannot be correlated safely. Examples include missing dispatch evidence, job-key mismatch, request-ID conflict, or inability to establish the running state.

After provider work has begun, failure to persist final lifecycle telemetry is treated as an operational error and must be visible in Edge logs. Provider data writes that already succeeded are not rolled back across an external HTTP boundary, but Root Admin must never manufacture a success state when final telemetry cannot be persisted.

All persisted errors remain sanitized and bounded in length. Vault values, KFSP access tokens, request headers, credentials, and raw provider payloads are never copied into `system_job_runs`, `kfsp_manual_dispatch_runs`, or Admin API responses.

## Testing

### Regression tests

Add/extend tests to prove:

- dispatcher migration adds correlation columns and uniqueness constraints;
- Root Admin KFSP path no longer uses synchronous `executeSystemJob()` finalization;
- queued dispatch returns 202 semantics;
- same request/same payload is duplicate-safe;
- same request/different payload fails closed;
- fresh active run conflicts;
- stale active run does not block a new request;
- rating manual delivery transitions queued → running → succeeded;
- rating provider failure transitions queued → running → failed;
- TTAI manual delivery with `failed_count > 0` finalizes failed;
- duplicate Edge delivery does not create a second native sync run;
- scheduled rating/TTAI behavior remains unchanged;
- secrets/raw provider payloads are absent from persisted lifecycle summaries.

### Production acceptance

After CI is green:

1. Apply the migration once.
2. Deploy both KFSP Edge Functions once.
3. Run one bounded manual TTAI recovery for a canonical ticker through the one-shot path.
4. Verify one request UUID appears as exactly one `kfsp_manual_dispatch_runs.request_id`, one `system_job_runs.id`, and one `kfsp_ttai_sync_runs.id`.
5. Verify the system job progresses from queued/running to the provider-derived terminal state.
6. Retry the exact same request UUID and confirm no second `net_request_id` or native sync run is created.
7. Verify no temporary cron jobs were added and production scheduled KFSP jobs remain active.

## Files Expected to Change

- `supabase/migrations/20260902*_kfsp_manual_recovery_lifecycle.sql`
- `supabase/functions/_shared/kfsp-manual-lifecycle.ts`
- `supabase/functions/kfsp-rating-sync/index.ts`
- `supabase/functions/kfsp-ttai-history-sync/index.ts`
- `lib/admin/jobs.ts`
- `app/api/admin/jobs/[key]/run/route.ts` only if response-state wording/status handling needs adjustment
- `tests/kfsp-canonical-universe-sync.test.ts` and/or a focused QEO-14 regression test
- `tests/root-admin-jobs.test.ts`

## Non-Goals

- changing KFSP provider scoring/normalization;
- changing the canonical Top Stocks 200 universe logic;
- changing scheduled KFSP cron cadence;
- introducing a polling scheduler solely for manual recovery;
- storing provider secrets or full raw responses in Admin telemetry;
- refactoring unrelated Root Admin job execution paths.
