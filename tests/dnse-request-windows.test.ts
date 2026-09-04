import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  buildDnseRequestWindows,
  dnseWindowSpanDays,
  isRetryableDnseWindowError,
  splitDnseRequestWindow,
} from "../modules/market/providers/dnse/request-windows.ts"

test("DNSE Daily bootstrap keeps a 366-day fast path", () => {
  const from = 1_535_281_948
  const to = from + 800 * 86_400
  const windows = buildDnseRequestWindows(from, to, 366)
  assert.equal(windows.length, 3)
  assert.ok(dnseWindowSpanDays(windows[0]) >= 366)
  assert.equal(windows[0].from, from)
  assert.equal(windows.at(-1)?.to, to)
})

test("a failing large DNSE window can be split recursively without gaps", () => {
  const original = { from: 1_535_281_948, to: 1_566_904_348 }
  const first = splitDnseRequestWindow(original)
  assert.equal(first.length, 2)
  assert.equal(first[0].from, original.from)
  assert.equal(first[0].to + 1, first[1].from)
  assert.equal(first[1].to, original.to)

  const second = first.flatMap(splitDnseRequestWindow)
  assert.equal(second.length, 4)
  assert.equal(second[0].from, original.from)
  assert.equal(second.at(-1)?.to, original.to)
  for (let index = 1; index < second.length; index += 1) {
    assert.equal(second[index - 1].to + 1, second[index].from)
  }
})

test("adaptive DNSE split retries only transient failures", () => {
  for (const error of [
    new Error("The operation was aborted due to timeout"),
    new Error("fetch failed"),
    new Error("DNSE OHLC VGI 1D failed (500): upstream"),
    new Error("DNSE OHLC VGI 1D failed (429): rate limited"),
  ]) {
    assert.equal(isRetryableDnseWindowError(error), true, error.message)
  }

  assert.equal(isRetryableDnseWindowError(new Error("DNSE OHLC VGI 1D failed (401): unauthorized")), false)
  assert.equal(isRetryableDnseWindowError(new Error("DNSE OHLC VGI 1D failed (404): symbol not found")), false)
})

test("Daily transient retry floor is small enough to recover a VGI-like 23-day timeout", () => {
  const historySource = readFileSync("modules/market/providers/dnse/history.ts", "utf8")
  assert.match(historySource, /DAILY_MIN_RETRY_WINDOW_DAYS\s*=\s*7/)
  assert.doesNotMatch(historySource, /DAILY_MIN_RETRY_WINDOW_DAYS\s*=\s*45/)
})