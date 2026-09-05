export type ResearchReportDetailTab = "pdf" | "analysis" | "chat"

export interface CitationNavigationState {
  activeTab: ResearchReportDetailTab
  requestedPage: number | null
}

export function nextCitationNavigationState(
  current: CitationNavigationState,
  page: number,
): CitationNavigationState {
  if (!Number.isInteger(page) || page < 1) {
    throw new Error("Invalid citation page")
  }

  return {
    ...current,
    activeTab: "pdf",
    requestedPage: page,
  }
}
