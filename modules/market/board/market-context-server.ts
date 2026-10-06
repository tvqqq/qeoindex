import "server-only"

import {
  parseVnindexImpactPayload,
  type MarketBoardContextBootstrap,
  type MarketImpactSnapshot,
} from "@/modules/market/board/market-context-contract"

const INDEX_IMPACT_URL = "https://api.dnse.com.vn/market-api/basket-influence?type=VNINDEX"
const PUBLIC_TIMEOUT_MS = 4_000
async function fetchPublicJson(url: URL | string) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json, text/plain, */*",
      Origin: "https://banggia.dnse.com.vn",
      Referer: "https://banggia.dnse.com.vn/",
      "User-Agent": "Mozilla/5.0 QeoIndex/1.0",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(PUBLIC_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json() as Promise<unknown>
}

export async function fetchVnindexImpactSnapshot(): Promise<MarketImpactSnapshot> {
  const parsed = parseVnindexImpactPayload(await fetchPublicJson(INDEX_IMPACT_URL))
  if (!parsed) throw new Error("VNINDEX basket-influence returned no finite contribution rows")
  return parsed
}

export async function loadMarketBoardContext(now = new Date()): Promise<MarketBoardContextBootstrap> {
  const errors: string[] = []
  let impact: MarketImpactSnapshot | null = null
  try {
    impact = await fetchVnindexImpactSnapshot()
  } catch (error) {
    errors.push(`Index impact: ${error instanceof Error ? error.message : String(error)}`)
  }
  return { generatedAt: now.toISOString(), impact, errors }

}
