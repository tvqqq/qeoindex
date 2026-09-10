import fs from "node:fs"
import { execFileSync } from "node:child_process"

const testPath = "tests/market-insight-ui-performance.test.ts"
let source = fs.readFileSync(testPath, "utf8")
const marker = 'test("QEO-187 computes exact Today 5D 20D flow persistence on one session calendar"'

if (!source.includes(marker)) {
  source += `

function qeo187Session(index: number) {
  return \`2026-08-\${String(index + 1).padStart(2, "0")}\`
}

test("QEO-187 computes exact Today 5D 20D flow persistence on one session calendar", async () => {
  const modulePath = path.resolve("modules/research/market-insight/institutional-flow-persistence.ts")
  assert.ok(fs.existsSync(modulePath), "QEO-187 must add a pure institutional-flow persistence helper")
  const { buildInstitutionalFlowPersistence } = await import(modulePath)
  const history = Array.from({ length: 20 }, (_, index) => ({
    sessionDate: qeo187Session(index),
    foreignNetValue: index < 15 ? -10 : 20,
    proprietaryNetValue: index < 15 ? 10 : -20,
    otherFlowNetValue: 2,
  }))

  const context = buildInstitutionalFlowPersistence({ sessionDate: "2026-08-20", history })
  const foreign = context.rows.find((row: { key: string }) => row.key === "foreign")
  const proprietary = context.rows.find((row: { key: string }) => row.key === "proprietary")
  const other = context.rows.find((row: { key: string }) => row.key === "other")

  assert.deepEqual(
    { today: foreign.today, fiveDay: foreign.fiveDay, twentyDay: foreign.twentyDay, state: foreign.state },
    { today: 20, fiveDay: 100, twentyDay: -50, state: "reversal_to_buying" },
  )
  assert.deepEqual(
    { today: proprietary.today, fiveDay: proprietary.fiveDay, twentyDay: proprietary.twentyDay, state: proprietary.state },
    { today: -20, fiveDay: -100, twentyDay: 50, state: "reversal_to_selling" },
  )
  assert.deepEqual(
    { today: other.today, fiveDay: other.fiveDay, twentyDay: other.twentyDay, state: other.state },
    { today: 2, fiveDay: 10, twentyDay: 40, state: "persistent_buying" },
  )
})

test("QEO-187 fails closed when a required flow observation or window session is missing", async () => {
  const modulePath = path.resolve("modules/research/market-insight/institutional-flow-persistence.ts")
  assert.ok(fs.existsSync(modulePath), "QEO-187 must add a pure institutional-flow persistence helper")
  const { buildInstitutionalFlowPersistence } = await import(modulePath)

  const missingObservation = Array.from({ length: 20 }, (_, index) => ({
    sessionDate: qeo187Session(index),
    foreignNetValue: index === 18 ? null : 10,
    proprietaryNetValue: 5,
    otherFlowNetValue: 1,
  }))
  const missingContext = buildInstitutionalFlowPersistence({ sessionDate: "2026-08-20", history: missingObservation })
  const foreign = missingContext.rows.find((row: { key: string }) => row.key === "foreign")
  assert.equal(foreign.fiveDay, null)
  assert.equal(foreign.twentyDay, null)
  assert.equal(foreign.state, "unknown")

  const nineteenSessions = Array.from({ length: 19 }, (_, index) => ({
    sessionDate: qeo187Session(index + 1),
    foreignNetValue: 10,
    proprietaryNetValue: -5,
    otherFlowNetValue: 1,
  }))
  const shortContext = buildInstitutionalFlowPersistence({ sessionDate: "2026-08-20", history: nineteenSessions })
  const shortForeign = shortContext.rows.find((row: { key: string }) => row.key === "foreign")
  assert.equal(shortForeign.today, 10)
  assert.equal(shortForeign.fiveDay, 50)
  assert.equal(shortForeign.twentyDay, null)
  assert.equal(shortForeign.state, "unknown")

  const noCurrent = buildInstitutionalFlowPersistence({ sessionDate: "2026-08-21", history: nineteenSessions })
  const noCurrentForeign = noCurrent.rows.find((row: { key: string }) => row.key === "foreign")
  assert.deepEqual(
    { today: noCurrentForeign.today, fiveDay: noCurrentForeign.fiveDay, twentyDay: noCurrentForeign.twentyDay, state: noCurrentForeign.state },
    { today: null, fiveDay: null, twentyDay: null, state: "unknown" },
  )
})

test("QEO-187 keeps zero-sum windows unknown and separates facts from interpretation", async () => {
  const modulePath = path.resolve("modules/research/market-insight/institutional-flow-persistence.ts")
  assert.ok(fs.existsSync(modulePath), "QEO-187 must add a pure institutional-flow persistence helper")
  const { buildInstitutionalFlowPersistence } = await import(modulePath)
  const history = Array.from({ length: 20 }, (_, index) => ({
    sessionDate: qeo187Session(index),
    foreignNetValue: index < 15 ? -10 : [10, -10, 10, -10, 0][index - 15],
    proprietaryNetValue: 1,
    otherFlowNetValue: 1,
  }))
  const context = buildInstitutionalFlowPersistence({ sessionDate: "2026-08-20", history })
  const foreign = context.rows.find((row: { key: string }) => row.key === "foreign")
  assert.equal(foreign.fiveDay, 0)
  assert.equal(foreign.twentyDay, -150)
  assert.equal(foreign.state, "unknown")
})

test("QEO-187 upgrades the existing institutional-flow card to compact persistence view", () => {
  const dashboard = fs.readFileSync(path.resolve("components/insights/market-close-dashboard.tsx"), "utf8")
  const charts = fs.readFileSync(path.resolve("components/insights/market-close-charts.tsx"), "utf8")
  const dataSource = fs.readFileSync(path.resolve("modules/research/market-insight/data.ts"), "utf8")

  assert.match(dataSource, /foreign_net_value,proprietary_net_value,other_flow_net_value,total_traded_value/)
  assert.match(dataSource, /otherFlowNetValue: row\\.other_flow_net_value/)
  assert.match(dashboard, /buildInstitutionalFlowPersistence\\(\\{[\\s\\S]*sessionDate: data\\.sessionDate[\\s\\S]*history/)
  assert.match(dashboard, /<InstitutionalFlowChart context=\\{flowPersistence\\}/)

  const flowStart = charts.indexOf("export function InstitutionalFlowChart")
  const flowEnd = charts.indexOf("const sectorConfig", flowStart)
  const flow = charts.slice(flowStart, flowEnd)
  assert.match(flow, /data-institutional-flow-persistence/)
  for (const label of ["Khối ngoại", "Tự doanh", "Khác", "Today", "5D", "20D", "Xu hướng", "Chưa đủ dữ liệu"]) {
    assert.ok(flow.includes(label), \`missing QEO-187 flow label: \${label}\`)
  }
  assert.doesNotMatch(flow, /<BarChart|<AreaChart|<LineChart/, "QEO-187 should stay compact instead of adding another large chart")
})
`
  fs.writeFileSync(testPath, source)
}

execFileSync("git", ["config", "user.name", "github-actions[bot]"])
execFileSync("git", ["config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com"])
execFileSync("git", ["add", testPath])
try {
  execFileSync("git", ["commit", "-m", "test(QEO-187): add flow persistence RED contracts"], { stdio: "inherit" })
  execFileSync("git", ["push", "origin", "HEAD"], { stdio: "inherit" })
} catch (error) {
  console.log("No RED test changes to commit")
}
