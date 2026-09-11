import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const browser = readFileSync(
  new URL("../browser/qeo172-chart-performance-production.spec.ts", import.meta.url),
  "utf8",
)

test("QEO-172 acceptance benchmark enforces frozen latency and payload budgets", () => {
  assert.match(browser, /UNCACHED_INITIAL_P95_MS\s*=\s*2500/)
  assert.match(browser, /WARM_TIMEFRAME_P50_MS\s*=\s*150/)
  assert.match(browser, /WARM_TIMEFRAME_P95_MS\s*=\s*500/)
  assert.match(browser, /ADJACENT_P50_MS\s*=\s*300/)
  assert.match(browser, /ADJACENT_P95_MS\s*=\s*800/)
  assert.match(browser, /RENDER_AFTER_NETWORK_P95_MS\s*=\s*200/)
  assert.match(browser, /CURRENT_TAIL_P95_MS\s*=\s*2000/)
  assert.match(browser, /LOCAL_STABLE_REUSE_MAX_MS\s*=\s*50/)
  assert.match(browser, /MAX_PAYLOAD_BYTES\s*=\s*2\s*\*\s*1024\s*\*\s*1024/)
  assert.match(browser, /BENCHMARK_MODE === "acceptance"/)
  assert.match(browser, /enforceAcceptanceBudgets/)
})
