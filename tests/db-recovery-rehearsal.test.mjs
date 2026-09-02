import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import test from "node:test"

const scriptPath = "scripts/db-recovery-rehearsal.sh"

function scriptSource() {
  assert.equal(existsSync(scriptPath), true, "QEO-26 rehearsal script must exist")
  return readFileSync(scriptPath, "utf8")
}

test("recovery rehearsal hard-rejects the production project ref", () => {
  const source = scriptSource()
  assert.match(source, /glwhhrmejlonhyorvtzm/)
  assert.match(source, /refus|reject|production/i)
})

test("recovery rehearsal requires an explicit non-production target", () => {
  const source = scriptSource()
  assert.match(source, /TARGET_ENV/)
  assert.match(source, /non[-_ ]?prod|development|local/i)
})

test("recovery rehearsal captures schema and data before destructive DDL", () => {
  const source = scriptSource()
  const schemaDump = source.indexOf("pg_dump --schema-only")
  const dataDump = source.indexOf("pg_dump --data-only")
  const destructive = source.indexOf("DROP COLUMN")
  assert.notEqual(schemaDump, -1)
  assert.notEqual(dataDump, -1)
  assert.notEqual(destructive, -1)
  assert.ok(schemaDump < destructive)
  assert.ok(dataDump < destructive)
})

test("recovery rehearsal covers both dropped legacy columns and legacy table recreation", () => {
  const source = scriptSource()
  assert.match(source, /DROP COLUMN/i)
  assert.match(source, /DROP TABLE/i)
  assert.match(source, /insights_stock_ratings_rehearsal/)
  assert.match(source, /wyckoff_universe_memberships_rehearsal/)
})

test("recovery rehearsal restores and verifies data plus security metadata parity", () => {
  const source = scriptSource()
  assert.match(source, /RESTORE|restore/i)
  assert.match(source, /row_count|row count|count\(\*\)/i)
  assert.match(source, /policy|rls/i)
  assert.match(source, /grant|privilege/i)
  assert.match(source, /function|view/i)
})
