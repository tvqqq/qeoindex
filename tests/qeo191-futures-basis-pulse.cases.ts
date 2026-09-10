import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

const read = (relativePath: string) => fs.readFileSync(path.resolve(relativePath), "utf8")

type SessionPoint = { sessionDate: string; value: number | null }

async function loadPulse() {
  const modulePath = path.resolve("modules/research/market-insight/futures-basis-pulse.ts")
  assert.ok(fs.existsSync(modulePath), "QEO-191 must add a pure futures basis pulse helper")
  return import(pathToFileURL(modulePath).href)
}

test("QEO-191 computes same-session F1M basis and prior-session basis change", async () => {
  const { buildFuturesBasisPulse } = await loadPulse()
  const futuresSessions: SessionPoint[] = [
    { sessionDate: "2026-09-09", value: 1902 },
    { sessionDate: "2026-09-10", value: 1904 },
  ]
  const spotSessions: SessionPoint[] = [
    { sessionDate: "2026-09-09", value: 1900 },
    { sessionDate: "2026-09-10", value: 1901 },
  ]

  const result = buildFuturesBasisPulse({
    targetSessionDate: "2026-09-10",
    futuresSessions,
    spotSessions,
  })

  assert.equal(result.status, "ready")
  assert.equal(result.futuresLast, 1904)
  assert.equal(result.spotValue, 1901)
  assert.equal(result.basis, 3)
  assert.ok(result.basisPct != null && Math.abs(result.basisPct - (3 / 1901) * 100) < 1e-12)
  assert.equal(result.previousSessionDate, "2026-09-09")
  assert.equal(result.previousBasis, 2)
  assert.equal(result.basisChange, 1)
  assert.equal(result.state, "premium")
})

test("QEO-191 keeps exact ±0.05 percent inside neutral and only classifies beyond the boundary", async () => {
  const { classifyFuturesBasisState } = await loadPulse()

  assert.equal(classifyFuturesBasisState(0.05), "neutral")
  assert.equal(classifyFuturesBasisState(-0.05), "neutral")
  assert.equal(classifyFuturesBasisState(0.050001), "premium")
  assert.equal(classifyFuturesBasisState(-0.050001), "discount")
  assert.equal(classifyFuturesBasisState(null), "unknown")
})

test("QEO-191 fails closed when the F1M close is not aligned to the requested market session", async () => {
  const { buildFuturesBasisPulse } = await loadPulse()
  const result = buildFuturesBasisPulse({
    targetSessionDate: "2026-09-10",
    futuresSessions: [{ sessionDate: "2026-09-09", value: 1902 }],
    spotSessions: [{ sessionDate: "2026-09-10", value: 1901 }],
  })

  assert.equal(result.status, "degraded")
  assert.equal(result.futuresLast, null)
  assert.equal(result.basis, null)
  assert.equal(result.basisPct, null)
  assert.equal(result.state, "unknown")
  assert.match(result.message, /không cùng phiên|chưa có F1M/i)
})

test("QEO-191 preserves current basis when prior-session evidence is incomplete", async () => {
  const { buildFuturesBasisPulse } = await loadPulse()
  const result = buildFuturesBasisPulse({
    targetSessionDate: "2026-09-10",
    futuresSessions: [{ sessionDate: "2026-09-10", value: 1904 }],
    spotSessions: [
      { sessionDate: "2026-09-09", value: 1900 },
      { sessionDate: "2026-09-10", value: 1901 },
    ],
  })

  assert.equal(result.status, "ready")
  assert.equal(result.basis, 3)
  assert.equal(result.previousBasis, null)
  assert.equal(result.basisChange, null)
  assert.match(result.basisChangeMessage, /chưa đủ dữ liệu/i)
})

test("QEO-191 leaves open interest explicitly unavailable until an automated source contract is verified", async () => {
  const { buildFuturesBasisPulse } = await loadPulse()
  const result = buildFuturesBasisPulse({
    targetSessionDate: "2026-09-10",
    futuresSessions: [{ sessionDate: "2026-09-10", value: 1904 }],
    spotSessions: [{ sessionDate: "2026-09-10", value: 1901 }],
  })

  assert.equal(result.openInterest, null)
  assert.equal(result.openInterestChange, null)
  assert.equal(result.openInterestStatus, "unverified_source")
  assert.match(result.openInterestMessage, /nguồn.*chưa.*xác minh/i)
})

test("QEO-191 loads DNSE F1M daily history plus persisted VN30 spot and wires a compact non-positioning pulse into Market Insights", () => {
  const loader = read("modules/research/market-insight/futures-basis-loader.ts")
  const insightsData = read("modules/research/insights/data.ts")
  const insightsDashboard = read("components/insights/insights-dashboard.tsx")
  const closeDashboard = read("components/insights/market-close-dashboard.tsx")
  const pulseView = read("components/insights/vn30-futures-basis-pulse.tsx")
  const surface = `${loader}\n${insightsData}\n${insightsDashboard}\n${closeDashboard}\n${pulseView}`

  assert.match(loader, /fetchDnseIndexCandleHistory\([\s\S]*"VN30F1M"[\s\S]*"1D"/)
  assert.match(loader, /market_insight_indexes/)
  assert.match(loader, /index_code[\s\S]*VN30/)
  assert.match(loader, /session_date/)
  assert.match(insightsData, /futuresBasisPulse/)
  assert.match(insightsDashboard, /futuresBasisPulse=\{data\.futuresBasisPulse\}/)
  assert.match(closeDashboard, /<Vn30FuturesBasisPulse[\s\S]*pulse=\{futuresBasisPulse\}/)
  assert.match(pulseView, /data-vn30-futures-basis-pulse/)
  assert.match(surface, /VN30F1M/)
  assert.match(surface, /Basis/)
  assert.match(surface, /OI/)
  assert.match(surface, /Premium|Chiết khấu|Discount|Trung tính|Neutral/i)
  assert.match(surface, /chưa.*xác minh/i)
  assert.doesNotMatch(surface, /institutional positioning|tổ chức.*long|tổ chức.*short|khối.*long|khối.*short/i)
})
