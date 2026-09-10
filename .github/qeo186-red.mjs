import { readFileSync, writeFileSync } from "node:fs"

const target = "tests/market-insight-ui-performance.test.ts"
let source = readFileSync(target, "utf8")
if (source.includes('QEO-186 sorts valid VNINDEX pullers and draggers')) process.exit(0)

source += `

test("QEO-186 sorts valid VNINDEX pullers and draggers while rejecting wrong-sign impacts", async () => {
  const modulePath = path.resolve("modules/research/market-insight/vnindex-contributors.ts")
  assert.ok(fs.existsSync(modulePath), "QEO-186 must add a pure VNINDEX contributor helper")
  const { buildVnindexContributorsContext } = await import(modulePath)

  const context = buildVnindexContributorsContext({
    vnindexChange: 3,
    leaders: [
      { category: "index_up", ticker: "AAA", estimatedIndexPoints: 1.2, rank: 3 },
      { category: "index_up", ticker: "BBB", estimatedIndexPoints: 2.5, rank: 1 },
      { category: "index_up", ticker: "BADUP", estimatedIndexPoints: -9, rank: 2 },
      { category: "index_down", ticker: "XXX", estimatedIndexPoints: -0.5, rank: 3 },
      { category: "index_down", ticker: "YYY", estimatedIndexPoints: -2, rank: 1 },
      { category: "index_down", ticker: "BADDOWN", estimatedIndexPoints: 4, rank: 2 },
      { category: "top_volume", ticker: "VOL", estimatedIndexPoints: 8, rank: 1 },
      { category: "index_up", ticker: "NULL", estimatedIndexPoints: null, rank: 4 },
    ],
  })

  assert.deepEqual(context.pullers.map((item: { ticker: string }) => item.ticker), ["BBB", "AAA"])
  assert.deepEqual(context.draggers.map((item: { ticker: string }) => item.ticker), ["YYY", "XXX"])
})

test("QEO-186 derives top-five and top-ten concentration from the side matching VNINDEX direction", async () => {
  const modulePath = path.resolve("modules/research/market-insight/vnindex-contributors.ts")
  assert.ok(fs.existsSync(modulePath), "QEO-186 must add a pure VNINDEX contributor helper")
  const { buildVnindexContributorsContext } = await import(modulePath)

  const leaders = [2, 1, 0.5, 0.3, 0.2, 0.1].map((impact, index) => ({
    category: "index_up",
    ticker: \`UP\${index + 1}\`,
    estimatedIndexPoints: impact,
    rank: index + 1,
  }))
  leaders.push({ category: "index_down", ticker: "DOWN1", estimatedIndexPoints: -3, rank: 1 })

  const up = buildVnindexContributorsContext({ vnindexChange: 5, leaders })
  assert.equal(up.direction, "up")
  assert.equal(up.top5ContributionPct, 80)
  assert.equal(up.top10ContributionPct, 82)
  assert.equal(up.concentrationState, "high")

  const down = buildVnindexContributorsContext({
    vnindexChange: -4,
    leaders: [-1.5, -1, -0.5, -0.4, -0.3, -0.2].map((impact, index) => ({
      category: "index_down",
      ticker: \`DN\${index + 1}\`,
      estimatedIndexPoints: impact,
      rank: index + 1,
    })),
  })
  assert.equal(down.direction, "down")
  assert.equal(down.top5ContributionPct, 92.5)
  assert.equal(down.top10ContributionPct, 97.5)
})

test("QEO-186 fails closed for invalid denominator and preserves valid concentration above 100 percent", async () => {
  const modulePath = path.resolve("modules/research/market-insight/vnindex-contributors.ts")
  assert.ok(fs.existsSync(modulePath), "QEO-186 must add a pure VNINDEX contributor helper")
  const { buildVnindexContributorsContext } = await import(modulePath)
  const leaders = [
    { category: "index_up", ticker: "AAA", estimatedIndexPoints: 1.5, rank: 1 },
    { category: "index_up", ticker: "BBB", estimatedIndexPoints: 1, rank: 2 },
    { category: "index_down", ticker: "CCC", estimatedIndexPoints: -0.5, rank: 1 },
  ]

  const offset = buildVnindexContributorsContext({ vnindexChange: 2, leaders })
  assert.equal(offset.top5ContributionPct, 125, "offsetting draggers can make gross leader contribution exceed the net move")
  assert.equal(offset.concentrationState, "high")

  for (const vnindexChange of [0, null, Number.NaN]) {
    const unknown = buildVnindexContributorsContext({ vnindexChange, leaders })
    assert.equal(unknown.top5ContributionPct, null)
    assert.equal(unknown.top10ContributionPct, null)
    assert.equal(unknown.concentrationState, "unknown")
  }
})

test("QEO-186 renders contributors after market health and before deep-dive charts", () => {
  const dashboard = fs.readFileSync(path.resolve("components/insights/market-close-dashboard.tsx"), "utf8")
  const helperPath = path.resolve("modules/research/market-insight/vnindex-contributors.ts")
  assert.ok(fs.existsSync(helperPath), "QEO-186 must add the contributor derivation helper")

  const health = dashboard.indexOf("data-market-health-embedded")
  const contributors = dashboard.indexOf("data-vnindex-contributors")
  const deepDive = dashboard.indexOf("data-market-close-chart-grid")
  assert.ok(contributors > health, "contributors must follow Market Health")
  assert.ok(contributors < deepDive, "contributors must precede deep-dive charts")
  assert.match(dashboard, /buildVnindexContributorsContext\\(\\{[\\s\\S]*vnindexChange:[\\s\\S]*leaders: data\\.leaders/)
  assert.match(dashboard, /Đóng góp VNINDEX/)
  assert.match(dashboard, /Top 5/)
  assert.match(dashboard, /Top 10/)
  assert.match(dashboard, /<IndexImpactChart\\b/)
})
`

writeFileSync(target, source)
