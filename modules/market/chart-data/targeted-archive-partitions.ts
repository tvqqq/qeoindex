import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import type { HotArchivePartition } from "./hot-store"

const DISCOVERY_PAGE_SIZE = 500
const DISCOVERY_MAX_PAGES = 24

function vietnamDateKey(epochSeconds: number) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(epochSeconds * 1000))
}

function partitionForTicker(ticker: string, epochSeconds: number): HotArchivePartition {
  const tradingDate = vietnamDateKey(epochSeconds)
  const from = Math.floor(new Date(`${tradingDate}T00:00:00+07:00`).getTime() / 1000)
  return { ticker, tradingDate, from, toExclusive: from + 86_400 }
}

/**
 * Bounded recovery-only discovery for one ticker. This narrows candidate
 * selection only; archive/prune authority still belongs to the canonical
 * lifecycle retention, content-identity, checksum, and readback proofs.
 */
export async function listExpiredHotPartitionsForTicker(
  supabase: SupabaseClient,
  input: { ticker: string; cutoff: number; maxPartitions?: number },
): Promise<HotArchivePartition[]> {
  const ticker = input.ticker.trim().toUpperCase()
  if (!/^[A-Z0-9]{2,12}$/.test(ticker)) throw new Error("Invalid targeted chart archive ticker")

  const maxPartitions = Math.max(1, Math.min(48, Math.floor(input.maxPartitions ?? 12)))
  const unique = new Map<string, HotArchivePartition>()

  for (let page = 0; page < DISCOVERY_MAX_PAGES; page += 1) {
    const offset = page * DISCOVERY_PAGE_SIZE
    const { data, error } = await supabase.from("chart_ohlcv_intraday").select("ticker,bar_time")
      .eq("base_resolution", "1m").eq("ticker", ticker)
      .lt("bar_time", new Date(input.cutoff * 1000).toISOString())
      .order("bar_time", { ascending: true })
      .range(offset, offset + DISCOVERY_PAGE_SIZE - 1)
    if (error) throw new Error(`Targeted chart hot archive discovery failed: ${error.message}`)

    for (const raw of (data || []) as Array<Record<string, unknown>>) {
      const timestamp = raw.bar_time ? new Date(String(raw.bar_time)).getTime() : NaN
      if (!Number.isFinite(timestamp)) continue
      const partition = partitionForTicker(ticker, Math.floor(timestamp / 1000))
      if (!unique.has(partition.tradingDate)) unique.set(partition.tradingDate, partition)
      if (unique.size >= maxPartitions) return [...unique.values()]
    }

    if ((data || []).length < DISCOVERY_PAGE_SIZE) return [...unique.values()]
  }

  throw new Error(`Targeted chart hot archive discovery reached its ${DISCOVERY_MAX_PAGES}-page bound`)
}
