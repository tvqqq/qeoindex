export interface Qeo105UniverseDiff {
  added: string[]
  removed: string[]
  unchanged: string[]
}

function normalizeTicker(value: string) {
  const ticker = String(value || "").trim().toUpperCase()
  if (!/^[A-Z0-9]{2,12}$/.test(ticker)) throw new Error(`Invalid universe ticker: ${value}`)
  return ticker
}

function normalizedSet(values: string[]) {
  const set = new Set<string>()
  for (const value of values) set.add(normalizeTicker(value))
  return set
}

export function diffUniverseTickers(previousTickers: string[], nextTickers: string[]): Qeo105UniverseDiff {
  const previous = normalizedSet(previousTickers)
  const next = normalizedSet(nextTickers)
  return {
    added: [...next].filter((ticker) => !previous.has(ticker)).sort(),
    removed: [...previous].filter((ticker) => !next.has(ticker)).sort(),
    unchanged: [...next].filter((ticker) => previous.has(ticker)).sort(),
  }
}
