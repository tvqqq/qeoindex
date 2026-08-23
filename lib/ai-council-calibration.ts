import type { AiCouncilStock, CouncilSignal } from "@/lib/ai-council-model"

export type CouncilDirectionalAgentKey = "wyckoff" | "momentum" | "fundamental" | "flow" | "market"
export type CouncilMarketRegime = "RISK_ON" | "NEUTRAL" | "RISK_OFF" | "UNKNOWN"

export const COUNCIL_BASE_WEIGHTS: Record<CouncilDirectionalAgentKey, number> = {
  wyckoff: 0.30,
  momentum: 0.20,
  fundamental: 0.20,
  flow: 0.15,
  market: 0.15,
}

export interface CouncilWeightProfile {
  weights: Record<CouncilDirectionalAgentKey, number>
  source: "static" | "overall-calibrated" | "regime-calibrated"
  calibrationVersion: string
  sampleCount: number
  regime: CouncilMarketRegime
}

function clamp(value: number, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value))
}

function chooseSignal(score: number, risk: AiCouncilStock["riskStatus"], confirmationPending: boolean): CouncilSignal {
  if (score >= 72 && risk === "approve" && !confirmationPending) return "BUY"
  if (score >= 60) return risk === "veto" ? "WAIT" : "BUY_ON_CONFIRMATION"
  if (score >= 47) return "WAIT"
  if (score >= 38) return "REDUCE"
  return "SELL"
}

function signalLabel(signal: CouncilSignal) {
  if (signal === "BUY") return "BUY"
  if (signal === "BUY_ON_CONFIRMATION") return "BUY ON CONFIRMATION"
  if (signal === "WAIT") return "WAIT"
  if (signal === "REDUCE") return "REDUCE"
  return "SELL / AVOID"
}

export function staticCouncilWeightProfile(regime: CouncilMarketRegime = "UNKNOWN"): CouncilWeightProfile {
  return {
    weights: { ...COUNCIL_BASE_WEIGHTS },
    source: "static",
    calibrationVersion: "static-v1",
    sampleCount: 0,
    regime,
  }
}

export function applyCouncilWeightProfile<T extends AiCouncilStock>(stock: T, profile: CouncilWeightProfile): T {
  const directionalAgents = stock.agents.filter((agent) => agent.key !== "risk")
  let weightedScore = 0
  let totalWeight = 0

  for (const agent of directionalAgents) {
    const weight = profile.weights[agent.key as CouncilDirectionalAgentKey]
    if (!Number.isFinite(weight) || weight <= 0) continue
    weightedScore += agent.score * weight
    totalWeight += weight
  }

  const councilScore = Math.round(clamp(totalWeight > 0 ? weightedScore / totalWeight : stock.councilScore))
  const signal = chooseSignal(councilScore, stock.riskStatus, stock.confirmationPending)

  return {
    ...stock,
    councilScore,
    signal,
    signalLabel: signalLabel(signal),
  }
}
