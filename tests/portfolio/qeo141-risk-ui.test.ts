import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"

function read(relative: string) {
  const full = path.join(process.cwd(), relative)
  assert.equal(fs.existsSync(full), true, `${relative} must exist`)
  return fs.readFileSync(full, "utf8")
}

test("Tài sản risk dashboard uses Vietnamese-primary canonical risk terminology", () => {
  const dashboard = read("components/portfolio/risk-engine/portfolio-risk-dashboard.tsx")
  const tooltip = read("components/portfolio/risk-engine/risk-term-tooltip.tsx")

  for (const label of [
    "Vốn chủ tài khoản",
    "Rủi ro đang hoạt động",
    "Tỷ lệ rủi ro đang hoạt động",
    "Rủi ro hoạt động tối đa",
    "Ngân sách rủi ro còn lại",
    "Rủi ro ban đầu",
    "Dừng lỗ hiện tại",
    "Mức sụt giảm",
    "Trạng thái rủi ro",
  ]) assert.match(`${dashboard}\n${tooltip}`, new RegExp(label))

  for (const term of [
    "Account Equity",
    "Active Risk",
    "Active Risk %",
    "Max Active Risk",
    "Remaining Risk Budget",
    "Initial Risk",
    "Current Stop",
    "Drawdown",
    "Risk State",
  ]) assert.match(tooltip, new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))

  assert.match(tooltip, /Thuật ngữ gốc:/)
  assert.match(dashboard, /Rủi ro chưa xác định/)
  assert.match(`${dashboard}\n${tooltip}`, /Risk Unknown/)
})

test("risk dashboard renders canonical API facts without deriving risk rules client-side", () => {
  const dashboard = read("components/portfolio/risk-engine/portfolio-risk-dashboard.tsx")
  const hook = read("components/portfolio/risk-engine/use-portfolio-risk-context.ts")
  const page = read("components/portfolio/portfolio-page.tsx")

  assert.match(hook, /\/api\/portfolio\/\$\{portfolioId\}\/risk/)
  assert.match(hook, /requestIdRef/)
  assert.match(dashboard, /riskState\.triggers/)
  assert.match(dashboard, /riskState\.insufficientRules/)
  assert.doesNotMatch(dashboard, /derivePortfolioRiskState|computeOpenTradeActiveRisk|buildEquityCurve/)
  assert.match(page, /PortfolioRiskDashboard/)
  assert.match(page, /activeTab === "portfolio"/)
})
