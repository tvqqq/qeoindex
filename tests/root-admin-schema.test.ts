import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import test from "node:test"

const sql = readFileSync(new URL("../supabase/migrations/20260824120000_root_admin_control_plane.sql", import.meta.url), "utf8")
const phasesSql = readFileSync(new URL("../supabase/migrations/20260825160000_system_job_phases.sql", import.meta.url), "utf8")
const ohlcvMigrationUrl = new URL("../supabase/migrations/20260825163000_market_ohlcv_history.sql", import.meta.url)
const chartOhlcvMigrationUrl = new URL("../supabase/migrations/20260905065836_qeo92_chart_ohlcv_intraday.sql", import.meta.url)

test("control-plane tables are private service-role data", () => {
  for (const table of ["system_settings", "system_job_runs", "system_audit_log"]) {
    assert.match(sql, new RegExp(`create table if not exists public\\.${table}`))
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`))
    assert.match(sql, new RegExp(`revoke all privileges on table public\\.${table} from anon, authenticated`))
    assert.match(sql, new RegExp(`grant all privileges on table public\\.${table} to service_role`))
  }
})

test("job phase telemetry is private, ordered and bound to its parent run", () => {
  assert.match(phasesSql, /create table if not exists public\.system_job_phases/)
  assert.match(phasesSql, /references public\.system_job_runs\(id\) on delete cascade/)
  assert.match(phasesSql, /unique \(run_id, phase_key\)/)
  assert.match(phasesSql, /system_job_phases_run_order_idx/)
  assert.match(phasesSql, /alter table public\.system_job_phases enable row level security/)
  assert.match(phasesSql, /revoke all privileges on table public\.system_job_phases from anon, authenticated/)
  assert.match(phasesSql, /grant all privileges on table public\.system_job_phases to service_role/)
})

test("raw OHLCV history is private, idempotent and exposes service-role coverage only", () => {
  assert.equal(existsSync(ohlcvMigrationUrl), true, "market_ohlcv_history migration must exist")
  if (!existsSync(ohlcvMigrationUrl)) return
  const ohlcvSql = readFileSync(ohlcvMigrationUrl, "utf8")

  assert.match(ohlcvSql, /create table if not exists public\.market_ohlcv_history/)
  assert.match(ohlcvSql, /primary key \(ticker, timeframe, bar_time\)/)
  assert.match(ohlcvSql, /timeframe text not null check \(timeframe in \('1D','1H'\)\)/)
  assert.match(ohlcvSql, /market_ohlcv_history_lookup_idx/)
  assert.match(ohlcvSql, /create or replace function public\.qeo_market_ohlcv_coverage\(p_tickers text\[\]\)/)
  assert.match(ohlcvSql, /count\(distinct date_trunc\('month'/)
  assert.match(ohlcvSql, /alter table public\.market_ohlcv_history enable row level security/)
  assert.match(ohlcvSql, /revoke all privileges on table public\.market_ohlcv_history from anon, authenticated/)
  assert.match(ohlcvSql, /grant all privileges on table public\.market_ohlcv_history to service_role/)
  assert.match(ohlcvSql, /grant execute on function public\.qeo_market_ohlcv_coverage\(text\[\]\) to service_role/)
  assert.doesNotMatch(ohlcvSql, /grant execute[\s\S]*qeo_market_ohlcv_coverage[\s\S]*to authenticated/)
})

test("QEO-92 keeps chart 1m storage isolated from Daily-only Wyckoff history", () => {
  assert.equal(existsSync(chartOhlcvMigrationUrl), true, "QEO-92 chart OHLCV migration must exist")
  if (!existsSync(chartOhlcvMigrationUrl)) return
  const chartSql = readFileSync(chartOhlcvMigrationUrl, "utf8")

  assert.match(chartSql, /create table if not exists public\.chart_ohlcv_provenance_batches/i)
  assert.match(chartSql, /create table if not exists public\.chart_ohlcv_intraday/i)
  assert.match(chartSql, /primary key \(ticker, base_resolution, bar_time\)/i)
  assert.match(chartSql, /base_resolution text not null check \(base_resolution = '1m'\)/i)
  assert.match(chartSql, /create table if not exists public\.chart_ohlcv_cold_manifests/i)
  assert.match(chartSql, /enable row level security/i)
  assert.match(chartSql, /grant all privileges on table public\.chart_ohlcv_intraday to service_role/i)
  assert.match(chartSql, /insert into storage\.buckets/i)
  assert.match(chartSql, /'chart-ohlcv'/i)
  assert.doesNotMatch(chartSql, /alter table public\.market_ohlcv_history[\s\S]*1m/i)
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
