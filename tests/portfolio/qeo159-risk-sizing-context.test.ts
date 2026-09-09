import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"

function read(relative: string) {
  return fs.readFileSync(path.join(process.cwd(), relative), "utf8")
}

test("QEO-139 server context passes canonical concentration, current plan id and structured sector metadata", () => {
  const source = read("modules/portfolio/risk-sizing/server.ts")

  assert.match(source, /moneyManagementPlanId:\s*string \| null/)
  assert.match(source, /PortfolioConcentrationReadModel/)
  assert.match(source, /concentration:\s*PortfolioConcentrationReadModel/)
  assert.match(source, /sectorMetadata:/)
  assert.match(source, /loadStructuredSectorMetadata/)
  assert.match(source, /moneyManagementPlanId:\s*plan\?\.id \?\? null/)
  assert.match(source, /concentration:\s*risk\.concentration/)
  assert.doesNotMatch(source, /evaluateCurrentConcentration/)
})

test("QEO-139 client context exposes concentration and sector map without changing calculator math", () => {
  const hook = read("components/portfolio/risk-sizing/use-risk-sizing-context.ts")
  const calculator = read("modules/portfolio/risk-sizing/calculator.ts")

  assert.match(hook, /PortfolioConcentrationReadModel/)
  assert.match(hook, /moneyManagementPlanId/)
  assert.match(hook, /concentration/)
  assert.match(hook, /sectorMetadata/)
  assert.doesNotMatch(calculator, /concentration|sectorMetadata|maxTickerConcentration|maxSectorRisk/)
})
