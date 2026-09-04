import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  scripts: Record<string, string>
}

test("artifact build is Next-only and release verification is explicit", () => {
  assert.equal(pkg.scripts.build, "next build")
  assert.equal("prebuild" in pkg.scripts, false)
  assert.equal("verify:build" in pkg.scripts, false)

  const pr = pkg.scripts["verify:pr"] || ""
  for (const command of ["scan:secrets", "test:manifest", "test:current", "lint:touched", "typecheck"]) {
    assert.match(pr, new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), command)
  }

  const full = pkg.scripts["verify:full"] || ""
  for (const command of ["verify:pr", "db:drift:verify", "db:replay:verify", "db:types:verify", "test:db-drift"]) {
    assert.match(full, new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), command)
  }
})

test("active package scripts do not reference superseded EOD version suites", () => {
  const scripts = JSON.stringify(pkg.scripts)
  assert.doesNotMatch(scripts, /test:eod-v2|test:eod-v3/)
})
