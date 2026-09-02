import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import test from "node:test"

const harnessPath = "scripts/db/rehearse-destructive-recovery.sh"
const recoveryFixture = "qeo_recovery_table_fixture"

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

test("synthetic fixture covers a legacy compatibility column and independent table drop", () => {
  const seed = source("scripts/db/recovery/seed.sql")
  assert.match(seed, /portfolio_transactions/i)
  assert.match(seed, /target_price/i)
  assert.match(seed, /target_price_1/i)
  assert.match(seed, new RegExp(recoveryFixture, "i"))
  assert.match(seed, /'QEO'/)
  assert.doesNotMatch(seed, /wyckoff_universe_memberships/i)
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
  assert.match(baseline, new RegExp(recoveryFixture, "i"))
  assert.doesNotMatch(baseline, /wyckoff_universe_memberships/i)
})

test("destructive fixture drops the chosen legacy column and synthetic table", () => {
  const destructive = source("scripts/db/recovery/destructive.sql")
  assert.match(destructive, /alter table public\.portfolio_transactions\s+drop column if exists target_price/i)
  assert.match(destructive, /drop table if exists public\.qeo_recovery_table_fixture/i)
  assert.doesNotMatch(destructive, /wyckoff_universe_memberships/i)

  const destroyed = source("scripts/db/recovery/assert-destroyed.sql")
  assert.match(destroyed, /information_schema\.columns/i)
  assert.match(destroyed, /to_regclass\('public\.qeo_recovery_table_fixture'\)/i)
  assert.doesNotMatch(destroyed, /wyckoff_universe_memberships/i)
})

test("restore bootstraps a placeholder relation before pg_restore clean phase", () => {
  const harness = source(harnessPath)
  const bootstrap = harness.indexOf("restore bootstrap")
  const restore = harness.indexOf("phase \"restore\"")

  assert.ok(bootstrap >= 0, "restore bootstrap phase must exist")
  assert.ok(restore > bootstrap, "restore bootstrap must run before pg_restore")
  assert.match(
    harness,
    /create table public\.qeo_recovery_table_fixture\s*\(\s*__qeo_restore_stub boolean\s*\)/i,
    "fully dropped synthetic table needs a minimal placeholder so pg_restore --clean can drop policies safely",
  )
  assert.doesNotMatch(harness, /wyckoff_universe_memberships/i)
})

test("exact app-role ACL is snapshotted before destruction and replayed after pg_restore", () => {
  const harness = source(harnessPath)
  const aclCapture = source("scripts/db/recovery/capture-acl-restore.sql")
  const capturePhase = harness.indexOf("ACL snapshot")
  const destructive = harness.indexOf("destructive rehearsal")
  const restore = harness.indexOf('phase "restore"')
  const aclRestore = harness.indexOf("ACL restore")
  const parity = harness.indexOf("restored parity")

  assert.ok(capturePhase >= 0 && capturePhase < destructive, "ACL snapshot must precede destructive execution")
  assert.ok(restore >= 0 && aclRestore > restore && parity > aclRestore, "ACL restore must run after pg_restore and before parity")
  assert.match(harness, /acl-restore\.sql/i)
  assert.match(aclCapture, /information_schema\.table_privileges/i)
  assert.match(aclCapture, /portfolio_transactions/i)
  assert.match(aclCapture, new RegExp(recoveryFixture, "i"))
  assert.doesNotMatch(aclCapture, /wyckoff_universe_memberships/i)
  assert.match(aclCapture, /anon/i)
  assert.match(aclCapture, /authenticated/i)
  assert.match(aclCapture, /service_role/i)
  assert.match(aclCapture, /revoke all privileges on table/i)
  assert.match(aclCapture, /is_grantable/i)
})

test("restored assertions require the dropped objects and synthetic values to return", () => {
  const restored = source("scripts/db/recovery/assert-restored.sql")
  assert.match(restored, /portfolio_transactions/i)
  assert.match(restored, /target_price/i)
  assert.match(restored, /target_price_1/i)
  assert.match(restored, new RegExp(recoveryFixture, "i"))
  assert.doesNotMatch(restored, /wyckoff_universe_memberships/i)
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
