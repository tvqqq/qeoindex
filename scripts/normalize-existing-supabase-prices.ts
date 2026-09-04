import { createClient } from "@supabase/supabase-js"
import { CANONICAL_UNIVERSE_TICKERS } from "../modules/wyckoff/universe.ts"

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "https://glwhhrmejlonhyorvtzm.supabase.co"
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""

if (!SUPABASE_KEY) {
  console.error("Missing SUPABASE_SERVICE_ROLE_KEY")
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

function normalizePrice(price: number | null | undefined): number | null {
  if (price == null || !Number.isFinite(price) || price <= 0) return null
  const normalized = price >= 500 ? price / 1000 : price
  return Math.round(normalized * 100) / 100
}

async function run() {
  console.log("Fetching all existing rows from Supabase stock_orderbook_snapshots...")
  const { data, error } = await supabase.from("stock_orderbook_snapshots").select("*")

  if (error || !data) {
    console.error("Failed to query:", error)
    return
  }

  console.log(`Found ${data.length} rows in database. Normalizing all prices to kilo format (e.g. 21.85)...`)

  const canonicalSet = new Set(CANONICAL_UNIVERSE_TICKERS.map((t) => t.toUpperCase()))
  const nonCanonicalSymbols: string[] = []
  const toUpsert: any[] = []

  for (const row of data) {
    const symbol = String(row.symbol || "").toUpperCase()
    if (!canonicalSet.has(symbol)) {
      nonCanonicalSymbols.push(symbol)
    }

    const ref = normalizePrice(row.reference_price)
    const ceil = normalizePrice(row.ceiling_price)
    const floor = normalizePrice(row.floor_price)
    const last = normalizePrice(row.latest_price)

    const intraday1m = Array.isArray(row.intraday_1m)
      ? row.intraday_1m.map((b: any) => ({
          time: Number(b.time || 0),
          open: normalizePrice(b.open) ?? 0,
          close: normalizePrice(b.close) ?? 0,
        })).filter((b: any) => b.close > 0)
      : []

    const trades = Array.isArray(row.trades)
      ? row.trades.map((t: any) => ({
          ...t,
          price: normalizePrice(t.price) ?? 0,
        })).filter((t: any) => t.price > 0)
      : []

    const latestQuote = typeof row.latest_quote === "object" && row.latest_quote !== null
      ? {
          ...row.latest_quote,
          reference: normalizePrice(row.latest_quote.reference) ?? ref,
          ceiling: normalizePrice(row.latest_quote.ceiling) ?? ceil,
          floor: normalizePrice(row.latest_quote.floor) ?? floor,
          matchPrice: normalizePrice(row.latest_quote.matchPrice) ?? last,
        }
      : {}

    toUpsert.push({
      ...row,
      reference_price: ref,
      ceiling_price: ceil,
      floor_price: floor,
      latest_price: last,
      intraday_1m: intraday1m,
      trades: trades,
      latest_quote: latestQuote,
      updated_at: new Date().toISOString(),
    })
  }

  // Delete non-canonical leftover symbols if any
  if (nonCanonicalSymbols.length > 0) {
    console.log(`Deleting ${nonCanonicalSymbols.length} non-canonical leftover symbols:`, nonCanonicalSymbols.join(", "))
    await supabase.from("stock_orderbook_snapshots").delete().in("symbol", nonCanonicalSymbols)
  }

  // Upsert canonical normalized rows
  console.log(`Upserting ${toUpsert.length} clean normalized rows...`)
  const BATCH_SIZE = 25
  for (let i = 0; i < toUpsert.length; i += BATCH_SIZE) {
    const chunk = toUpsert.slice(i, i + BATCH_SIZE)
    const { error: upsertErr } = await supabase.from("stock_orderbook_snapshots").upsert(chunk, { onConflict: "symbol" })
    if (upsertErr) console.error(`Error on batch ${i}:`, upsertErr.message)
  }

  console.log("✅ All rows successfully normalized to standard kilo prices!")
}

run().catch(console.error)
