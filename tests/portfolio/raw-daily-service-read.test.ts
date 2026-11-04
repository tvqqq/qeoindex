import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"

function read(relative: string) {
  const full = path.join(process.cwd(), relative)
  assert.equal(fs.existsSync(full), true, `${relative} must exist`)
  return fs.readFileSync(full, "utf8")
}

function assertBoundedRawDailyRead(server: string, label: string) {
  const ownerCheck = server.indexOf("if (!portfolioResult.data)")
  const clientCall = server.indexOf("const rawClient = getSupabaseServerClient()")
  assert.ok(ownerCheck >= 0 && clientCall > ownerCheck, `${label} must verify portfolio ownership before accessing the service-role client`)
  assert.match(server, /\.eq\("id", portfolioId\)[\s\S]*?\.eq\("user_id", context\.user\.id\)/)

  const queryStart = clientCall
  const queryEnd = server.indexOf("if (rawResult.error)", queryStart)
  assert.ok(queryEnd > queryStart, `${label} must fail closed on raw Daily query errors`)
  const query = server.slice(queryStart, queryEnd)
  assert.match(query, /if \(!rawClient\)[\s\S]*?dbFailure\("load-market_ohlcv_raw_daily"/)
  assert.match(query, /rawClient\s*\.from\("market_ohlcv_raw_daily"\)/)
  assert.match(query, /\.select\("ticker,session_date,close,source_price_unit,price_basis"\)/)
  assert.match(query, /\.in\("ticker", allTickers\)/)
  assert.match(query, /\.gte\("session_date", firstTransactionDate\)/)
  assert.match(query, /\.lte\("session_date", currentDate\)/)
  assert.match(query, /\.order\("session_date", \{ ascending: true \}\)/)
  assert.doesNotMatch(query, /context\.supabase/)
  assert.match(server, /if \(rawResult\.error\) dbFailure\("load-market_ohlcv_raw_daily", rawResult\.error\)/)
  assert.match(server, /row\.price_basis === "RAW"/)
  assert.match(server, /row\.source_price_unit === "VND_THOUSANDS"/)
  assert.match(server, /Number\.isFinite\(Number\(row\.close\)\)/)
  assert.match(server, /Number\(row\.close\) > 0/)
}

test("risk and performance raw Daily reads remain owner-gated, bounded, and fail closed", () => {
  const risk = read("modules/portfolio/risk-engine/server.ts")
  const performance = read("modules/portfolio/performance/server.ts")

  assertBoundedRawDailyRead(risk, "risk engine")
  assertBoundedRawDailyRead(performance, "performance reader")
})
