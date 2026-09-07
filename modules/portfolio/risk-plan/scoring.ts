import type {
  DisciplineProfilePoints,
  ProfileBand,
  ProfilePoint,
  RiskProfilePoints,
} from "./types.ts"

const PROFILE_POINTS = new Set<number>([5, 10, 15])

function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number.`)
  }
}

export function scoreProfile(points: readonly ProfilePoint[]): { total: number; band: ProfileBand } {
  if (points.length !== 6) {
    throw new RangeError("Profile must contain exactly six scored answers.")
  }
  for (const point of points) {
    if (!PROFILE_POINTS.has(point)) {
      throw new RangeError("Each profile answer must score 5, 10, or 15 points.")
    }
  }

  const total = points.reduce<number>((sum, point) => sum + point, 0)
  const band: ProfileBand = total < 50 ? "low" : total < 70 ? "middle" : "high"
  return { total, band }
}

export function scoreRiskProfile(input: RiskProfilePoints) {
  return scoreProfile([
    input.marketRiskPoints,
    input.activeReturn12mPoints,
    input.winRatioPoints,
    input.personalRiskTolerancePoints,
    input.experiencePoints,
    input.payoffRatioPoints,
  ])
}

export function scoreDisciplineProfile(input: DisciplineProfilePoints) {
  return scoreProfile([
    input.punctualityPoints,
    input.dietSelfControlPoints,
    input.recordKeepingPoints,
    input.officeClutterPoints,
    input.billsExpensesPoints,
    input.exerciseRoutinePoints,
  ])
}

export function riskProfilePointsForActiveReturn12m(returnPercent: number): ProfilePoint {
  assertFinite(returnPercent, "12-month active trading return")
  if (returnPercent >= 50) return 5
  if (returnPercent >= 10) return 10
  return 15
}

export function riskProfilePointsForWinRatio(winRatioPercent: number): ProfilePoint {
  assertFinite(winRatioPercent, "Win Ratio")
  if (winRatioPercent < 0 || winRatioPercent > 100) {
    throw new RangeError("Win Ratio must be between 0 and 100 percent.")
  }
  if (winRatioPercent >= 50) return 5
  if (winRatioPercent >= 35) return 10
  return 15
}

export function riskProfilePointsForPayoffRatio(payoffRatio: number): ProfilePoint {
  assertFinite(payoffRatio, "Payoff Ratio")
  if (payoffRatio < 0) throw new RangeError("Payoff Ratio cannot be negative.")
  if (payoffRatio > 3) return 5
  if (payoffRatio >= 2) return 10
  return 15
}
