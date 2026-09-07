import assert from "node:assert/strict"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import test from "node:test"

const migrationName = "20260906169000_qeo132_raw_daily_basis.sql"
const migrationPath = `supabase/migrations/${migrationName}`

function migrationSql() {
  assert.equal(existsSync(migrationPath), true, `${migrationName} must exist after QEO-124 and before QEO-129`)
  return readFileSync(migrationPath, "utf8")
}

test("QEO-132 owns a collision-free 20260906169000 raw Daily migration", () => {
  const versions = readdirSync("supabase/migrations").filter((name) => name.startsWith("20260906169000_"))
  assert.deepEqual(versions, [migrationName])
})

test("QEO-132 creates separate append-only raw evidence and canonical raw Daily tables", () => {
  const sql = migrationSql()
  assert.match(sql, /create\s+table\s+public\.market_ohlcv_raw_daily_evidence/i)
  assert.match(sql, /create\s+table\s+public\.market_ohlcv_raw_daily/i)
  assert.match(sql, /price_basis\s+text\s+not\s+null/i)
  assert.match(sql, /price_basis\s*=\s*'RAW'/i)
  assert.match(sql, /raw_evidence_hash\s+text\s+not\s+null/i)
  assert.match(sql, /raw_evidence_hash\s*~\s*'\^\[a-f0-9\]\{64\}\$'/i)
  assert.match(sql, /foreign\s+key\s*\(evidence_id,\s*ticker,\s*session_date\)[\s\S]*?references\s+public\.market_ohlcv_raw_daily_evidence\s*\(id,\s*ticker,\s*session_date\)/i)
  assert.match(sql, /primary\s+key\s*\(ticker,\s*session_date\)/i)

  for (const column of ["open", "high", "low", "close"]) {
    assert.match(sql, new RegExp(`${column}\\s*>\\s*0`, "i"))
  }
  assert.match(sql, /volume\s*>=\s*0/i)
  assert.match(sql, /high\s*>=\s*greatest\s*\(open,\s*close,\s*low\)/i)
  assert.match(sql, /low\s*<=\s*least\s*\(open,\s*close,\s*high\)/i)
})

test("QEO-132 keeps raw evidence private and exposes only service-role persistence", () => {
  const sql = migrationSql()
  assert.match(sql, /alter\s+table\s+public\.market_ohlcv_raw_daily_evidence\s+enable\s+row\s+level\s+security/i)
  assert.match(sql, /alter\s+table\s+public\.market_ohlcv_raw_daily\s+enable\s+row\s+level\s+security/i)
  assert.match(sql, /revoke\s+all\s+privileges\s+on\s+table\s+public\.market_ohlcv_raw_daily_evidence\s+from\s+public,\s*anon,\s*authenticated/i)
  assert.match(sql, /revoke\s+all\s+privileges\s+on\s+table\s+public\.market_ohlcv_raw_daily\s+from\s+public,\s*anon,\s*authenticated/i)
  assert.match(sql, /create\s+or\s+replace\s+function\s+public\.qeo_persist_raw_daily_observation/i)
  assert.match(sql, /grant\s+execute\s+on\s+function\s+public\.qeo_persist_raw_daily_observation[\s\S]*?to\s+service_role/i)
  assert.match(sql, /revoke\s+all\s+on\s+function\s+public\.qeo_persist_raw_daily_observation[\s\S]*?from\s+public,\s*anon,\s*authenticated/i)

  // Evidence is append-only: service role gets SELECT/INSERT only, never UPDATE/DELETE.
  assert.match(sql, /grant\s+select,\s*insert\s+on\s+table\s+public\.market_ohlcv_raw_daily_evidence\s+to\s+service_role/i)
  assert.doesNotMatch(sql, /grant[^;]*(?:update|delete)[^;]*market_ohlcv_raw_daily_evidence/i)
})

test("QEO-132 never rewrites the legacy adjusted market_ohlcv_history table", () => {
  const sql = migrationSql()
  assert.doesNotMatch(sql, /alter\s+table\s+public\.market_ohlcv_history/i)
  assert.doesNotMatch(sql, /update\s+public\.market_ohlcv_history/i)
  assert.doesNotMatch(sql, /delete\s+from\s+public\.market_ohlcv_history/i)
  assert.doesNotMatch(sql, /insert\s+into\s+public\.market_ohlcv_history/i)
})
