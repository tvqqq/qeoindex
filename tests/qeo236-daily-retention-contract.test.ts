import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import test from "node:test"

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

function qeo236Migration() {
  const migrations = readdirSync(new URL("../supabase/migrations/", import.meta.url))
  const name = migrations.find((entry) => entry.endsWith("_qeo236_daily_5y_retention.sql"))
  assert.ok(name, "QEO-236 rolling 5Y Daily retention migration must exist")
  return source(`supabase/migrations/${name}`)
}

test("QEO-236 keeps canonical Daily OHLCV to a rolling five-calendar-year window", () => {
  const archive = source("modules/eod/archive.ts")
  const contract = source("modules/market/history/contract.ts")
  const route = source("app/api/admin/market/daily-history/backfill/route.ts")
  const sql = qeo236Migration()

  assert.match(contract, /DAILY_BACKFILL_DAYS\s*=\s*5\s*\*\s*366/)
  assert.match(route, /bounded ~5Y bootstrap followed by incremental EOD refresh/i)
  assert.match(archive, /qeo_prune_daily_ohlcv_history/)
  assert.match(archive, /rolling 5 calendar years/i)

  assert.match(sql, /create or replace function public\.qeo_prune_daily_ohlcv_history/i)
  assert.match(sql, /Asia\/Ho_Chi_Minh/)
  assert.match(sql, /interval\s+'5 years'/i)
  assert.match(sql, /delete\s+from\s+public\.market_ohlcv_history/i)
  assert.match(sql, /timeframe\s*=\s*'1D'/i)
  assert.match(sql, /bar_time\s*<\s*v_daily_cutoff/i)
  assert.match(sql, /rolling 5 calendar years/i)
  assert.match(sql, /grant execute on function public\.qeo_prune_daily_ohlcv_history\(timestamptz\) to service_role/i)
})
