import type { SupabaseClient } from "@supabase/supabase-js"

const DAILY_PROVENANCE_IDENTITY_VERSION = 1
const DAILY_FACT_UPSERT_CHUNK_SIZE = 500

export interface PersistedDailyOhlcvRow {
  ticker: string
  timeframe: "1D"
  bar_time: string
  open: number
  high: number
  low: number
  close: number
  volume: number
  provider: string
  provider_detail: string
  source_url: string
  fetched_at: string
}

type ResolvedDailyProvenance = {
  id?: unknown
  identity_version?: unknown
  provider?: unknown
  provider_detail?: unknown
  source_url?: unknown
}

function provenanceIdentityKey(row: Pick<PersistedDailyOhlcvRow, "provider" | "provider_detail" | "source_url">) {
  return JSON.stringify([1, row.provider, row.provider_detail, row.source_url])
}

export function isDailyProvenanceCompatibilityUnavailable(message: string) {
  return /market_ohlcv_history_compat.*(?:does not exist|not found)|could not find the table.*market_ohlcv_history_compat|schema cache/i.test(message)
}

export function assertDailyProvenanceConsistent(rows: Array<Record<string, unknown>>, context: string) {
  const inconsistent = rows.find((row) => row.provenance_consistent === false)
  if (!inconsistent) return
  const ticker = String(inconsistent.ticker || "unknown")
  const barTime = String(inconsistent.bar_time || "unknown")
  throw new Error(`${context} failed Daily provenance consistency for ${ticker} at ${barTime}`)
}

export async function persistDailyOhlcvRows(
  supabase: SupabaseClient,
  rows: PersistedDailyOhlcvRow[],
): Promise<void> {
  if (!rows.length) return

  const identities = new Map<string, { identity_version: 1; provider: string; provider_detail: string; source_url: string }>()
  for (const row of rows) {
    const key = JSON.stringify([1, row.provider, row.provider_detail, row.source_url])
    if (!identities.has(key)) {
      identities.set(key, {
        identity_version: DAILY_PROVENANCE_IDENTITY_VERSION,
        provider: row.provider,
        provider_detail: row.provider_detail,
        source_url: row.source_url,
      })
    }
  }

  const provenanceUpsert = await supabase
    .from("market_ohlcv_provenance")
    .upsert([...identities.values()], {
      onConflict: "identity_version,provider,provider_detail,source_url",
    })
    .select("id,identity_version,provider,provider_detail,source_url")

  if (provenanceUpsert.error) {
    throw new Error(`Daily provenance resolve failed: ${provenanceUpsert.error.message}`)
  }

  const resolved = new Map<string, number>()
  for (const raw of (provenanceUpsert.data || []) as ResolvedDailyProvenance[]) {
    const id = Number(raw.id)
    const identityVersion = Number(raw.identity_version)
    const provider = String(raw.provider ?? "")
    const providerDetail = String(raw.provider_detail ?? "")
    const sourceUrl = String(raw.source_url ?? "")
    if (!Number.isSafeInteger(id) || id <= 0 || identityVersion !== DAILY_PROVENANCE_IDENTITY_VERSION) continue
    resolved.set(provenanceIdentityKey({ provider, provider_detail: providerDetail, source_url: sourceUrl }), id)
  }

  if (resolved.size !== identities.size) {
    throw new Error(`Daily provenance resolve incomplete: ${resolved.size}/${identities.size}`)
  }

  const compactFacts = rows.map((row) => {
    const provenanceId = resolved.get(provenanceIdentityKey(row))
    if (!provenanceId) throw new Error(`Daily provenance id missing for ${row.ticker} at ${row.bar_time}`)
    const { provider_detail: _providerDetail, source_url: _sourceUrl, ...fact } = row
    return { ...fact, provenance_id: provenanceId }
  })

  for (let offset = 0; offset < compactFacts.length; offset += DAILY_FACT_UPSERT_CHUNK_SIZE) {
    const chunk = compactFacts.slice(offset, offset + DAILY_FACT_UPSERT_CHUNK_SIZE)
    if (!chunk.length) continue
    const { error } = await supabase
      .from("market_ohlcv_history")
      .upsert(chunk, { onConflict: "ticker,timeframe,bar_time" })
    if (error) throw new Error(`Daily OHLCV provenance upsert failed: ${error.message}`)
  }
}
