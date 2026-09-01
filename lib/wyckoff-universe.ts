export interface UniverseStock {
  ticker: string
  rank: number
  marketCapT: number
  exchange: string
}

/**
 * Safety cap only. Runtime membership is loaded from qeo_current_market_universe().
 * This bootstrap snapshot exists for maintenance scripts that cannot use server-only
 * Runtime Cache helpers. It must never be used as the website/EOD membership source.
 */
export const UNIVERSE_DATE = "2026-09-01"
export const UNIVERSE_SIZE = 200

export const CANONICAL_UNIVERSE_TICKERS = [
  "VIC", "VCB", "VHM", "BID", "VGI", "CTG", "TCB", "VPB", "GAS", "HPG",
  "MCH", "MBB", "ACV", "LPB", "HDB", "VPL", "STB", "BSR", "GVR", "ACB",
  "VNM", "FPT", "MWG", "MSN", "DMX", "TCX", "VJC", "VCK", "HVN", "SHB",
  "VRE", "SAB", "SSB", "SSI", "VIB", "MSR", "MSB", "VPX", "BVH", "PLX",
  "BCM", "GEE", "TPB", "POW", "LPS", "NVB", "VIX", "GMD", "GEX", "OCB",
  "EIB", "NVL", "HCM", "REE", "ABB", "FRT", "KBC", "VCI", "GEL", "VND",
  "NAB", "VPI", "PNJ", "SBT", "KDH", "PVS", "VGC", "HAG", "PVD", "MBS",
  "DCM", "DGC", "DXG", "DPM", "HUT", "OIL", "SHS", "IDC", "PDR", "TCH",
  "NLG", "BAF", "VHC", "PVT", "VCG", "CII", "DSE", "CTR", "DGW", "EVF",
  "HAH", "VTP", "KLB", "DIG", "HSG", "ORS", "PC1", "FTS", "PHR", "CEO",
  "BSI", "BVB", "DBC", "VAB", "HNG", "CTD", "HDG", "TVN", "CTS", "PET",
  "NT2", "HHV", "VGT", "VSC", "GEG", "NKG", "PAN", "HHS", "IJC", "ANV",
  "ABW", "DHC", "SZC", "DXS", "DPG", "VDS", "VC3", "TVS", "AGR", "NAF",
  "HDC", "DCL", "AAA", "DDV", "CSV", "ASM", "KHG", "TNG", "TTA", "TCM",
  "SCR", "BVS", "CTF", "AGG", "PVP", "FCN", "AAS", "MZG", "ELC", "VFS",
  "VTZ", "KSB", "VOS", "YEG", "NTL", "LCG", "CSM", "ROS", "HBC", "HHP",
  "HQC", "HPX", "MST", "TIG", "APG", "C69", "DRI", "PVC", "EVG", "EVS",
  "SHN", "POM", "GIL", "TVC", "OGC", "TTF", "LDG", "DLG", "SBS", "IDJ",
  "HII", "CRC", "PSI", "APS", "ASP", "ACC", "NRC", "AAV", "HSL", "HNM",
  "TCO", "TC6", "TDN", "TNI", "MBG", "HID", "ABS", "AAH", "VNE", "AMV",
] as const

export const CANONICAL_UNIVERSE_STOCKS: UniverseStock[] = CANONICAL_UNIVERSE_TICKERS.map((ticker, index) => ({
  ticker,
  rank: index + 1,
  marketCapT: 0,
  exchange: "",
}))
