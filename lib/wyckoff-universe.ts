export interface UniverseStock {
  ticker: string
  rank: number
  marketCapT: number
  exchange: "HOSE"
}

export const UNIVERSE_DATE = "2026-08-13"

// Snapshot of the 50 largest HOSE/VNINDEX stocks by market capitalization.
// This is a fallback/seed only. Notion is the canonical mutable universe.
export const TOP50_HOSE: UniverseStock[] = [
  ["VIC", 1, 1624.3], ["VHM", 2, 599.68], ["VCB", 3, 498.83], ["BID", 4, 284.29],
  ["CTG", 5, 252.43], ["TCB", 6, 210.46], ["VPB", 7, 198.35], ["MBB", 8, 194.53],
  ["HPG", 9, 185.75], ["GAS", 10, 180.01], ["MCH", 11, 178.98], ["LPB", 12, 158.03],
  ["VPL", 13, 148.32], ["STB", 14, 140.64], ["HDB", 15, 132.89], ["BSR", 16, 131.19],
  ["ACB", 17, 130.02], ["VNM", 18, 129.58], ["FPT", 19, 120.24], ["GVR", 20, 119.0],
  ["TCX", 21, 109.01], ["MWG", 22, 104.26], ["MSN", 23, 98.43], ["VJC", 24, 96.52],
  ["HVN", 25, 74.21], ["VCK", 26, 73.9], ["SHB", 27, 62.52], ["SSI", 28, 61.15],
  ["SAB", 29, 57.39], ["VRE", 30, 56.69], ["SSB", 31, 51.6], ["MSB", 32, 50.54],
  ["VIB", 33, 49.87], ["BVH", 34, 49.66], ["VPX", 35, 47.53], ["PLX", 36, 45.68],
  ["GEE", 37, 42.98], ["POW", 38, 41.72], ["TPB", 39, 40.5], ["BCM", 40, 39.95],
  ["HCM", 41, 34.22], ["EIB", 42, 33.53], ["NVL", 43, 33.39], ["VIX", 44, 33.32],
  ["GMD", 45, 32.93], ["GEX", 46, 32.12], ["OCB", 47, 31.85], ["REE", 48, 29.34],
  ["PGV", 49, 27.36], ["KBC", 50, 26.2],
].map(([ticker, rank, marketCapT]) => ({
  ticker: ticker as string,
  rank: rank as number,
  marketCapT: marketCapT as number,
  exchange: "HOSE" as const,
}))
