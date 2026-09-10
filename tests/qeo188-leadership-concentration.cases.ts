import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"

const read = (relativePath: string) => fs.readFileSync(path.resolve(relativePath), "utf8")

function candidate(ticker: string, tradedValueBillion: number | null) {
  return { ticker, tradedValueBillion }
}

test("QEO-188 persists exact KFSP traded value into the HOSE candidate snapshot", () => {
  const migrationPath = path.resolve("supabase/migrations/20260910211000_qeo188_candidate_traded_value_for_leadership_concentration.sql")
  assert.ok(fs.existsSync(migrationPath), "QEO-188 must add traded_value_1d_billion to candidate snapshots")

  const migration = read("supabase/migrations/20260910211000_qeo188_candidate_traded_value_for_leadership_concentration.sql")
  const ratingSync = read("supabase/functions/kfsp-rating-sync/index.ts")
  assert.match(migration, /kfsp_universe_candidate_snapshots[\s\S]*traded_value_1d_billion/i)
  assert.match(ratingSync, /candidateRows[\s\S]*traded_value_1d_billion:\s*numeric\(row\.kfsp_metrics\.liquidity\.traded_value_1d_billion\)/)
})

test("QEO-188 ranks exact traded value and normalizes VNINDEX denominator from million to billion VND", async () => {
  const modulePath = path.resolve("modules/research/market-insight/leadership-concentration.ts")
  assert.ok(fs.existsSync(modulePath), "QEO-188 must add a pure leadership concentration helper")
  const { buildLeadershipConcentrationContext } = await import(modulePath)

  const context = buildLeadershipConcentrationContext({
    vnindexTradedValueMillion: 6_000_000,
    candidates: [
      candidate("F", 400), candidate("A", 1_200), candidate("L", 25), candidate("C", 800),
      candidate("I", 100), candidate("B", 1_000), candidate("H", 200), candidate("J", 50),
      candidate("D", 600), candidate("K", 25), candidate("E", 500), candidate("G", 300),
    ],
  })

  assert.equal(context.vnindexTradedValueBillion, 6_000)
  assert.deepEqual(context.top10.map((item: { ticker: string }) => item.ticker), ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"])
  assert.equal(Number(context.top5SharePct.toFixed(2)), 68.33)
  assert.equal(Number(context.top10SharePct.toFixed(2)), 85.83)
  assert.equal(context.state, "concentrated")
})

test("QEO-188 classifies broad versus undecided concentration from Top 10 share only", async () => {
  const modulePath = path.resolve("modules/research/market-insight/leadership-concentration.ts")
  assert.ok(fs.existsSync(modulePath), "QEO-188 must add a pure leadership concentration helper")
  const { buildLeadershipConcentrationContext } = await import(modulePath)

  const broad = buildLeadershipConcentrationContext({
    vnindexTradedValueMillion: 5_000_000,
    candidates: Array.from({ length: 12 }, (_, index) => candidate(`B${index}`, index < 10 ? 100 : 50)),
  })
  assert.equal(Number(broad.top10SharePct.toFixed(2)), 20)
  assert.equal(broad.state, "broad")

  const undecided = buildLeadershipConcentrationContext({
    vnindexTradedValueMillion: 2_500_000,
    candidates: Array.from({ length: 10 }, (_, index) => candidate(`U${index}`, 100)),
  })
  assert.equal(Number(undecided.top10SharePct.toFixed(2)), 40)
  assert.equal(undecided.state, "unknown")
})

test("QEO-188 fails closed for missing or inconsistent liquidity universe", async () => {
  const modulePath = path.resolve("modules/research/market-insight/leadership-concentration.ts")
  assert.ok(fs.existsSync(modulePath), "QEO-188 must add a pure leadership concentration helper")
  const { buildLeadershipConcentrationContext } = await import(modulePath)

  const missing = buildLeadershipConcentrationContext({
    vnindexTradedValueMillion: 2_000_000,
    candidates: [candidate("A", 300), candidate("B", null), ...Array.from({ length: 10 }, (_, index) => candidate(`X${index}`, 100))],
  })
  assert.equal(missing.state, "unknown")
  assert.equal(missing.top5SharePct, null)
  assert.equal(missing.top10SharePct, null)

  const tooShort = buildLeadershipConcentrationContext({
    vnindexTradedValueMillion: 2_000_000,
    candidates: Array.from({ length: 9 }, (_, index) => candidate(`S${index}`, 100)),
  })
  assert.equal(tooShort.state, "unknown")

  const impossible = buildLeadershipConcentrationContext({
    vnindexTradedValueMillion: 1_000_000,
    candidates: Array.from({ length: 10 }, (_, index) => candidate(`I${index}`, 150)),
  })
  assert.equal(impossible.state, "unknown")
})

test("QEO-188 loads HOSE traded-value evidence and renders a compact concentration view beside contributor context", () => {
  const dataSource = read("modules/research/market-insight/data.ts")
  const dashboard = read("components/insights/market-close-dashboard.tsx")
  const viewPath = path.resolve("components/insights/leadership-concentration-view.tsx")

  assert.match(dataSource, /kfsp_universe_candidate_snapshots/)
  assert.match(dataSource, /ticker,traded_value_1d_billion/)
  assert.match(dataSource, /\.eq\("as_of_date",\s*targetDate\)[\s\S]*\.eq\("exchange",\s*"HOSE"\)/)
  assert.ok(fs.existsSync(viewPath), "QEO-188 must add a compact concentration view")
  const view = read("components/insights/leadership-concentration-view.tsx")

  assert.match(dashboard, /buildLeadershipConcentrationContext\([\s\S]*vnindexTradedValueMillion:\s*vnindex\?\.tradedValue[\s\S]*candidates:\s*data\.leadershipLiquidity/)
  assert.match(dashboard, /data-vnindex-contributors[\s\S]*<LeadershipConcentrationView context=\{leadershipConcentration\}/)
  assert.match(view, /data-leadership-concentration/)
  for (const label of ["Top 5", "Top 10", "Lan tỏa", "Tập trung", "Chưa xác nhận", "Không suy diễn dòng tiền tổ chức"]) {
    assert.ok(view.includes(label), `missing QEO-188 UI label: ${label}`)
  }
  assert.doesNotMatch(view, /<BarChart|<AreaChart|<LineChart/, "QEO-188 should remain a compact decision card")
})
