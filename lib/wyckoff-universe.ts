export interface UniverseStock {
  ticker: string
  rank: number
  marketCapT: number
  exchange: "HOSE"
}

export const UNIVERSE_DATE = "2026-08-17"
export const UNIVERSE_SIZE = 100

export const CANONICAL_UNIVERSE_TICKERS = [
  "VIC", "VHM", "VCB", "BID", "CTG", "TCB", "VPB", "MBB", "HPG", "GAS",
  "MCH", "LPB", "VPL", "STB", "HDB", "BSR", "ACB", "VNM", "FPT", "GVR",
  "DMX", "TCX", "MWG", "MSN", "VJC", "HVN", "VCK", "SHB", "SSI", "SAB",
  "VRE", "SSB", "MSB", "VIB", "BVH", "VPX", "PLX", "GEE", "POW", "TPB",
  "BCM", "HCM", "EIB", "NVL", "VIX", "GMD", "GEX", "OCB", "REE", "GEL",
  "PGV", "KBC", "VCI", "VND", "NAB", "FRT", "KDH", "VPI", "SBT", "PNJ",
  "HAG", "VGC", "PVD", "DCM", "DGC", "CRV", "DPM", "KDC", "VBB", "SJS",
  "DXG", "LGC", "TAL", "DHG", "SIP", "BMP", "PDR", "BAF", "NLG", "VCG",
  "VHC", "TCH", "VSH", "CTR", "KLB", "BWE", "DSE", "CII", "EVF", "PVT",
  "VTP", "HPA", "ORS", "DGW", "HAH", "HSG", "PC1", "DIG", "FTS", "PHR"
] as const

export const CANONICAL_UNIVERSE_STOCKS: UniverseStock[] = CANONICAL_UNIVERSE_TICKERS.map((ticker, index) => ({
  ticker,
  rank: index + 1,
  marketCapT: 50,
  exchange: "HOSE" as const,
}))

