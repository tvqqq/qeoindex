import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

test("stock-detail-data provides clean company name without repeating ticker or sector", () => {
  const code = source("modules/research/insights/stock-detail-data.ts")

  // Top stocks dictionary includes proper company names
  assert.match(code, /VN_TOP_COMPANY_NAMES/)
  assert.match(code, /VIC:\s*"Tập đoàn Vingroup"/)
  assert.match(code, /HPG:\s*"Tập đoàn Hòa Phát"/)
  assert.match(code, /VHM:\s*"Công ty Cổ phần Vinhomes"/)

  // resolveCleanCompanyName helper exists and is used
  assert.match(code, /resolveCleanCompanyName/)
  assert.match(code, /resolveCleanCompanyName\(decoded/)
  assert.match(code, /resolveCleanCompanyName\(sym/)
})

test("StockIdentity includes getSectorIcon and displays sector icon before industry name", () => {
  const code = source("components/stock-identity.tsx")

  // Contains getSectorIcon with matching Insights icons
  assert.match(code, /export function getSectorIcon/)
  assert.match(code, /Building2/)
  assert.match(code, /LineChart/)
  assert.match(code, /Landmark/)

  // Sector icon is rendered before detail/sector
  assert.match(code, /<SectorIcon sector=\{detail\} \/>/)
})

test("StockIdentity cleans up redundant companyName", () => {
  const code = source("components/stock-identity.tsx")

  // Defensive check against redundant ticker or sector inside companyName
  assert.match(code, /displayCompanyName\.toUpperCase\(\)\.startsWith\(`\$\{normTicker\} ·`\)/)
})

test("StockDetailWorkstation keeps transition status absolute without creating a middle-column gap", () => {
  const workstation = source("components/stock-detail/stock-detail-workstation.tsx")

  assert.match(workstation, /data-qeo173-transition-indicator/)
  assert.match(workstation, /pointer-events-none absolute right-2 top-2 z-50/)
  assert.doesNotMatch(workstation, /opacity-35 pointer-events-none/)

  // Header remains in normal document flow directly inside the section.
  assert.match(workstation, /<StockCompanyHeader data=\{currentData\} \/>/)
})
