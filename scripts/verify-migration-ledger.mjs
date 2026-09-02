import { existsSync, readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const MIGRATION_RE = /^(\d+)_([a-z0-9_]+)\.sql$/

function parseMigrationFile(filename) {
  const match = MIGRATION_RE.exec(filename)
  return match ? { version: match[1], name: match[2], filename } : null
}

function inScope(version, prefix) {
  return typeof version === "string" && version.startsWith(prefix)
}

export function verifyMigrationLedger({ repoFiles, pendingFiles = [], ledger, reconciliation }) {
  const errors = []
  const scopePrefix = reconciliation.scopePrefix
  const repo = repoFiles.map(parseMigrationFile).filter(Boolean).filter((entry) => inScope(entry.version, scopePrefix))
  const pending = pendingFiles.map(parseMigrationFile).filter(Boolean)
  const production = ledger.filter((entry) => inScope(entry.version, scopePrefix))
  const mappings = new Map(reconciliation.mappings.map((entry) => [entry.name, entry]))
  const quarantined = new Map((reconciliation.quarantined ?? []).map((entry) => [entry.name, entry]))
  const repoByName = new Map(repo.map((entry) => [entry.name, entry]))
  const prodByName = new Map(production.map((entry) => [entry.name, entry]))
  const pendingByName = new Map(pending.map((entry) => [entry.name, entry]))

  for (const entry of repo) {
    const prod = prodByName.get(entry.name)
    const mapping = mappings.get(entry.name)
    if (!prod) {
      if (!quarantined.has(entry.name)) errors.push(`repo-only migration: ${entry.filename}`)
      continue
    }
    if (entry.version === prod.version) continue
    if (!mapping) {
      errors.push(`timestamp drift is not mapped: ${entry.name} repo=${entry.version} production=${prod.version}`)
      continue
    }
    if (mapping.repoVersion !== entry.version || mapping.productionVersion !== prod.version) {
      errors.push(`production version mismatch for ${entry.name}: expected repo=${mapping.repoVersion} production=${mapping.productionVersion}, got repo=${entry.version} production=${prod.version}`)
    }
  }

  for (const entry of production) {
    const repoEntry = repoByName.get(entry.name)
    const mapping = mappings.get(entry.name)
    if (!repoEntry) {
      if (pendingByName.has(entry.name)) {
        errors.push(`production-applied migration remains pending: ${entry.name}`)
      }
      errors.push(`production-only migration: ${entry.version}_${entry.name}`)
      if (mapping) {
        errors.push(`mapped repository file missing for ${entry.name}: ${mapping.repoVersion}_${entry.name}.sql`)
      }
      continue
    }
    if (mapping && mapping.productionVersion !== entry.version) {
      errors.push(`production version mismatch for ${entry.name}: expected ${mapping.productionVersion}, got ${entry.version}`)
    }
  }

  for (const mapping of reconciliation.mappings) {
    const expectedFilename = `${mapping.repoVersion}_${mapping.name}.sql`
    if (!repoFiles.includes(expectedFilename)) {
      errors.push(`mapped repository file missing for ${mapping.name}: ${expectedFilename}`)
    }
    const prod = prodByName.get(mapping.name)
    if (!prod) {
      errors.push(`mapped production migration missing for ${mapping.name}: ${mapping.productionVersion}`)
    } else if (prod.version !== mapping.productionVersion) {
      errors.push(`production version mismatch for ${mapping.name}: expected ${mapping.productionVersion}, got ${prod.version}`)
    }
  }

  for (const quarantine of reconciliation.quarantined ?? []) {
    const activeFilename = `${quarantine.repoVersion}_${quarantine.name}.sql`
    if (repoFiles.includes(activeFilename)) errors.push(`quarantined migration active: ${quarantine.name}`)
    if (!pendingFiles.includes(path.basename(quarantine.path))) errors.push(`quarantined migration missing from pending path: ${quarantine.name}`)
    if (prodByName.has(quarantine.name)) errors.push(`quarantined migration already applied in production: ${quarantine.name}`)
  }

  return { ok: errors.length === 0, errors }
}

function readSqlFiles(directory) {
  return existsSync(directory) ? readdirSync(directory).filter((name) => name.endsWith(".sql")).sort() : []
}

export function verifyRepositorySnapshot({ rootDir = process.cwd(), manifestPath = "docs/db/qeo-25-migration-ledger.json" } = {}) {
  const reconciliation = JSON.parse(readFileSync(path.join(rootDir, manifestPath), "utf8"))
  const repoFiles = readSqlFiles(path.join(rootDir, "supabase/migrations"))
  const pendingFiles = readSqlFiles(path.join(rootDir, "supabase/pending-migrations"))
  return verifyMigrationLedger({ repoFiles, pendingFiles, ledger: reconciliation.productionLedger, reconciliation })
}

function runCli() {
  const result = verifyRepositorySnapshot()
  if (!result.ok) {
    console.error("Migration ledger reconciliation FAILED")
    for (const error of result.errors) console.error(`- ${error}`)
    process.exitCode = 1
    return
  }
  console.log("Migration ledger reconciliation PASS")
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null
if (invokedPath && import.meta.url === invokedPath) runCli()
