import "@/components/insights/wyckoff-chart-dashboard"

declare module "@/components/insights/wyckoff-chart-dashboard" {
  interface WyckoffListItem {
    latestEvent?: string
  }
}
