import type { AnalysisLog, ResearchData } from "@/modules/research/types"

function pendingPlaceholder(index: number): AnalysisLog {
  return {
    id: `pending-placeholder-${index}`,
    notionUrl: "",
    ticker: "",
    analysis: "",
    date: "",
    timeframes: [],
    type: [],
    summary: "",
    probabilities: { bull: null, base: null, bear: null },
    outcome: "Pending",
    actualScenario: "Unresolved",
    errorClass: "",
    lessonLearned: "",
    taBias: "",
    faBias: "",
    driveEvidence: "",
    sourceChat: "",
    updated: "",
  }
}

/**
 * ResearchApp historically derives pending-review metrics from data.logs.
 * Route projections carry only the exact count, so inject tiny in-memory rows
 * rather than fetching full Notion pages solely to preserve that metric.
 */
export function withPendingReviewPlaceholders(data: ResearchData): ResearchData {
  const pending = data.stats?.pendingReviews
  if (pending == null || pending <= 0) return data
  return {
    ...data,
    logs: [...data.logs, ...Array.from({ length: pending }, (_, index) => pendingPlaceholder(index))],
  }
}
