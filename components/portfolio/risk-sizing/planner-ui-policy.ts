// Intentionally unused until an unavailable planner control is actually rendered.
// Working controls keep their real handlers; future coming-soon controls call this helper.
export function showPlannerUnavailableAlert(featureName: string): void {
  if (typeof window === "undefined") return

  window.alert(`Tính năng "${featureName}" đang được hoàn thiện và chưa khả dụng. Vui lòng thử lại sau khi functional rollout hoàn tất.`)
}
