import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import test from "node:test"

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

test("QEO-197 keeps Vercel workflow as a thin rollback wrapper around the shared orchestrator", () => {
  const workflow = source("workflows/qeoindex-eod-pipeline.ts")
  assert.match(workflow, /use workflow/)
  assert.match(workflow, /runQeoIndexEodOrchestrator/)
  assert.match(workflow, /sleepUntil:\s*sleep/)
  assert.doesNotMatch(workflow, /runKfspRatingRefreshStep|runSupabasePublishStep/)
})

test("QEO-197 standalone worker build and hardened UpCloud deployment exist", () => {
  for (const path of [
    "services/eod-worker/entrypoint.ts",
    "services/eod-worker/build.mjs",
    "services/eod-worker/Dockerfile",
    "services/eod-worker/deploy/upcloud/docker-compose.upcloud.yml",
    "services/eod-worker/deploy/upcloud/qeo-eod.service",
    "services/eod-worker/deploy/upcloud/qeo-eod.timer",
  ]) assert.equal(existsSync(new URL(`../${path}`, import.meta.url)), true, `${path} must exist`)

  const pkg = JSON.parse(source("package.json"))
  assert.match(pkg.scripts["eod:worker:build"] || "", /services\/eod-worker\/build\.mjs/)
  assert.ok(pkg.devDependencies?.esbuild, "esbuild must be pinned in devDependencies")

  const compose = source("services/eod-worker/deploy/upcloud/docker-compose.upcloud.yml")
  assert.match(compose, /mem_limit:\s*900m/)
  assert.match(compose, /cpus:\s*["']0\.85["']/)
  assert.match(compose, /read_only:\s*true/)
  assert.match(compose, /no-new-privileges:true/)
  assert.match(compose, /cap_drop:[\s\S]*ALL/)
  assert.match(compose, /context:\s*\.\.\/\.\.\/\.\.\/\.\./, "Compose build context must resolve to repository root")
  assert.doesNotMatch(compose, /^\s*ports:/m)
})

test("QEO-197 UpCloud timer fires at 15:01 ICT on weekdays and is not persistent", () => {
  const timer = source("services/eod-worker/deploy/upcloud/qeo-eod.timer")
  assert.match(timer, /OnCalendar=Mon\.\.Fri \*-\*-\* 15:01:00 Asia\/Ho_Chi_Minh/)
  assert.match(timer, /Persistent=false/)
})

test("QEO-197 retirement migration preserves the legacy pg_cron row but makes it inactive", () => {
  const path = "supabase/migrations/20260912145500_qeo197_retire_supabase_eod_scheduler.sql"
  assert.equal(existsSync(new URL(`../${path}`, import.meta.url)), true)
  const sql = source(path)
  assert.match(sql, /qeoindex-eod-pipeline-1515-ict/)
  assert.match(sql, /cron\.alter_job/)
  assert.match(sql, /active\s*:=\s*false/i)
  assert.doesNotMatch(sql, /cron\.unschedule\('qeoindex-eod-pipeline-1515-ict'\)/i)
})


test("QEO-197 admin metadata points to UpCloud while legacy pg_cron is historical-only", () => {
  const catalog = source("modules/admin/effective-job-catalog.ts")
  const schedule = source("modules/admin/job-schedule.ts")
  assert.match(catalog, /provider:\s*"upcloud_systemd"/)
  assert.match(catalog, /scheduleIct:\s*"15:01 T2-T6"/)
  assert.match(catalog, /schedulerName:\s*"qeo-eod\.timer"/)
  assert.match(schedule, /"qeoindex-eod-pipeline-1515-ict": "qeoindex\.eod_pipeline"/)
  const activeBlock = schedule.slice(schedule.indexOf("JOB_KEY_TO_PG_CRON_NAME"))
  assert.doesNotMatch(activeBlock, /"qeoindex\.eod_pipeline": "qeoindex-eod-pipeline-1515-ict"/)
})
