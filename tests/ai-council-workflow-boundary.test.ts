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

test("Firebase App Hosting builds without Vercel Workflow World and pauses all workflow dispatch", () => {
  const nextConfig = source("next.config.mjs")
  const hosting = source("modules/shared/hosting.ts")
  const firebaseConfig = source("apphosting.yaml")
  assert.match(nextConfig, /QEO_HOSTING_PROVIDER === "firebase" \? nextConfig : withWorkflow\(nextConfig\)/)
  assert.match(hosting, /WORKFLOW_PAUSED_FOR_FIREBASE_MIGRATION/)
  assert.match(firebaseConfig, /variable: QEO_HOSTING_PROVIDER/)
  assert.match(firebaseConfig, /value: firebase/)
  assert.match(firebaseConfig, /minInstances: 0/)
  assert.match(firebaseConfig, /cpuAlwaysAllocated: false/)

  for (const route of [
    "app/api/signals/daily/route.ts",
    "app/api/ai-council/eod/route.ts",
    "app/api/qeoindex/eod/route.ts",
    "app/api/qeoindex/chart-universe-bootstrap/route.ts",
    "app/api/research-reports/daily/route.ts",
    "app/api/research-reports/images/backfill/route.ts",
    "app/api/admin/qeoindex/eod/retry/route.ts",
  ]) {
    const code = source(route)
    const guard = code.indexOf("if (!supportsManagedWorkflows()) return pausedWorkflowResponse()")
    const dispatch = code.indexOf("await start(")
    assert.ok(guard >= 0 && dispatch > guard, `${route} must pause before starting a workflow on Firebase`)
  }
  const admin = source("modules/admin/jobs.ts")
  assert.ok(admin.indexOf("if (!supportsManagedWorkflows())") < admin.indexOf('await import("workflow/api")'))

  for (const route of ["app/api/ai-council/daily/route.ts", "app/api/ai-council/debate-daily/route.ts"]) {
    const code = source(route)
    assert.match(code, /if \(isFirebaseAppHosting\(\)\) return pausedWorkflowResponse\(\)/)
  }
})

test("Firebase Hosting redirects Vercel-specific cache and ops integrations to portable fallbacks", () => {
  const adapter = source("modules/shared/cache/hosting-runtime-cache.ts")
  const uiCache = source("modules/shared/cache/ui-data-cache.ts")
  const marketCache = source("modules/market/realtime/intraday-5m-service.ts")
  const invalidator = source("app/api/market/cache/invalidate/route.ts")
  const alerting = source("modules/admin/ops-alerts.ts")
  const layout = source("app/layout.tsx")
  assert.match(adapter, /if \(isFirebaseAppHosting\(env\)\)/)
  assert.match(adapter, /await import\("@vercel\/functions"\)/)
  assert.match(uiCache, /getHostingCache/)
  assert.match(marketCache, /getHostingCache/)
  assert.match(invalidator, /getHostingCache/)
  assert.match(alerting, /SLACK_BOT_TOKEN/)
  assert.match(alerting, /QEO_ALERTS_ENABLED/)
  assert.match(layout, /QEO_HOSTING_PROVIDER !== 'firebase'/)
})
