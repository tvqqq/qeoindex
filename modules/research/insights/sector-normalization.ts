import type {
  InsightsBubbleStock,
  InsightsDashboardData,
  InsightsRatingRow,
  InsightsSectorSummary,
} from "@/modules/research/insights/data"

const TICKER_SECTOR_OVERRIDES: Record<string, string> = {
  YEG: "Dịch vụ công ích",
  TVC: "Chứng khoán",
}

function sectorForTicker(ticker: string, sector: string) {
  return TICKER_SECTOR_OVERRIDES[ticker.toUpperCase()] || sector || "Chưa phân ngành"
}

function average(values: Array<number | null>) {
  const valid = values.filter((value): value is number => value != null && Number.isFinite(value))
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null
}

function dominant(values: Array<string | null>) {
  const counts = new Map<string, number>()
  for (const value of values) {
    if (!value) continue
    counts.set(value, (counts.get(value) || 0) + 1)
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "vi"))[0]?.[0] ?? null
}

function buildSectorSummaries(rows: InsightsRatingRow[]): InsightsSectorSummary[] {
  const groups = new Map<string, InsightsRatingRow[]>()
  for (const row of rows) {
    const sector = sectorForTicker(row.ticker, row.sector)
    groups.set(sector, [...(groups.get(sector) || []), row])
  }

  return [...groups.entries()]
    .map(([sector, stocks]) => ({
      sector,
      stockCount: stocks.length,
      top100Count: stocks.length,
      averagePrice: average(stocks.map((stock) => stock.price)),
      totalMarketCapBillion: stocks.reduce((sum, stock) => sum + (stock.marketCapBillion || 0), 0),
      averageCanslimScore: average(stocks.map((stock) => stock.canslimScore)),
      averageScore4m: average(stocks.map((stock) => stock.score4m)),
      pricePotentialUpCount: stocks.filter((stock) => stock.pricePotential?.startsWith("Tăng")).length,
      averageRsShort: average(stocks.map((stock) => stock.rsShort)),
      averageRsMedium: average(stocks.map((stock) => stock.rsMedium)),
      dominantRrgState: dominant(stocks.map((stock) => stock.sectorRrgState)),
      averageWeeklyChangePercent: average(stocks.map((stock) => stock.weeklyChangePercent)),
      averageMonthlyChangePercent: average(stocks.map((stock) => stock.monthlyChangePercent)),
      averageRatingScore: average(stocks.map((stock) => stock.ratingScore)),
    }))
    .filter((row) => row.stockCount > 0)
    .sort((left, right) => (right.averageRatingScore || 0) - (left.averageRatingScore || 0) || left.sector.localeCompare(right.sector, "vi"))
}

function normalizeRating(row: InsightsRatingRow): InsightsRatingRow {
  const sector = sectorForTicker(row.ticker, row.sector)
  return sector === row.sector ? row : { ...row, sector, industryGroup: sector }
}

function normalizeBubble(row: InsightsBubbleStock): InsightsBubbleStock {
  const sector = sectorForTicker(row.ticker, row.sector)
  return sector === row.sector ? row : { ...row, sector }
}

export function normalizeInsightsDashboardSectors(data: InsightsDashboardData): InsightsDashboardData {
  const ratings = data.ratings.map(normalizeRating)
  const bubbleStocks = data.bubbleStocks.map(normalizeBubble)
  return {
    ...data,
    ratings,
    bubbleStocks,
    sectorSummaries: buildSectorSummaries(ratings),
  }
}
