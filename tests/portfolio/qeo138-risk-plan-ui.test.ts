import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"

const uiFiles = [
  "components/portfolio/portfolio-risk-plan.tsx",
  "components/portfolio/risk-plan/risk-profile-form.tsx",
  "components/portfolio/risk-plan/discipline-profile-form.tsx",
  "components/portfolio/risk-plan/money-management-plan-form.tsx",
  "components/portfolio/risk-plan/risk-term-tooltip.tsx",
]

function read(relativePath: string) {
  const filePath = path.join(process.cwd(), relativePath)
  assert.equal(fs.existsSync(filePath), true, `${relativePath} must exist`)
  return fs.readFileSync(filePath, "utf8")
}

test("risk planning UI retains canonical McDowell English terms as tooltip keys with Vietnamese presentation", () => {
  const source = uiFiles.map(read).join("\n")

  for (const label of [
    "Risk Profile",
    "Discipline Profile",
    "Money Management Plan",
    "Win Ratio",
    "Payoff Ratio",
    "Risk per Trade",
    "Max Active Risk",
    "Account Drawdown",
  ]) {
    assert.match(source, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), `${label} must remain available as canonical source terminology`)
  }

  assert.match(source, /RiskTermTooltip/)
  assert.match(source, /Chưa đủ lịch sử/)
  assert.match(source, /30–45|30-45/)
  assert.match(source, /50–65|50-65/)
  assert.match(source, /70–90|70-90/)
  assert.doesNotMatch(source, /triệt tiêu hoàn toàn nguy cơ/i)
  assert.doesNotMatch(source, /zero risk/i)
  assert.doesNotMatch(source, /left[- ]brain|right[- ]brain/i)
})

test("every Money Management Plan rule and editable parameter has shared Vietnamese tooltip help", () => {
  const source = read("components/portfolio/risk-plan/money-management-plan-form.tsx")
  const labels = [
    "Risk per Trade",
    "Max Active Risk",
    "Account Drawdown",
    "Drawdown Reduce Threshold",
    "Risk Reduction Factor",
    "Drawdown Pause Threshold",
    "Consecutive Stop-Outs",
    "Rolling Trade Loss Window",
    "Daily Trading Holiday",
    "Daily Losing Trades",
    "Daily Loss Percent",
    "Weekly Trading Holiday",
    "Weekly Losing Trades",
    "Weekly Loss Percent",
    "Monthly Trading Holiday",
    "Monthly Losing Trades",
    "Monthly Loss Percent",
    "Define Initial Stop-Loss Exit",
    "Honor Stop When Hit",
    "Market/System Stop Rules",
    "Trailing Stops",
    "Emotional Stop Movement",
    "Recalculate Risk When Scaling In",
    "Daily Record Keeping",
    "Scale In Only To Winning Position",
    "Doubling Down",
    "Scale-Out Mode",
    "Custom Scale-Out Percentages",
    "Diversification Limits",
    "Max Sector Risk",
    "Concentration Warning",
    "Risk Capital Policy",
    "Risk Capital Value",
    "Plan Notes",
  ]

  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    assert.match(
      source,
      new RegExp(`RiskTermTooltip[^>]*label=["']${escaped}["']`, "i"),
      `${label} must use RiskTermTooltip`,
    )
  }
})

