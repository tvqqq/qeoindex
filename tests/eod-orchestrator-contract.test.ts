import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import { resolveAiCouncilPromptIdentityHash } from "../modules/ai-council/prompt-identity.ts"

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

test("QEO-60 exposes seven stable business phases while retaining internal durable phases", () => {
  const phases = source("modules/admin/job-phases.ts")
  const telemetry = source("modules/admin/job-phase-telemetry.ts")

  for (const phase of [
    "DATA_REFRESH",
    "READY_GATE",
    "HISTORY_PREPARE",
    "WYCKOFF_PUBLISH",
    "AI_COUNCIL",
    "POST_ANALYSIS",
    "COMPLETE",
  ]) {
    assert.match(phases, new RegExp(`key: "${phase}"`), `missing business phase ${phase}`)
  }
  assert.match(phases, /QEOINDEX_EOD_BUSINESS_PHASES/)
  assert.match(phases, /QEOINDEX_EOD_INTERNAL_PHASE_TO_BUSINESS/)
  assert.match(telemetry, /businessPhase/)
  assert.match(telemetry, /QEOINDEX_EOD_INTERNAL_PHASE_TO_BUSINESS/)
})

test("QEO-60 runs TTAI and Market Close as sibling branches only after Rating and joins before READY", () => {
  const workflow = source("workflows/qeoindex-eod-pipeline.ts")
  const body = workflow.slice(workflow.indexOf("export async function qeoindexEodPipeline"))

  const rating = body.indexOf("runKfspRatingRefreshStep")
  const parallel = body.indexOf("Promise.all", rating)
  const ttai = body.indexOf("runTtaiRefreshBranch", rating)
  const marketClose = body.indexOf("runMarketCloseBranch", rating)
  const ready = body.indexOf("runEodReadyStep", rating)

  assert.ok(rating >= 0, "Rating refresh must exist")
  assert.ok(parallel > rating, "parallel join must start only after Rating freezes the universe")
  assert.ok(ttai > rating && ttai < ready, "TTAI branch must execute after Rating and before READY")
  assert.ok(marketClose > rating && marketClose < ready, "Market Close branch must execute after Rating and before READY")
  assert.ok(ready > parallel, "READY must wait for the sibling branches")
  assert.match(body.slice(rating, ready), /assertFrozenUniverseStillCurrent/)
})

test("QEO-60 bounds provider history concurrency with a configurable hard cap", () => {
  const workflow = source("workflows/qeoindex-eod-pipeline.ts")
  const steps = source("modules/eod/workflow-steps.ts")

  assert.match(workflow, /QEOINDEX_EOD_HISTORY_CONCURRENCY/)
  assert.match(workflow, /HISTORY_CONCURRENCY_MAX/)
  assert.match(workflow, /runHistoryRefreshWindowStep/)
  assert.match(steps, /export async function runHistoryRefreshWindowStep/)
  assert.match(steps, /Promise\.all/)
  assert.match(steps, /HISTORY_REFRESH_BATCH_SIZE\s*=\s*10/)
  assert.doesNotMatch(workflow, /Promise\.all\(ready\.stocks\.map/)
})

test("QEO-60 enforces Deterministic Council then Market Synthesis then LLM debate", () => {
  const workflow = source("workflows/qeoindex-eod-pipeline.ts")
  const body = workflow.slice(workflow.indexOf("export async function qeoindexEodPipeline"))

  const deterministic = body.indexOf("runDeterministicCouncilStep")
  const synthesis = body.indexOf("runMarketSynthesisStep")
  const llm = body.indexOf("runLlmDebateStep")

  assert.ok(deterministic >= 0)
  assert.ok(synthesis > deterministic, "Market Synthesis must follow deterministic Council")
  assert.ok(llm > synthesis, "LLM debate must consume the market synthesis stage after deterministic Council")
})

test("QEO-64 waits for terminal Market Synthesis and injects its exact-session context into LLM evidence", () => {
  const synthesisStep = source("modules/eod/market-synthesis-step.ts")
  const steps = source("modules/eod/workflow-steps.ts")
  const operations = source("modules/ai-council/operations.ts")
  const promptEvidence = source("modules/ai-council/prompt-evidence.ts")
  const promptIdentity = source("modules/ai-council/prompt-identity.ts")

  assert.match(synthesisStep, /awaitMarketSynthesisConclusion/, "synthesis phase must wait for an exact-session terminal conclusion")
  assert.match(synthesisStep, /status:\s*"succeeded"/, "synthesis phase must expose terminal success, not enqueue success")
  assert.doesNotMatch(synthesisStep, /status:\s*"queued"/, "enqueue success is not completion evidence")
  assert.match(synthesisStep, /getMarketCloseInsightData[\s\S]*ratingDate/, "synthesis must bind to the exact session snapshot")
  assert.match(synthesisStep, /market_ai_conclusions/, "synthesis must consume persisted terminal Market AI evidence")
  assert.match(synthesisStep, /snapshot_id/, "synthesis must bind to the persisted snapshot identity")
  assert.match(synthesisStep, /crypto\.subtle\.digest/, "snapshot identity must remain workflow-compatible without Node crypto")
  assert.doesNotMatch(synthesisStep, /market-ai-conclusion-loader/, "workflow path must not import the Node-only Market AI loader")

  assert.match(steps, /loadMarketSynthesisContext[\s\S]*runAiCouncilDebateOperation/, "LLM step must load completed synthesis before the debate operation")
  assert.match(operations, /marketSynthesis/, "AI Council operation must consume market synthesis context")
  assert.match(promptEvidence, /researchContext/, "LLM point-in-time packet must retain the context layer that carries synthesis")
  assert.match(promptIdentity, /marketSynthesisHash/, "prompt/cache identity must change when synthesis evidence changes")
  assert.match(promptIdentity, /marketSynthesis[\s\S]*evidenceHash/, "identity must bind to the persisted synthesis evidence hash")
})

test("QEO-64 Market Synthesis evidence hash participates in prompt/cache identity", () => {
  const base = {
    evidenceHash: "1".repeat(64),
    llmEvidence: { contextHash: "2".repeat(64) },
    researchContext: {
      contextHash: "3".repeat(64),
      marketSynthesis: { evidenceHash: "4".repeat(64) },
    },
  }
  const first = resolveAiCouncilPromptIdentityHash(base, "llm-debate-v3-first-class-context")
  const second = resolveAiCouncilPromptIdentityHash({
    ...base,
    researchContext: {
      ...base.researchContext,
      marketSynthesis: { evidenceHash: "5".repeat(64) },
    },
  }, "llm-debate-v3-first-class-context")
  const withoutSynthesis = resolveAiCouncilPromptIdentityHash({
    evidenceHash: base.evidenceHash,
    llmEvidence: base.llmEvidence,
    researchContext: { contextHash: base.researchContext.contextHash },
  }, "llm-debate-v3-first-class-context")

  assert.notEqual(first, second)
  assert.notEqual(first, withoutSynthesis)
})

test("QEO-60 keeps historical backfill explicit and never runs current Rating/TTAI refresh in that branch", () => {
  const workflow = source("workflows/qeoindex-eod-pipeline.ts")
  const body = workflow.slice(workflow.indexOf("if (historicalBackfill)"), workflow.indexOf("if (!ready)"))
  const historical = body.slice(0, body.indexOf("} else {"))

  assert.match(historical, /runEodBackfillReadyStep/)
  assert.match(historical, /runMarketCloseCollectStep\(runId, startedAtIso, false\)/)
  assert.doesNotMatch(historical, /runKfspRatingRefreshStep|runTtaiRefreshStep/)
})
