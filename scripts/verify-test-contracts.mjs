import { readFileSync, readdirSync } from "node:fs"
import { fileURLToPath, pathToFileURL } from "node:url"
import { join, resolve } from "node:path"

const OWNERS = new Set(["auth", "market", "kfsp", "wyckoff", "ai", "signals", "eod", "admin", "portfolio", "research", "ui", "db", "tooling", "notion"])
const BUCKETS = new Set(["canonical", "rewrite", "superseded", "duplicate", "deep-safety"])
const SUITES = new Set(["fast", "eod", "ai", "db", "ui-contracts", "none"])

function repoPath(rootUrl) {
  return fileURLToPath(rootUrl instanceof URL ? rootUrl : pathToFileURL(resolve(rootUrl)))
}

function topLevelTests(root) {
  return readdirSync(join(root, "tests"), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".test.ts"))
    .map((entry) => `tests/${entry.name}`)
    .sort()
}

function invalidEntry(entry, index) {
  const errors = []
  const label = entry?.path || `entry[${index}]`
  if (!entry || typeof entry !== "object") return [`${label}: entry must be an object`]
  if (typeof entry.path !== "string" || !/^tests\/[^/]+\.test\.ts$/.test(entry.path)) errors.push(`${label}: invalid top-level test path`)
  if (!OWNERS.has(entry.owner)) errors.push(`${label}: invalid owner ${String(entry.owner)}`)
  if (typeof entry.invariant !== "string" || entry.invariant.trim().length < 12) errors.push(`${label}: invariant must be explicit`)
  if (!BUCKETS.has(entry.bucket)) errors.push(`${label}: invalid bucket ${String(entry.bucket)}`)
  if (!Array.isArray(entry.suites) || entry.suites.length === 0) errors.push(`${label}: suites must be non-empty`)
  else {
    const uniqueSuites = new Set(entry.suites)
    if (uniqueSuites.size !== entry.suites.length) errors.push(`${label}: duplicate suite value`)
    for (const suite of entry.suites) if (!SUITES.has(suite)) errors.push(`${label}: invalid suite ${String(suite)}`)
    if (entry.suites.includes("none") && entry.suites.length !== 1) errors.push(`${label}: none cannot be combined with executable suites`)
  }
  if (entry.bucket === "duplicate" && (typeof entry.replacement !== "string" || entry.replacement.length === 0)) errors.push(`${label}: duplicate requires replacement`)
  if (entry.bucket === "superseded") {
    if (typeof entry.deleteWith !== "string" || entry.deleteWith.length === 0) errors.push(`${label}: superseded requires deleteWith`)
    if (!Array.isArray(entry.suites) || entry.suites.length !== 1 || entry.suites[0] !== "none") errors.push(`${label}: superseded tests must be quarantined in suite none`)
  }
  if ((entry.bucket === "canonical" || entry.bucket === "rewrite" || entry.bucket === "deep-safety") && entry.suites?.includes("none")) {
    errors.push(`${label}: active/deep-safety tests cannot use suite none`)
  }
  return errors
}

export function validateTestContracts(rootUrl = new URL("../", import.meta.url)) {
  const root = repoPath(rootUrl)
  const manifest = JSON.parse(readFileSync(join(root, "tests", "test-contracts.json"), "utf8"))
  const entries = Array.isArray(manifest.entries) ? manifest.entries : []
  const actual = topLevelTests(root)
  const counts = new Map()
  for (const entry of entries) counts.set(entry?.path, (counts.get(entry?.path) || 0) + 1)
  const manifestPaths = [...new Set(entries.map((entry) => entry?.path).filter((path) => typeof path === "string"))].sort()
  const actualSet = new Set(actual)
  const manifestSet = new Set(manifestPaths)
  const missing = actual.filter((path) => !manifestSet.has(path))
  const extra = manifestPaths.filter((path) => !actualSet.has(path))
  const duplicates = [...counts.entries()].filter(([, count]) => count > 1).map(([path]) => path).sort()
  const invalid = entries.flatMap((entry, index) => invalidEntry(entry, index))
  if (manifest.version !== 1) invalid.push(`manifest: expected version 1, received ${String(manifest.version)}`)
  return {
    ok: missing.length === 0 && extra.length === 0 && duplicates.length === 0 && invalid.length === 0,
    actualCount: actual.length,
    manifestCount: entries.length,
    missing,
    extra,
    duplicates,
    invalid,
  }
}

function main() {
  const result = validateTestContracts(new URL("../", import.meta.url))
  if (!result.ok) {
    console.error(JSON.stringify(result, null, 2))
    process.exitCode = 1
    return
  }
  console.log(`test-contract manifest valid: ${result.manifestCount}/${result.actualCount} top-level tests classified`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main()
