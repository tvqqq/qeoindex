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
  return { source, block }
}

test("portfolio Trade context exposes only unlinked legacy transactions without inferring Trades", () => {
  const { block } = tradeContextSource()

  assert.match(
    block,
    /const legacyTransactions = transactions\.filter\(\(row\) => row\.trade_id === null\)/,
    "legacyTransactions must contain only rows without a canonical Trade link",
  )
  assert.doesNotMatch(block, /createTrade\(|attachFillToTrade\(/)
})

test("QEO-143 Trade context carries machine-readable migration provenance and counts", () => {
  const { source, block } = tradeContextSource()

  const tradeSelect = source.match(/const TRADE_SELECT = "([^"]+)"/)?.[1] ?? ""
  const fillSelect = source.match(/const FILL_SELECT = "([^"]+)"/)?.[1] ?? ""

  for (const field of [
    "origin",
    "grouping_status",
    "scorecard_eligible",
    "legacy_opened_on",
    "legacy_closed_on",
    "legacy_source_transaction_count",
  ]) {
    assert.ok(tradeSelect.includes(field), `TRADE_SELECT must include ${field}`)
  }
  for (const field of ["record_origin", "legacy_migration_status"]) {
    assert.ok(fillSelect.includes(field), `FILL_SELECT must include ${field}`)
  }

  assert.match(block, /legacyUngroupedCount/)
  assert.match(block, /deterministicLegacyCount/)
  assert.match(
    block,
    /completeness:\s*\{\s*legacyGrouping,\s*legacyUngroupedCount,\s*deterministicLegacyCount\s*\}/,
    "legacy evidence counts must be returned beside grouping completeness",
  )
})
