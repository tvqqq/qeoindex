import { readFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { join } from "node:path"

const EXECUTABLE_SUITES = new Set(["fast", "eod", "ai", "db", "ui-contracts"])

export function resolveSuiteTests(suite, rootUrl = new URL("../", import.meta.url)) {
  const root = fileURLToPath(rootUrl)
  const manifest = JSON.parse(readFileSync(join(root, "tests", "test-contracts.json"), "utf8"))
  const requested = suite === "current" ? new Set(["fast", "eod", "ai", "ui-contracts"]) : new Set([suite])
  for (const name of requested) {
    if (!EXECUTABLE_SUITES.has(name)) throw new Error(`Unknown test suite: ${name}`)
  }
  return [...new Set(manifest.entries
    .filter((entry) => !["duplicate", "superseded"].includes(entry.bucket))
    .filter((entry) => entry.suites.some((name) => requested.has(name)))
    .map((entry) => entry.path))].sort()
}

export function runSuite(suite, rootUrl = new URL("../", import.meta.url)) {
  const files = resolveSuiteTests(suite, rootUrl)
  if (files.length === 0) throw new Error(`Suite ${suite} resolved to zero tests`)
  console.log(`[test-suite] ${suite}: ${files.length} files`)
  const result = spawnSync(process.execPath, ["--test", ...files], {
    cwd: fileURLToPath(rootUrl),
    stdio: "inherit",
    env: process.env,
  })
  if (result.error) throw result.error
  return result.status ?? 1
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const suite = process.argv[2]
  if (!suite) {
    console.error("Usage: node scripts/run-test-suite.mjs <fast|eod|ai|db|ui-contracts|current>")
    process.exit(2)
  }
  process.exit(runSuite(suite))
}
