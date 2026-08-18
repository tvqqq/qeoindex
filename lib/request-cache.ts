import { cache } from "react"
import { getResearchData } from "./research-data"
import { getScannerData } from "./scanner-data"
import { fetchDailyMarketHistory, fetchHourlyMarketHistory } from "./market-history"

// React cache() memoizes the return value per request.
// Multiple async server components calling these with the same args
// share a single in-flight Promise — no extra network requests.

export const getCachedResearchData = cache(getResearchData)
export const getCachedScannerData = cache(getScannerData)
export const getCachedDailyHistory = cache((symbol: string) => fetchDailyMarketHistory(symbol))
export const getCachedHourlyHistory = cache((symbol: string) => fetchHourlyMarketHistory(symbol))
