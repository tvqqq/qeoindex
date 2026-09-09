import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"

function read(relative: string) {
  return fs.readFileSync(path.join(process.cwd(), relative), "utf8")
}

test("concentration read model carries typed current plan rules for projection without React JSON reparsing", () => {
  const types = read("modules/portfolio/concentration/types.ts")
  const evaluator = read("modules/portfolio/concentration/evaluate-current.ts")
  assert.match(types, /rules:\s*DiversificationRules \| null/)
  assert.match(evaluator, /rules:\s*input\.rules/)
})

test("planner computes projected concentration and states explicitly that guardrails do not change sizing math", () => {
  const advisor = read("components/portfolio/risk-sizing/trade-size-advisor.tsx")
  const panel = read("components/portfolio/concentration/projected-concentration-panel.tsx")

  assert.match(advisor, /projectTradeConcentration/)
  assert.match(advisor, /riskContext\?\.sectorMetadata\.byTicker\[normalizedTicker\]/)
  assert.match(advisor, /riskContext\.concentration\.rules/)
  assert.match(advisor, /ProjectedConcentrationPanel/)
  assert.match(panel, /Tập trung sau giao dịch dự kiến/)
  assert.match(panel, /Tỷ trọng mã/)
  assert.match(panel, /Active Risk theo mã/)
  assert.match(panel, /Active Risk ngành/)
  assert.match(panel, /Số vị thế/)
  assert.match(panel, /không thay đổi công thức hoặc khối lượng giao dịch/i)
})

test("persisted planned Trade uses an isolated QEO-137 mutation helper with auditable concentration override", () => {
  const advisor = read("components/portfolio/risk-sizing/trade-size-advisor.tsx")
  const persistence = read("components/portfolio/risk-sizing/planned-trade-persistence.ts")

  assert.match(advisor, /persistPlannedTradeRecord/)
  assert.match(advisor, /portfolioId/)
  assert.match(advisor, /selectedMode/)
  assert.match(advisor, /overrideReason/)
  assert.match(advisor, /requiresConcentrationOverride/)
  assert.doesNotMatch(advisor, /method:\s*["'](?:POST|PUT|PATCH)["']/i)
  assert.doesNotMatch(advisor, /\/api\/portfolio\/\$\{portfolioId\}\/trades/)

  assert.match(persistence, /portfolioId:\s*string/)
  assert.match(persistence, /trade:\s*PlannedTrade/)
  assert.match(persistence, /mode:\s*"live" \| "paper"/)
  assert.match(persistence, /overrideReason:\s*string \| null/)
  assert.match(persistence, /requiresConcentrationOverride:\s*boolean/)
  assert.match(persistence, /\/api\/portfolio\/\$\{input\.portfolioId\}\/trades/)
  assert.match(persistence, /method:\s*"POST"/)
  assert.match(persistence, /money_management_plan_id:\s*input\.riskContext\.moneyManagementPlanId \?\? null/)
  assert.match(persistence, /status:\s*"planned"/)
  assert.match(persistence, /\/journal/)
  assert.match(persistence, /Concentration\/diversification override/)
  assert.match(persistence, /concentration_override/)
  assert.match(persistence, /override_reason:\s*overrideReason/)
  assert.match(persistence, /Không thể lưu bằng chứng override/)
  assert.match(advisor, /Lưu Trade dự kiến/)
})

test("concentration conflicts remain advisory and executed fill recording path is untouched", () => {
  const calculator = read("modules/portfolio/risk-sizing/calculator.ts")
  const transactionDialog = read("components/portfolio/add-transaction-dialog.tsx")

  assert.doesNotMatch(calculator, /concentration|sectorMetadata|maxTickerConcentration|maxSectorRisk/)
  assert.doesNotMatch(transactionDialog, /projectTradeConcentration|concentration_override|maxTickerConcentration|maxSectorRisk/)
})