test("risk planning UI talks only to authenticated portfolio APIs", () => {
  const source = uiFiles.map(read).join("\n")
  assert.match(source, /\/api\/portfolio\/\$\{portfolioId\}\/risk-plan/)
  assert.doesNotMatch(source, /createClient|supabase\.|\.from\(/)
})

test("allocation tab keeps existing calculator and adds the risk-plan surface", () => {
  const page = read("components/portfolio/portfolio-page.tsx")
  assert.match(page, /PortfolioCapitalAllocation/)
  assert.match(page, /PortfolioRiskPlan/)
  assert.match(page, /activeTab === "allocation"/)
})

test("switching portfolios remounts the risk-plan surface so draft and overview state cannot leak", () => {
  const page = read("components/portfolio/portfolio-page.tsx")
  assert.match(
    page,
    /<PortfolioRiskPlan\s+key=\{activePortfolioId\}\s+portfolioId=\{activePortfolioId\}\s*\/>/,
    "PortfolioRiskPlan must be keyed by activePortfolioId so local draft state and in-flight overview state are discarded on portfolio switch",
  )
})

test("Risk and Discipline Profile use a three-stop slider instead of dropdown scoring", () => {
  const risk = read("components/portfolio/risk-plan/risk-profile-form.tsx")
  const discipline = read("components/portfolio/risk-plan/discipline-profile-form.tsx")
  const source = `${risk}\n${discipline}`

  assert.match(source, /PointSlider/)
  assert.match(source, /5\s*[,|/]\s*10\s*[,|/]\s*15|\[5,\s*10,\s*15\]/)
  assert.doesNotMatch(risk, /<select\b/)
  assert.doesNotMatch(discipline, /<select\b/)
})

test("saved profile attempts are displayed and can hydrate a retake", () => {
  const parent = read("components/portfolio/portfolio-risk-plan.tsx")
  const risk = read("components/portfolio/risk-plan/risk-profile-form.tsx")
  const discipline = read("components/portfolio/risk-plan/discipline-profile-form.tsx")

  assert.match(parent, /latestAttempt=\{overview\?\.latestRiskProfileAttempt/)
  assert.match(parent, /latestAttempt=\{overview\?\.latestDisciplineProfileAttempt/)
  assert.match(risk, /latestAttempt/)
  assert.match(discipline, /latestAttempt/)
  assert.match(`${risk}\n${discipline}`, /Đánh giá lại|Chỉnh sửa/i)
  assert.match(`${risk}\n${discipline}`, /created_at/)
  assert.match(`${risk}\n${discipline}`, /total_score/)
})

test("Portfolio Risk UI uses Vietnamese as the primary label and keeps canonical English inside tooltips", () => {
  const sizingTerms = read("modules/portfolio/risk-sizing/terminology.ts")
  const sizingTooltip = read("components/portfolio/risk-sizing/risk-metric-tooltip.tsx")
  const planTooltip = read("components/portfolio/risk-plan/risk-term-tooltip.tsx")
  const allocation = read("components/portfolio/portfolio-capital-allocation.tsx")
  const riskPlan = read("components/portfolio/portfolio-risk-plan.tsx")
  const moneyPlan = read("components/portfolio/risk-plan/money-management-plan-form.tsx")
  const planning = read("modules/portfolio/risk-sizing/planning.ts")

  assert.match(sizingTerms, /labelVi:/)
  assert.match(sizingTerms, /labelEn:/)
  assert.match(sizingTooltip, /metadata\.labelVi/)
  assert.match(sizingTooltip, /metadata\.labelEn/)
  assert.match(sizingTooltip, /Thuật ngữ gốc:/)

  assert.match(planTooltip, /labelVi/)
  assert.match(planTooltip, /labelEn/)
  assert.match(planTooltip, /Thuật ngữ gốc:/)

  for (const label of [
    "Lập kế hoạch phân bổ vốn",
    "Phân bổ vốn & khối lượng giao dịch",
    "Tư vấn khối lượng giao dịch",
    "Hồ sơ rủi ro",
    "Hồ sơ kỷ luật",
    "Kế hoạch quản trị vốn",
  ]) {
    assert.match(`${allocation}\n${riskPlan}\n${moneyPlan}`, new RegExp(label, "i"), `missing Vietnamese primary label ${label}`)
  }

  assert.doesNotMatch(allocation, />\s*Capital Allocation &amp; Trade Size\s*</)
  assert.doesNotMatch(allocation, />\s*Portfolio planner\s*</)
  assert.doesNotMatch(riskPlan, />\s*Risk Profile · Discipline Profile · Money Management Plan\s*</)
  assert.doesNotMatch(moneyPlan, />\s*Money Management Plan\s*</)
  assert.doesNotMatch(moneyPlan, />\s*Save Money Management Plan\s*</)
  assert.doesNotMatch(moneyPlan, />\s*No scale-out rule\s*</)
  assert.doesNotMatch(moneyPlan, />\s*Signal driven\s*</)
  assert.match(planning, /rủi ro danh mục/i)
  assert.match(planning, /không giả định margin/i)
})
