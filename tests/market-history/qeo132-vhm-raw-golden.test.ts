import assert from "node:assert/strict"
import test from "node:test"

import { buildRawDailyObservationPayload } from "../../modules/market/history/raw-daily-store.ts"
import {
  buildStockBizHistoricalQuoteUrl,
  parseStockBizRawDailyHtml,
  summarizeRawDailyRange,
} from "../../modules/market/providers/stockbiz/raw-daily.ts"

function row(
  date: string,
  open: number,
  high: number,
  low: number,
  close: number,
  average: number,
  adjustedClose: number,
  volume: number,
) {
  return `<tr><td>${date}</td><td>fixture</td><td>${open}</td><td>${high}</td><td>${low}</td><td>${close}</td><td>${average}</td><td>${adjustedClose}</td><td>${volume}</td></tr>`
}

const VHM_GOLDEN_HTML = `<table id="stockbiz-history">
  <thead><tr><th>Ngày</th><th>Thay đổi</th><th>Mở cửa</th><th>Cao nhất</th><th>Thấp nhất</th><th>Đóng cửa</th><th>TB</th><th>Đóng cửa ĐC</th><th>Khối lượng</th></tr></thead>
  <tbody>${[
    row("13/10/2025", 123, 126, 122.1, 124.2, 123.79, 59.8, 13_782_200),
    row("14/10/2025", 124.5, 131.5, 124.5, 127, 127.58, 61.15, 14_600_200),
    row("15/10/2025", 127.5, 127.6, 122.6, 124, 124.13, 59.7, 8_062_500),
    row("16/10/2025", 123.8, 123.8, 120.4, 122, 121.76, 58.74, 9_614_900),
    row("17/10/2025", 122, 122, 114.6, 116, 117.27, 55.85, 12_213_500),
    row("26/06/2026", 157.5, 163.9, 156.5, 162, 160.87, 78, 12_073_300),
    row("05/08/2026", 154.2, 158.8, 153, 153, 155.69, 76.5, 10_681_100),
  ].join("")}</tbody>
</table>`

function persistencePayload(bar: ReturnType<typeof parseStockBizRawDailyHtml>[number], fetchedAt: string) {
  const [year, month, day] = bar.sessionDate.split("-")
  return buildRawDailyObservationPayload({
    ticker: bar.ticker,
    sessionDate: bar.sessionDate,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume,
    provider: "StockBiz",
    providerDetail: "QEO-132 frozen VHM raw golden",
    sourceUrl: buildStockBizHistoricalQuoteUrl(bar.ticker, `${day}/${month}/${year}`),
    sourcePriceUnit: bar.sourcePriceUnit,
    normalizationVersion: "stockbiz-raw-v1",
    fetchedAt,
  })
}

test("QEO-132 VHM golden keeps raw weekly range and audit adjusted closes separate", () => {
  const bars = parseStockBizRawDailyHtml(VHM_GOLDEN_HTML, { ticker: "VHM" })
  const week = bars.filter((bar) => bar.sessionDate >= "2025-10-13" && bar.sessionDate <= "2025-10-17")

  assert.deepEqual(summarizeRawDailyRange(week), {
    sessions: 5,
    high: 131.5,
    low: 114.6,
    firstSession: "2025-10-13",
    lastSession: "2025-10-17",
  })

  const june = bars.find((bar) => bar.sessionDate === "2026-06-26")
  const august = bars.find((bar) => bar.sessionDate === "2026-08-05")
  assert.ok(june)
  assert.ok(august)
  assert.equal(june.close, 162)
  assert.equal(june.adjustedClose, 78)
  assert.equal(august.close, 153)
  assert.equal(august.adjustedClose, 76.5)
})

test("QEO-132 VHM golden parser output becomes deterministic RAW persistence input without adjusted-close substitution", () => {
  const bars = parseStockBizRawDailyHtml(VHM_GOLDEN_HTML, { ticker: "VHM" })
  for (const bar of bars) {
    const first = persistencePayload(bar, "2026-09-07T00:00:00Z")
    const replay = persistencePayload(bar, "2026-09-08T00:00:00Z")

    assert.equal(first.price_basis, "RAW")
    assert.equal(first.close, bar.close)
    assert.notEqual(first.close, bar.adjustedClose)
    assert.equal(Object.hasOwn(first, "adjusted_close"), false)
    assert.equal(first.raw_evidence_hash, replay.raw_evidence_hash)
    assert.notEqual(first.fetched_at, replay.fetched_at)
    assert.match(first.raw_evidence_hash, /^[a-f0-9]{64}$/)
  }
})
