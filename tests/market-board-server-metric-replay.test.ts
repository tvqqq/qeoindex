import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

import {
  buildBoardMetricReplay, preferObservedReplay,
  type PersistedBoardMetric,
} from "../modules/market/board/metric-replay.ts"

const today = "2026-10-07"
const previous = "2026-10-06"
const now = new Date("2026-10-07T02:45:00.000Z")
const time = (day: string, hhmm: string) => day + "T" + hhmm + ":00+07:00"
const row = (day: string, hhmm: string, kind: "liquidity" | "foreign", override: Partial<PersistedBoardMetric> = {}): PersistedBoardMetric => ({
  session_date: day,
  minute_at: new Date(time(day, hhmm)).toISOString(),
  source_as_of: new Date(time(day, hhmm)).toISOString(),
  kind,
  source: kind === "liquidity" ? "index-quote" : "top200-partial",
  traded_value: kind === "liquidity" ? 1000 : null,
  volume: kind === "liquidity" ? 50 : null,
  buy_value: kind === "foreign" ? 200 : null,
  sell_value: kind === "foreign" ? 300 : null,
  covered_symbols: kind === "foreign" ? 174 : null,
  ...override,
})

test("fresh mid-session browser hydrates real unattended 09:15-to-now liquidity and foreign history", () => {
  const rows = [
    row(today, "09:15", "liquidity", { traded_value: 10 }),
    row(today, "09:30", "liquidity", { traded_value: 20 }),
    row(today, "09:40", "liquidity", { traded_value: 30 }),
    row(today, "09:15", "foreign", { buy_value: 1, sell_value: 2 }),
    row(today, "09:40", "foreign", { buy_value: 4, sell_value: 7 }),
    row(previous, "09:15", "liquidity", { traded_value: 50 }),
    row(previous, "09:40", "liquidity", { traded_value: 80 }),
  ]
  const replay = buildBoardMetricReplay(rows.reverse(), today, now)
  assert.deepEqual(replay.liquidity.today.map(p => p.value), [10, 20, 30])
  assert.deepEqual(replay.liquidity.previous.map(p => p.value), [50, 80])
  assert.equal(replay.previousDay, previous)
  assert.deepEqual(replay.foreign.today.map(p => p.buy - p.sell), [-1, -3])
  assert.deepEqual(preferObservedReplay(replay.liquidity.today, []), replay.liquidity.today)
})

test("no synthetic past points, scoped source and provider-time checks", () => {
  const invalid = [
    row(today, "09:25", "foreign", { source: "finhay-vnindex" }),
    row(today, "09:30", "foreign", { covered_symbols: 0 }),
    row(today, "09:30", "foreign", { buy_value: null }),
    row(today, "09:35", "liquidity", { source: "top200-partial" }),
    row(today, "09:35", "liquidity", { traded_value: null }),
    row(today, "09:38", "liquidity", { source_as_of: time(previous, "14:45") }),
    row(today, "09:40", "liquidity", { source_as_of: time(today, "09:35") }),
    row(today, "15:01", "liquidity"),
    row("2026-10-05", "09:20", "foreign"),
  ]
  const replay = buildBoardMetricReplay([row(today, "09:20", "liquidity"), ...invalid], today, now)
  assert.equal(replay.liquidity.today.length, 1)
  assert.equal(replay.foreign.today.length, 0)
  assert.deepEqual(preferObservedReplay([], [{ minute: 1, value: 10 }]), [{ minute: 1, value: 10 }])
  assert.equal(preferObservedReplay([], []).length, 0)
})

test("same source same minute is deduplicated without overwriting observed samples", () => {
  const first = row(today, "09:15", "foreign", { buy_value: 0, sell_value: 0, covered_symbols: 1 })
  const replay = buildBoardMetricReplay([first, first], today, now)
  assert.equal(replay.foreign.today.length, 1)
  assert.equal(replay.foreign.today[0]?.buy, 0)
  assert.equal(replay.foreign.today[0]?.sell, 0)
})

test("unattended capture is a database cron reading worker checkpoint, never a browser timer", () => {
  const migration = readFileSync(new URL("../supabase/migrations/20261007094500_qeo332_server_market_board_metric_replay.sql", import.meta.url), "utf8")
  const api = readFileSync(new URL("../app/api/market/metric-history/route.ts", import.meta.url), "utf8")
  const ui = readFileSync(new URL("../components/market-board/market-context-strip.tsx", import.meta.url), "utf8")
  const router = readFileSync(new URL("../services/market-realtime-worker/internal/worker/frame_router.go", import.meta.url), "utf8")

  assert.match(migration, /cron.schedule\('qeo-board-intraday-minute', '\* 2-7 \* \* 1-5'/)
  assert.match(migration, /from public.market_realtime_bus/)
  assert.match(migration, /stream = 'dnse-market'/)
  assert.match(migration, /grossTradeAmount/)
  assert.match(migration, /totalBuyTradedAmount/)
  assert.match(migration, /multicastReceiveTime/)
  assert.match(migration, /source_as_of >= market_board_intraday_minutes.source_as_of/)
  assert.match(migration, /covered_symbols between 1 and 200/)
  assert.match(migration, /enable row level security/)
  assert.match(migration, /revoke all on function public.qeo_capture_market_board_minute/)
  assert.doesNotMatch(migration, /insert into public.market_ohlcv_history|generate_series\(/)
  assert.match(router, /retainVNINDEX/)
  assert.match(api, /requireApiFeature\("market_board"\)/)
  assert.match(ui, /fetch\("\/api\/market\/metric-history"/)
  assert.match(ui, /foreignChartPartial/)
  assert.match(ui, /Biểu đồ: DNSE chỉ Top 200/)
  assert.doesNotMatch(api, /FINHAY_OAUTH|DNSE_API_KEY/)
})
