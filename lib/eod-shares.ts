import { CANONICAL_UNIVERSE_TICKERS } from "@/lib/wyckoff-universe"

/**
 * EOD Canonical Shares Outstanding for Universe Stocks.
 * Source of Truth: TradingView Scanner & HOSE/HNX Listed Shares.
 */
export const STATIC_SHARES_FALLBACK: Record<string, number> = {
  VIC: 7554899036,
  VHM: 8214820000,
  VCB: 8355680000,
  BID: 6829770000,
  CTG: 5370000000,
  TCB: 7086240000,
  VPB: 7933900000,
  MBB: 10068800000,
  HPG: 8442970000,
  GAS: 2296700000,
  MCH: 716800000,
  LPB: 3375000000,
  VPL: 400000000,
  STB: 1885200000,
  HDB: 2908000000,
  BSR: 3100500000,
  ACB: 4466600000,
  VNM: 2089950000,
  FPT: 1460500000,
  GVR: 4000000000,
  DMX: 500000000,
  TCX: 450000000,
  MWG: 1462000000,
  VJC: 541600000,
  HVN: 2214390000,
  VCK: 350000000,
  SSI: 1964000000,
  SAB: 1282500000,
  MSN: 1534950000,
  DGW: 221161000,
  PHR: 135500000,
}

let cachedSharesMap: Record<string, number> | null = null
let lastFetchedAt = 0

/**
 * Fetches latest EOD shares outstanding for universe stocks from TradingView.
 * Cached in memory for 12 hours (EOD static).
 */
export async function getUniverseSharesOutstanding(): Promise<Record<string, number>> {
  const now = Date.now()
  if (cachedSharesMap && now - lastFetchedAt < 12 * 60 * 60 * 1000) {
    return cachedSharesMap
  }

  try {
    const res = await fetch("https://scanner.tradingview.com/vietnam/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filter: [{ left: "name", operation: "in_range", right: [...CANONICAL_UNIVERSE_TICKERS] }],
        symbols: { tickers: [] },
        columns: ["name", "total_shares_outstanding"],
      }),
      signal: AbortSignal.timeout(4000),
    })

    if (res.ok) {
      const data = await res.json()
      if (Array.isArray(data?.data)) {
        const nextMap: Record<string, number> = { ...STATIC_SHARES_FALLBACK }
        for (const item of data.data) {
          const sym = item?.d?.[0]
          const shares = Number(item?.d?.[1])
          if (sym && Number.isFinite(shares) && shares > 0) {
            nextMap[sym] = Math.round(shares)
          }
        }
        cachedSharesMap = nextMap
        lastFetchedAt = now
        return nextMap
      }
    }
  } catch (err) {
    console.warn("[EOD Shares] Fallback to static universe shares mapping:", err)
  }

  return STATIC_SHARES_FALLBACK
}

/**
 * Calculates accurate Foreign Room percentage against Total Listed/Outstanding Shares.
 */
export function calculateForeignRoomPercent(
  foreignRoom: number | null | undefined,
  symbol: string,
  listedShare?: number | null
): { percent: number | null; totalShares: number | null } {
  if (typeof foreignRoom !== "number" || foreignRoom <= 0) {
    return { percent: foreignRoom === 0 ? 0 : null, totalShares: listedShare ?? null }
  }

  const total = (listedShare && listedShare > 0) ? listedShare : (STATIC_SHARES_FALLBACK[symbol] ?? null)
  if (!total || total <= 0) {
    return { percent: null, totalShares: null }
  }

  const percent = Math.min(100, Math.max(0, (foreignRoom / total) * 100))
  return { percent, totalShares: total }
}
