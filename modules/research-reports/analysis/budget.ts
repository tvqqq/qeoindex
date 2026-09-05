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
  initialSnapshot?: ResearchReportAiBudgetSnapshot
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

function nonNegativeInteger(value: number, name: string) {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer`)
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

function validateSnapshot(snapshot: ResearchReportAiBudgetSnapshot) {
  const maxRequestAttempts = positiveInteger(snapshot.maxRequestAttempts, "initialSnapshot.maxRequestAttempts")
  const maxEstimatedCostUsd = positiveFinite(snapshot.maxEstimatedCostUsd, "initialSnapshot.maxEstimatedCostUsd")
  const requestAttempts = nonNegativeInteger(snapshot.requestAttempts, "initialSnapshot.requestAttempts")
  const unknownUsageAttempts = nonNegativeInteger(snapshot.unknownUsageAttempts, "initialSnapshot.unknownUsageAttempts")
  const estimatedCostUsd = nonNegativeFinite(snapshot.estimatedCostUsd, "initialSnapshot.estimatedCostUsd")

  if (requestAttempts > maxRequestAttempts) {
    throw new Error("Research report AI budget snapshot request attempts exceed configured maximum")
  }
  if (unknownUsageAttempts > requestAttempts) {
    throw new Error("Research report AI budget snapshot unknown usage exceeds request attempts")
  }
  if (snapshot.budgetReason !== null
    && snapshot.budgetReason !== "ai_request_limit"
    && snapshot.budgetReason !== "estimated_cost_limit") {
    throw new Error("Research report AI budget snapshot has invalid exhaustion reason")
  }
  if (!snapshot.budgetExhausted && snapshot.budgetReason !== null) {
    throw new Error("Research report AI budget snapshot has a reason without exhaustion")
  }

  return {
    requestAttempts,
    maxRequestAttempts,
    estimatedCostUsd: roundUsd(estimatedCostUsd),
    maxEstimatedCostUsd,
    unknownUsageAttempts,
    budgetExhausted: Boolean(snapshot.budgetExhausted),
    budgetReason: snapshot.budgetReason,
  }
}

export function createResearchReportAiBudget(
  options: ResearchReportAiBudgetOptions = {},
): ResearchReportAiBudget {
  const initial = options.initialSnapshot ? validateSnapshot(options.initialSnapshot) : null
  const maxRequestAttempts = positiveInteger(
    options.maxRequestAttempts ?? initial?.maxRequestAttempts ?? 20,
    "maxRequestAttempts",
  )
  const maxEstimatedCostUsd = positiveFinite(
    options.maxEstimatedCostUsd ?? initial?.maxEstimatedCostUsd ?? 1,
    "maxEstimatedCostUsd",
  )

  if (initial
    && (initial.maxRequestAttempts !== maxRequestAttempts
      || initial.maxEstimatedCostUsd !== maxEstimatedCostUsd)) {
    throw new Error("Research report AI budget snapshot limits do not match configured runtime limits")
  }

  let requestAttempts = initial?.requestAttempts ?? 0
  let estimatedCostUsd = initial?.estimatedCostUsd ?? 0
  let unknownUsageAttempts = initial?.unknownUsageAttempts ?? 0
  let budgetExhausted = initial?.budgetExhausted ?? false
  let budgetReason: ResearchReportBudgetReason | null = initial?.budgetReason ?? null

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
