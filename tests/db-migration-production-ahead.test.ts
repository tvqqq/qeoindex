import assert from "node:assert/strict"
import test from "node:test"
import { reconcileMigrations } from "../scripts/db/migration-drift-lib.mjs"

const logicalName = "qeo129_adjusted_daily_shadow"
const productionVersion = "20260906223014"

function manifestEntry(overrides: Record<string, unknown> = {}) {
  return {
    logicalName,
    repositoryVersion: null,
    productionVersion,
    state: "PRODUCTION_AHEAD",
    evidence: "qeo129-production-promoted-before-source-merge",
    rationale: "Production schema was promoted from the reviewed QEO-129 branch while source remains intentionally unmerged until QEO-132 raw Daily boundary lands.",
    ...overrides,
  }
}

test("PRODUCTION_AHEAD reconciles an explicitly reviewed production-only migration", () => {
  const result = reconcileMigrations({
    activeFiles: [],
    pendingFiles: [],
    productionLedger: [{ version: productionVersion, name: logicalName }],
    manifest: { migrations: [manifestEntry()] },
  })

  assert.equal(result.ok, true, result.errors.join("\n"))
})

test("PRODUCTION_AHEAD fails closed unless source is absent and the exact production version is reviewed", () => {
  const cases = [
    {
      label: "active source unexpectedly exists",
      activeFiles: [`20260906170000_${logicalName}.sql`],
      pendingFiles: [],
      productionLedger: [{ version: productionVersion, name: logicalName }],
      manifest: { migrations: [manifestEntry()] },
    },
    {
      label: "pending source unexpectedly exists",
      activeFiles: [],
      pendingFiles: [`20260906170000_${logicalName}.sql`],
      productionLedger: [{ version: productionVersion, name: logicalName }],
      manifest: { migrations: [manifestEntry()] },
    },
    {
      label: "production row is missing",
      activeFiles: [],
      pendingFiles: [],
      productionLedger: [],
      manifest: { migrations: [manifestEntry()] },
    },
    {
      label: "production version changed",
      activeFiles: [],
      pendingFiles: [],
      productionLedger: [{ version: "20260906223015", name: logicalName }],
      manifest: { migrations: [manifestEntry()] },
    },
    {
      label: "repository version is not null",
      activeFiles: [],
      pendingFiles: [],
      productionLedger: [{ version: productionVersion, name: logicalName }],
      manifest: { migrations: [manifestEntry({ repositoryVersion: "20260906170000" })] },
    },
  ]

  for (const candidate of cases) {
    const result = reconcileMigrations(candidate)
    assert.equal(result.ok, false, `${candidate.label} must fail closed`)
  }
})
