import { existsSync, readFileSync, readdirSync } from "node:fs"
import { reconcileMigrations } from "./migration-drift-lib.mjs"

const activeFiles = readdirSync("supabase/migrations").filter((name) => name.endsWith(".sql"))
const pendingFiles = existsSync("supabase/pending-migrations")
  ? readdirSync("supabase/pending-migrations").filter((name) => name.endsWith(".sql"))
  : []
const manifest = JSON.parse(readFileSync("supabase/migration-equivalence.json", "utf8"))
const ledger = JSON.parse(readFileSync("docs/db/evidence/production-migration-ledger-2026-09-02.json", "utf8"))

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
  console.log("migration drift verification: PASS")
  console.log(JSON.stringify(result.summary, null, 2))
}
