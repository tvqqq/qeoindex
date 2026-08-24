import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

test("EOD workflow keeps Node-only Council and Wyckoff work behind cross-file steps", () => {
  const workflow = source("workflows/ai-council-eod-workflow.ts")
  const steps = source("lib/ai-council-eod-workflow-steps.ts")

  assert.match(workflow, /from "@\/lib\/ai-council-eod-workflow-steps"/)
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

  assert.match(steps, /from "@\/lib\/ai-council-operations"/)
  assert.match(steps, /from "@\/lib\/wyckoff-unified-runner"/)
  assert.match(steps, /from "@\/lib\/supabase\/server"/)
})
