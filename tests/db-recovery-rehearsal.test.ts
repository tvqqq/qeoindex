import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import test from "node:test"

const harnessPath = "scripts/db/rehearse-destructive-recovery.sh"

function source(path: string) {
  assert.equal(existsSync(path), true, `${path} must exist`)
  return readFileSync(path, "utf8")
}

test("recovery harness is fail-fast and hard-blocks production targets", () => {
  const harness = source(harnessPath)
  assert.match(harness, /set -euo pipefail/)
  assert.match(harness, /glwhhrmejlonhyorvtzm/)
  assert.match(harness, /127\.0\.0\.1:54322/)
  assert.match(harness, /localhost:54322/)
  assert.match(harness, /production project ref is forbidden/i)
  assert.match(harness, /must target local Supabase port 54322/i)
})

test("backup validation must precede destructive execution", () => {
  const harness = source(harnessPath)
  const backupValidation = harness.indexOf("backup validation")
  const destructive = harness.indexOf("destructive rehearsal")
  assert.ok(backupValidation >= 0, "backup validation phase must exist")
  assert.ok(destructive > backupValidation, "destructive rehearsal must occur only after backup validation")
})

test("synthetic fixture covers a legacy compatibility column and legacy bridge row", () => {
  const seed = source("scripts/db/recovery/seed.sql")
  assert.match(seed, /portfolio_transactions/i)
  assert.match(seed, /target_price/i)
  assert.match(seed, /target_price_1/i)
  assert.match(seed, /wyckoff_universe_memberships/i)
  assert.match(seed, /'QEO'/)
  assert.doesNotMatch(seed, /glwhhrmejlonhyorvtzm/)
})

test("baseline captures data, schema, indexes, RLS, policies, privileges and functions", () => {
  const baseline = source("scripts/db/recovery/capture-baseline.sql")
  assert.match(baseline, /information_schema\.columns/i)
  assert.match(baseline, /pg_constraint/i)
  assert.match(baseline, /c\.contype::text/i, "pg_constraint.contype must be cast before text concatenation")
  assert.match(baseline, /pg_indexes/i)
  assert.match(baseline, /relrowsecurity/i)
  assert.match(baseline, /pg_policies/i)
  assert.match(baseline, /information_schema\.table_privileges/i)
  assert.match(baseline, /pg_proc/i)
  assert.match(
    baseline,
    /case\s+when\s+p\.prokind\s*=\s*'f'\s+then\s+pg_get_functiondef\(p\.oid\)/i,
    "pg_get_functiondef must never be evaluated for aggregate/procedure catalog rows",
  )
  assert.match(baseline, /pg_type/i)
})

test("destructive fixture drops the chosen legacy column and bridge table", () => {
  const destructive = source("scripts/db/recovery/destructive.sql")
  assert.match(destructive, /alter table public\.portfolio_transactions\s+drop column if exists target_price/i)
  assert.match(destructive, /drop table if exists public\.wyckoff_universe_memberships/i)

  const destroyed = source("scripts/db/recovery/assert-destroyed.sql")
  assert.match(destroyed, /information_schema\.columns/i)
  assert.match(destroyed, /to_regclass\('public\.wyckoff_universe_memberships'\)/i)
})

test("restored assertions require the dropped objects and synthetic values to return", () => {
  const restored = source("scripts/db/recovery/assert-restored.sql")
  assert.match(restored, /portfolio_transactions/i)
  assert.match(restored, /target_price/i)
  assert.match(restored, /target_price_1/i)
  assert.match(restored, /wyckoff_universe_memberships/i)
  assert.match(restored, /42\.50|42\.5/)
  assert.match(restored, /'QEO'/)
  assert.match(restored, /relrowsecurity/i)
})

test("harness executes the complete backup destroy restore parity sequence", () => {
  const harness = source(harnessPath)
  for (const contract of [
    /supabase db reset/,
    /recovery\/seed\.sql/,
    /capture-baseline\.sql/,
    /pg_dump/,
    /pg_restore --list/,
    /recovery\/destructive\.sql/,
    /assert-destroyed\.sql/,
    /pg_restore/,
    /assert-restored\.sql/,
    /diff -u/,
    /recovery rehearsal: PASS/,
  ]) {
    assert.match(harness, contract)
  }
})
