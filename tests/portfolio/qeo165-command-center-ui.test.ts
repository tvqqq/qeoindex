import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

function source(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8")
}

test("QEO-165 establishes shared command-center presentation primitives", () => {
  const shell = source("components/portfolio/revamp/portfolio-section-shell.tsx")
  const status = source("components/portfolio/revamp/tactical-status.ts")

  assert.match(shell, /PortfolioSectionShell/)
  assert.match(status, /resolveTacticalPositionState/)
  assert.match(status, /MISSING_STOP/)
  assert.doesNotMatch(status, /rarity|conviction|attack|defense|mạnh|yếu/i)
})
