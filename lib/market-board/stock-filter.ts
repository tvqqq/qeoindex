import { BOARD_SECTOR_GROUPS, boardSectorGroupForSector } from "../market-sectors.ts"

export const BOARD_EXCHANGES = ["HOSE", "HNX", "UPCOM"] as const

export type BoardExchange = (typeof BOARD_EXCHANGES)[number]

const LOCKED_SECTOR_GROUP_KEYS = new Set(["bank", "securities"])

export interface StockFilterCriteriaV1 {
  version: 1
  exchanges: BoardExchange[]
  minPriceVnd: number | null
  // Backward-compatible persisted key: minimum 50-session average volume in shares/session.
  minVolumeShares: number | null
  sectors: string[]
  updatedAt: string
}

export interface FilterableBoardStock {
  ticker: string
  exchange: string
  kfspSector: string
  lastClose?: number | null
  averageVolume50d?: number | null
}

export interface FilterQuote {
  price?: number | null
  volume?: number | null
}

export interface StockFilterDailyCacheV1 {
  version: 1
  userId: string
  vietnamDate: string
  universeRunId: string
  filterHash: string
  tickers: string[]
  resolvedAt: string
}

export interface DailyFilterCacheExpectation {
  userId: string
  vietnamDate: string
  universeRunId: string
  filterHash: string
  universeSymbols: readonly string[]
}

export interface FilterSectorColumn {
  key: string
  label: string
  sectors: string[]
  locked: boolean
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function normalizedSectors(values: readonly string[]) {
  return [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "vi"))
}

function normalizePositiveNumber(value: unknown) {
  if (value == null || value === "") return null
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : null
}

function normalizeUpdatedAt(value: unknown, nowIso?: string) {
  if (nowIso) return nowIso
  if (typeof value === "string" && value.trim()) return value
  return new Date().toISOString()
}

export function groupFilterSectorsByBoardColumn(
  availableSectors: readonly string[],
): FilterSectorColumn[] {
  const sectors = normalizedSectors(availableSectors)
  return BOARD_SECTOR_GROUPS.map((group) => ({
    key: group.key,
    label: group.label,
    sectors: sectors.filter((sector) => boardSectorGroupForSector(sector).key === group.key),
    locked: LOCKED_SECTOR_GROUP_KEYS.has(group.key),
  }))
}

export function isLockedFilterSector(sector: string) {
  return LOCKED_SECTOR_GROUP_KEYS.has(boardSectorGroupForSector(sector).key)
}

export function hasRequiredFilterSectorSelections(
  selected: ReadonlySet<string>,
  availableSectors: readonly string[],
) {
  for (const group of groupFilterSectorsByBoardColumn(availableSectors)) {
    if (group.sectors.length === 0) continue
    const selectedInGroup = group.sectors.filter((sector) => selected.has(sector))
    if (selectedInGroup.length === 0) return false
    if (group.locked && selectedInGroup.length !== group.sectors.length) return false
  }
  return true
}

export function canUnselectFilterSector(
  selected: ReadonlySet<string>,
  sector: string,
  availableSectors: readonly string[],
) {
  if (!selected.has(sector)) return true
  if (isLockedFilterSector(sector)) return false

  const groupKey = boardSectorGroupForSector(sector).key
  const group = groupFilterSectorsByBoardColumn(availableSectors)
    .find((item) => item.key === groupKey)
  if (!group) return false

  return group.sectors.filter((candidate) => selected.has(candidate)).length > 1
}

export function defaultStockFilterCriteria(
  availableSectors: readonly string[],
  nowIso?: string,
): StockFilterCriteriaV1 {
  return {
    version: 1,
    exchanges: [...BOARD_EXCHANGES],
    minPriceVnd: null,
    minVolumeShares: null,
    sectors: normalizedSectors(availableSectors),
    updatedAt: normalizeUpdatedAt(undefined, nowIso),
  }
}

