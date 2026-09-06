import assert from "node:assert/strict"
import test from "node:test"

import { deriveProbeExDate } from "./qeo122-ex-date-derivation.ts"

const REGIME = "verified-record-minus-one-trading-session-v1"

test("QEO-122 reproduces the retained VHM ~8Y ex-date sequence", () => {
  const cases = [
    ["2018-10-09", "2018-10-08"],
    ["2019-08-09", "2019-08-08"],
    ["2021-09-16", "2021-09-15"],
    ["2022-06-01", "2022-05-31"],
    ["2026-06-30", "2026-06-29"],
    ["2026-08-07", "2026-08-06"],
  ] as const

  for (const [recordDate, exDate] of cases) {
    assert.equal(deriveProbeExDate({ recordDate, exchange: "HOSE", regimeVersion: REGIME })?.exDate, exDate)
  }
})

test("QEO-122 reproduces representative HNX and UPCOM ex-dates", () => {
  const cases = [
    ["2022-06-01", "HNX", "2022-05-31"],
    ["2022-07-15", "UPCOM", "2022-07-14"],
    ["2024-04-16", "UPCOM", "2024-04-15"],
  ] as const

  for (const [recordDate, exchange, exDate] of cases) {
    assert.equal(deriveProbeExDate({ recordDate, exchange, regimeVersion: REGIME })?.exDate, exDate)
  }
})

test("QEO-122 ex-date derivation remains fail-closed for an unproven regime, uncovered date or non-trading record date", () => {
  assert.equal(deriveProbeExDate({ recordDate: "2026-06-30", exchange: "HOSE", regimeVersion: "unknown" }), null)
  assert.equal(deriveProbeExDate({ recordDate: "2017-12-29", exchange: "HOSE", regimeVersion: REGIME }), null)
  assert.equal(deriveProbeExDate({ recordDate: "2026-09-02", exchange: "HOSE", regimeVersion: REGIME }), null)
})
