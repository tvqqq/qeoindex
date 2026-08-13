import "server-only"
import { supabaseAdminRead } from "@/lib/supabase/server"
import type { Database } from "@/lib/supabase/database.types"
import type { DailyScanRow, ScannerData, UniverseRow } from "@/lib/scanner-data"
import type { ScannerBias, ScannerConfidence } from "@/lib/wyckoff-engine"

type UniverseRecord = Database["public"]["Tables"]["stock_universe"]["Row"]
type ScanRecord = Database["public"]["Tables"]["daily_scans"]["Row"]
type HealthRecord = Database["public"]["Tables"]["provider_health"]["Row"]

function numeric(value: number | string | null): number | null {
  if (value == null) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function scanRow(row: ScanRecord): DailyScanRow {
  return {
    id: row.id, ticker: row.ticker, date: row.scan_date, rank: row.rank,
    price: numeric(row.price), changePct: numeric(row.change_pct), volume: numeric(row.volume),
    rsi14: numeric(row.rsi14), macd: numeric(row.macd), macdSignal: numeric(row.macd_signal),
    ma20: numeric(row.ma20), ma50: numeric(row.ma50), ma200: numeric(row.ma200), atr14: numeric(row.atr14), relVolume: numeric(row.rel_volume),
    wyckoffState: row.wyckoff_state, phase: row.phase, taBias: row.ta_bias as ScannerBias, bullProbability: row.bull_probability,
    baseProbability: row.base_probability, bearProbability: row.bear_probability, support: row.support, resistance: row.resistance,
    confirmation: row.confirmation, invalidation: row.invalidation, whatChanged: row.what_changed, confidence: row.confidence as ScannerConfidence,
    provider: row.provider, providerDetail: row.provider_detail, status: row.status,
  }
}

function actualProvider(scans: DailyScanRow[]) {
  const providers = [...new Set(scans.map((scan) => scan.provider).filter(Boolean))]
  if (!providers.length) return "Chưa có dữ liệu"
  if (providers.length > 1) return "Mixed providers"
  return providers[0] === "Fallback" ? "Yahoo fallback" : providers[0]
}

export async function getSupabaseScannerData(): Promise<ScannerData> {
  const [universeRows, scanRows, healthRows] = await Promise.all([
    supabaseAdminRead<UniverseRecord[]>("stock_universe?active=eq.true&order=universe_version.desc,rank.asc&select=*"),
    supabaseAdminRead<ScanRecord[]>("daily_scans?order=scan_date.desc,created_at.desc&select=*"),
    supabaseAdminRead<HealthRecord[]>("provider_health?order=updated_at.desc&select=*"),
  ])
  const universeVersion = universeRows[0]?.universe_version
  if (!universeVersion) throw new Error("Supabase scanner universe is empty")
  const latestScans: Record<string, DailyScanRow> = {}
  for (const row of scanRows) {
    if (!latestScans[row.ticker]) latestScans[row.ticker] = scanRow(row)
  }
  const scans = Object.values(latestScans)
  const health = healthRows.find((row) => row.provider === "DNSE")
  const universe: UniverseRow[] = universeRows.filter((row) => row.universe_version === universeVersion).map((row) => ({
    id: row.id, ticker: row.ticker, exchange: "HOSE", rank: row.rank, marketCapT: numeric(row.market_cap_t) ?? 0,
    active: row.active, providerStatus: latestScans[row.ticker]?.provider ?? "Pending", lastScan: latestScans[row.ticker]?.date ?? "", sector: row.sector ?? "",
  }))
  return {
    source: "supabase", operationalBackend: "supabase", universeDate: universeVersion, generatedAt: new Date().toISOString(), universe, latestScans,
    providerHealth: {
      configured: true,
      provider: "DNSE",
      status: health?.status ?? (scans.length ? "unknown" : "pending"),
      currentProvider: actualProvider(scans),
      message: health?.last_detail ?? (scans.length ? "Provider provenance lấy từ Daily scan gần nhất." : "Chưa có Daily scan trong Supabase."),
      lastSuccessAt: health?.last_success_at ?? "",
      lastFailureAt: health?.last_failure_at ?? "",
    },
  }
}
