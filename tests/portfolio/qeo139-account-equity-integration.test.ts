import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8")
}

test("PortfolioPage retains portfolio-level totalRealizedPnl for Account Equity", () => {
  const page = read("components/portfolio/portfolio-page.tsx")
  assert.match(page, /const portfolioSummary = useMemo\(/)
  assert.match(page, /const \{ positions, totalRealizedPnl \} = portfolioSummary/)
  assert.match(page, /totalRealizedPnlKvnd=\{totalRealizedPnl\}/)
})

test("capital allocation uses the pure Account Equity builder and never re-sums position realized P&L", () => {
  const source = read("components/portfolio/portfolio-capital-allocation.tsx")
  assert.match(source, /buildAccountEquityContext/)
  assert.match(source, /totalRealizedPnlKvnd/)
  assert.doesNotMatch(source, /positions\.reduce\([\s\S]*realizedPnl\s*\*\s*1000/)
})
