import "server-only"

import { getCanonicalUniverse } from "@/lib/market-universe"
import { loadAdminSettingsSnapshot } from "@/lib/admin/settings"

function nextMonthlyRefresh(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", hourCycle: "h23",
  }).formatToParts(now).filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)])) as Record<string, number>

  let year = parts.year
  let month = parts.month
  const beforeCurrentRun = parts.day === 1 && (parts.hour < 7 || (parts.hour === 7 && parts.minute < 10))
  if (!beforeCurrentRun) {
    month += 1
    if (month === 13) { month = 1; year += 1 }
  }
  // Vietnam is UTC+7 year-round: 07:10 ICT = 00:10 UTC.
  return new Date(Date.UTC(year, month - 1, 1, 0, 10, 0)).toISOString()
}

export async function loadAdminUniverseView() {
  const [universe, settings] = await Promise.all([getCanonicalUniverse(), loadAdminSettingsSnapshot()])
  const minMarketCapBillion = Number(settings.byKey["market.universe_min_market_cap_billion"]?.value ?? 10)
  const minAverageVolume50d = Number(settings.byKey["market.universe_min_avg_volume_50d"]?.value ?? 250_000)
  const filterSettings = settings.settings.filter((setting) =>
    setting.key === "market.universe_min_market_cap_billion" || setting.key === "market.universe_min_avg_volume_50d",
  )

  return {
    universe,
    filterSettings,
    nextConfiguredFilters: { minMarketCapBillion, minAverageVolume50d },
    nextUpdateAt: nextMonthlyRefresh(),
    detailCompleteCount: universe.stocks.filter((stock) => stock.detailComplete).length,
    officialLogoCount: universe.stocks.filter((stock) => stock.logoKind === "official").length,
    generatedFallbackLogoCount: universe.stocks.filter((stock) => stock.logoKind === "generated_fallback").length,
  }
}
