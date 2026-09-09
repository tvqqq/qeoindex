import "server-only"

import type { ServerAuthContext } from "@/modules/auth/server"
import type { Json } from "@/modules/shared/supabase/database.types"
import type { PerformanceTradeInput } from "../performance/types.ts"
import type { RawTransaction, TransactionAction } from "../pnl.ts"
import { buildRiskProfileEvidence } from "./evidence.ts"
import { scoreDisciplineProfile, scoreRiskProfile } from "./scoring.ts"
import type {
  DisciplineProfilePoints,
  MoneyManagementPlanInput,
  ProfilePoint,
  RiskProfilePoints,
} from "./types.ts"
import { RiskPlanDomainError, validateMoneyManagementPlan } from "./validation.ts"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const PROFILE_POINTS = new Set<number>([5, 10, 15])

const RISK_PROFILE_SELECT = "id,portfolio_id,user_id,market_risk_points,active_return_12m_points,win_ratio_points,personal_risk_tolerance_points,experience_points,payoff_ratio_points,total_score,score_band,metric_evidence,created_at" as const
const DISCIPLINE_PROFILE_SELECT = "id,portfolio_id,user_id,punctuality_points,diet_self_control_points,record_keeping_points,office_clutter_points,bills_expenses_points,exercise_routine_points,total_score,score_band,created_at" as const
const PLAN_SELECT = "id,portfolio_id,user_id,version,risk_profile_attempt_id,discipline_profile_attempt_id,schema_version,default_trade_risk_percent,advanced_risk_override_acknowledged,max_active_risk_percent,drawdown_reduce_enabled,drawdown_reduce_threshold_percent,risk_reduction_factor,drawdown_pause_enabled,drawdown_pause_threshold_percent,consecutive_stop_outs_enabled,consecutive_stop_outs_threshold,rolling_trade_loss_enabled,rolling_trade_count,holiday_rules,execution_rules,scale_rules,diversification_rules,risk_capital_policy,notes,created_at" as const

function invalidInput(message: string): never {
  throw new RiskPlanDomainError("INVALID_PLAN", message)
}

function requireUuid(value: string, label: string): string {
  if (!UUID_RE.test(value)) invalidInput(`${label} is invalid.`)
  return value
}

function asRecord(value: unknown, label = "Request body"): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    invalidInput(`${label} must be an object.`)
  }
  return value as Record<string, unknown>
}

function asPoint(value: unknown, label: string): ProfilePoint {
  const point = Number(value)
  if (!PROFILE_POINTS.has(point)) invalidInput(`${label} must score 5, 10, or 15 points.`)
  return point as ProfilePoint
}

function finiteNumber(value: unknown, label: string): number {
  const number = Number(value)
  if (!Number.isFinite(number)) invalidInput(`${label} must be a finite number.`)
  return number
}

function optionalFiniteNumber(value: unknown, label: string): number | null {
  if (value == null || value === "") return null
  return finiteNumber(value, label)
}

function requiredBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") invalidInput(`${label} must be boolean.`)
  return value
}

function optionalUuid(value: unknown, label: string): string | null {
  if (value == null || value === "") return null
  return requireUuid(String(value), label)
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) invalidInput(`${label} must be an array.`)
  return value.map((entry) => String(entry).trim()).filter(Boolean)
}

function dbFailure(operation: string, error: unknown): never {
  const detail = String((error as { message?: unknown } | null)?.message ?? "unknown database error")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300)
  console.error(`[QeoIndex Risk Plan] ${operation} failed: ${detail}`)
  throw new Error(`Risk plan persistence failed during ${operation}`)
}

async function ensurePortfolioOwned(context: ServerAuthContext, portfolioId: string) {
  requireUuid(portfolioId, "Portfolio ID")
  const result = await context.supabase
    .from("portfolios")
    .select("id,user_id")
    .eq("id", portfolioId)
    .eq("user_id", context.user.id)
    .maybeSingle()
  if (result.error) dbFailure("load-portfolio", result.error)
  if (!result.data) throw new RiskPlanDomainError("NOT_FOUND", "Portfolio was not found.")
  return result.data
}

function normalizeRiskProfilePoints(input: unknown): RiskProfilePoints {
  const body = asRecord(input)
  const result: RiskProfilePoints = {
    marketRiskPoints: asPoint(body.marketRiskPoints, "Market Risk"),
    activeReturn12mPoints: asPoint(body.activeReturn12mPoints, "12-month active trading return"),
    winRatioPoints: asPoint(body.winRatioPoints, "Win Ratio"),
    personalRiskTolerancePoints: asPoint(body.personalRiskTolerancePoints, "Personal Risk Tolerance"),
    experiencePoints: asPoint(body.experiencePoints, "Trading Experience"),
    payoffRatioPoints: asPoint(body.payoffRatioPoints, "Payoff Ratio"),
  }
  scoreRiskProfile(result)
  return result
}

