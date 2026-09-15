import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import test from "node:test"

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

const coreUrl = new URL("../modules/market/chart-data/storage-audit.ts", import.meta.url)
const serverUrl = new URL("../modules/market/chart-data/storage-audit-server.ts", import.meta.url)
const routeUrl = new URL("../app/api/qeoindex/chart-storage-audit/route.ts", import.meta.url)

test("QEO-231 provides a machine-readable HOT/COLD/mixed read-equivalence audit path", () => {
  assert.equal(existsSync(coreUrl), true, "storage audit core must exist")
  assert.equal(existsSync(serverUrl), true, "production storage audit adapter must exist")
  assert.equal(existsSync(routeUrl), true, "machine-authenticated storage audit route must exist")
})

test("QEO-231 audit core passes only when all three canonical read modes exactly match direct durable storage", async () => {
  if (!existsSync(coreUrl)) return
  const { runChartStorageAudit } = await import(coreUrl.href)
  const ranges = {
    cold: { kind: "cold", from: 100, to: 160 },
    mixed: { kind: "mixed", from: 100, to: 260 },
    hot: { kind: "hot", from: 200, to: 260 },
  } as const
  const bars = new Map([
    ["cold", [{ time: 120, open: 1, high: 2, low: 1, close: 2, volume: 10 }]],
    ["mixed", [
      { time: 120, open: 1, high: 2, low: 1, close: 2, volume: 10 },
      { time: 220, open: 2, high: 3, low: 2, close: 3, volume: 20 },
    ]],
    ["hot", [{ time: 220, open: 2, high: 3, low: 2, close: 3, volume: 20 }]],
  ])

  const result = await runChartStorageAudit({ ticker: "VCB" }, {
    discoverRanges: async () => ranges,
    readDirect: async (range: { kind: string }) => bars.get(range.kind) ?? [],
    readCanonical: async (range: { kind: string; from: number; to: number }) => ({
      ticker: "VCB",
      resolution: "1m",
      from: range.from,
      to: range.to,
      bars: bars.get(range.kind) ?? [],
      gaps: [],
      integrityIssues: [],
      coverage: { complete: true, state: "COMPLETE" },
      errors: [],
    }),
  })

  assert.equal(result.passed, true)
  assert.deepEqual(result.probes.map((probe: { kind: string }) => probe.kind), ["cold", "mixed", "hot"])
  assert.ok(result.probes.every((probe: { passed: boolean }) => probe.passed))
})

test("QEO-231 audit core fails closed on bar mismatch or canonical fallback/error evidence", async () => {
  if (!existsSync(coreUrl)) return
  const { runChartStorageAudit } = await import(coreUrl.href)
  const ranges = {
    cold: { kind: "cold", from: 100, to: 160 },
    mixed: { kind: "mixed", from: 100, to: 260 },
    hot: { kind: "hot", from: 200, to: 260 },
  } as const
  const expected = [{ time: 120, open: 1, high: 2, low: 1, close: 2, volume: 10 }]

  const result = await runChartStorageAudit({ ticker: "VCB" }, {
    discoverRanges: async () => ranges,
    readDirect: async () => expected,
    readCanonical: async (range: { kind: string; from: number; to: number }) => ({
      ticker: "VCB",
      resolution: "1m",
      from: range.from,
      to: range.to,
      bars: range.kind === "mixed"
        ? [{ ...expected[0], close: 2.5 }]
        : expected,
      gaps: [],
      integrityIssues: [],
      coverage: { complete: range.kind !== "hot", state: range.kind === "hot" ? "PARTIAL" : "COMPLETE" },
      errors: range.kind === "hot" ? [{ code: "PROVIDER_UNAVAILABLE" }] : [],
    }),
  })

  assert.equal(result.passed, false)
  assert.equal(result.probes.find((probe: { kind: string }) => probe.kind === "mixed")?.passed, false)
  assert.equal(result.probes.find((probe: { kind: string }) => probe.kind === "hot")?.passed, false)
})

test("QEO-231 production adapter compares verified cold objects plus HOT rows against the canonical service without provider fallback", () => {
  if (!existsSync(serverUrl)) return
  const server = source("modules/market/chart-data/storage-audit-server.ts")
  assert.match(server, /listVerifiedColdManifests/)
  assert.match(server, /createSupabaseColdOhlcvStorage/)
  assert.match(server, /readHotIntradayRange/)
  assert.match(server, /normalizeCanonicalBars/)
  assert.match(server, /getCanonicalChartOhlcv/)
  assert.match(server, /QEO-231 audit forbids provider fallback/)
})

test("QEO-231 production adapter proves source isolation and forces a closed-session canonical read", () => {
  if (!existsSync(serverUrl)) return
  const server = source("modules/market/chart-data/storage-audit-server.ts")
  assert.match(server, /QEO-231 verified COLD overlaps HOT audit session/)
  assert.match(server, /auditNow/)
  assert.match(server, /ranges\.hot\.to\s*\+\s*4\s*\*\s*3600/)
  assert.match(server, /now:\s*auditNow/)
})

test("QEO-231 audit route is scheduler-authenticated, read-only, and returns conflict on failed equivalence", () => {
  if (!existsSync(routeUrl)) return
  const route = source("app/api/qeoindex/chart-storage-audit/route.ts")
  assert.match(route, /isMachineRequestAuthorized/)
  assert.match(route, /qeo_verify_eod_scheduler_secret/)
  assert.match(route, /runProductionChartStorageAudit/)
  assert.match(route, /status:\s*result\.passed\s*\?\s*200\s*:\s*409/)
  assert.doesNotMatch(route, /requireApiUser/)
  assert.doesNotMatch(route, /insert\(|update\(|upsert\(|delete\(/)
})
