export const SECTOR_ORDER = [
  "Ngân hàng",
  "Chứng khoán",
  "Bất động sản",
  "Tiêu dùng & Bán lẻ",
  "Năng lượng",
  "Điện & Utilities",
  "Công nghiệp & Vật liệu",
  "Hàng không & Du lịch",
  "Công nghệ",
  "Bảo hiểm",
  "Logistics",
] as const

export type MarketSector = (typeof SECTOR_ORDER)[number]

const SECTOR_BY_TICKER: Record<string, MarketSector> = {
  VCB: "Ngân hàng", BID: "Ngân hàng", CTG: "Ngân hàng", TCB: "Ngân hàng", VPB: "Ngân hàng",
  MBB: "Ngân hàng", LPB: "Ngân hàng", STB: "Ngân hàng", HDB: "Ngân hàng", ACB: "Ngân hàng",
  SHB: "Ngân hàng", SSB: "Ngân hàng", MSB: "Ngân hàng", VIB: "Ngân hàng", TPB: "Ngân hàng",
  EIB: "Ngân hàng", OCB: "Ngân hàng",

  TCX: "Chứng khoán", VCK: "Chứng khoán", VPX: "Chứng khoán", SSI: "Chứng khoán",
  HCM: "Chứng khoán", VIX: "Chứng khoán",

  VIC: "Bất động sản", VHM: "Bất động sản", VRE: "Bất động sản", BCM: "Bất động sản",
  NVL: "Bất động sản", KBC: "Bất động sản",

  MCH: "Tiêu dùng & Bán lẻ", VNM: "Tiêu dùng & Bán lẻ", MWG: "Tiêu dùng & Bán lẻ",
  MSN: "Tiêu dùng & Bán lẻ", SAB: "Tiêu dùng & Bán lẻ",

  GAS: "Năng lượng", BSR: "Năng lượng", PLX: "Năng lượng",
  POW: "Điện & Utilities", REE: "Điện & Utilities", PGV: "Điện & Utilities",

  HPG: "Công nghiệp & Vật liệu", GVR: "Công nghiệp & Vật liệu", GEE: "Công nghiệp & Vật liệu",
  GEX: "Công nghiệp & Vật liệu",

  VJC: "Hàng không & Du lịch", HVN: "Hàng không & Du lịch", VPL: "Hàng không & Du lịch",
  FPT: "Công nghệ", BVH: "Bảo hiểm", GMD: "Logistics",
}

export function sectorForTicker(ticker: string): MarketSector {
  return SECTOR_BY_TICKER[ticker.toUpperCase()] ?? "Công nghiệp & Vật liệu"
}
