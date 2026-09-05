export interface CanonicalDailyHotAuthorityRow {
  volume?: unknown
  provider?: unknown
  source_url?: unknown
  provider_detail?: unknown
}

export function isCanonicalDailyHotRowUsable(row: CanonicalDailyHotAuthorityRow) {
  const volume = Number(row.volume)
  if (!Number.isFinite(volume) || volume < 0) return false
  if (volume !== 0) return true

  const provider = String(row.provider || "")
  if (provider === "VCI" || provider === "DNSE") return true

  return provider === "Fallback"
    && String(row.source_url || "") === "internal://stock_orderbook_snapshots"
    && String(row.provider_detail || "").startsWith("Verified final market-close repair")
}
