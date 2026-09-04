import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import { validateCouncilEvidenceRefs } from "../modules/ai-council/prompt-evidence.ts"

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

test("EOD workflow keeps Node-only Council and Wyckoff work behind cross-file steps", () => {
  const workflow = source("workflows/ai-council-eod-workflow.ts")
  const steps = source("modules/ai-council/eod-workflow-steps.ts")

  assert.match(workflow, /from "@\/modules\/ai-council\/eod-workflow-steps"/)
  assert.match(workflow, /"use workflow"/)
  assert.doesNotMatch(workflow, /"use step"/)
  assert.doesNotMatch(workflow, /ai-council-operations|wyckoff-unified-runner|supabase\/server/)

  for (const stepName of [
    "assertFinalEodMarketReadyStep",
    "runWyckoffBatchStep",
    "validateWyckoffTop100Step",
    "runDeterministicCouncilStep",
    "runLlmDebateStep",
  ]) {
    const start = steps.indexOf(`export async function ${stepName}`)
    assert.ok(start >= 0, `${stepName} must live in the dedicated step module`)
    assert.match(steps.slice(start, start + 220), /"use step"/)
  }

  assert.match(steps, /from "@\/modules\/ai-council\/operations"/)
  assert.match(steps, /from "@\/modules\/wyckoff\/unified-runner"/)
  assert.match(steps, /from "@\/modules\/shared\/supabase\/server"/)
})

test("operational AI Council routes accept an explicit ratingDate for same-session recovery", () => {
  const daily = source("app/api/ai-council/daily/route.ts")
  const debate = source("app/api/ai-council/debate-daily/route.ts")

  for (const route of [daily, debate]) {
    assert.match(route, /searchParams\.get\("ratingDate"\)/)
    assert.match(route, /\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$/)
    assert.match(route, /INVALID_RATING_DATE/)
    assert.match(route, /qeo_verify_eod_scheduler_secret/)
    assert.match(route, /data === true/)
  }

  assert.match(daily, /runAiCouncilDailyOperation\(supabase, operationDate, ratingDate\)/)
  assert.match(debate, /runAiCouncilDebateOperation\(supabase, ratingDate\)/)
})

test("Council evidence refs tolerate only the observed metric's harmless display unit", () => {
  const packet = {
    observedIndicators: {
      kfsp_canslim_score: { value: 100, unit: "score_0_100", asOf: "2026-08-27" },
      pe_ttm: { value: 46.741855078405, unit: "ratio", asOf: "2026-08-27" },
      net_foreign_trading_billion: { value: -61.215358976, unit: "billion_vnd", asOf: "2026-08-27" },
      volume_1d: { value: 6_287_366, unit: "volume", asOf: "2026-08-27" },
      price_vs_sma200_pct: { value: 19.93, unit: "percent", asOf: "2026-08-27" },
    },
    missingIndicators: [],
  } as unknown as Parameters<typeof validateCouncilEvidenceRefs>[2]

  const harmless = [
    ["kfsp_canslim_score", "100 score_0_100"],
    ["pe_ttm", "46.741855078405x"],
    ["net_foreign_trading_billion", "-61.215358976 billion_vnd"],
    ["volume_1d", "6,287,366 volume"],
    ["price_vs_sma200_pct", "19.93 percent"],
  ] as const

  for (const [metricKey, observedValue] of harmless) {
    const result = validateCouncilEvidenceRefs("bull", [{
      metricKey,
      observedValue,
      asOf: "2026-08-27",
      interpretation: "grounded value",
    }], packet)
    assert.equal(result.valid, true, `${metricKey} should accept its own display unit`)
  }

  const composite = validateCouncilEvidenceRefs("bear", [{
    metricKey: "volume_1d",
    observedValue: "6,287,366 volume; average_volume_20d 9,860,945 volume",
    asOf: "2026-08-27",
    interpretation: "composite citation must stay invalid",
  }], packet)
  assert.equal(composite.valid, false)

  const wrongUnit = validateCouncilEvidenceRefs("bear", [{
    metricKey: "pe_ttm",
    observedValue: "46.741855078405 percent",
    asOf: "2026-08-27",
    interpretation: "wrong unit must stay invalid",
  }], packet)
  assert.equal(wrongUnit.valid, false)
})
