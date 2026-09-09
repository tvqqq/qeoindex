import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

function read(path: string): string {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8")
}

test("QEO-144 fixture covers the deterministic portfolio acceptance matrix", () => {
  const sql = read("tests/portfolio/qeo144-acceptance-fixture.sql")
  const seedShell = read("scripts/portfolio/qeo144-seed-local.sh")
  const userScript = read("scripts/portfolio/qeo144-create-local-user.mjs")

  for (const ticker of [
    "FPT",
    "HPG",
    "MWG",
    "VNM",
    "ACB",
    "SSI",
    "MSN",
    "UNKNOWNSTOP",
    "LEGACY",
    "PAPER",
    "VIC",
    "QEOUNK",
  ]) {
    assert.match(sql, new RegExp(`\\b${ticker}\\b`), `fixture must include ${ticker}`)
  }

  assert.match(sql, /planned/i)
  assert.match(sql, /partial/i)
  assert.match(sql, /live/i)
  assert.match(sql, /paper/i)
  assert.match(sql, /deposit/i)
  assert.match(sql, /withdrawal/i)
  assert.match(sql, /100000000/)
  assert.match(sql, /20000000/)
  assert.match(sql, /concentrationWarningPercent/)
  assert.match(sql, /maxTickerConcentrationPercent/)
  assert.match(sql, /maxSectorRiskPercent/)
  assert.match(sql, /maxConcurrentOpenPositions/)
  assert.match(sql, /concentration_override/)

  assert.match(seedShell, /127\.0\.0\.1|localhost/)
  assert.match(seedShell, /refus|abort|exit 1/i)
  assert.match(seedShell, /qeo144-acceptance-fixture\.sql/)
  assert.match(userScript, /qeo144-acceptance@example\.invalid/)
  assert.match(userScript, /Qeo144!LocalOnly/)
  assert.match(userScript, /auth\.admin\.createUser/)
})

test("QEO-144 seed is explicitly local-only and owner-scoped", () => {
  const sql = read("tests/portfolio/qeo144-acceptance-fixture.sql")
  const seedShell = read("scripts/portfolio/qeo144-seed-local.sh")

  assert.doesNotMatch(sql, /truncate\s+/i)
  assert.match(sql, /qeo144_user_id/)
  assert.match(sql, /on conflict|delete from/i)
  assert.match(seedShell, /QEO144_DB_CONTAINER/)
  assert.match(seedShell, /supabase_db_qeoindex/)
})
