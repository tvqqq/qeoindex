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

export function selectWyckoffV2Universe(_rows: WyckoffV2UniverseRow[]): WyckoffV2UniverseSelection {
  throw new Error("Wyckoff v2 universe selection is not implemented")
}
