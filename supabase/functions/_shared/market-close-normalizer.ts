import { normalizeSectorBreadthPayload } from "./sector-breadth-normalizer.ts"
import { parseVerifiedMarketClosePayloads as parseBaseVerifiedMarketClosePayloads } from "./market-close-normalizer-base.ts"

export * from "./market-close-normalizer-base.ts"

/**
 * Compatibility wrapper around the canonical market-close normalizer.
 * KFSP has emitted sector breadth in both row-oriented and column-oriented shapes.
 * Normalize only that transport shape here, then let the canonical parser and
 * existing fail-closed validation own all semantic checks.
 */
export function parseVerifiedMarketClosePayloads(
  params: Parameters<typeof parseBaseVerifiedMarketClosePayloads>[0],
): ReturnType<typeof parseBaseVerifiedMarketClosePayloads> {
  const normalizedBreadth = normalizeSectorBreadthPayload(params.sectorBreadthPayload)
  const sectorBreadthPayload = normalizedBreadth.map((row) => ({
    nganh: row.name,
    count_advances: row.advances,
    count_declines: row.declines,
    count_nochange: row.unchanged,
  }))

  return parseBaseVerifiedMarketClosePayloads({
    ...params,
    sectorBreadthPayload,
  })
}