function normalizeDisciplineProfilePoints(input: unknown): DisciplineProfilePoints {
  const body = asRecord(input)
  const result: DisciplineProfilePoints = {
    punctualityPoints: asPoint(body.punctualityPoints, "Punctuality"),
    dietSelfControlPoints: asPoint(body.dietSelfControlPoints, "Diet Self-Control"),
    recordKeepingPoints: asPoint(body.recordKeepingPoints, "Record Keeping"),
    officeClutterPoints: asPoint(body.officeClutterPoints, "Office Clutter"),
    billsExpensesPoints: asPoint(body.billsExpensesPoints, "Bills and Expenses"),
    exerciseRoutinePoints: asPoint(body.exerciseRoutinePoints, "Exercise Routine"),
  }
  scoreDisciplineProfile(result)
  return result
}

function normalizeHolidayPeriod(value: unknown, label: string) {
  if (value == null) return undefined
  const body = asRecord(value, label)
  return {
    enabled: requiredBoolean(body.enabled, `${label}.enabled`),
    ...(body.consecutiveLosingTrades != null ? { consecutiveLosingTrades: finiteNumber(body.consecutiveLosingTrades, `${label}.consecutiveLosingTrades`) } : {}),
    ...(body.consecutiveLosingDays != null ? { consecutiveLosingDays: finiteNumber(body.consecutiveLosingDays, `${label}.consecutiveLosingDays`) } : {}),
    ...(body.lossAmount != null ? { lossAmount: finiteNumber(body.lossAmount, `${label}.lossAmount`) } : {}),
    ...(body.lossPercent != null ? { lossPercent: finiteNumber(body.lossPercent, `${label}.lossPercent`) } : {}),
    ...(body.profitAmount != null ? { profitAmount: finiteNumber(body.profitAmount, `${label}.profitAmount`) } : {}),
    ...(body.profitPercent != null ? { profitPercent: finiteNumber(body.profitPercent, `${label}.profitPercent`) } : {}),
    ...(body.losingTradeWindow != null ? { losingTradeWindow: finiteNumber(body.losingTradeWindow, `${label}.losingTradeWindow`) } : {}),
  }
}

