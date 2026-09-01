const DEFAULT_SUPABASE_URL = "https://glwhhrmejlonhyorvtzm.supabase.co"
const STOCK_LOGO_BUCKET = "stock-logo"

export function stockLogoPath(symbol: string) {
  const ticker = String(symbol || "").trim().toUpperCase()
  return ticker ? `${ticker}.png` : ""
}

export function stockLogoUrl(symbolOrPath: string) {
  const raw = String(symbolOrPath || "").trim()
  if (!raw) return ""
  const path = raw.includes("/") || raw.toLowerCase().endsWith(".png") ? raw.replace(/^\/+/, "") : stockLogoPath(raw)
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL || DEFAULT_SUPABASE_URL).replace(/\/$/, "")
  return `${base}/storage/v1/object/public/${STOCK_LOGO_BUCKET}/${encodeURIComponent(path)}`
}
