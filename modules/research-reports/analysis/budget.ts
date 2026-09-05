export type ResearchReportBudgetReason = "ai_request_limit" | "estimated_cost_limit"

export interface ResearchReportAiBudgetSnapshot {
  requestAttempts: number
  maxRequestAttempts: number
  estimatedCostUsd: number
  maxEstimatedCostUsd: number
  unknownUsageAttempts: number
  budgetExhausted: boolean
  budgetReason: ResearchReportBudgetReason | null
}

export interface ResearchReportAiBudgetOptions {
  maxRequestAttempts?: number
  maxEstimatedCostUsd?: number
}

export interface ResearchReportRequestReservation {
  reservedCostUsd: number
}

export class ResearchReportBudgetExceededError extends Error {
  readonly reason: ResearchReportBudgetReason

  constructor(reason: ResearchReportBudgetReason) {
    super(reason === "ai_request_limit"
      ? "Research report AI request-attempt budget is exhausted"
      : "Research report AI estimated-cost budget is exhausted")
    this.name = "ResearchReportBudgetExceededError"
    this.reason = reason
  }
}

export interface ResearchReportAiBudget {
  beforeRequest(input: ResearchReportRequestReservation): void
  recordResponseCost(estimatedCostUsd: number): void
  recordUnknownUsage(): void
  snapshot(): ResearchReportAiBudgetSnapshot
}

function positiveInteger(value: number, name: string) {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`)
  return value
}

function positiveFinite(value: number, name: string) {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive finite number`)
  return value
}

function nonNegativeFinite(value: number, name: string) {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a non-negative finite number`)
  return value
}

function roundUsd(value: number) {
  return Number(value.toFixed(12))
}

export function createResearchReportAiBudget(
  options: ResearchReportAiBudgetOptions = {},
): ResearchReportAiBudget {
  const maxRequestAttempts = positiveInteger(options.maxRequestAttempts ?? 20, "maxRequestAttempts")
  const maxEstimatedCostUsd = positiveFinite(options.maxEstimatedCostUsd ?? 1, "maxEstimatedCostUsd")

  let requestAttempts = 0
  let estimatedCostUsd = 0
  let unknownUsageAttempts = 0
  let budgetExhausted = false
  let budgetReason: ResearchReportBudgetReason | null = null

  function fail(reason: ResearchReportBudgetReason): never {
    budgetExhausted = true
    budgetReason = reason
    throw new ResearchReportBudgetExceededError(reason)
  }

  return {
    beforeRequest(input) {
      const reservedCostUsd = nonNegativeFinite(input.reservedCostUsd, "reservedCostUsd")
      if (requestAttempts >= maxRequestAttempts) fail("ai_request_limit")
      if (roundUsd(estimatedCostUsd + reservedCostUsd) > maxEstimatedCostUsd) {
        fail("estimated_cost_limit")
      }

      // The attempt is consumed before provider dispatch so timeouts and lost
      // responses cannot bypass the hard request-attempt ceiling.
      requestAttempts += 1
    },

    recordResponseCost(cost) {
      estimatedCostUsd = roundUsd(estimatedCostUsd + nonNegativeFinite(cost, "estimatedCostUsd"))
      if (estimatedCostUsd >= maxEstimatedCostUsd) {
        budgetExhausted = true
        budgetReason = "estimated_cost_limit"
      }
    },

    recordUnknownUsage() {
      unknownUsageAttempts += 1
    },

    snapshot() {
      return {
        requestAttempts,
        maxRequestAttempts,
        estimatedCostUsd,
        maxEstimatedCostUsd,
        unknownUsageAttempts,
        budgetExhausted,
        budgetReason,
      }
    },
  }
}