function normalizeMoneyManagementPlanInput(input: unknown): MoneyManagementPlanInput {
  const body = asRecord(input)
  const drawdownReduce = asRecord(body.drawdownReduce, "drawdownReduce")
  const drawdownPause = asRecord(body.drawdownPause, "drawdownPause")
  const consecutiveStopOuts = asRecord(body.consecutiveStopOuts, "consecutiveStopOuts")
  const rollingTradeLoss = asRecord(body.rollingTradeLoss, "rollingTradeLoss")
  const holidayRules = asRecord(body.holidayRules, "holidayRules")
  const executionRules = asRecord(body.executionRules, "executionRules")
  const scaleRules = asRecord(body.scaleRules, "scaleRules")
  const diversificationRules = asRecord(body.diversificationRules, "diversificationRules")
  const riskCapitalPolicy = asRecord(body.riskCapitalPolicy, "riskCapitalPolicy")

  const mode = String(riskCapitalPolicy.mode ?? "")
  let normalizedRiskCapitalPolicy: MoneyManagementPlanInput["riskCapitalPolicy"]
  if (mode === "disabled") {
    normalizedRiskCapitalPolicy = { mode: "disabled" }
  } else if (mode === "risk_capital_amount") {
    normalizedRiskCapitalPolicy = {
      mode,
      amount: finiteNumber(riskCapitalPolicy.amount, "riskCapitalPolicy.amount"),
    }
  } else if (mode === "net_worth_percent") {
    normalizedRiskCapitalPolicy = {
      mode,
      percent: finiteNumber(riskCapitalPolicy.percent, "riskCapitalPolicy.percent"),
    }
  } else {
    invalidInput("riskCapitalPolicy.mode is invalid.")
  }

  const scaleOutMode = String(scaleRules.scaleOutMode ?? "")
  if (!["none", "thirds", "30_30_40", "signal_driven", "custom"].includes(scaleOutMode)) {
    invalidInput("scaleRules.scaleOutMode is invalid.")
  }

  return validateMoneyManagementPlan({
    riskProfileAttemptId: optionalUuid(body.riskProfileAttemptId, "Risk Profile attempt ID"),
    disciplineProfileAttemptId: optionalUuid(body.disciplineProfileAttemptId, "Discipline Profile attempt ID"),
    defaultTradeRiskPercent: finiteNumber(body.defaultTradeRiskPercent, "Risk per Trade"),
    advancedRiskOverrideAcknowledged: requiredBoolean(body.advancedRiskOverrideAcknowledged, "advancedRiskOverrideAcknowledged"),
    maxActiveRiskPercent: finiteNumber(body.maxActiveRiskPercent, "Max Active Risk"),
    drawdownReduce: {
      enabled: requiredBoolean(drawdownReduce.enabled, "drawdownReduce.enabled"),
      thresholdPercent: optionalFiniteNumber(drawdownReduce.thresholdPercent, "drawdownReduce.thresholdPercent"),
      riskReductionFactor: optionalFiniteNumber(drawdownReduce.riskReductionFactor, "drawdownReduce.riskReductionFactor"),
    },
    drawdownPause: {
      enabled: requiredBoolean(drawdownPause.enabled, "drawdownPause.enabled"),
      thresholdPercent: optionalFiniteNumber(drawdownPause.thresholdPercent, "drawdownPause.thresholdPercent"),
    },
    consecutiveStopOuts: {
      enabled: requiredBoolean(consecutiveStopOuts.enabled, "consecutiveStopOuts.enabled"),
      threshold: optionalFiniteNumber(consecutiveStopOuts.threshold, "consecutiveStopOuts.threshold"),
    },
    rollingTradeLoss: {
      enabled: requiredBoolean(rollingTradeLoss.enabled, "rollingTradeLoss.enabled"),
      tradeCount: optionalFiniteNumber(rollingTradeLoss.tradeCount, "rollingTradeLoss.tradeCount"),
    },
    holidayRules: {
      daily: normalizeHolidayPeriod(holidayRules.daily, "holidayRules.daily"),
      weekly: normalizeHolidayPeriod(holidayRules.weekly, "holidayRules.weekly"),
      monthly: normalizeHolidayPeriod(holidayRules.monthly, "holidayRules.monthly"),
    },
    executionRules: {
      defineInitialStopBeforeEntry: requiredBoolean(executionRules.defineInitialStopBeforeEntry, "executionRules.defineInitialStopBeforeEntry"),
      honorStopWhenHit: requiredBoolean(executionRules.honorStopWhenHit, "executionRules.honorStopWhenHit"),
      stopUsesMarketOrSystemRules: requiredBoolean(executionRules.stopUsesMarketOrSystemRules, "executionRules.stopUsesMarketOrSystemRules"),
      trailingStopsWhenAppropriate: requiredBoolean(executionRules.trailingStopsWhenAppropriate, "executionRules.trailingStopsWhenAppropriate"),
      doNotMoveStopEmotionally: requiredBoolean(executionRules.doNotMoveStopEmotionally, "executionRules.doNotMoveStopEmotionally"),
      recalculateRiskWhenScalingIn: requiredBoolean(executionRules.recalculateRiskWhenScalingIn, "executionRules.recalculateRiskWhenScalingIn"),
      dailyRecordKeeping: requiredBoolean(executionRules.dailyRecordKeeping, "executionRules.dailyRecordKeeping"),
    },
    scaleRules: {
      scaleInOnlyToWinningPosition: requiredBoolean(scaleRules.scaleInOnlyToWinningPosition, "scaleRules.scaleInOnlyToWinningPosition"),
      prohibitDoublingDown: requiredBoolean(scaleRules.prohibitDoublingDown, "scaleRules.prohibitDoublingDown"),
      scaleOutMode: scaleOutMode as MoneyManagementPlanInput["scaleRules"]["scaleOutMode"],
      ...(scaleRules.customScaleOutPercentages != null
        ? { customScaleOutPercentages: stringArray(scaleRules.customScaleOutPercentages, "scaleRules.customScaleOutPercentages").map((value) => finiteNumber(value, "scaleRules.customScaleOutPercentages")) }
        : {}),
    },
    diversificationRules: {
      enabled: requiredBoolean(diversificationRules.enabled, "diversificationRules.enabled"),
      ...(diversificationRules.maxSectorRiskPercent != null ? { maxSectorRiskPercent: finiteNumber(diversificationRules.maxSectorRiskPercent, "diversificationRules.maxSectorRiskPercent") } : {}),
      ...(diversificationRules.concentrationWarningPercent != null ? { concentrationWarningPercent: finiteNumber(diversificationRules.concentrationWarningPercent, "diversificationRules.concentrationWarningPercent") } : {}),
      ...(diversificationRules.maxTickerConcentrationPercent != null ? { maxTickerConcentrationPercent: finiteNumber(diversificationRules.maxTickerConcentrationPercent, "diversificationRules.maxTickerConcentrationPercent") } : {}),
      ...(diversificationRules.maxConcurrentOpenPositions != null ? { maxConcurrentOpenPositions: finiteNumber(diversificationRules.maxConcurrentOpenPositions, "diversificationRules.maxConcurrentOpenPositions") } : {}),
    },
    riskCapitalPolicy: normalizedRiskCapitalPolicy,
    notes: body.notes == null ? null : String(body.notes),
  })
}