export function normalizeStockFilterCriteria(
  input: unknown,
  availableSectors: readonly string[],
  nowIso?: string,
): StockFilterCriteriaV1 | null {
  if (!isPlainObject(input)) return null

  const supportedExchangeSet = new Set<string>(BOARD_EXCHANGES)
  const requestedExchanges = Array.isArray(input.exchanges) ? input.exchanges : []
  const exchangeSet = new Set(
    requestedExchanges
      .map((value) => String(value ?? "").trim().toUpperCase())
      .filter((value) => supportedExchangeSet.has(value)),
  )
  const exchanges = BOARD_EXCHANGES.filter((exchange) => exchangeSet.has(exchange))
  if (exchanges.length === 0) return null

  const availableSectorList = normalizedSectors(availableSectors)
  const availableSectorSet = new Set(availableSectorList)
  const requestedSectors = Array.isArray(input.sectors) ? input.sectors : []
  const sectorSet = new Set(
    requestedSectors
      .map((value) => String(value ?? "").trim())
      .filter((value) => availableSectorSet.has(value)),
  )
  const sectors = availableSectorList.filter((sector) => sectorSet.has(sector))
  if (sectors.length === 0) return null

  return {
    version: 1,
    exchanges,
    minPriceVnd: normalizePositiveNumber(input.minPriceVnd),
    minVolumeShares: normalizePositiveNumber(input.minVolumeShares),
    sectors,
    updatedAt: normalizeUpdatedAt(input.updatedAt, nowIso),
  }
}

function boardPriceToVnd(value: unknown) {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) return null
  // Board quotes are normally normalized to thousands of VND (e.g. 66.1 = 66,100 VND).
  // Keep compatibility with any already-VND snapshot by not multiplying values >= 1,000.
  return number >= 1_000 ? number : number * 1_000
}

export function filterBoardTickers(
  stocks: readonly FilterableBoardStock[],
  quotes: Readonly<Record<string, FilterQuote | undefined>>,
  criteria: StockFilterCriteriaV1,
) {
  const exchanges = new Set(criteria.exchanges)
  const sectors = new Set(criteria.sectors)

  return stocks
    .filter((stock) => {
      if (!exchanges.has(String(stock.exchange ?? "").toUpperCase() as BoardExchange)) return false
      if (!sectors.has(String(stock.kfspSector ?? "").trim())) return false

      if (criteria.minPriceVnd != null) {
        const priceVnd = boardPriceToVnd(quotes[stock.ticker]?.price ?? stock.lastClose)
        if (priceVnd == null || priceVnd <= criteria.minPriceVnd) return false
      }

      if (criteria.minVolumeShares != null) {
        const averageVolume50d = Number(stock.averageVolume50d)
        if (!Number.isFinite(averageVolume50d) || averageVolume50d <= criteria.minVolumeShares) return false
      }

      return true
    })
    .map((stock) => stock.ticker)
}

function stableCriteriaPayload(criteria: StockFilterCriteriaV1) {
  return JSON.stringify({
    version: 1,
    liquidityBasis: "averageVolume50d",
    exchanges: [...criteria.exchanges].sort(),
    minPriceVnd: criteria.minPriceVnd,
    minVolumeShares: criteria.minVolumeShares,
    sectors: [...criteria.sectors].sort((a, b) => a.localeCompare(b, "vi")),
  })
}

export function stockFilterHash(criteria: StockFilterCriteriaV1) {
  const input = stableCriteriaPayload(criteria)
  let hash = 0x811c9dc5
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, "0")
}

export function isValidDailyFilterCache(
  value: unknown,
  expected: DailyFilterCacheExpectation,
): value is StockFilterDailyCacheV1 {
  if (!isPlainObject(value) || value.version !== 1) return false
  if (value.userId !== expected.userId) return false
  if (value.vietnamDate !== expected.vietnamDate) return false
  if (value.universeRunId !== expected.universeRunId) return false
  if (value.filterHash !== expected.filterHash) return false
  if (typeof value.resolvedAt !== "string" || !value.resolvedAt) return false
  if (!Array.isArray(value.tickers)) return false

  const universe = new Set(expected.universeSymbols)
  const tickers = value.tickers.map((ticker) => String(ticker ?? "").toUpperCase())
  if (new Set(tickers).size !== tickers.length) return false
  return tickers.every((ticker) => universe.has(ticker))
}

export function readStockFilterFromSettings(
  settings: unknown,
  availableSectors: readonly string[],
) {
  if (!isPlainObject(settings)) return null
  const marketBoard = settings.marketBoard
  if (!isPlainObject(marketBoard)) return null
  const criteria = normalizeStockFilterCriteria(marketBoard.stockFilter, availableSectors)
  if (!criteria) return null
  return hasRequiredFilterSectorSelections(new Set(criteria.sectors), availableSectors) ? criteria : null
}

export function mergeStockFilterIntoSettings(
  settings: unknown,
  criteria: StockFilterCriteriaV1,
): Record<string, unknown> {
  const current = isPlainObject(settings) ? settings : {}
  const marketBoard = isPlainObject(current.marketBoard) ? current.marketBoard : {}
  return {
    ...current,
    marketBoard: {
      ...marketBoard,
      stockFilter: criteria,
    },
  }
}
