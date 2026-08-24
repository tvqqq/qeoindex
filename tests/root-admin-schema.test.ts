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
