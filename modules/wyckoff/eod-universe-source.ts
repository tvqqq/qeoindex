import { selectWyckoffV2Universe, type WyckoffV2UniverseRow } from "./eod-universe.ts"

export async function loadWyckoffV2Universe() {
  const { getCanonicalUniverse } = await import("@/modules/market/universe/index")
  const snapshot = await getCanonicalUniverse()
  const rows: WyckoffV2UniverseRow[] = snapshot.stocks.map((stock) => ({
    ticker: stock.ticker,
    active: true,
    exchange: stock.exchange || "HOSE",
    rank: stock.rank,
    sector: stock.sector || "",
  }))
  if (!rows.length) throw new Error("Canonical Wyckoff universe returned no ticker rows")
  return selectWyckoffV2Universe(rows)
}
