import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const serverUrl = new URL("../../modules/portfolio/trades/server.ts", import.meta.url)

function tradeContextSource() {
  const source = readFileSync(serverUrl, "utf8")
  const block = source.match(
    /export async function readPortfolioTradeContext[\s\S]*?export \{ TRADE_SELECT/,
  )?.[0] ?? ""
  assert.ok(block, "readPortfolioTradeContext source must be found")
  return block
}

test("portfolio Trade context exposes only unlinked legacy transactions without inferring Trades", () => {
  const source = tradeContextSource()

  assert.match(
    source,
    /const legacyTransactions = transactions\.filter\(\(row\) => row\.trade_id === null\)/,
    "legacyTransactions must contain only rows without a canonical Trade link",
  )
  assert.match(
    source,
    /legacyTransactions,\s*\n\s*completeness:\s*\{\s*legacyGrouping\s*\}/,
    "legacyTransactions must be returned beside explicit grouping completeness",
  )
  assert.doesNotMatch(source, /createTrade\(|attachFillToTrade\(/)
})
