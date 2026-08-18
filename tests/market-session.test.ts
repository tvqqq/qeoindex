import test from "node:test"
import assert from "node:assert/strict"

import { isTradingSessionOpen, getVnTimeSeconds } from "../lib/session-countdown.ts"

test("isTradingSessionOpen returns true during active trading hours (09:00 - 15:00 on weekdays)", () => {
  // Tuesday at 10:30 AM ICT (UTC 03:30)
  const tuesday1030 = new Date("2026-08-18T03:30:00Z")
  assert.equal(isTradingSessionOpen(tuesday1030), true)

  // Wednesday at 14:15 PM ICT (UTC 07:15)
  const wednesday1415 = new Date("2026-08-19T07:15:00Z")
  assert.equal(isTradingSessionOpen(wednesday1415), true)
})

test("isTradingSessionOpen returns false outside trading hours and on weekends", () => {
  // Tuesday at 08:30 AM ICT (UTC 01:30) - before open
  const tuesday0830 = new Date("2026-08-18T01:30:00Z")
  assert.equal(isTradingSessionOpen(tuesday0830), false)

  // Tuesday at 15:30 PM ICT (UTC 08:30) - after close
  const tuesday1530 = new Date("2026-08-18T08:30:00Z")
  assert.equal(isTradingSessionOpen(tuesday1530), false)

  // Saturday at 10:00 AM ICT (UTC 03:00) - weekend
  const saturday1000 = new Date("2026-08-22T03:00:00Z")
  assert.equal(isTradingSessionOpen(saturday1000), false)

  // Sunday at 14:00 PM ICT (UTC 07:00) - weekend
  const sunday1400 = new Date("2026-08-23T07:00:00Z")
  assert.equal(isTradingSessionOpen(sunday1400), false)
})