async function loadRiskProfileEvidence(context: ServerAuthContext, portfolioId: string) {
  const [tradesResult, fillsResult] = await Promise.all([
    context.supabase
      .from("portfolio_trades")
      .select("id,ticker,mode,status,timeframe,system_tags,setup_tags,initial_risk_amount,closed_at")
      .eq("portfolio_id", portfolioId)
      .eq("user_id", context.user.id)
      .eq("status", "closed"),
    context.supabase
      .from("portfolio_transactions")
      .select("id,trade_id,ticker,action,quantity,price,fee,fee_rate,transaction_date,tags,setup_tags,mistake_tags")
      .eq("portfolio_id", portfolioId)
      .eq("user_id", context.user.id)
      .not("trade_id", "is", null),
  ])
  if (tradesResult.error) dbFailure("load-closed-trades-for-evidence", tradesResult.error)
  if (fillsResult.error) dbFailure("load-linked-fills-for-evidence", fillsResult.error)

  const trades = (tradesResult.data ?? []).map((row) => ({
    ...row,
    mode: row.mode as "live" | "paper",
    system_tags: row.system_tags ?? [],
    setup_tags: row.setup_tags ?? [],
    initial_risk_amount: row.initial_risk_amount == null ? null : Number(row.initial_risk_amount),
  })) as PerformanceTradeInput[]

  const fills = (fillsResult.data ?? []).map((row) => ({
    ...row,
    action: row.action as TransactionAction,
    tags: row.tags ?? [],
    setup_tags: row.setup_tags ?? [],
    mistake_tags: row.mistake_tags ?? [],
  })) as RawTransaction[]

  return buildRiskProfileEvidence({
    trades,
    fills,
    periodEnd: new Date().toISOString(),
  })
}

export async function listRiskProfileAttempts(context: ServerAuthContext, portfolioId: string) {
  await ensurePortfolioOwned(context, portfolioId)
  const result = await context.supabase
    .from("portfolio_risk_profile_attempts")
    .select(RISK_PROFILE_SELECT)
    .eq("portfolio_id", portfolioId)
    .eq("user_id", context.user.id)
    .order("created_at", { ascending: false })
  if (result.error) dbFailure("list-risk-profile-attempts", result.error)
  return result.data ?? []
}

export async function createRiskProfileAttempt(context: ServerAuthContext, portfolioId: string, input: unknown) {
  await ensurePortfolioOwned(context, portfolioId)
  const points = normalizeRiskProfilePoints(input)
  const metricEvidence = await loadRiskProfileEvidence(context, portfolioId)
  const result = await context.supabase
    .from("portfolio_risk_profile_attempts")
    .insert({
      portfolio_id: portfolioId,
      user_id: context.user.id,
      market_risk_points: points.marketRiskPoints,
      active_return_12m_points: points.activeReturn12mPoints,
      win_ratio_points: points.winRatioPoints,
      personal_risk_tolerance_points: points.personalRiskTolerancePoints,
      experience_points: points.experiencePoints,
      payoff_ratio_points: points.payoffRatioPoints,
      metric_evidence: metricEvidence as unknown as Json,
    })
    .select(RISK_PROFILE_SELECT)
    .single()
  if (result.error || !result.data) dbFailure("create-risk-profile-attempt", result.error)
  return result.data
}

export async function listDisciplineProfileAttempts(context: ServerAuthContext, portfolioId: string) {
  await ensurePortfolioOwned(context, portfolioId)
  const result = await context.supabase
    .from("portfolio_discipline_profile_attempts")
    .select(DISCIPLINE_PROFILE_SELECT)
    .eq("portfolio_id", portfolioId)
    .eq("user_id", context.user.id)
    .order("created_at", { ascending: false })
  if (result.error) dbFailure("list-discipline-profile-attempts", result.error)
  return result.data ?? []
}

