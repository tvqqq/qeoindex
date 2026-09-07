import assert from "node:assert/strict"
import test from "node:test"

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
  return `<tr>
    <td>${date}</td><td>fixture</td><td>${open}</td><td>${high}</td><td>${low}</td>
    <td>${close}</td><td>${average}</td><td>${adjustedClose}</td><td>${volume}</td>
  </tr>`
}

function table(rows: string, headers = [
  "Ngày", "Thay đổi", "Mở cửa", "Cao nhất", "Thấp nhất", "Đóng cửa", "TB", "Đóng cửa ĐC", "Khối lượng",
]) {
  return `<table id="stockbiz-history">
    <thead><tr>${headers.map((header) => `<th>${header}</th>`).join("")}</tr></thead>
    <tbody>${rows}</tbody>
  </table>`
}

const VHM_GOLDEN_HTML = table([
  row("13/10/2025", 123, 126, 122.1, 124.2, 123.79, 59.8, 13_782_200),
  row("14/10/2025", 124.5, 131.5, 124.5, 127, 127.58, 61.15, 14_600_200),
  row("15/10/2025", 127.5, 127.6, 122.6, 124, 124.13, 59.7, 8_062_500),
  row("16/10/2025", 123.8, 123.8, 120.4, 122, 121.76, 58.74, 9_614_900),
  row("17/10/2025", 122, 122, 114.6, 116, 117.27, 55.85, 12_213_500),
  row("26/06/2026", 157.5, 163.9, 156.5, 162, 160.87, 78, 12_073_300),
  row("05/08/2026", 154.2, 158.8, 153, 153, 155.69, 76.5, 10_681_100),
].join(""))

test("QEO-132 parses StockBiz raw OHLC separately from adjusted close", () => {
  const bars = parseStockBizRawDailyHtml(VHM_GOLDEN_HTML, { ticker: "VHM" })
  assert.equal(bars.length, 7)

  const june = bars.find((bar) => bar.sessionDate === "2026-06-26")
  assert.deepEqual(june, {
    ticker: "VHM",
    sessionDate: "2026-06-26",
    open: 157.5,
    high: 163.9,
    low: 156.5,
    close: 162,
    volume: 12_073_300,
    adjustedClose: 78,
    priceBasis: "RAW",
    sourcePriceUnit: "VND_THOUSANDS",
  })
  assert.notEqual(june?.close, june?.adjustedClose)

  const august = bars.find((bar) => bar.sessionDate === "2026-08-05")
  assert.equal(august?.close, 153)
  assert.equal(august?.adjustedClose, 76.5)
  assert.equal(august?.priceBasis, "RAW")
})

test("QEO-132 reproduces VHM raw golden week without adjusted-price substitution", () => {
  const bars = parseStockBizRawDailyHtml(VHM_GOLDEN_HTML, { ticker: "VHM" })
    .filter((bar) => bar.sessionDate >= "2025-10-13" && bar.sessionDate <= "2025-10-17")
  const summary = summarizeRawDailyRange(bars)
  assert.deepEqual(summary, {
    sessions: 5,
    high: 131.5,
    low: 114.6,
    firstSession: "2025-10-13",
    lastSession: "2025-10-17",
  })
})

test("QEO-132 builds only bounded StockBiz ticker/date URLs", () => {
  assert.equal(
    buildStockBizHistoricalQuoteUrl("vhm", "05/08/2026"),
    "https://web.stockbiz.vn/Stocks/VHM/LookupQuote.aspx?Date=05%2F08%2F2026",
  )
  assert.throws(() => buildStockBizHistoricalQuoteUrl("../VHM", "05/08/2026"), /ticker/i)
  assert.throws(() => buildStockBizHistoricalQuoteUrl("VHM", "2026-08-05"), /date/i)
  assert.throws(() => buildStockBizHistoricalQuoteUrl("VHM", "32/08/2026"), /date/i)
})

test("QEO-132 fails closed when StockBiz semantic columns are missing or ambiguous", () => {
  const missingAdjusted = table(
    row("05/08/2026", 154.2, 158.8, 153, 153, 155.69, 76.5, 10_681_100),
    ["Ngày", "Thay đổi", "Mở cửa", "Cao nhất", "Thấp nhất", "Đóng cửa", "TB", "Khác", "Khối lượng"],
  )
  assert.throws(() => parseStockBizRawDailyHtml(missingAdjusted, { ticker: "VHM" }), /column|header|adjusted/i)

  const duplicateCloseHeader = table(
    row("05/08/2026", 154.2, 158.8, 153, 153, 155.69, 76.5, 10_681_100),
    ["Ngày", "Thay đổi", "Mở cửa", "Cao nhất", "Thấp nhất", "Đóng cửa", "TB", "Đóng cửa", "Khối lượng"],
  )
  assert.throws(() => parseStockBizRawDailyHtml(duplicateCloseHeader, { ticker: "VHM" }), /column|header|adjusted|ambiguous/i)
})

test("QEO-132 does not recursively unescape double-escaped semantic headers", () => {
  const doubleEscapedDateHeader = table(
    row("05/08/2026", 154.2, 158.8, 153, 153, 155.69, 76.5, 10_681_100),
    ["&amp;lt;span&amp;gt;Ngày&amp;lt;/span&amp;gt;", "Thay đổi", "Mở cửa", "Cao nhất", "Thấp nhất", "Đóng cửa", "TB", "Đóng cửa ĐC", "Khối lượng"],
  )

  assert.throws(
    () => parseStockBizRawDailyHtml(doubleEscapedDateHeader, { ticker: "VHM" }),
    /column|header|missing|ambiguous/i,
  )
})

test("QEO-132 rejects invalid OHLC, volume, date and duplicate session evidence", () => {
  const invalidOhlc = table(row("05/08/2026", 154.2, 152, 153, 153, 153.5, 76.5, 10_681_100))
  assert.throws(() => parseStockBizRawDailyHtml(invalidOhlc, { ticker: "VHM" }), /OHLC|high/i)

  const invalidVolume = table(row("05/08/2026", 154.2, 158.8, 153, 153, 155.69, 76.5, -1))
  assert.throws(() => parseStockBizRawDailyHtml(invalidVolume, { ticker: "VHM" }), /volume/i)

  const invalidDate = table(row("31/02/2026", 154.2, 158.8, 153, 153, 155.69, 76.5, 10_681_100))
  assert.throws(() => parseStockBizRawDailyHtml(invalidDate, { ticker: "VHM" }), /date/i)

  const duplicate = table([
    row("05/08/2026", 154.2, 158.8, 153, 153, 155.69, 76.5, 10_681_100),
    row("05/08/2026", 154.2, 158.8, 153, 153, 155.69, 76.5, 10_681_100),
  ].join(""))
  assert.throws(() => parseStockBizRawDailyHtml(duplicate, { ticker: "VHM" }), /duplicate|ambiguous/i)
})
