import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

function source(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8")
}

test("QEO-118 ticker QA API is authenticated no-store and gated by exact rollout flag", () => {
  const route = source("app/api/insights/[ticker]/chat/route.ts")
  assert.match(route, /requireApiFeature\("research"\)/)
  assert.match(route, /TICKER_QA_ENABLED/)
  assert.match(route, /\.trim\(\)\.toLowerCase\(\)\s*===\s*"true"/)
  assert.match(route, /runtime\s*=\s*"nodejs"/)
  assert.match(route, /dynamic\s*=\s*"force-dynamic"/)
  assert.match(route, /Cache-Control["']?\s*:\s*["']no-store["']/)
  assert.match(route, /answerTickerQuestion/)
})

test("QEO-118 route ticker is authoritative and request body cannot override it", () => {
  const route = source("app/api/insights/[ticker]/chat/route.ts")
  assert.match(route, /decodeURIComponent\(rawTicker/)
  assert.match(route, /ticker:\s*ticker/)
  assert.match(route, /question:\s*typeof payload\.question/)
  assert.match(route, /history:\s*payload\.history/)
  assert.doesNotMatch(route, /payload\.ticker|body\.ticker|requestBody\.ticker/)
})

test("QEO-118 API treats Qdrant factory failure as degraded retrieval rather than immediate 5xx", () => {
  const route = source("app/api/insights/[ticker]/chat/route.ts")
  assert.match(route, /createServerTickerKnowledgeIndex/)
  assert.match(route, /try\s*\{[\s\S]*createServerTickerKnowledgeIndex\(\)[\s\S]*\}\s*catch\s*\{/)
  assert.match(route, /index:\s*index/)
})

test("QEO-118 API telemetry never logs raw request body question or history", () => {
  const route = source("app/api/insights/[ticker]/chat/route.ts")
  assert.match(route, /recordTelemetry/)
  assert.match(route, /QEO-118_TICKER_QA/)
  assert.doesNotMatch(route, /console\.(?:info|log|error)\([^\n]*(?:payload|body|question|history)/i)
})
