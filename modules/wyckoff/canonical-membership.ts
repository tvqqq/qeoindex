export interface CanonicalWyckoffMembership {
  ticker: string
  rank: number
}

export interface CandidateWyckoffMembership {
  ticker: string
  rank: number | null | undefined
}

function normalizedTicker(value: string) {
  return value.trim().toUpperCase()
}

export function assertCanonicalWyckoffMembership(
  canonicalRows: CanonicalWyckoffMembership[],
  candidateRows: CandidateWyckoffMembership[],
) {
  const canonical = canonicalRows.map((row) => ({ ticker: normalizedTicker(row.ticker), rank: row.rank }))
  const candidate = candidateRows.map((row) => ({ ticker: normalizedTicker(row.ticker), rank: row.rank }))
  const canonicalMap = new Map(canonical.map((row) => [row.ticker, row.rank] as const))
  const candidateMap = new Map(candidate.map((row) => [row.ticker, row.rank] as const))

  const duplicateCanonical = canonical.length !== canonicalMap.size
  const duplicateCandidate = candidate.length !== candidateMap.size
  const missing = [...canonicalMap.keys()].filter((ticker) => !candidateMap.has(ticker))
  const unexpected = [...candidateMap.keys()].filter((ticker) => !canonicalMap.has(ticker))
  const rankMismatch = [...canonicalMap.entries()].flatMap(([ticker, rank]) => {
    if (!candidateMap.has(ticker) || candidateMap.get(ticker) === rank) return []
    return [`${ticker}:${String(candidateMap.get(ticker))}->${rank}`]
  })

  if (
    canonical.length !== candidate.length
    || duplicateCanonical
    || duplicateCandidate
    || missing.length
    || unexpected.length
    || rankMismatch.length
  ) {
    throw new Error(
      `Canonical Wyckoff membership mismatch: candidate=${candidate.length}/${canonical.length}`
      + `${duplicateCanonical ? "; duplicateCanonical=true" : ""}`
      + `${duplicateCandidate ? "; duplicateCandidate=true" : ""}`
      + `${missing.length ? `; missing=${missing.slice(0, 20).join(",")}` : ""}`
      + `${unexpected.length ? `; unexpected=${unexpected.slice(0, 20).join(",")}` : ""}`
      + `${rankMismatch.length ? `; rankMismatch=${rankMismatch.slice(0, 20).join(",")}` : ""}`,
    )
  }
}
