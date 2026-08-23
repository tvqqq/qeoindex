import { cache } from "react"
import { getResearchData, getResearchTickerData } from "./research-data"
import { getScannerData, getScannerTickerData } from "./scanner-data"
import { fetchDailyMarketHistoryUi, fetchHourlyMarketHistoryUi, fetchLongDailyMarketHistoryUi } from "./market-history"

// React cache() still deduplicates in-flight work within one server request.
// The underlying UI getters now also use Vercel Runtime Cache / optional Redis
// across requests, while operational scanner/signal code keeps separate fresh APIs.

export const getCachedResearchData = cache(getResearchData)
export const getCachedResearchTickerData = cache((ticker: string) => getResearchTickerData(ticker))
export const getCachedScannerData = cache(getScannerData)
export const getCachedScannerTickerData = cache((ticker: string) => getScannerTickerData(ticker))
export const getCachedDailyHistory = cache((symbol: string) => fetchDailyMarketHistoryUi(symbol))
export const getCachedHourlyHistory = cache((symbol: string) => fetchHourlyMarketHistoryUi(symbol))
export const getCachedLongDailyHistory = cache((symbol: string) => fetchLongDailyMarketHistoryUi(symbol))
