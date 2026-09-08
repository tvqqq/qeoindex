import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import test from "node:test"

const calculatorPath = "components/portfolio/risk-sizing/trade-size-calculator.tsx"
const advisorPath = "components/portfolio/risk-sizing/trade-size-advisor.tsx"
const combinedPath = "components/portfolio/risk-sizing/combined-portfolio-simulation.tsx"
const hookPath = "components/portfolio/risk-sizing/use-risk-sizing-context.ts"
const tooltipPath = "components/portfolio/risk-sizing/risk-metric-tooltip.tsx"
const allocationPath = "components/portfolio/portfolio-capital-allocation.tsx"
const panel1Path = "components/portfolio/risk-sizing/portfolio-allocation-advisor.tsx"
const panel2Path = "components/portfolio/risk-sizing/portfolio-current-state.tsx"
const uiPolicyPath = "components/portfolio/risk-sizing/planner-ui-policy.ts"
const pagePath = "components/portfolio/portfolio-page.tsx"
const terminologyPath = "modules/portfolio/risk-sizing/terminology.ts"
const pnlPath = "modules/portfolio/pnl.ts"
const pnlTestPath = "tests/portfolio-pnl.test.ts"

function read(path: string) {
  return existsSync(path) ? readFileSync(path, "utf8") : ""
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

test("stop-first sizing keeps canonical English source terms in shared metadata while UI renders Vietnamese labels", () => {
  const surface = `${read(advisorPath)}\n${read(panel1Path)}`
  const terminology = read(terminologyPath)
  const tooltip = read(tooltipPath)
  const terms = [
    ["accountEquity", "Account Equity", "Vốn tài khoản"],
    ["riskPerTrade", "Risk per Trade", "Rủi ro mỗi giao dịch"],
    ["riskAmount", "Risk Amount", "Số tiền rủi ro"],
    ["plannedEntry", "Planned Entry", "Giá vào lệnh dự kiến"],
    ["initialStop", "Initial Stop", "Mức dừng lỗ ban đầu"],
    ["riskPerShare", "Risk per Share", "Rủi ro trên mỗi cổ phiếu"],
    ["estimatedCommission", "Estimated Commission", "Phí giao dịch ước tính"],
    ["slippageAllowance", "Slippage Allowance", "Phần đệm trượt giá"],
    ["tradeSize", "Trade Size", "Khối lượng giao dịch"],
    ["positionValue", "Position Value", "Giá trị vị thế"],
    ["activeRisk", "Active Risk", "Rủi ro đang hoạt động"],
    ["maxActiveRisk", "Max Active Risk", "Rủi ro đang hoạt động tối đa"],
    ["remainingRiskBudget", "Remaining Risk Budget", "Ngân sách rủi ro còn lại"],
  ] as const

  for (const [term, labelEn, labelVi] of terms) {
    assert.match(terminology, new RegExp(`labelEn:\\s*"${escapeRegExp(labelEn)}"`), `missing canonical source label ${labelEn}`)
    assert.match(terminology, new RegExp(`labelVi:\\s*"${escapeRegExp(labelVi)}"`), `missing Vietnamese label ${labelVi}`)
    assert.match(surface, new RegExp(`term="${term}"`), `portfolio sizing surface does not render ${term}`)
  }
  assert.match(tooltip, /metadata\.labelVi/)
  assert.match(tooltip, /metadata\.labelEn/)
  assert.match(tooltip, /Thuật ngữ gốc:/)
})

test("allocation owns one authenticated risk-context fetch and advisor stays deterministic", () => {
  const hook = read(hookPath)
  const allocation = read(allocationPath)
  const advisor = read(advisorPath)

  assert.match(hook, /fetch\(`\/api\/portfolio\/\$\{portfolioId\}\/risk-sizing`/)
  assert.match(hook, /AbortController/)
  assert.match(hook, /cache:\s*"no-store"/)
  assert.match(hook, /credentials:\s*"same-origin"/)
  assert.match(allocation, /useRiskSizingContext\(activePortfolioId\)/)
  assert.doesNotMatch(advisor, /fetch\(`\/api\/portfolio\/\$\{portfolioId\}\/risk-sizing`/)
  assert.match(advisor, /calculateTradeSize/)
  assert.match(allocation, /simulatePlannedTrades/)
  assert.match(advisor, /RiskMetricTooltip/)
  assert.doesNotMatch(`${hook}\n${allocation}\n${advisor}`, /createClient|supabase\.|\.from\(/)
})

test("four-panel portfolio workflow is locked in 1→4 order with Vietnamese primary headings and Panel 1 stays portfolio-scoped", () => {
  const allocation = read(allocationPath)
  const panel1 = read(panel1Path)
  const panel2 = read(panel2Path)
  const combined = read(combinedPath)
  const composed = `${allocation}\n${panel1}\n${panel2}\n${combined}`
  const headings = [
    "1. Tư vấn phân bổ vốn",
    "2. Trạng thái danh mục hiện tại",
    "3. Tư vấn khối lượng giao dịch",
    "4. Mô phỏng danh mục tổng hợp",
  ]

  for (const heading of headings) {
    assert.match(composed, new RegExp(escapeRegExp(heading)), `missing four-panel heading: ${heading}`)
  }

  assert.match(allocation, /<PortfolioAllocationAdvisor[\s\S]*<PortfolioCurrentState[\s\S]*3\. Tư vấn khối lượng giao dịch[\s\S]*<CombinedPortfolioSimulation/)
  assert.match(allocation, /lg:grid-cols-2/)
  assert.doesNotMatch(panel1, /plannedEntry|initialStop/)
  assert.doesNotMatch(composed, />\s*1\. Portfolio Allocation Advisor\s*</)
  assert.doesNotMatch(composed, />\s*2\. Current Portfolio State\s*</)
  assert.doesNotMatch(composed, />\s*3\. Trade Size Advisor\s*</)
  assert.doesNotMatch(composed, />\s*4\. Combined Portfolio Simulation\s*</)
})

test("Panel 2 never promotes compatibility stopLoss fields into canonical risk evidence", () => {
  const panel2 = read(panel2Path)
  assert.match(panel2, /riskCoverage\.holdingRisks/)
  assert.match(panel2, /openTradeRisks/)
  assert.doesNotMatch(panel2, /position\.stopLoss|stopLoss1|stopLoss2|stopLoss3/)
})

test("ui-first production pass exposes consistent planner hierarchy and one explicit unavailable-action policy", () => {
  const allocation = read(allocationPath)
  const panel1 = read(panel1Path)
  const panel2 = read(panel2Path)
  const advisor = read(advisorPath)
  const combined = read(combinedPath)
  const policy = read(uiPolicyPath)
  const surface = `${allocation}\n${panel1}\n${panel2}\n${advisor}\n${combined}`

  assert.match(allocation, /data-planner-workspace/)
  assert.match(panel1, /data-planner-panel="allocation"/)
  assert.match(panel2, /data-planner-panel="current-state"/)
  assert.match(advisor, /data-planner-advisor="trade-size"/)
  assert.match(combined, /data-planner-panel="simulation"/)
  assert.match(combined, /Trước[\s\S]*Dự kiến[\s\S]*Sau/)

  assert.match(policy, /export function showPlannerUnavailableAlert/)
  assert.match(policy, /window\.alert/)
  assert.match(policy, /đang được hoàn thiện/i)
  assert.doesNotMatch(surface, /window\.alert/)
})

test("ticker-first Trade Size Advisor owns ephemeral planned basket behavior with Vietnamese actions", () => {
  const advisor = read(advisorPath)
  const allocation = read(allocationPath)

  for (const label of [
    "Mã cổ phiếu",
    "Thêm giao dịch dự kiến",
    "Các giao dịch dự kiến",
    "Sửa",
    "Xóa",
    "không được lưu",
  ]) {
    assert.match(advisor, new RegExp(escapeRegExp(label), "i"), `Trade Size Advisor missing ${label}`)
  }

  for (const term of ["riskPerTrade", "plannedEntry", "initialStop", "estimatedCommission", "slippageAllowance", "tradeSize"]) {
    assert.match(advisor, new RegExp(`term="${term}"`), `missing sizing tooltip term ${term}`)
  }

  assert.match(advisor, /calculateTradeSize/)
  assert.match(advisor, /\.toUpperCase\(\)/)
  assert.match(allocation, /<TradeSizeAdvisor[\s\S]*plannedTrades=\{plannedTrades\}/)
  assert.match(allocation, /<CombinedPortfolioSimulation[\s\S]*plannedTrades=\{plannedTrades\}/)
  assert.match(allocation, /upsertPlannedTrade/)
  assert.match(allocation, /removePlannedTrade/)
  assert.doesNotMatch(advisor, /method:\s*["'](?:POST|PUT|PATCH)["']/i)
  assert.doesNotMatch(advisor, /localStorage|sessionStorage|indexedDB/i)
})

test("combined simulation panel renders Trước / Dự kiến / Sau states and deterministic advisors in Vietnamese", () => {
  const combined = read(combinedPath)
  const allocation = read(allocationPath)

  for (const label of [
    "Trước",
    "Dự kiến",
    "Sau",
    "Tư vấn phân bổ vốn",
    "Tư vấn khối lượng giao dịch",
    "Kết luận tổng hợp",
    "Rủi ro đang hoạt động dự kiến",
    "Thiếu hụt nguồn tiền",
  ]) {
    assert.match(combined, new RegExp(escapeRegExp(label)), `Combined Portfolio Simulation missing ${label}`)
  }

  assert.match(allocation, /<CombinedPortfolioSimulation/)
  assert.doesNotMatch(combined, /confidence score|will rise|expected target|probability/i)
})

test("monolithic calculator is retired after ticker-first advisor migration", () => {
  assert.equal(read(calculatorPath), "")
})

test("legacy fixed-stop assumptions and unsafe risk claims are removed from the allocation surface", () => {
  const source = `${read(allocationPath)}\n${read(advisorPath)}`
  assert.doesNotMatch(source, /triệt tiêu hoàn toàn nguy cơ/i)
  assert.doesNotMatch(source, /dealStopLossPct|7\.0.*Stoploss/i)
  assert.doesNotMatch(source, /% Cắt lỗ deal tiếp theo/i)
})

test("legacy fixed-fractional sizing helper is removed from the portfolio domain", () => {
  const pnl = read(pnlPath)
  const pnlTest = read(pnlTestPath)

  assert.doesNotMatch(pnl, /export function calculatePositionSizing/)
  assert.doesNotMatch(pnlTest, /calculatePositionSizing|Fixed Fractional Account Risk/)
})

test("draft sizing state cannot leak across portfolio switches", () => {
  const page = read(pagePath)
  assert.match(page, /<PortfolioCapitalAllocation[\s\S]*?key=\{activePortfolioId\s*\?\?\s*""\}/)
})

test("RiskMetricTooltip resolves shared bilingual terminology instead of duplicating formulas", () => {
  const tooltip = read(tooltipPath)
  assert.match(tooltip, /RISK_SIZING_TERMS/)
  assert.match(tooltip, /Tooltip/)
  assert.match(tooltip, /Thuật ngữ gốc:/)
  assert.match(tooltip, /Công thức gốc:/)
  assert.doesNotMatch(tooltip, /Risk Amount\s*=|Trade Size\s*=/)
})

test("stop-first guidance states stop provenance and execution risks without guarantees", () => {
  const source = read(advisorPath)
  assert.match(source, /hỗ trợ|kháng cự/i)
  assert.match(source, /biến động|hoạt động giá/i)
  assert.match(source, /quy tắc.*hệ thống|hệ thống giao dịch/i)
  assert.match(source, /dừng lỗ kéo theo/i)
  assert.match(source, /gap/i)
  assert.match(source, /thanh khoản/i)
  assert.match(source, /qua đêm|overnight/i)
  assert.match(source, /trượt giá/i)
  assert.doesNotMatch(source, /bảo đảm.*không.*thua|không thể cháy/i)
})

test("planned basket simulation stays fail-closed for unknown current risk evidence", () => {
  const allocation = read(allocationPath)
  assert.match(allocation, /summarizePortfolioRiskCoverage/)
  assert.match(allocation, /simulatePlannedTrades/)
  assert.match(allocation, /unknownRiskItemCount:\s*riskCoverage\.unknownRiskItemCount/)
  assert.match(allocation, /riskContextAvailable:\s*riskSizing\.context\s*!=\s*null/)
  assert.match(allocation, /plannedTrades,/)
})

test("risk context failure remains explicit in Vietnamese and never becomes zero risk", () => {
  const advisor = read(advisorPath)
  const combined = read(combinedPath)
  const panel1 = read(panel1Path)
  assert.match(advisor, /const riskContextUnavailable = !loadingRiskContext && riskContext == null/)
  assert.match(`${advisor}\n${combined}\n${panel1}`, /Không thể tải ngữ cảnh rủi ro|Không có ngữ cảnh rủi ro|Không khả dụng/i)
  assert.match(combined, /riskContextAvailable/)
  assert.doesNotMatch(`${advisor}\n${combined}\n${panel1}`, /ngữ cảnh rủi ro[^\n]{0,80}(?:=|là)\s*0/i)
})

test("Advanced evidence keeps Optimal f informational and unavailable without history", () => {
  const advisor = read(advisorPath)
  const terminology = read(terminologyPath)

  assert.match(advisor, /<details/)
  assert.match(advisor, /term="winRatio"/)
  assert.match(advisor, /term="payoffRatio"/)
  assert.match(advisor, /term="optimalF"/)
  assert.match(terminology, /labelEn:\s*"Win Ratio"/)
  assert.match(terminology, /labelEn:\s*"Payoff Ratio"/)
  assert.match(terminology, /labelEn:\s*"Optimal f"/)
  assert.match(advisor, /Chưa đủ lịch sử/)
  assert.match(advisor, /chỉ dùng để tham khảo/i)
  assert.match(advisor, /mạnh tay hơn/i)
  assert.match(advisor, /không được tự động áp/i)
  assert.match(advisor, /không bảo đảm Risk of Ruin bằng 0/i)
  assert.match(advisor, /calculateOptimalF/)
  assert.doesNotMatch(advisor, /Risk of Ruin probability|probability matrix|ROR probability table/i)
  assert.doesNotMatch(advisor, /setRiskPercentInput\([^\n]*optimal/i)
})
