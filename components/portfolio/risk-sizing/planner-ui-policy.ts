// UI-first rollout policy: working controls keep their real handlers. Any future
// intentionally unavailable planner action should call this helper instead of
// failing silently or scattering direct window.alert() calls across components.
export function showPlannerUnavailableAlert(featureName: string): void {
  if (typeof window === "undefined") return

  window.alert(`Tính năng "${featureName}" đang được hoàn thiện và chưa khả dụng. Vui lòng thử lại sau khi functional rollout hoàn tất.`)
}
