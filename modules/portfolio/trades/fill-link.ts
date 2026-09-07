import "server-only"

import { type ServerAuthContext } from "@/modules/auth/server"
import { TradeDomainError } from "./validation"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const TICKER_RE = /^[A-Z0-9]{2,12}$/
const FILL_ACTIONS = new Set(["buy", "sell", "rights", "dividend_stock"])

export async function validateTradeFillLink(
  context: ServerAuthContext,
  portfolioId: string,
  tradeId: string,
  ticker: string,
  action: string,
) {
  if (!UUID_RE.test(portfolioId) || !UUID_RE.test(tradeId)) {
    throw new TradeDomainError("INVALID_ID", "Portfolio ID or Trade ID is invalid")
  }

  const normalizedTicker = ticker.trim().toUpperCase()
  if (!TICKER_RE.test(normalizedTicker)) {
    throw new TradeDomainError("INVALID_TICKER", "Ticker is invalid")
  }
  if (!FILL_ACTIONS.has(action)) {
    throw new TradeDomainError("INVALID_FILL_ACTION", `${action} is not a Trade fill action`)
  }

  const result = await context.supabase
    .from("portfolio_trades")
    .select("id,portfolio_id,user_id,ticker,status")
    .eq("id", tradeId)
    .eq("portfolio_id", portfolioId)
    .eq("user_id", context.user.id)
    .maybeSingle()

  if (result.error) {
    console.error("[QeoIndex Trade] validate-fill-link failed", result.error)
    throw new Error("Trade link validation failed")
  }
  if (!result.data) throw new TradeDomainError("NOT_FOUND", "Trade was not found")

  const trade = result.data
  if (trade.status === "cancelled") {
    throw new TradeDomainError("TRADE_CANCELLED", "A cancelled Trade cannot receive fills")
  }
  if (normalizedTicker !== trade.ticker) {
    throw new TradeDomainError("TICKER_MISMATCH", "Transaction ticker does not match Trade ticker")
  }

  return trade
}
