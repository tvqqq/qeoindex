export const INTERACTIVE_CHART_PROVIDER_BUDGET_MS = 1_500

export interface ProviderBudget {
  remainingMs(): number | null
}

export function createProviderBudget(
  totalBudgetMs?: number,
  nowMs: () => number = Date.now,
): ProviderBudget {
  if (totalBudgetMs == null) {
    return { remainingMs: () => null }
  }
  if (!Number.isFinite(totalBudgetMs) || totalBudgetMs <= 0) {
    throw new Error("Provider budget must be a positive finite number")
  }

  const deadlineMs = nowMs() + Math.floor(totalBudgetMs)
  return {
    remainingMs() {
      return Math.max(0, deadlineMs - nowMs())
    },
  }
}
