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
  assert.match(baseline, /pg_indexes/i)
  assert.match(baseline, /relrowsecurity/i)
  assert.match(baseline, /pg_policies/i)
  assert.match(baseline, /information_schema\.table_privileges/i)
  assert.match(baseline, /pg_proc/i)
})

test("destructive fixture drops the chosen legacy column and bridge table", () => {
  const destructive = source("scripts/db/recovery/destructive.sql")
  assert.match(destructive, /alter table public\.portfolio_transactions\s+drop column if exists target_price/i)
  assert.match(destructive, /drop table if exists public\.wyckoff_universe_memberships/i)

  const destroyed = source("scripts/db/recovery/assert-destroyed.sql")
  assert.match(destroyed, /information_schema\.columns/i)
  assert.match(destroyed, /to_regclass\('public\.wyckoff_universe_memberships'\)/i)
})
