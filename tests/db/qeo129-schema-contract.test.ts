import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import test from "node:test"

const migrationPath = "supabase/migrations/20260906170000_qeo129_adjusted_daily_shadow.sql"

test("QEO-129 shadow storage is private, lineage-bound, and exact-readback verified", () => {
  assert.equal(
    existsSync(migrationPath),
    true,
    "QEO-129 migration 20260906170000 must exist after the RED gate",
  )

  const sql = readFileSync(migrationPath, "utf8")

  assert.match(sql, /create\s+table\s+public\.market_ohlcv_adjusted_daily/i)
  assert.match(sql, /primary\s+key\s*\(ticker,\s*session_date\)/i)
  assert.match(
    sql,
    /foreign\s+key\s*\(factor_run_id,\s*ticker\)[\s\S]*?references\s+public\.market_adjustment_factor_runs\s*\(id,\s*ticker\)/i,
  )
  assert.match(sql, /open\s+numeric\s+not\s+null\s+check\s*\(open\s*>\s*0\)/i)
  assert.match(sql, /high\s+numeric\s+not\s+null\s+check\s*\(high\s*>\s*0\)/i)
  assert.match(sql, /low\s+numeric\s+not\s+null\s+check\s*\(low\s*>\s*0\)/i)
  assert.match(sql, /close\s+numeric\s+not\s+null\s+check\s*\(close\s*>\s*0\)/i)
  assert.match(sql, /volume\s+numeric\s+not\s+null\s+check\s*\(volume\s*>=\s*0\)/i)
  assert.match(sql, /check\s*\(high\s*>=\s*greatest\(open,\s*close,\s*low\)\)/i)
  assert.match(sql, /check\s*\(low\s*<=\s*least\(open,\s*close,\s*high\)\)/i)
  assert.match(sql, /event_lineage_hash\s+text\s+not\s+null\s+check\s*\(event_lineage_hash\s*~\s*'\^\[a-f0-9\]\{64\}\$'\)/i)

  assert.match(sql, /create\s+table\s+public\.market_adjusted_daily_rollout/i)
  assert.match(sql, /status\s+text\s+not\s+null\s+default\s+'shadow'/i)
  assert.match(sql, /status\s+in\s*\(\s*'shadow'\s*,\s*'active'\s*,\s*'blocked'\s*\)/i)
  assert.match(sql, /verified_from\s+date/i)
  assert.match(sql, /verified_through\s+date/i)
  assert.match(sql, /activated_at\s+timestamptz/i)
  assert.match(sql, /blocked_reason\s+text/i)

  assert.match(sql, /alter\s+table\s+public\.market_ohlcv_adjusted_daily\s+enable\s+row\s+level\s+security/i)
  assert.match(sql, /alter\s+table\s+public\.market_adjusted_daily_rollout\s+enable\s+row\s+level\s+security/i)
  assert.match(
    sql,
    /revoke\s+all\s+privileges\s+on\s+table\s+public\.market_ohlcv_adjusted_daily\s+from\s+public,\s*anon,\s*authenticated/i,
  )
  assert.match(
    sql,
    /revoke\s+all\s+privileges\s+on\s+table\s+public\.market_adjusted_daily_rollout\s+from\s+public,\s*anon,\s*authenticated/i,
  )
  assert.match(sql, /grant\s+select,\s*insert,\s*update,\s*delete\s+on\s+table\s+public\.market_ohlcv_adjusted_daily\s+to\s+service_role/i)
  assert.match(sql, /grant\s+select,\s*insert,\s*update\s+on\s+table\s+public\.market_adjusted_daily_rollout\s+to\s+service_role/i)

  assert.match(
    sql,
    /create\s+or\s+replace\s+function\s+public\.qeo_adjusted_daily_readback\s*\(\s*p_ticker\s+text,\s*p_from\s+date,\s*p_to\s+date,\s*p_factor_run_id\s+uuid,\s*p_lineage_hash\s+text\s*\)/i,
  )
  assert.match(
    sql,
    /returns\s+table\s*\([\s\S]*?session_date\s+date[\s\S]*?bar_time\s+timestamptz[\s\S]*?open\s+numeric[\s\S]*?high\s+numeric[\s\S]*?low\s+numeric[\s\S]*?close\s+numeric[\s\S]*?volume\s+numeric[\s\S]*?raw_bar_time\s+timestamptz[\s\S]*?factor_run_id\s+uuid[\s\S]*?factor_version\s+text[\s\S]*?event_lineage_hash\s+text[\s\S]*?adjustment_engine_version\s+text[\s\S]*?\)/i,
    "QEO-129 exact readback RPC must expose persisted OHLCV as well as identity/lineage",
  )
  assert.match(
    sql,
    /select[\s\S]*?a\.session_date[\s\S]*?a\.bar_time[\s\S]*?a\.open[\s\S]*?a\.high[\s\S]*?a\.low[\s\S]*?a\.close[\s\S]*?a\.volume[\s\S]*?a\.raw_bar_time[\s\S]*?a\.factor_run_id[\s\S]*?a\.factor_version[\s\S]*?a\.event_lineage_hash[\s\S]*?a\.adjustment_engine_version/i,
    "QEO-129 exact readback RPC must select persisted OHLCV, not lineage-only metadata",
  )
  assert.match(sql, /security\s+definer/i)
  assert.match(sql, /set\s+search_path\s*=\s*public,\s*pg_temp/i)
  assert.match(
    sql,
    /revoke\s+all\s+on\s+function\s+public\.qeo_adjusted_daily_readback[\s\S]*?from\s+public,\s*anon,\s*authenticated/i,
  )
  assert.match(
    sql,
    /grant\s+execute\s+on\s+function\s+public\.qeo_adjusted_daily_readback[\s\S]*?to\s+service_role/i,
  )

  assert.doesNotMatch(sql, /(?:update|delete\s+from|insert\s+into)\s+public\.market_ohlcv_history/i)
  assert.doesNotMatch(sql, /grant\s+(?:select|insert|update|delete|all)[^;]*market_ohlcv_adjusted_daily[^;]*(?:anon|authenticated)/i)
})
