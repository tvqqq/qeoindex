export interface UniverseStock {
  ticker: string
  rank: number
  marketCapT: number
  exchange: "HOSE"
}

export const UNIVERSE_DATE = "2026-08-17"
export const UNIVERSE_SIZE = 100

export const CANONICAL_UNIVERSE_TICKERS = [
  "VCB", "BID", "CTG", "TCB", "VPB", "MBB", "LPB", "STB", "HDB", "ACB",
  "SHB", "SSB", "MSB", "VIB", "TPB", "EIB", "OCB", "NAB", "KLB", "VBB",
  "VAB", "BVB", "EVF",
  "TCX", "VCK", "VPX", "SSI", "HCM", "VIX", "VCI", "VND", "DSE", "ORS", "FTS",
  "VIC", "VHM", "VRE", "BCM", "NVL", "KBC", "KDH", "VPI", "CRV", "SJS",
  "DXG", "TAL", "SIP", "PDR", "NLG", "TCH", "DIG",
  "MCH", "VNM", "MWG", "MSN", "SAB", "FRT", "SBT", "PNJ", "KDC", "DHG",
  "BAF", "VHC", "HPA", "DGW",
  "GAS", "BSR", "PLX", "PVD", "POW", "REE", "PGV", "VSH", "BWE",
  "HPG", "GVR", "GEE", "GEX", "GEL", "HAG", "VGC", "DCM", "DGC", "DPM",
  "LGC", "BMP", "VCG", "CII", "HSG", "PC1",
  "VJC", "HVN", "VPL", "FPT", "BVH", "GMD", "CTR", "PVT", "VTP", "HAH"
] as const

export const CANONICAL_UNIVERSE_STOCKS: UniverseStock[] = CANONICAL_UNIVERSE_TICKERS.map((ticker, index) => ({
  ticker,
  rank: index + 1,
  marketCapT: 50,
  exchange: "HOSE" as const,
}))

