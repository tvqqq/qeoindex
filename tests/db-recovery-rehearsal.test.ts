import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import test from "node:test"

const harnessPath = "scripts/db/rehearse-destructive-recovery.sh"

test("recovery harness is fail-fast and hard-blocks production targets", () => {
  assert.equal(existsSync(harnessPath), true, "recovery harness must exist")
  const harness = readFileSync(harnessPath, "utf8")
  assert.match(harness, /set -euo pipefail/)
  assert.match(harness, /glwhhrmejlonhyorvtzm/)
  assert.match(harness, /127\.0\.0\.1:54322/)
  assert.match(harness, /localhost:54322/)
  assert.match(harness, /production project ref is forbidden/i)
  assert.match(harness, /must target local Supabase port 54322/i)
})

test("backup validation must precede destructive execution", () => {
  assert.equal(existsSync(harnessPath), true, "recovery harness must exist")
  const harness = readFileSync(harnessPath, "utf8")
  const backupValidation = harness.indexOf("backup validation")
  const destructive = harness.indexOf("destructive rehearsal")
  assert.ok(backupValidation >= 0, "backup validation phase must exist")
  assert.ok(destructive > backupValidation, "destructive rehearsal must occur only after backup validation")
})
