import type { SupabaseClient } from "@supabase/supabase-js"

export interface WyckoffCompanyMetadata {
  companyName: string
  sector: string
  exchange: string | null
}

type RatingMetadataRow = {
  ticker: string
  company_name: string | null
  sector: string | null
  exchange: string | null
}

/**
 * Reads the latest published company labels used by Insights without pulling the
 * full rating payload. Failure is intentionally non-fatal: Wyckoff remains
 * usable with ticker/sector labels from its canonical universe membership.
 */
export async function getWyckoffCompanyMetadata(
  supabase: SupabaseClient,
  tickers: string[],
): Promise<Map<string, WyckoffCompanyMetadata>> {
  const uniqueTickers = [...new Set(tickers.map((ticker) => ticker.trim().toUpperCase()).filter(Boolean))]
  if (!uniqueTickers.length) return new Map()

  const { data: latest, error: latestError } = await supabase
    .from("insights_stock_ratings")
    .select("as_of_date")
    .eq("is_published", true)
    .eq("source", "kfsp")
    .order("as_of_date", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (latestError || !latest?.as_of_date) return new Map()

  const { data, error } = await supabase
    .from("insights_stock_ratings")
    .select("ticker,company_name,sector,exchange")
    .eq("is_published", true)
    .eq("source", "kfsp")
    .eq("as_of_date", latest.as_of_date)
    .in("ticker", uniqueTickers)

  if (error || !data) return new Map()

  return new Map((data as RatingMetadataRow[]).map((row) => [
    row.ticker,
    {
      companyName: row.company_name?.trim() || row.ticker,
      sector: row.sector?.trim() || "",
      exchange: row.exchange?.trim() || null,
    },
  ]))
}
