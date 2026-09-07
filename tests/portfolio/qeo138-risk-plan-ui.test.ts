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

test("risk planning UI uses canonical McDowell labels and shared Vietnamese tooltips", () => {
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
    assert.match(source, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), `${label} must be visible`)
  }

  assert.match(source, /RiskTermTooltip/)
  assert.match(source, /Insufficient History/)
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
