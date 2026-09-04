import { existsSync, readFileSync, readdirSync } from "node:fs"
import { reconcileMigrations } from "./migration-drift-lib.mjs"

const activeFiles = readdirSync("supabase/migrations").filter((name) => name.endsWith(".sql"))
const pendingFiles = existsSync("supabase/pending-migrations")
  ? readdirSync("supabase/pending-migrations").filter((name) => name.endsWith(".sql"))
  : []
const manifest = JSON.parse(readFileSync("supabase/migration-equivalence.json", "utf8"))
const ledgerDirectory = "docs/db/evidence"
const reviewedLedgers = readdirSync(ledgerDirectory)
  .filter((name) => /^production-migration-ledger-\d{4}-\d{2}-\d{2}\.json$/.test(name))
  .sort()
const latestLedger = reviewedLedgers.at(-1)
if (!latestLedger) throw new Error("No reviewed production migration ledger found")
const ledger = JSON.parse(readFileSync(`${ledgerDirectory}/${latestLedger}`, "utf8"))

const result = reconcileMigrations({
  activeFiles,
  pendingFiles,
  productionLedger: ledger.migrations,
  manifest,
})

if (!result.ok) {
  console.error("migration drift verification: FAIL")
  for (const error of result.errors) console.error(`- ${error}`)
  process.exitCode = 1
} else {
  console.log(`migration drift verification: PASS (${latestLedger})`)
  console.log(JSON.stringify(result.summary, null, 2))
}
