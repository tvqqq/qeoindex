import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

function source(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8")
}

test("performance keeps one canonical hook owner while presenting Campaign Results", () => {
  const performance = source("components/portfolio/performance/performance-dashboard.tsx")
  const hookCalls = performance.match(/usePortfolioPerformance\(portfolioId\)/g) ?? []

  assert.match(performance, /Campaign Results|Kết quả chiến dịch/)
  assert.equal(hookCalls.length, 1, "performance dashboard must keep one canonical performance hook owner")
  assert.doesNotMatch(performance, /fetch\(/, "performance dashboard must not add direct performance fetching")
  assert.match(performance, /Mẫu nhỏ:/)
  assert.match(performance, /TradingScorecard/)
  assert.match(performance, /EquityDrawdownPanel/)
  assert.match(performance, /PerformanceLedger/)
  assert.match(performance, /BenchmarkPanel/)
  assert.match(performance, /SegmentsPanel/)
})

test("watchlist becomes a factual Scouting Board while preserving quote-batch ownership", () => {
  const watchlist = source("components/portfolio/watchlist-panel.tsx")
  const card = source("components/portfolio/revamp/scouting-card.tsx")
  const page = source("components/portfolio/portfolio-page.tsx")

  assert.match(watchlist, /ScoutingCard/)
  assert.match(watchlist, /Scouting Board|Trinh sát/)
  assert.match(watchlist, /const tickersKey = useMemo/)
  assert.match(watchlist, /intraday\?tickers=\$\{tickersKey\}/)
  assert.match(watchlist, /Chi tiết Scouting Board/)

  assert.match(card, /item\.ticker/)
  assert.match(card, /quote/)
  assert.match(card, /alert_price_above/)
  assert.match(card, /alert_price_below/)
  assert.match(card, /tags/)
  assert.match(card, /onRemove/)
  assert.doesNotMatch(card, /fetch\(/)
  assert.doesNotMatch(card, /khuyến nghị|recommendation|conviction|mua ngay|nên mua/i)

  assert.match(page, /Scouting Board|Trinh sát/)
})