export async function createDisciplineProfileAttempt(context: ServerAuthContext, portfolioId: string, input: unknown) {
  await ensurePortfolioOwned(context, portfolioId)
  const points = normalizeDisciplineProfilePoints(input)
  const result = await context.supabase
    .from("portfolio_discipline_profile_attempts")
    .insert({
      portfolio_id: portfolioId,
      user_id: context.user.id,
      punctuality_points: points.punctualityPoints,
      diet_self_control_points: points.dietSelfControlPoints,
      record_keeping_points: points.recordKeepingPoints,
      office_clutter_points: points.officeClutterPoints,
      bills_expenses_points: points.billsExpensesPoints,
      exercise_routine_points: points.exerciseRoutinePoints,
    })
    .select(DISCIPLINE_PROFILE_SELECT)
    .single()
  if (result.error || !result.data) dbFailure("create-discipline-profile-attempt", result.error)
  return result.data
}

export async function listMoneyManagementPlans(context: ServerAuthContext, portfolioId: string) {
  await ensurePortfolioOwned(context, portfolioId)
  const result = await context.supabase
    .from("portfolio_money_management_plans")
    .select(PLAN_SELECT)
    .eq("portfolio_id", portfolioId)
    .eq("user_id", context.user.id)
    .order("version", { ascending: false })
  if (result.error) dbFailure("list-money-management-plans", result.error)
  return result.data ?? []
}

export async function getCurrentMoneyManagementPlan(context: ServerAuthContext, portfolioId: string) {
  await ensurePortfolioOwned(context, portfolioId)
  const result = await context.supabase
    .from("portfolio_money_management_plans")
    .select(PLAN_SELECT)
    .eq("portfolio_id", portfolioId)
    .eq("user_id", context.user.id)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (result.error) dbFailure("load-current-money-management-plan", result.error)
  return result.data ?? null
}

export async function createMoneyManagementPlanVersion(context: ServerAuthContext, portfolioId: string, input: unknown) {
  await ensurePortfolioOwned(context, portfolioId)
  const plan = normalizeMoneyManagementPlanInput(input)
  const payload: Json = {
    risk_profile_attempt_id: plan.riskProfileAttemptId,
    discipline_profile_attempt_id: plan.disciplineProfileAttemptId,
    schema_version: 1,
    default_trade_risk_percent: plan.defaultTradeRiskPercent,
    advanced_risk_override_acknowledged: plan.advancedRiskOverrideAcknowledged,
    max_active_risk_percent: plan.maxActiveRiskPercent,
    drawdown_reduce_enabled: plan.drawdownReduce.enabled,
    drawdown_reduce_threshold_percent: plan.drawdownReduce.thresholdPercent ?? null,
    risk_reduction_factor: plan.drawdownReduce.riskReductionFactor ?? null,
    drawdown_pause_enabled: plan.drawdownPause.enabled,
    drawdown_pause_threshold_percent: plan.drawdownPause.thresholdPercent ?? null,
    consecutive_stop_outs_enabled: plan.consecutiveStopOuts.enabled,
    consecutive_stop_outs_threshold: plan.consecutiveStopOuts.threshold ?? null,
    rolling_trade_loss_enabled: plan.rollingTradeLoss.enabled,
    rolling_trade_count: plan.rollingTradeLoss.tradeCount ?? null,
    holiday_rules: plan.holidayRules as unknown as Json,
    execution_rules: plan.executionRules as unknown as Json,
    scale_rules: plan.scaleRules as unknown as Json,
    diversification_rules: plan.diversificationRules as unknown as Json,
    risk_capital_policy: plan.riskCapitalPolicy as unknown as Json,
    notes: plan.notes,
  }

  const result = await context.supabase.rpc("qeo_create_portfolio_money_management_plan", {
    p_portfolio_id: portfolioId,
    p_payload: payload,
  })
  if (result.error || !result.data) dbFailure("create-money-management-plan-version", result.error)
  return result.data
}

export async function getRiskPlanOverview(context: ServerAuthContext, portfolioId: string) {
  await ensurePortfolioOwned(context, portfolioId)
  const [riskAttempts, disciplineAttempts, plans, evidence] = await Promise.all([
    listRiskProfileAttempts(context, portfolioId),
    listDisciplineProfileAttempts(context, portfolioId),
    listMoneyManagementPlans(context, portfolioId),
    loadRiskProfileEvidence(context, portfolioId),
  ])

  return {
    latestRiskProfileAttempt: riskAttempts[0] ?? null,
    latestDisciplineProfileAttempt: disciplineAttempts[0] ?? null,
    currentMoneyManagementPlan: plans[0] ?? null,
    riskProfileAttemptCount: riskAttempts.length,
    disciplineProfileAttemptCount: disciplineAttempts.length,
    moneyManagementPlanVersionCount: plans.length,
    evidence,
  }
}
