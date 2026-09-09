import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"

const sectorAdapterPath = path.join(process.cwd(), "modules/portfolio/concentration/sector-metadata.ts")
const riskTypesPath = path.join(process.cwd(), "modules/portfolio/risk-engine/types.ts")
const riskServerPath = path.join(process.cwd(), "modules/portfolio/risk-engine/server.ts")

test("structured sector adapter uses canonical universe and never ticker fallback classification", () => {
  assert.equal(fs.existsSync(sectorAdapterPath), true, "QEO-159 sector-metadata.ts must exist")
  const source = fs.readFileSync(sectorAdapterPath, "utf8")
  assert.match(source, /getCanonicalUniverse/)
  assert.doesNotMatch(source, /sectorForTicker/)
  assert.match(source, /sector\?\.trim\(\) \|\| null/)
  assert.match(source, /byTicker\[ticker\] \?\?= null/)
})

test("portfolio risk read model exposes deterministic concentration composition", () => {
  const typesSource = fs.readFileSync(riskTypesPath, "utf8")
  const serverSource = fs.readFileSync(riskServerPath, "utf8")

  assert.match(typesSource, /PortfolioConcentrationReadModel/)
  assert.match(typesSource, /concentration:\s*PortfolioConcentrationReadModel/)

  assert.match(serverSource, /loadStructuredSectorMetadata/)
  assert.match(serverSource, /evaluateCurrentConcentration/)
  assert.match(serverSource, /positions:\s*summary\.positions\.map/)
  assert.match(serverSource, /activeRiskRows:\s*active\.rows\.map/)
  assert.match(serverSource, /accountEquityVnd:\s*account\.equityVnd/)
  assert.match(serverSource, /currentPriceKvnd:\s*currentPricesKvnd\[position\.ticker\]\s*\?\?\s*null/)
  assert.match(serverSource, /concentration,/)
})

test("concentration composition passes QEO-141 activeRiskVnd through unchanged", () => {
  const serverSource = fs.readFileSync(riskServerPath, "utf8")
  assert.match(serverSource, /activeRiskVnd:\s*row\.activeRiskVnd/)
  assert.doesNotMatch(serverSource, /activeRiskVnd:\s*[^\n]*currentStop/)
})
