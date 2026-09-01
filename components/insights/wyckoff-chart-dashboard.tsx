import type { WyckoffChartStudy } from "@/lib/wyckoff-chart-model"

/** Shared payload types for the active deferred Wyckoff infographic UI. */
export interface WyckoffListItem {
  ticker: string
  rank: number
  sector: string
  price: number | null
  changePct: number | null
  phase: string
  phase1H?: string
  phase1D?: string
  phase1W?: string
  bias: string
  confidence: string
  status: string
  date: string
  latestEvent?: string
}

export interface WyckoffTickerPayload {
  ticker: string
  companyName: string
  exchange: string
  sector?: string
  studies: WyckoffChartStudy[]
  generatedAt: string
}
