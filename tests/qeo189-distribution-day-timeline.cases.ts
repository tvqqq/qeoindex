import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

const read = (relativePath: string) => fs.readFileSync(path.resolve(relativePath), "utf8")

type SessionInput = {
  sessionDate: string
  distributionCount: number | null
  distributionWindow: string | null
  totalMatchedVolume: number | null
  vnindexChangePct: number | null
}

function session(
  sessionDate: string,
  distributionCount: number | null,
  totalMatchedVolume: number | null = 100,
  vnindexChangePct: number | null = 0,
): SessionInput {
  return {
    sessionDate,
    distributionCount,
    distributionWindow: "25 sessions",
    totalMatchedVolume,
    vnindexChangePct,
  }
}

async function loadTimelineBuilder() {
  const modulePath = path.resolve("modules/research/market-insight/distribution-day-timeline.ts")
  assert.ok(fs.existsSync(modulePath), "QEO-189 must add a pure distribution-day timeline helper")
  return import(pathToFileURL(modulePath).href)
}

test("QEO-189 keeps the latest 25 market sessions in chronological order", async () => {
  const { buildDistributionDayTimeline } = await loadTimelineBuilder()
  const history = Array.from({ length: 30 }, (_, index) => {
    const day = String(index + 1).padStart(2, "0")
    return session(`2026-08-${day}`, index < 15 ? 1 : 2)
  }).reverse()

  const context = buildDistributionDayTimeline({
    sessionDate: "2026-08-30",
    currentDistributionCount: 2,
    history,
  })

  assert.equal(context.sessions.length, 25)
  assert.equal(context.sessions[0]?.sessionDate, "2026-08-06")
  assert.equal(context.sessions.at(-1)?.sessionDate, "2026-08-30")
  assert.deepEqual(
    context.sessions.map((item: { sessionDate: string }) => item.sessionDate),
    [...context.sessions.map((item: { sessionDate: string }) => item.sessionDate)].sort(),
  )
})

test("QEO-189 marks only verified canonical count increments and fails closed across missing observations", async () => {
  const { buildDistributionDayTimeline } = await loadTimelineBuilder()
  const context = buildDistributionDayTimeline({
    sessionDate: "2026-09-08",
    currentDistributionCount: 2,
    history: [
      session("2026-09-01", 1),
      session("2026-09-02", 1),
      session("2026-09-03", 2),
      session("2026-09-04", null),
      session("2026-09-05", 3),
      session("2026-09-06", 1),
      session("2026-09-07", 1),
      session("2026-09-08", 2),
    ],
  })

  const marks = context.sessions.filter((item: { isDistributionDay: boolean }) => item.isDistributionDay)
  assert.deepEqual(marks.map((item: { sessionDate: string }) => item.sessionDate), ["2026-09-03", "2026-09-08"])
  assert.equal(context.sessions.find((item: { sessionDate: string }) => item.sessionDate === "2026-09-05")?.isDistributionDay, false)
  assert.equal(context.sessions.find((item: { sessionDate: string }) => item.sessionDate === "2026-09-06")?.isExpiry, true)
  assert.equal(context.verifiedMarks25, 2)
  assert.equal(context.verifiedMarks10, 2)
  assert.equal(context.latestMarkSessionsAgo, 0)
  assert.equal(context.expiryCount25, 1)
})

test("QEO-189 derives tooltip volume context only from adjacent verified positive observations", async () => {
  const { buildDistributionDayTimeline } = await loadTimelineBuilder()
  const context = buildDistributionDayTimeline({
    sessionDate: "2026-09-04",
    currentDistributionCount: 2,
    history: [
      session("2026-09-01", 1, 100, -0.2),
      session("2026-09-02", 2, 125, -1.1),
      session("2026-09-03", 2, null, 0.4),
      session("2026-09-04", 2, 150, -0.3),
    ],
  })

  assert.equal(context.sessions[1]?.volumeChangePct, 25)
  assert.equal(context.sessions[1]?.vnindexChangePct, -1.1)
  assert.equal(context.sessions[2]?.volumeChangePct, null)
  assert.equal(context.sessions[3]?.volumeChangePct, null, "missing prior volume must break adjacency instead of bridging across sessions")
})

test("QEO-189 loads historical canonical distribution evidence and renders a compact hover timeline inside Market Health", () => {
  const dataSource = read("modules/research/market-insight/data.ts")
  const dashboard = read("components/insights/market-close-dashboard.tsx")
  const viewPath = path.resolve("components/insights/distribution-day-timeline.tsx")

  assert.match(dataSource, /distributionCount:\s*number \| null/)
  assert.match(dataSource, /distributionWindow:\s*string \| null/)
  assert.match(dataSource, /totalMatchedVolume:\s*number \| null/)
  assert.match(dataSource, /select\("session_date,market_regime,[^"]*distribution_count,distribution_window,[^"]*total_matched_volume[^"]*"\)/)
  assert.match(dataSource, /distributionCount:\s*row\.distribution_count != null \? Number\(row\.distribution_count\) : null/)
  assert.match(dataSource, /distributionWindow:\s*\(row\.distribution_window as string\) \|\| null/)
  assert.match(dataSource, /totalMatchedVolume:\s*row\.total_matched_volume != null \? Number\(row\.total_matched_volume\) : null/)

  assert.ok(fs.existsSync(viewPath), "QEO-189 must add a compact timeline view")
  const view = read("components/insights/distribution-day-timeline.tsx")
  assert.match(dashboard, /buildDistributionDayTimeline\([\s\S]*currentDistributionCount:\s*dailySummary\.distributionCount[\s\S]*history/)
  assert.match(dashboard, /data-market-health-embedded[\s\S]*<MarketHealthView[\s\S]*<DistributionDayTimeline context=\{distributionTimeline\}/)
  assert.match(view, /data-distribution-day-timeline/)
  assert.match(view, /25 phiên gần nhất/)
  assert.match(view, /VNINDEX/)
  assert.match(view, /Khối lượng/)
  assert.match(view, /Canonical count/)
  assert.match(view, /group-hover/)
  assert.match(view, /group-focus-within/)
  assert.doesNotMatch(view, /<BarChart|<AreaChart|<LineChart/, "QEO-189 should stay a compact timeline rather than add another chart library surface")
})
