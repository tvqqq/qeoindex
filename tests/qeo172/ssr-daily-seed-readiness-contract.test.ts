import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const source = readFileSync(
  new URL("../../components/stock-detail/chart/use-chart-history.ts", import.meta.url),
  "utf8",
)

test("QEO-172 usable 1D SSR seed renders ready without duplicate initial history fetch", () => {
  assert.match(source, /const hasUsableDailySeed = timeframe === "1D" && seedDailyBars\.length > 0/)
  assert.match(source, /useState\(\(\) => !exactPrepared && !hasUsableDailySeed\)/)
  assert.match(
    source,
    /if \(hasUsableDailySeed\) \{[\s\S]*?setLoading\(false\)[\s\S]*?return \(\) => controller\.abort\(\)/,
  )
})
