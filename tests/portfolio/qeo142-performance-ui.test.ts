import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"

const root = process.cwd()
const performanceUiDir = path.join(root, "components/portfolio/performance")
const pagePath = path.join(root, "components/portfolio/portfolio-page.tsx")
const legacyBenchmarkPath = path.join(root, "components/portfolio/portfolio-benchmark-chart.tsx")

const expectedUiFiles = [
  "terminology.ts",
  "use-performance.ts",
  "performance-dashboard.tsx",
  "trading-scorecard.tsx",
  "equity-drawdown-panel.tsx",
  "performance-ledger.tsx",
  "benchmark-panel.tsx",
  "segments-panel.tsx",
]

function read(filePath: string): string {
  assert.equal(fs.existsSync(filePath), true, `${path.relative(root, filePath)} must exist`)
  return fs.readFileSync(filePath, "utf8")
}

function readUi(fileName: string): string {
  return read(path.join(performanceUiDir, fileName))
}

test("Hiệu suất tab renders the canonical one-fetch performance dashboard", () => {
  for (const fileName of expectedUiFiles) readUi(fileName)

  const page = read(pagePath)
  const compatibilitySlot = read(legacyBenchmarkPath)
  assert.match(page, /activeTab\s*===\s*["']benchmark["']/)
  assert.match(page, /<PortfolioBenchmarkChart\b/)
  assert.match(page, /portfolioId=\{activePortfolioId\}/)
  assert.match(compatibilitySlot, /PortfolioPerformanceDashboard/)
  assert.match(compatibilitySlot, /<PortfolioPerformanceDashboard\s+portfolioId=\{portfolioId\}\s*\/>/)

  const hook = readUi("use-performance.ts")
  assert.match(hook, /usePortfolioPerformance/)
  assert.match(hook, /fetch\(`\/api\/portfolio\/\$\{portfolioId\}\/performance`/)
  assert.match(hook, /cache:\s*["']no-store["']/)

  const clientSources = [
    ...expectedUiFiles.map((name) => readUi(name)),
    page,
    compatibilitySlot,
  ]
  const performanceFetchOwners = clientSources.filter((source) => (
    source.includes("/performance") && source.includes("fetch(")
  ))
  assert.equal(performanceFetchOwners.length, 1, "only use-performance.ts may fetch canonical performance data")
})

test("dashboard keeps canonical section order and filter scope visible", () => {
  const dashboard = readUi("performance-dashboard.tsx")

  const orderedSections = [
    "TradingScorecard",
    "EquityDrawdownPanel",
    "PerformanceLedger",
    "BenchmarkPanel",
    "SegmentsPanel",
    "Optimal f",
  ]
  let previousIndex = -1
  for (const marker of orderedSections) {
    const index = dashboard.indexOf(marker)
    assert.ok(index > previousIndex, `${marker} must appear after the prior dashboard section`)
    previousIndex = index
  }

  for (const label of ["Thực tế", "Mô phỏng", "Kết hợp"]) {
    assert.match(dashboard, new RegExp(label))
  }
  for (const label of ["Ngày", "Tuần", "Tháng", "Năm"]) {
    assert.match(dashboard, new RegExp(label))
  }

  assert.match(dashboard, /Mẫu nhỏ/i)
  assert.match(dashboard, /toàn danh mục/i)
})

test("performance UI is presentation-only and fails closed for missing metrics", () => {
  const sources = expectedUiFiles.map((name) => readUi(name)).join("\n")

  assert.doesNotMatch(sources, /computePortfolioPositions/)
  assert.doesNotMatch(sources, /deriveClosedTradeOutcomes/)
  assert.doesNotMatch(sources, /buildTradingScorecard/)
  assert.doesNotMatch(sources, /winnerCount\s*\/\s*eligibleTradeCount/)
  assert.doesNotMatch(sources, /commissionVnd\s*\/\s*grossProfitVnd/)

  assert.match(sources, /N\/A/)
  assert.match(sources, /Không đủ dữ liệu/)
})

test("terminology preserves canonical English terms formulas and safety context", () => {
  const terminology = readUi("terminology.ts")

  for (const field of ["labelVi", "labelEn", "formula", "helpVi"]) {
    assert.match(terminology, new RegExp(field))
  }
  for (const term of ["Win Ratio", "Payoff Ratio", "Commission Ratio", "Account Equity", "Drawdown", "Optimal f"]) {
    assert.match(terminology, new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
  }

  assert.match(terminology, /Winning Closed Trades\s*\/\s*Eligible Closed Trades/)
  assert.match(terminology, /Total Commission\s*\/\s*Gross Profit/)
  assert.match(terminology, /mạnh|aggressive/i)
  assert.match(terminology, /không tự động|never auto/i)
})

test("legacy benchmark compatibility slot delegates without network or return arithmetic", () => {
  const legacy = read(legacyBenchmarkPath)
  assert.match(legacy, /PortfolioPerformanceDashboard/)
  assert.doesNotMatch(legacy, /fetch\(/)
  assert.doesNotMatch(legacy, /\/benchmark/)
  assert.doesNotMatch(legacy, /computePortfolioPositions/)
  assert.doesNotMatch(legacy, /portfolioReturnPct\s*:\s*0/)
  assert.doesNotMatch(legacy, /alphaPct\s*:\s*0/)
})
