import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"

const scoringPath = path.join(process.cwd(), "modules/portfolio/risk-plan/scoring.ts")
const validationPath = path.join(process.cwd(), "modules/portfolio/risk-plan/validation.ts")

async function loadScoring() {
  assert.equal(fs.existsSync(scoringPath), true, "QEO-138 scoring.ts must exist")
  return import("../../modules/portfolio/risk-plan/scoring.ts")
}

async function loadValidation() {
  assert.equal(fs.existsSync(validationPath), true, "QEO-138 validation.ts must exist")
  return import("../../modules/portfolio/risk-plan/validation.ts")
}

const basePlan = {
  riskProfileAttemptId: null,
  disciplineProfileAttemptId: null,
  defaultTradeRiskPercent: 1.5,
  advancedRiskOverrideAcknowledged: false,
  maxActiveRiskPercent: 6,
  drawdownReduce: {
    enabled: true,
    thresholdPercent: 10,
    riskReductionFactor: 0.75,
  },
  drawdownPause: {
    enabled: true,
    thresholdPercent: 15,
  },
  consecutiveStopOuts: {
    enabled: true,
    threshold: 7,
  },
  rollingTradeLoss: {
    enabled: true,
    tradeCount: 25,
  },
  holidayRules: {},
  executionRules: {
    defineInitialStopBeforeEntry: true,
    honorStopWhenHit: true,
    stopUsesMarketOrSystemRules: true,
    trailingStopsWhenAppropriate: true,
    doNotMoveStopEmotionally: true,
    recalculateRiskWhenScalingIn: true,
    dailyRecordKeeping: true,
  },
  scaleRules: {
    scaleInOnlyToWinningPosition: true,
    prohibitDoublingDown: true,
    scaleOutMode: "none" as const,
  },
  diversificationRules: { enabled: false },
  riskCapitalPolicy: { mode: "disabled" as const },
  notes: null,
}

test("profile totals use deterministic 30-45 / 50-65 / 70-90 bands", async () => {
  const { scoreProfile } = await loadScoring()

  assert.deepEqual(scoreProfile([5, 5, 5, 5, 5, 5]), { total: 30, band: "low" })
  assert.deepEqual(scoreProfile([10, 10, 10, 10, 5, 5]), { total: 50, band: "middle" })
  assert.deepEqual(scoreProfile([15, 15, 10, 10, 10, 10]), { total: 70, band: "high" })
  assert.deepEqual(scoreProfile([15, 15, 15, 15, 15, 15]), { total: 90, band: "high" })
})

test("profile scoring rejects non-source point values and incomplete questionnaires", async () => {
  const { scoreProfile } = await loadScoring()

  assert.throws(() => scoreProfile([5, 10, 15, 5, 10] as never), /six/i)
  assert.throws(() => scoreProfile([5, 10, 15, 5, 10, 12] as never), /5, 10, or 15/i)
})

test("numeric Risk Profile evidence maps to source anchors deterministically", async () => {
  const {
    riskProfilePointsForActiveReturn12m,
    riskProfilePointsForWinRatio,
    riskProfilePointsForPayoffRatio,
  } = await loadScoring()

  assert.equal(riskProfilePointsForActiveReturn12m(50), 5)
  assert.equal(riskProfilePointsForActiveReturn12m(49.99), 10)
  assert.equal(riskProfilePointsForActiveReturn12m(10), 10)
  assert.equal(riskProfilePointsForActiveReturn12m(9.99), 15)

  assert.equal(riskProfilePointsForWinRatio(50), 5)
  assert.equal(riskProfilePointsForWinRatio(49.99), 10)
  assert.equal(riskProfilePointsForWinRatio(35), 10)
  assert.equal(riskProfilePointsForWinRatio(34.99), 15)

  assert.equal(riskProfilePointsForPayoffRatio(3.01), 5)
  assert.equal(riskProfilePointsForPayoffRatio(3), 10)
  assert.equal(riskProfilePointsForPayoffRatio(2), 10)
  assert.equal(riskProfilePointsForPayoffRatio(1.99), 15)
})

test("Money Management Plan validates explicit advanced risk acknowledgement", async () => {
  const { validateMoneyManagementPlan, RiskPlanDomainError } = await loadValidation()

  assert.throws(
    () => validateMoneyManagementPlan({ ...basePlan, defaultTradeRiskPercent: 2.5 }),
    (error: unknown) => error instanceof RiskPlanDomainError && error.code === "ADVANCED_RISK_ACK_REQUIRED",
  )

  const accepted = validateMoneyManagementPlan({
    ...basePlan,
    defaultTradeRiskPercent: 2.5,
    advancedRiskOverrideAcknowledged: true,
  })
  assert.equal(accepted.defaultTradeRiskPercent, 2.5)
})

test("Money Management Plan never derives risk percentage from profile score", async () => {
  const { validateMoneyManagementPlan } = await loadValidation()

  const accepted = validateMoneyManagementPlan({ ...basePlan, defaultTradeRiskPercent: 1.5 })
  assert.equal(accepted.defaultTradeRiskPercent, 1.5)
  assert.equal("profileScore" in accepted, false)
})

test("Money Management Plan enforces internally consistent drawdown and active-risk rules", async () => {
  const { validateMoneyManagementPlan } = await loadValidation()

  assert.throws(
    () => validateMoneyManagementPlan({ ...basePlan, maxActiveRiskPercent: 1 }),
    /Max Active Risk/i,
  )
  assert.throws(
    () => validateMoneyManagementPlan({
      ...basePlan,
      drawdownReduce: { enabled: true, thresholdPercent: 10, riskReductionFactor: 1 },
    }),
    /reduction factor/i,
  )
  assert.throws(
    () => validateMoneyManagementPlan({
      ...basePlan,
      drawdownPause: { enabled: true, thresholdPercent: 8 },
    }),
    /pause threshold/i,
  )
  assert.throws(
    () => validateMoneyManagementPlan({
      ...basePlan,
      consecutiveStopOuts: { enabled: true, threshold: 0 },
    }),
    /stop-out/i,
  )
})

test("custom scale-out percentages must be positive and total exactly 100 within tolerance", async () => {
  const { validateMoneyManagementPlan } = await loadValidation()

  assert.doesNotThrow(() => validateMoneyManagementPlan({
    ...basePlan,
    scaleRules: {
      scaleInOnlyToWinningPosition: true,
      prohibitDoublingDown: true,
      scaleOutMode: "custom",
      customScaleOutPercentages: [30, 30, 40],
    },
  }))

  assert.throws(() => validateMoneyManagementPlan({
    ...basePlan,
    scaleRules: {
      scaleInOnlyToWinningPosition: true,
      prohibitDoublingDown: true,
      scaleOutMode: "custom",
      customScaleOutPercentages: [30, 30, 30],
    },
  }), /100/)
})
