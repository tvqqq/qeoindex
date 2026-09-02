import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import test from "node:test"
import { pathToFileURL } from "node:url"

const verifierPath = "scripts/verify-migration-ledger.mjs"

async function verifier() {
  assert.equal(existsSync(verifierPath), true, "QEO-25 verifier must exist")
  return import(pathToFileURL(verifierPath).href)
}

const base = {
  repoFiles: [
    "20260902011529_clean_rebuild_market_snapshot_trigger.sql",
    "20260902011846_restrict_orderbook_prune_trigger_execute.sql",
    "20260902020424_kfsp_rating_storage_refactor.sql",
  ],
  pendingFiles: [],
  ledger: [
    { version: "20260902011529", name: "clean_rebuild_market_snapshot_trigger" },
    { version: "20260902011846", name: "restrict_orderbook_prune_trigger_execute" },
    { version: "20260902020424", name: "kfsp_rating_storage_refactor" },
  ],
  reconciliation: {
    scopePrefix: "202609",
    mappings: [
      {
        name: "clean_rebuild_market_snapshot_trigger",
        repoVersion: "20260902011529",
        productionVersion: "20260902011529",
        status: "RECONCILED",
      },
      {
        name: "restrict_orderbook_prune_trigger_execute",
        repoVersion: "20260902011846",
        productionVersion: "20260902011846",
        status: "RECONCILED",
      },
      {
        name: "kfsp_rating_storage_refactor",
        repoVersion: "20260902020424",
        productionVersion: "20260902020424",
        status: "RECONCILED",
      },
    ],
    quarantined: [],
  },
}

test("accepts explicitly reconciled production timestamp mappings", async () => {
  const { verifyMigrationLedger } = await verifier()
  const result = verifyMigrationLedger(base)
  assert.deepEqual(result, { ok: true, errors: [] })
})

test("rejects an unexplained active repository migration", async () => {
  const { verifyMigrationLedger } = await verifier()
  const result = verifyMigrationLedger({
    ...base,
    repoFiles: [...base.repoFiles, "20260902120000_unexplained_repo_only.sql"],
  })
  assert.equal(result.ok, false)
  assert.match(result.errors.join("\n"), /repo-only.*unexplained_repo_only/i)
})

test("rejects an unexplained production-only logical migration", async () => {
  const { verifyMigrationLedger } = await verifier()
  const result = verifyMigrationLedger({
    ...base,
    ledger: [...base.ledger, { version: "20260902120100", name: "unexplained_production_only" }],
  })
  assert.equal(result.ok, false)
  assert.match(result.errors.join("\n"), /production-only.*unexplained_production_only/i)
})

test("rejects a mapping whose repository filename disappeared", async () => {
  const { verifyMigrationLedger } = await verifier()
  const result = verifyMigrationLedger({ ...base, repoFiles: base.repoFiles.slice(1) })
  assert.equal(result.ok, false)
  assert.match(result.errors.join("\n"), /mapped repository file missing.*clean_rebuild_market_snapshot_trigger/i)
})

test("rejects a mapped production version that changed unexpectedly", async () => {
  const { verifyMigrationLedger } = await verifier()
  const result = verifyMigrationLedger({
    ...base,
    ledger: [
      { version: "20260902999999", name: "clean_rebuild_market_snapshot_trigger" },
      base.ledger[1],
      base.ledger[2],
    ],
  })
  assert.equal(result.ok, false)
  assert.match(result.errors.join("\n"), /production version mismatch.*clean_rebuild_market_snapshot_trigger/i)
})

test("rejects a production-applied migration that is left only in pending migrations", async () => {
  const { verifyMigrationLedger } = await verifier()
  const result = verifyMigrationLedger({
    ...base,
    repoFiles: base.repoFiles.filter((name) => !name.includes("kfsp_rating_storage_refactor")),
    pendingFiles: ["20260902090000_kfsp_rating_storage_refactor.sql"],
  })
  assert.equal(result.ok, false)
  assert.match(result.errors.join("\n"), /mapped repository file missing.*kfsp_rating_storage_refactor/i)
  assert.match(result.errors.join("\n"), /production-applied migration remains pending.*kfsp_rating_storage_refactor/i)
})
