export interface WyckoffV2UniverseRow {
  ticker: string
  active: boolean
  exchange: string
  rank: number | null
  sector: string
}

export interface WyckoffV2UniverseSelection {
  stocks: WyckoffV2UniverseRow[]
  warnings: string[]
}

const MAX_UNIVERSE_SIZE = 200
const SUPPORTED_EXCHANGES = new Set(["HOSE", "HNX", "UPCOM"])

type ClassifiedRow = WyckoffV2UniverseRow & { rankValid: boolean }

function normalizedRow(row: WyckoffV2UniverseRow): WyckoffV2UniverseRow {
  return {
    ...row,
    ticker: String(row.ticker || "").trim().toUpperCase(),
    exchange: String(row.exchange || "").trim().toUpperCase(),
    sector: String(row.sector || "").trim(),
    rank: row.rank == null ? null : Number(row.rank),
    active: row.active === true,
  }
}

function rankIsInContract(rank: number | null) {
  return rank !== null && Number.isInteger(rank) && rank >= 1 && rank <= MAX_UNIVERSE_SIZE
}

function anomalyComparator(a: ClassifiedRow, b: ClassifiedRow) {
  const aHasRank = a.rank !== null && Number.isFinite(a.rank)
  const bHasRank = b.rank !== null && Number.isFinite(b.rank)
  if (aHasRank && bHasRank && a.rank !== b.rank) return (a.rank as number) - (b.rank as number)
  if (aHasRank !== bHasRank) return aHasRank ? -1 : 1
  return a.ticker.localeCompare(b.ticker)
}

export function selectWyckoffV2Universe(rows: WyckoffV2UniverseRow[]): WyckoffV2UniverseSelection {
  if (!Array.isArray(rows)) throw new Error("Universe query unavailable")

  const active = rows.map(normalizedRow).filter((row) => row.active)
  if (!active.length) throw new Error("Universe has no active tickers")

  const tickerSeen = new Set<string>()
  for (const row of active) {
    if (!/^[A-Z0-9]{2,12}$/.test(row.ticker)) throw new Error(`Invalid ticker symbol: ${row.ticker || "<empty>"}`)
    if (!SUPPORTED_EXCHANGES.has(row.exchange)) throw new Error(`Unsupported exchange for ${row.ticker}: ${row.exchange || "<empty>"}`)
    if (tickerSeen.has(row.ticker)) throw new Error(`Duplicate ticker symbol: ${row.ticker}`)
    tickerSeen.add(row.ticker)
  }

  const rankCandidates = [...active].sort((a, b) => {
    const aValid = rankIsInContract(a.rank)
    const bValid = rankIsInContract(b.rank)
    if (aValid !== bValid) return aValid ? -1 : 1
    if (aValid && bValid && a.rank !== b.rank) return (a.rank as number) - (b.rank as number)
    return a.ticker.localeCompare(b.ticker)
  })

  const usedRanks = new Set<number>()
  const classified: ClassifiedRow[] = rankCandidates.map((row) => {
    const rankValid = rankIsInContract(row.rank) && !usedRanks.has(row.rank as number)
    if (rankValid) usedRanks.add(row.rank as number)
    return { ...row, rankValid }
  })

  const warnings: string[] = []
  const duplicateGroups = new Map<number, string[]>()
  for (const row of active) {
    if (rankIsInContract(row.rank)) {
      const group = duplicateGroups.get(row.rank as number) ?? []
      group.push(row.ticker)
      duplicateGroups.set(row.rank as number, group)
    } else if (row.rank == null) {
      warnings.push(`${row.ticker}: missing Rank; moved to anomaly tail`)
    } else if (!Number.isInteger(row.rank)) {
      warnings.push(`${row.ticker}: non-integer Rank ${row.rank}; moved to anomaly tail`)
    } else {
      warnings.push(`${row.ticker}: out-of-range Rank ${row.rank}; moved to anomaly tail`)
    }
  }
  for (const [rank, tickers] of [...duplicateGroups.entries()].sort((a, b) => a[0] - b[0])) {
    if (tickers.length > 1) warnings.push(`duplicate Rank ${rank}: ${[...tickers].sort().join(", ")}; later duplicate(s) moved to anomaly tail`)
  }
  if (active.length > MAX_UNIVERSE_SIZE) warnings.push(`Universe has ${active.length} active tickers; capped at ${MAX_UNIVERSE_SIZE}`)

  const validRows = classified
    .filter((row) => row.rankValid)
    .sort((a, b) => (a.rank as number) - (b.rank as number) || a.ticker.localeCompare(b.ticker))
  const anomalyRows = classified.filter((row) => !row.rankValid).sort(anomalyComparator)
  const stocks = [...validRows, ...anomalyRows]
    .slice(0, MAX_UNIVERSE_SIZE)
    .map(({ rankValid: _rankValid, ...row }) => row)

  if (!stocks.length || new Set(stocks.map((row) => row.ticker)).size !== stocks.length) {
    throw new Error("Unable to deterministically select canonical universe")
  }

  return { stocks, warnings }
}
