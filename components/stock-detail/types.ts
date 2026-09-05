import type { AiCouncilHistoryEntry, AiCouncilStockSnapshot } from "@/modules/ai-council/data"
import type { AiCouncilStock } from "@/modules/ai-council/model"
import type { AnalysisLog, Thesis } from "@/modules/research/types"
import type { TimeframeStudy } from "@/modules/research/multi-timeframe"
import type { DailyScanRow, UniverseRow } from "@/modules/signals/scanner/data"
import type { OhlcvBar } from "@/modules/shared/technical/indicators"
import type { FaScreenRow } from "@/modules/research/fa-screen-data"
import type { InsightsRatingRow } from "@/modules/research/insights/data"

export interface StockWatchlistItem {
  ticker: string
  companyName: string
  price: number
  change: number
  changePct: number
  isBookmarked?: boolean
}

export interface StockDetailData {
  ticker: string
  companyName: string
  exchange: string
  sector: string
  rank?: number
  price: number
  change: number
  changePct: number
  refPrice: number
  highPrice: number
  lowPrice: number
  ceilingPrice: number
  floorPrice: number
  volume: number
  marketCapT: number
  pe: number | null
  pb: number | null
  roe: number | null
  eps: number | null
  bars: OhlcvBar[]
  hourlyBars?: OhlcvBar[]
  aiStock?: AiCouncilStock | AiCouncilStockSnapshot
  aiHistory?: AiCouncilHistoryEntry[]
  scan?: DailyScanRow
  thesis?: Thesis
  fa?: FaScreenRow
  universe?: UniverseRow
  studies?: TimeframeStudy[]
  logs?: AnalysisLog[]
  watchlist: StockWatchlistItem[]
  ratingRow?: InsightsRatingRow | null
}
