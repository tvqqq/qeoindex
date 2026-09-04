import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import test from "node:test"

const lifecycleMigrationPath = "supabase/migrations/20260902060000_kfsp_manual_recovery_lifecycle.sql"
const helperPath = "supabase/functions/_shared/kfsp-manual-lifecycle.ts"
const ratingPath = "supabase/functions/kfsp-rating-sync/index.ts"
const ttaiPath = "supabase/functions/kfsp-ttai-history-sync/index.ts"
const jobsPath = "modules/admin/jobs.ts"

function source(path: string) {
  assert.ok(existsSync(path), `${path} must exist`)
  return readFileSync(path, "utf8")
}

test("manual recovery migration defines deterministic correlation and bounded queue conflict", () => {
  const lifecycle = source(lifecycleMigrationPath)
  assert.match(lifecycle, /system_job_run_id uuid/i)
  assert.match(lifecycle, /sync_run_id uuid/i)
  assert.match(lifecycle, /status text/i)
  assert.match(lifecycle, /p_actor_user_id uuid/i)
  assert.match(lifecycle, /p_max_duration_minutes integer/i)
  assert.match(lifecycle, /KFSP_REQUEST_ID_CONFLICT/i)
  assert.match(lifecycle, /KFSP_ACTIVE_RUN_CONFLICT/i)
  assert.match(lifecycle, /status in \('queued', 'running'\)/i)
  assert.match(lifecycle, /net\.http_post/i)
  assert.match(lifecycle, /system_job_runs/i)
})

test("shared Edge lifecycle helper delegates running and terminal transitions without secrets", () => {
  const helper = source(helperPath)
  assert.match(helper, /beginManualKfspLifecycle/)
  assert.match(helper, /finalizeManualKfspLifecycle/)
  assert.match(helper, /manual_recovery_rpc/)
  assert.match(helper, /qeo_begin_kfsp_manual_lifecycle/)
  assert.match(helper, /qeo_finalize_kfsp_manual_lifecycle/)
  assert.match(helper, /duplicate/)
  assert.doesNotMatch(helper, /access_token|x-kfsp-sync-secret|vault\.decrypted_secrets/i)
})

test("rating sync correlates manual request id while scheduled runs keep random ids", () => {
  const rating = source(ratingPath)
  assert.match(rating, /manualKfspRequestId\(requestBody\)/)
  assert.match(rating, /beginManualKfspLifecycle/)
  assert.match(rating, /finalizeManualKfspLifecycle/)
  assert.match(rating, /crypto\.randomUUID\(\)/)
})

test("TTAI sync correlates manual request id and preserves partial-failure semantics", () => {
  const ttai = source(ttaiPath)
  assert.match(ttai, /manualKfspRequestId\(requestBody\)/)
  assert.match(ttai, /beginManualKfspLifecycle/)
  assert.match(ttai, /finalizeManualKfspLifecycle/)
  assert.match(ttai, /crypto\.randomUUID\(\)/)
  assert.match(ttai, /failed \? 207 : 200/)
})

test("Root Admin queues KFSP recovery without synchronous executeSystemJob terminalization", () => {
  const jobs = source(jobsPath)
  assert.match(jobs, /p_actor_user_id: input\.actorUserId/)
  assert.match(jobs, /p_max_duration_minutes:/)
  assert.match(jobs, /state: row\.status/)
  assert.match(jobs, /systemJobRunId: row\.system_job_run_id/)

  const functionStart = jobs.indexOf("export async function dispatchManualAdminJob")
  const kfspAsyncBranch = jobs.indexOf('input.key === "kfsp.rating_daily" || input.key === "kfsp.ttai_history"', functionStart)
  const genericTelemetry = jobs.indexOf("await executeSystemJob", functionStart)
  assert.ok(functionStart >= 0, "dispatchManualAdminJob must exist")
  assert.ok(kfspAsyncBranch > functionStart, "KFSP async branch must exist in dispatchManualAdminJob")
  assert.ok(genericTelemetry > kfspAsyncBranch, "KFSP async dispatch must return before generic synchronous telemetry")
})
