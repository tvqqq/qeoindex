import test from "node:test"
import assert from "node:assert/strict"

import {
  displayedMarketMetricDay,
  readRetainedMetric,
  validSessionMetricTimestamp,
  writeRetainedMetric,
} from "../modules/market/board/market-context-retention.ts"

test("display last verified trading day until next exchange 09:00 ICT, never midnight or 15:00", () => {
  const day = (time: string) => displayedMarketMetricDay(new Date(time))
  assert.equal(day("2026-10-06T14:59:59+07:00"), "2026-10-06")
  assert.equal(day("2026-10-06T15:16:00+07:00"), "2026-10-06")
  assert.equal(day("2026-10-06T23:59:59+07:00"), "2026-10-06")
  assert.equal(day("2026-10-07T00:01:00+07:00"), "2026-10-06")
  assert.equal(day("2026-10-07T08:59:59+07:00"), "2026-10-06")
  assert.equal(day("2026-10-07T09:00:00+07:00"), "2026-10-07")
  assert.equal(day("2026-10-07T09:15:00+07:00"), "2026-10-07")
  assert.equal(day("2026-10-10T10:00:00+07:00"), "2026-10-09") // Saturday
  assert.equal(day("2026-10-12T08:59:59+07:00"), "2026-10-09") // Monday before open
  assert.equal(day("2026-10-12T09:00:00+07:00"), "2026-10-12")
  assert.equal(day("2026-09-03T08:59:59+07:00"), "2026-08-28") // exchange holiday stretch
  assert.equal(day("2026-09-03T09:00:00+07:00"), "2026-09-03")
  assert.equal(day("invalid"), "")
})

test("only actual source readings from 09:00 of that session qualify for retention", () => {
  assert.equal(validSessionMetricTimestamp("2026-10-06T08:59:59+07:00", "2026-10-06"), false)
  assert.equal(validSessionMetricTimestamp("2026-10-06T09:00:00+07:00", "2026-10-06"), true)
  assert.equal(validSessionMetricTimestamp("2026-10-06T14:46:00+07:00", "2026-10-06"), true)
  assert.equal(validSessionMetricTimestamp("2026-10-05T14:46:00+07:00", "2026-10-06"), false)
  assert.equal(validSessionMetricTimestamp("bad", "2026-10-06"), false)
  assert.equal(validSessionMetricTimestamp("2026-10-06T15:16:00+07:00", "bad"), false)
})

test("EOD reload recovers session-scoped liquidity and signed foreign totals without source mixing", () => {
  const values = new Map<string, string>()
  const store = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
  }
  const day = "2026-10-06"
  writeRetainedMetric(store, "liquidity", {
    day, source: "index-quote", asOf: "2026-10-06T14:45:00+07:00", value: 9_100_000_000_000,
    volume: 408_800_000,
  })
  writeRetainedMetric(store, "foreign", {
    day, source: "top200-partial", asOf: "2026-10-06T14:45:00+07:00",
    buy: 940_400_000_000, sell: 1_660_000_000_000,
  })
  assert.equal(readRetainedMetric(store, "liquidity", "index-quote", day)?.value, 9_100_000_000_000)
  assert.equal(readRetainedMetric(store, "liquidity", "index-quote", day)?.volume, 408_800_000)
  const foreign = readRetainedMetric(store, "foreign", "top200-partial", day)
  assert.equal(foreign?.buy, 940_400_000_000)
  assert.equal(foreign?.sell, 1_660_000_000_000)
  assert.equal((foreign?.buy ?? 0) - (foreign?.sell ?? 0), -719_600_000_000)
  assert.equal(readRetainedMetric(store, "foreign", "finhay-vnindex", day), null)
  assert.equal(readRetainedMetric(store, "foreign", "top200-partial", "2026-10-07"), null)
  assert.equal(readRetainedMetric(store, "liquidity", "index-quote", "2026-10-07"), null)
})

test("stored zero is real, malformed sessions and measurements cannot be reused", () => {
  const values = new Map<string, string>()
  const store = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
  }
  writeRetainedMetric(store, "liquidity", {
    day: "2026-10-06", source: "finhay-vnindex",
    asOf: "2026-10-06T09:15:00+07:00", value: 0, volume: 0,
  })
  writeRetainedMetric(store, "foreign", {
    day: "2026-10-06", source: "finhay-vnindex",
    asOf: "2026-10-06T09:15:00+07:00", buy: 0, sell: 0,
  })
  assert.equal(readRetainedMetric(store, "liquidity", "finhay-vnindex", "2026-10-06")?.value, 0)
  assert.equal(readRetainedMetric(store, "foreign", "finhay-vnindex", "2026-10-06")?.buy, 0)
  const oldSize = values.size
  writeRetainedMetric(store, "foreign", {
    day: "2026-10-07", source: "top200-partial",
    asOf: "2026-10-06T14:46:00+07:00", buy: 10, sell: 20,
  })
  assert.equal(values.size, oldSize)
  const name = [...values.keys()].find((key) => key.includes(":foreign:finhay-vnindex:"))
  assert.ok(name)
  values.set(name, JSON.stringify({ day: "2026-10-06", source: "finhay-vnindex", asOf: "2026-10-06T14:45:00+07:00", buy: -10, sell: 100 }))
  assert.equal(readRetainedMetric(store, "foreign", "finhay-vnindex", "2026-10-06"), null)
  values.set(name, "{bad")
  assert.equal(readRetainedMetric(store, "foreign", "finhay-vnindex", "2026-10-06"), null)
})

test("retained snapshots stay bounded to three sessions per source and survive a corrupt day index", () => {
  const values = new Map<string, string>()
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) },
  }
  for (const day of ["2026-10-01", "2026-10-02", "2026-10-05", "2026-10-06"]) {
    writeRetainedMetric(storage, "liquidity", {
      day, source: "finhay-vnindex", asOf: `${day}T14:45:00+07:00`, value: 10,
    })
  }
  assert.equal(readRetainedMetric(storage, "liquidity", "finhay-vnindex", "2026-10-01"), null)
  for (const day of ["2026-10-02", "2026-10-05", "2026-10-06"]) {
    assert.equal(readRetainedMetric(storage, "liquidity", "finhay-vnindex", day)?.value, 10)
  }
  const daysKey = [...values.keys()].find((key) => key.endsWith(":liquidity:finhay-vnindex:days"))
  assert.ok(daysKey)
  values.set(daysKey, "{corrupt")
  writeRetainedMetric(storage, "liquidity", {
    day: "2026-10-06", source: "finhay-vnindex",
    asOf: "2026-10-06T14:46:00+07:00", value: 11,
  })
  assert.equal(readRetainedMetric(storage, "liquidity", "finhay-vnindex", "2026-10-06")?.value, 11)
  // A delayed REST/poll response must not roll back the persisted close.
  writeRetainedMetric(storage, "liquidity", {
    day: "2026-10-06", source: "finhay-vnindex",
    asOf: "2026-10-06T14:45:00+07:00", value: 1,
  })
  assert.equal(readRetainedMetric(storage, "liquidity", "finhay-vnindex", "2026-10-06")?.value, 11)
})
