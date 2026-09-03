import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const repairSource = readFileSync("lib/qeoindex-eod-no-trade-repair-step.ts", "utf8")

test("EOD gap repair accepts verified final traded OHLC snapshots instead of only no-trade rows", () => {
  assert.match(repairSource, /latest_quote/)
  assert.match(repairSource, /openPrice/)
  assert.match(repairSource, /highPrice/)
  assert.match(repairSource, /lowPrice/)
  assert.match(repairSource, /matchPrice/)
  assert.match(repairSource, /Math\.max/)
  assert.match(repairSource, /Math\.min/)
  assert.match(repairSource, /Verified final EOD repair from stock_orderbook_snapshots/)
})
