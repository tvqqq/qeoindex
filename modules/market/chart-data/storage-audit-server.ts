import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import { createSupabaseColdOhlcvStorage, listVerifiedColdManifests } from "./cold-store"
import type { CanonicalOhlcvBar, SourceTaggedBar } from "./contract"
import { readHotIntradayRange } from "./hot-store"
import { normalizeCanonicalBars } from "./normalize"
import { getCanonicalChartOhlcv } from "./service"
import {
  runChartStorageAudit,
  type ChartStorageAuditRange,
  type ChartStorageAuditRanges,
  type ChartStorageAuditResult,
} from "./storage-audit"

function vietnamDayBounds(epoch: number) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
  const dateKey = formatter.format(new Date(epoch * 1000))
  const from = Math.floor(new Date(`${dateKey}T00:00:00+07:00`).getTime() / 1000)
  return { from, to: from + 86400 - 1 }
}

async function oldestHotEpoch(supabase: SupabaseClient, ticker: string) {
  const { data, error } = await supabase
    .from("chart_ohlcv_intraday")
    .select("bar_time")
    .eq("ticker", ticker)
    .eq("base_resolution", "1m")
    .order("bar_time", { ascending: true })
    .limit(1)
  if (error) throw new Error(`QEO-231 HOT boundary read failed: ${error.message}`)
  const timestamp = data?.[0]?.bar_time ? new Date(String(data[0].bar_time)).getTime() : NaN
  if (!Number.isFinite(timestamp)) throw new Error(`QEO-231 HOT boundary missing for ${ticker}`)
  return Math.floor(timestamp / 1000)
}

async function discoverRanges(supabase: SupabaseClient, ticker: string): Promise<ChartStorageAuditRanges> {
  const oldestHot = await oldestHotEpoch(supabase, ticker)
  const hotDay = vietnamDayBounds(oldestHot)
  const hotBars = await readHotIntradayRange(supabase, ticker, hotDay.from, hotDay.to)
  if (!hotBars.length) throw new Error(`QEO-231 HOT audit session missing for ${ticker}`)

  const manifests = await listVerifiedColdManifests(supabase, {
    ticker,
    baseResolution: "1m",
    limit: 1_000,
  })
  const latestCold = manifests
    .filter((manifest) => manifest.rangeEnd < hotBars[0].time)
    .sort((left, right) => left.rangeEnd - right.rangeEnd)
    .at(-1)
  if (!latestCold) throw new Error(`QEO-231 verified COLD boundary missing for ${ticker}`)

  const cold: ChartStorageAuditRange = {
    kind: "cold",
    from: latestCold.rangeStart,
    to: latestCold.rangeEnd,
  }
  const hot: ChartStorageAuditRange = {
    kind: "hot",
    from: hotBars[0].time,
    to: hotBars.at(-1)!.time,
  }
  if (cold.to >= hot.from) throw new Error(`QEO-231 COLD/HOT boundary overlaps for ${ticker}`)
  if (manifests.some((manifest) => manifest.rangeStart <= hot.to && manifest.rangeEnd >= hot.from)) {
    throw new Error(`QEO-231 verified COLD overlaps HOT audit session for ${ticker}`)
  }

  return {
    cold,
    mixed: { kind: "mixed", from: cold.from, to: hot.to },
    hot,
  }
}

function directBars(coldBars: CanonicalOhlcvBar[], hotBars: CanonicalOhlcvBar[]) {
  const tagged: SourceTaggedBar[] = [
    ...coldBars.map((bar) => ({ source: "cold" as const, bar })),
    ...hotBars.map((bar) => ({ source: "hot" as const, bar })),
  ]
  const normalized = normalizeCanonicalBars(tagged)
  if (normalized.integrityIssues.length) {
    throw new Error("QEO-231 direct durable storage has integrity conflicts")
  }
  return normalized.bars
}

export async function runProductionChartStorageAudit(
  supabase: SupabaseClient,
  ticker: string,
): Promise<ChartStorageAuditResult> {
  const coldStorage = createSupabaseColdOhlcvStorage(supabase)
  const ranges = await discoverRanges(supabase, ticker)
  const auditNow = new Date((ranges.hot.to + 4 * 3600) * 1000)
  const provider = {
    async fetch() {
      throw new Error("QEO-231 audit forbids provider fallback")
    },
  }

  return runChartStorageAudit({ ticker }, {
    discoverRanges: async () => ranges,
    readDirect: async (range) => {
      const [hotBars, cold] = await Promise.all([
        readHotIntradayRange(supabase, ticker, range.from, range.to),
        coldStorage.readIntersectingRange({ ticker, from: range.from, to: range.to }),
      ])
      return directBars(cold.bars, hotBars)
    },
    readCanonical: (range) => getCanonicalChartOhlcv({
      supabase,
      coldStorage,
      provider,
      now: auditNow,
    }, {
      ticker,
      resolution: "1m",
      from: range.from,
      to: range.to,
    }),
  })
}
