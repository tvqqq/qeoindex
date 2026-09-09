export type TacticalPositionState =
  | "BREACH"
  | "WARNING"
  | "UNKNOWN"
  | "MISSING_STOP"
  | "PROFIT"
  | "LOSS"
  | "FLAT"

export function resolveTacticalPositionState(input: {
  unrealizedPnl: number
  stopLoss: number | null
  authoritativeRiskState?: "BREACH" | "WARNING" | "UNKNOWN" | null
}): TacticalPositionState {
  if (input.authoritativeRiskState) return input.authoritativeRiskState
  if (input.stopLoss == null) return "MISSING_STOP"
  if (input.unrealizedPnl > 0) return "PROFIT"
  if (input.unrealizedPnl < 0) return "LOSS"
  return "FLAT"
}
