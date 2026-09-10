import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"

const read = (relativePath: string) => fs.readFileSync(path.resolve(relativePath), "utf8")

test("QEO-134 market sentiment provider uses the verified VN-Index endpoints and full history", () => {
  const provider = read("modules/research/market-insight/topi-sentiment.ts")

  assert.match(provider, /https:\/\/apiclient\.topi\.vn\/api-web/)
  assert.match(provider, /postTopi\("GetFGIndex", \{ Target: TOPI_TARGET_VNINDEX \}/)
  assert.match(provider, /postTopi\("GetFGChart", \{ Target: TOPI_TARGET_VNINDEX, Days: 0 \}/)
  assert.match(provider, /TOPI_TARGET_VNINDEX = 0/)
})

test("QEO-134 market sentiment parser accepts the nested TOPI response envelope and normalizes dates", () => {
  const provider = read("modules/research/market-insight/topi-sentiment.ts")

  assert.match(provider, /Object\.prototype\.hasOwnProperty\.call\(record, "Data"\)/)
  assert.match(provider, /Object\.prototype\.hasOwnProperty\.call\(record, "data"\)/)
  assert.match(provider, /\^\(\\d\{2\}\)\[\/-\]\(\\d\{2\}\)\[\/-\]\(\\d\{4\}\)\$/)
  assert.match(provider, /historyByDate\.set\(tradingDate, point\)/)
  assert.match(provider, /sort\(\(left, right\) => left\.tradingDate\.localeCompare\(right\.tradingDate\)\)/)
})

test("QEO-134 dashboard replaces persisted sentiment instead of silently falling back to KFSP", () => {
  const dashboardData = read("modules/research/insights/data.ts")

  assert.match(dashboardData, /fetchTopiMarketSentiment\(\)/)
  assert.match(dashboardData, /sentimentScore: sentiment\?\.score \?\? null/)
  assert.match(dashboardData, /sentimentLabel: sentiment\?\.label \?\? null/)
  assert.match(dashboardData, /sentimentHistory: sentiment\?\.history \?\? \[\]/)
})
