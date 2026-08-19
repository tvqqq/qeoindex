import test from "node:test"
import assert from "node:assert/strict"

import { isTradingSessionOpen, isLunchBreak, getMarketSessionStatus, getVnTimeSeconds } from "../lib/session-countdown.ts"

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

test("isLunchBreak returns true only between 11:30 and 13:00 on weekdays", () => {
  // Tuesday at 11:30 AM ICT (UTC 04:30) -> true
  const tuesday1130 = new Date("2026-08-18T04:30:00Z")
  assert.equal(isLunchBreak(tuesday1130), true)

  // Tuesday at 12:15 PM ICT (UTC 05:15) -> true
  const tuesday1215 = new Date("2026-08-18T05:15:00Z")
  assert.equal(isLunchBreak(tuesday1215), true)

  // Tuesday at 12:59:59 PM ICT (UTC 05:59:59) -> true
  const tuesday1259 = new Date("2026-08-18T05:59:59Z")
  assert.equal(isLunchBreak(tuesday1259), true)

  // Tuesday at 11:29:59 AM ICT (UTC 04:29:59) -> false
  const tuesday1129 = new Date("2026-08-18T04:29:59Z")
  assert.equal(isLunchBreak(tuesday1129), false)

  // Tuesday at 13:00:00 PM ICT (UTC 06:00:00) -> false
  const tuesday1300 = new Date("2026-08-18T06:00:00Z")
  assert.equal(isLunchBreak(tuesday1300), false)

  // Saturday at 12:00 PM ICT (UTC 05:00) -> false (weekend)
  const saturday1200 = new Date("2026-08-22T05:00:00Z")
  assert.equal(isLunchBreak(saturday1200), false)
})

test("getMarketSessionStatus returns accurate session phase, live flag, and cache keys", () => {
  // 1. Tuesday 08:30 AM ICT (Pre-market)
  const preMarket = new Date("2026-08-18T01:30:00Z")
  const preStatus = getMarketSessionStatus(preMarket)
  assert.equal(preStatus.phase, "PRE_MARKET")
  assert.equal(preStatus.isLiveSession, false)
  assert.equal(preStatus.cacheBucketKey, "pre_market")
  assert.equal(preStatus.ttlSeconds, 1800) // 30 mins to 09:00

  // 2. Tuesday 10:30 AM ICT (Morning session)
  const morning = new Date("2026-08-18T03:30:00Z")
  const morningStatus = getMarketSessionStatus(morning)
  assert.equal(morningStatus.phase, "MORNING")
  assert.equal(morningStatus.isLiveSession, true)
  assert.match(morningStatus.cacheBucketKey, /^m_\d+$/)

  // 3. Tuesday 12:00 PM ICT (Lunch break)
  const lunch = new Date("2026-08-18T05:00:00Z")
  const lunchStatus = getMarketSessionStatus(lunch)
  assert.equal(lunchStatus.phase, "LUNCH_BREAK")
  assert.equal(lunchStatus.isLiveSession, false)
  assert.equal(lunchStatus.cacheBucketKey, "lunch_break")
  assert.equal(lunchStatus.ttlSeconds, 3600) // 1 hour to 13:00

  // 4. Tuesday 14:00 PM ICT (Afternoon session)
  const afternoon = new Date("2026-08-18T07:00:00Z")
  const afternoonStatus = getMarketSessionStatus(afternoon)
  assert.equal(afternoonStatus.phase, "AFTERNOON")
  assert.equal(afternoonStatus.isLiveSession, true)
  assert.match(afternoonStatus.cacheBucketKey, /^a_\d+$/)

  // 5. Tuesday 18:00 PM ICT (EOD Closed)
  const eod = new Date("2026-08-18T11:00:00Z")
  const eodStatus = getMarketSessionStatus(eod)
  assert.equal(eodStatus.phase, "EOD_CLOSED")
  assert.equal(eodStatus.isLiveSession, false)
  assert.equal(eodStatus.cacheBucketKey, "eod_closed")
  assert.ok(eodStatus.ttlSeconds > 3600)

  // 6. Saturday 14:00 PM ICT (Weekend)
  const weekend = new Date("2026-08-22T07:00:00Z")
  const weekendStatus = getMarketSessionStatus(weekend)
  assert.equal(weekendStatus.phase, "EOD_CLOSED")
  assert.equal(weekendStatus.isLiveSession, false)
  assert.equal(weekendStatus.cacheBucketKey, "eod_closed")
  assert.ok(weekendStatus.ttlSeconds > 86400)
})

