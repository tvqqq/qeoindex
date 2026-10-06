import test from "node:test"
import assert from "node:assert/strict"
import { getMarketCardActivity } from "../modules/market/board/market-realtime-activity.ts"

const nowMs = Date.parse("2026-10-06T09:45:00+07:00")
const today = "2026-10-06"
const tick = "2026-10-06T09:44:40+07:00"
const older = "2026-10-06T09:42:00+07:00"

test("market card activity requires actual current trading session and same-day source freshness", () => {
  assert.equal(getMarketCardActivity({ sources: [tick], sessionDay: today, nowMs }), "live")
  assert.equal(getMarketCardActivity({ sources: [tick, tick], sessionDay: today, nowMs }), "live")
  assert.equal(getMarketCardActivity({ sources: [tick, older], sessionDay: today, nowMs }), "delayed")
  assert.equal(getMarketCardActivity({ sources: [older], sessionDay: today, nowMs }), "delayed")
  assert.equal(getMarketCardActivity({ sources: ["2026-10-05T09:44:40+07:00"], sessionDay: today, nowMs }), "delayed")
  assert.equal(getMarketCardActivity({ sources: [tick], sessionDay: "2026-10-05", nowMs }), "unavailable")
  assert.equal(getMarketCardActivity({ sources: [], sessionDay: today, nowMs }), "unavailable")
  assert.equal(getMarketCardActivity({ sources: [null], sessionDay: today, nowMs }), "unavailable")
  assert.equal(getMarketCardActivity({ sources: [tick], sessionDay: today, nowMs, canStream: false }), "unavailable")
  assert.equal(getMarketCardActivity({ sources: ["bad"], sessionDay: today, nowMs }), "delayed")
  assert.equal(getMarketCardActivity({ sources: ["2026-10-06T09:46:00+07:00"], sessionDay: today, nowMs }), "delayed")
})

test("market status freezes on lunch, weekends, and EOD rather than pulsing stale data", () => {
  for (const time of ["2026-10-06T11:45:00+07:00", "2026-10-06T15:01:00+07:00", "2026-10-10T09:45:00+07:00"]) {
    assert.equal(getMarketCardActivity({ sources: [tick], sessionDay: today, nowMs: Date.parse(time) }), "closed")
  }
  assert.equal(getMarketCardActivity({ sources: [tick], sessionDay: today, nowMs: Number.NaN }), "unavailable")
})
