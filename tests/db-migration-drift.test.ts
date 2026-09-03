import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import test from "node:test"
import { parseMigrationFilename, reconcileMigrations } from "../scripts/db/migration-drift-lib.mjs"

test("parseMigrationFilename extracts version and logical name", () => {
  assert.deepEqual(
    parseMigrationFilename("20260902011529_clean_rebuild_market_snapshot_trigger.sql"),
    { version: "20260902011529", logicalName: "clean_rebuild_market_snapshot_trigger" },
  )
})

test("mapped timestamp mismatch passes only when explicitly declared", () => {
  const result = reconcileMigrations({
    activeFiles: ["20260902084500_ai_council_authenticated_readonly.sql"],
    pendingFiles: [],
    productionLedger: [{ version: "20260902014425", name: "ai_council_authenticated_readonly" }],
    manifest: { migrations: [{ logicalName: "ai_council_authenticated_readonly", repositoryVersion: "20260902084500", productionVersion: "20260902014425", state: "MAPPED", evidence: "ledger-logical-name" }] },
  })
  assert.equal(result.ok, true, result.errors.join("\n"))
})

test("unexplained repo-only migration fails closed", () => {
  const result = reconcileMigrations({ activeFiles: ["20260902090000_repo_only.sql"], pendingFiles: [], productionLedger: [], manifest: { migrations: [] } })
  assert.equal(result.ok, false)
  assert.match(result.errors.join("\n"), /repo-only/i)
})

test("unexplained production-only migration fails closed", () => {
  const result = reconcileMigrations({ activeFiles: [], pendingFiles: [], productionLedger: [{ version: "20260902090000", name: "prod_only" }], manifest: { migrations: [] } })
  assert.equal(result.ok, false)
  assert.match(result.errors.join("\n"), /production-only/i)
})

test("production-applied migration cannot remain pending", () => {
  const result = reconcileMigrations({
    activeFiles: [],
    pendingFiles: ["20260902090000_kfsp_rating_storage_refactor.sql"],
    productionLedger: [{ version: "20260902020424", name: "kfsp_rating_storage_refactor" }],
    manifest: { migrations: [{ logicalName: "kfsp_rating_storage_refactor", repositoryVersion: "20260902090000", productionVersion: "20260902020424", state: "MAPPED", evidence: "production-schema-contract" }] },
  })
  assert.equal(result.ok, false)
  assert.match(result.errors.join("\n"), /pending/i)
})

test("duplicate manifest logical names fail", () => {
  const result = reconcileMigrations({
    activeFiles: ["20260902011529_x.sql"],
    pendingFiles: [],
    productionLedger: [{ version: "20260902011529", name: "x" }],
    manifest: { migrations: [
      { logicalName: "x", repositoryVersion: "20260902011529", productionVersion: "20260902011529", state: "EXACT", evidence: "a" },
      { logicalName: "x", repositoryVersion: "20260902011529", productionVersion: "20260902011529", state: "EXACT", evidence: "b" },
    ] },
  })
  assert.equal(result.ok, false)
  assert.match(result.errors.join("\n"), /duplicate manifest/i)
})

test("current repository migration set reconciles against reviewed production ledger", () => {
  const manifest = JSON.parse(readFileSync("supabase/migration-equivalence.json", "utf8"))
  const ledger = JSON.parse(readFileSync("docs/db/evidence/production-migration-ledger-2026-09-02.json", "utf8"))
  const activeFiles = readdirSync("supabase/migrations").filter((name) => name.endsWith(".sql"))
  const pendingFiles = existsSync("supabase/pending-migrations")
    ? readdirSync("supabase/pending-migrations").filter((name) => name.endsWith(".sql"))
    : []
  const result = reconcileMigrations({ activeFiles, pendingFiles, productionLedger: ledger.migrations, manifest })
  assert.equal(result.ok, true, result.errors.join("\n"))
})

test("QEO-22 watchlist invariant is recorded as an exact production migration", () => {
  const manifest = JSON.parse(readFileSync("supabase/migration-equivalence.json", "utf8"))
  const ledger = JSON.parse(readFileSync("docs/db/evidence/production-migration-ledger-2026-09-02.json", "utf8"))
  const expected = {
    logicalName: "qeo22_watchlist_default_invariant",
    repositoryVersion: "20260902052650",
    productionVersion: "20260902052650",
    state: "EXACT",
  }
  const mapping = manifest.migrations.find((entry: { logicalName?: string }) => entry.logicalName === expected.logicalName)
  const production = ledger.migrations.find((entry: { name?: string }) => entry.name === expected.logicalName)

  assert.ok(mapping)
  assert.equal(mapping.repositoryVersion, expected.repositoryVersion)
  assert.equal(mapping.productionVersion, expected.productionVersion)
  assert.equal(mapping.state, expected.state)
  assert.deepEqual(production, { version: expected.productionVersion, name: expected.logicalName })
})

test("QEO-19 Wyckoff legacy-table DROP is promoted as an exact production migration", () => {
  const logicalName = "drop_legacy_wyckoff_universe_memberships"
  const manifest = JSON.parse(readFileSync("supabase/migration-equivalence.json", "utf8"))
  const ledger = JSON.parse(readFileSync("docs/db/evidence/production-migration-ledger-2026-09-02.json", "utf8"))
  const mapping = manifest.migrations.find((entry: { logicalName?: string }) => entry.logicalName === logicalName)
  const production = ledger.migrations.find((entry: { name?: string }) => entry.name === logicalName)
  const pendingFiles = existsSync("supabase/pending-migrations")
    ? readdirSync("supabase/pending-migrations").filter((name) => name.endsWith(".sql"))
    : []

  assert.ok(mapping, "QEO-19 migration mapping must exist")
  assert.equal(mapping.state, "EXACT", "QEO-19 physical DROP must leave quarantine only after production acceptance")
  assert.match(mapping.productionVersion ?? "", /^\d{14}$/, "QEO-19 production migration version must be recorded")
  assert.equal(mapping.repositoryVersion, mapping.productionVersion, "EXACT migration must use the production version in source history")
  assert.deepEqual(production, { version: mapping.productionVersion, name: logicalName })
  assert.equal(
    pendingFiles.some((name) => name.endsWith(`_${logicalName}.sql`)),
    false,
    "production-applied QEO-19 DROP must not remain under pending-migrations",
  )

  const migrationPath = `supabase/migrations/${mapping.productionVersion}_${logicalName}.sql`
  assert.equal(existsSync(migrationPath), true, "exact QEO-19 production migration source must exist")
  if (!existsSync(migrationPath)) return
  const migration = readFileSync(migrationPath, "utf8")
  assert.match(migration, /drop\s+table\s+if\s+exists\s+public\.wyckoff_universe_memberships/i)
  assert.doesNotMatch(migration, /cascade/i)
})

test("db drift CLI exits zero for reviewed current state", () => {
  const run = spawnSync(process.execPath, ["scripts/db/verify-migration-drift.mjs"], { encoding: "utf8" })
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`)
  assert.match(run.stdout, /migration drift verification: PASS/i)
})