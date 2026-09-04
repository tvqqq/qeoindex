import { readFileSync, writeFileSync } from "node:fs"

function read(path) {
  return readFileSync(path, "utf8")
}

function write(path, content) {
  writeFileSync(path, content.endsWith("\n") ? content : `${content}\n`)
}

function replaceRequired(path, from, to, label) {
  const content = read(path)
  if (!content.includes(from)) throw new Error(`Missing ${label} in ${path}`)
  write(path, content.replace(from, to))
}

function removeDeepEodImports(content) {
  const lines = content.split("\n")
  const out = []
  for (let index = 0; index < lines.length;) {
    if (!lines[index].startsWith("import ")) {
      out.push(lines[index])
      index += 1
      continue
    }

    const block = [lines[index]]
    index += 1
    while (
      index < lines.length
      && !block.join("\n").match(/from\s+["'][^"']+["']\s*$/)
      && !block[0].match(/^import\s+["'][^"']+["']\s*$/)
    ) {
      block.push(lines[index])
      index += 1
    }
    const text = block.join("\n")
    if (/from\s+["']@\/modules\/eod\//.test(text)) continue
    out.push(...block)
  }
  return out.join("\n")
}

write("modules/ai-council/market-synthesis-context.ts", `export interface AiCouncilMarketSynthesisContext {
  sessionDate: string
  asOf: string
  evidenceHash: string
  posture: string
  confidence: string
  headline: string
  conclusion: string
  risks: string[]
}
`)

replaceRequired(
  "modules/ai-council/operations.ts",
  'import type { EodMarketSynthesisContext } from "@/modules/eod/market-synthesis-step"',
  'import type { AiCouncilMarketSynthesisContext } from "@/modules/ai-council/market-synthesis-context"',
  "AI Council EOD-owned market synthesis type import",
)
replaceRequired(
  "modules/ai-council/operations.ts",
  "marketSynthesis?: EodMarketSynthesisContext | null,",
  "marketSynthesis?: AiCouncilMarketSynthesisContext | null,",
  "AI Council market synthesis parameter type",
)

const synthesisPath = "modules/eod/market-synthesis-step.ts"
let synthesis = read(synthesisPath)
const supabaseImport = 'import type { SupabaseClient } from "@supabase/supabase-js"\n'
if (!synthesis.includes(supabaseImport)) throw new Error("Missing Supabase import anchor in market synthesis step")
synthesis = synthesis.replace(
  supabaseImport,
  `${supabaseImport}\nimport type { AiCouncilMarketSynthesisContext } from "@/modules/ai-council/market-synthesis-context"\n`,
)
const contextInterface = `export interface EodMarketSynthesisContext {
  sessionDate: string
  asOf: string
  evidenceHash: string
  posture: string
  confidence: string
  headline: string
  conclusion: string
  risks: string[]
}`
if (!synthesis.includes(contextInterface)) throw new Error("Missing EOD market synthesis context interface")
synthesis = synthesis.replace(
  contextInterface,
  "export type EodMarketSynthesisContext = AiCouncilMarketSynthesisContext",
)
write(synthesisPath, synthesis)

write("modules/eod/index.ts", `export { runEodBackfillReadyStep } from "./backfill-ready-step"
export {
  assertFrozenUniverseStillCurrent,
  assertReadyMatchesFrozenUniverse,
  runKfspRatingRefreshStep,
  runTtaiRefreshStep,
} from "./data-refresh-steps"
export type { TtaiRefreshProgress } from "./data-refresh-steps"
export { failQeoIndexEodRunStep } from "./failure-step"
export {
  persistHistoryTickerAttemptsStep,
  revalidateFullCanonicalArtifactsStep,
  runTargetedHistoryRetryStep,
  runTargetedWyckoffRetryStep,
  runWyckoffBuildIsolatedStep,
} from "./fault-steps"
export {
  appendTickerAttempts,
  computeEodTickerCoverage,
  latestTickerStageAttempts,
  selectRetryTickers,
} from "./fault-isolation"
export type { EodTickerAttempt } from "./fault-isolation"
export { runMarketSynthesisStep } from "./market-synthesis-step"
export { runEodNoTradeDailyRepairStep } from "./no-trade-repair-step"
export { runNotionAnalyticalSummaryStep } from "./notion-summary-step"
export { completeQeoIndexEodPartialStep } from "./partial-step"
export { runRetentionCleanupStep } from "./retention-step"
export { completeRecoveredEodRunStep, loadEodRetryContextStep } from "./retry-steps"
export { skipQeoIndexEodRunStep } from "./skip-step"
export {
  runCompleteStep,
  runEodReadyStep,
  runMarketCloseCollectStep,
  startQeoIndexEodRunStep,
} from "./runtime-steps"
export {
  HISTORY_REFRESH_BATCH_SIZE,
  runDeterministicCouncilStep,
  runHistoryRefreshWindowStep,
  runLlmDebateStep,
  runSupabasePublishStep,
  runSupabaseValidateStep,
  runWyckoffBuildStep,
} from "./workflow-steps"
`)

const pipelinePath = "workflows/qeoindex-eod-pipeline.ts"
let pipeline = removeDeepEodImports(read(pipelinePath))
const pipelineAnchor = 'import { sleep } from "workflow"\n\n'
if (!pipeline.includes(pipelineAnchor)) throw new Error("Missing pipeline import anchor")
const pipelineApi = `import {
  HISTORY_REFRESH_BATCH_SIZE,
  appendTickerAttempts,
  assertFrozenUniverseStillCurrent,
  assertReadyMatchesFrozenUniverse,
  completeQeoIndexEodPartialStep,
  computeEodTickerCoverage,
  failQeoIndexEodRunStep,
  persistHistoryTickerAttemptsStep,
  runCompleteStep,
  runDeterministicCouncilStep,
  runEodBackfillReadyStep,
  runEodNoTradeDailyRepairStep,
  runEodReadyStep,
  runHistoryRefreshWindowStep,
  runKfspRatingRefreshStep,
  runLlmDebateStep,
  runMarketCloseCollectStep,
  runMarketSynthesisStep,
  runNotionAnalyticalSummaryStep,
  runRetentionCleanupStep,
  runSupabasePublishStep,
  runSupabaseValidateStep,
  runTtaiRefreshStep,
  runWyckoffBuildIsolatedStep,
  runWyckoffBuildStep,
  skipQeoIndexEodRunStep,
  startQeoIndexEodRunStep,
  type EodTickerAttempt,
  type TtaiRefreshProgress,
} from "@/modules/eod"

`
pipeline = pipeline.replace(pipelineAnchor, `${pipelineAnchor}${pipelineApi}`)
write(pipelinePath, pipeline)

const retryPath = "workflows/qeoindex-eod-retry.ts"
let retry = removeDeepEodImports(read(retryPath))
const retryApi = `import {
  appendTickerAttempts,
  completeQeoIndexEodPartialStep,
  completeRecoveredEodRunStep,
  computeEodTickerCoverage,
  latestTickerStageAttempts,
  loadEodRetryContextStep,
  revalidateFullCanonicalArtifactsStep,
  runDeterministicCouncilStep,
  runLlmDebateStep,
  runMarketSynthesisStep,
  runNotionAnalyticalSummaryStep,
  runRetentionCleanupStep,
  runSupabasePublishStep,
  runTargetedHistoryRetryStep,
  runTargetedWyckoffRetryStep,
  selectRetryTickers,
} from "@/modules/eod"

`
retry = `${retryApi}${retry.replace(/^\n+/, "")}`
write(retryPath, retry)

console.log("QEO-67 public EOD boundary finalized")
