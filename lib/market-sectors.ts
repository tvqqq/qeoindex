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

export const BOARD_SECTOR_GROUPS = [
  { key: "bank", label: "Ngân hàng", sectors: ["Ngân hàng"] },
  { key: "securities", label: "Chứng khoán", sectors: ["Chứng khoán"] },
  { key: "consumer", label: "Tiêu dùng & Bán lẻ", sectors: ["Tiêu dùng & Bán lẻ"] },
  { key: "real-estate", label: "Bất động sản", sectors: ["Bất động sản"] },
  { key: "industrial-tech", label: "Công nghiệp", sectors: ["Công nghiệp & Vật liệu", "Công nghệ"] },
  { key: "other", label: "Các ngành còn lại", sectors: ["Năng lượng", "Điện & Utilities", "Hàng không & Du lịch", "Bảo hiểm", "Logistics"] },
] as const satisfies ReadonlyArray<{ key: string; label: string; sectors: readonly MarketSector[] }>

export type BoardSectorGroup = (typeof BOARD_SECTOR_GROUPS)[number]

export function boardSectorGroupForSector(sector: string) {
  return BOARD_SECTOR_GROUPS.find((group) => (group.sectors as readonly string[]).includes(sector)) ?? BOARD_SECTOR_GROUPS.at(-1)!
}

const SECTOR_BY_TICKER: Record<string, MarketSector> = {
  VCB: "Ngân hàng", BID: "Ngân hàng", CTG: "Ngân hàng", TCB: "Ngân hàng", VPB: "Ngân hàng",
  MBB: "Ngân hàng", LPB: "Ngân hàng", STB: "Ngân hàng", HDB: "Ngân hàng", ACB: "Ngân hàng",
  SHB: "Ngân hàng", SSB: "Ngân hàng", MSB: "Ngân hàng", VIB: "Ngân hàng", TPB: "Ngân hàng",
  EIB: "Ngân hàng", OCB: "Ngân hàng",

  TCX: "Chứng khoán", VCK: "Chứng khoán", VPX: "Chứng khoán", SSI: "Chứng khoán",
  HCM: "Chứng khoán", VIX: "Chứng khoán",
  VCI: "Chứng khoán", VND: "Chứng khoán", DSE: "Chứng khoán", ORS: "Chứng khoán",
  FTS: "Chứng khoán",

  VIC: "Bất động sản", VHM: "Bất động sản", VRE: "Bất động sản", BCM: "Bất động sản",
  NVL: "Bất động sản", KBC: "Bất động sản",
  KDH: "Bất động sản", VPI: "Bất động sản", CRV: "Bất động sản", SJS: "Bất động sản",
  DXG: "Bất động sản", TAL: "Bất động sản", SIP: "Bất động sản", PDR: "Bất động sản",
  NLG: "Bất động sản", TCH: "Bất động sản", DIG: "Bất động sản",

  MCH: "Tiêu dùng & Bán lẻ", VNM: "Tiêu dùng & Bán lẻ", MWG: "Tiêu dùng & Bán lẻ",
  MSN: "Tiêu dùng & Bán lẻ", SAB: "Tiêu dùng & Bán lẻ",
  FRT: "Tiêu dùng & Bán lẻ", SBT: "Tiêu dùng & Bán lẻ", PNJ: "Tiêu dùng & Bán lẻ",
  KDC: "Tiêu dùng & Bán lẻ", DHG: "Tiêu dùng & Bán lẻ", BAF: "Tiêu dùng & Bán lẻ",
  VHC: "Tiêu dùng & Bán lẻ", HPA: "Tiêu dùng & Bán lẻ", DGW: "Tiêu dùng & Bán lẻ",
  DMX: "Tiêu dùng & Bán lẻ",

  GAS: "Năng lượng", BSR: "Năng lượng", PLX: "Năng lượng",
  PVD: "Năng lượng",
  POW: "Điện & Utilities", REE: "Điện & Utilities", PGV: "Điện & Utilities",
  VSH: "Điện & Utilities", BWE: "Điện & Utilities",

  HPG: "Công nghiệp & Vật liệu", GVR: "Công nghiệp & Vật liệu", GEE: "Công nghiệp & Vật liệu",
  GEX: "Công nghiệp & Vật liệu",
  GEL: "Công nghiệp & Vật liệu", HAG: "Công nghiệp & Vật liệu", VGC: "Công nghiệp & Vật liệu",
  DCM: "Công nghiệp & Vật liệu", DGC: "Công nghiệp & Vật liệu", DPM: "Công nghiệp & Vật liệu",
  VBB: "Ngân hàng", NAB: "Ngân hàng", KLB: "Ngân hàng", EVF: "Ngân hàng",
  VAB: "Ngân hàng", BVB: "Ngân hàng",
  LGC: "Công nghiệp & Vật liệu", BMP: "Công nghiệp & Vật liệu", VCG: "Công nghiệp & Vật liệu",
  CII: "Công nghiệp & Vật liệu", HSG: "Công nghiệp & Vật liệu", PC1: "Công nghiệp & Vật liệu",
  PHR: "Công nghiệp & Vật liệu",

  VJC: "Hàng không & Du lịch", HVN: "Hàng không & Du lịch", VPL: "Hàng không & Du lịch",
  FPT: "Công nghệ", BVH: "Bảo hiểm", GMD: "Logistics",
  CTR: "Công nghệ", PVT: "Logistics", VTP: "Logistics", HAH: "Logistics",
}

export function sectorForTicker(ticker: string): MarketSector {
  return SECTOR_BY_TICKER[ticker.toUpperCase()] ?? "Công nghiệp & Vật liệu"
}
