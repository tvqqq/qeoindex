import { readFileSync, writeFileSync, rmSync } from "node:fs"

function read(path) {
  return readFileSync(path, "utf8")
}

function extract(source, start, end) {
  const startIndex = source.indexOf(start)
  if (startIndex < 0) throw new Error(`Missing start marker: ${start}`)
  const endIndex = end ? source.indexOf(end, startIndex) : source.length
  if (end && endIndex < 0) throw new Error(`Missing end marker: ${end}`)
  return source.slice(startIndex, endIndex).trimEnd()
}

function requireReplace(source, oldValue, newValue, label) {
  if (!source.includes(oldValue)) throw new Error(`Missing replacement target: ${label}`)
  return source.replace(oldValue, newValue)
}

const legacyWorkflowPath = "lib/qeoindex-eod-workflow-steps-legacy.ts"
const workflowPath = "lib/qeoindex-eod-workflow-steps.ts"
const runtimePath = "lib/qeoindex-eod-runtime-steps.ts"
const legacyArchivePath = "lib/qeoindex-eod-archive-legacy.ts"
const archivePath = "lib/qeoindex-eod-archive.ts"
const backfillPath = "lib/qeoindex-eod-backfill-ready-step.ts"

const legacyWorkflow = read(legacyWorkflowPath)
const currentWorkflow = read(workflowPath)
const currentArchive = read(archivePath)

const runtimeImports = `import "server-only"

import { markQeoIndexEodPhaseSkipped, runQeoIndexEodPhase } from "@/lib/admin/job-phase-telemetry"
import { QEOINDEX_EOD_JOB_KEY } from "@/lib/admin/job-phases"
import { getCanonicalUniverse } from "@/lib/market-universe"
import { getSupabaseServerClient } from "@/lib/supabase/server"
import { vietnamDateKey } from "@/lib/vn-market-calendar"
import { loadWyckoffV2Universe } from "@/lib/wyckoff-v2-universe-source"
`

const runtimeParts = [
  extract(legacyWorkflow, "function requiredSupabase()", "function vietnamDateKey"),
  extract(legacyWorkflow, "async function assertFinalEodMarketReady", "async function buildAllSnapshots"),
  extract(legacyWorkflow, "export async function startQeoIndexEodRunStep", "export async function runEodReadyStep"),
  extract(legacyWorkflow, "export async function runEodReadyStep", "export async function runMarketCloseCollectStep"),
  extract(legacyWorkflow, "export async function runMarketCloseCollectStep", "function mergeHistoryRefreshProgress"),
  extract(legacyWorkflow, "export async function runCompleteStep", null),
]

let runtime = `${runtimeImports}\n${runtimeParts.join("\n\n")}\n`
runtime = runtime
  .replaceAll("-EOD-v3", "-EOD-v4")
  .replaceAll('"supabase-first-eod-v3"', '"supabase-first-eod-v4-dag"')
writeFileSync(runtimePath, runtime)

let workflow = currentWorkflow
workflow = workflow.replace(
  /import \{\n  archiveCanonicalUniverseBatchToNotion,[\s\S]*?\n\} from "@\/lib\/qeoindex-eod-archive"\n/,
  "",
)
workflow = workflow.replace(
  /export \{\n  runCompleteStep,[\s\S]*?\n\} from "\.\/qeoindex-eod-workflow-steps-legacy"\n/,
  `export {\n  runCompleteStep,\n  runEodReadyStep,\n  runMarketCloseCollectStep,\n  startQeoIndexEodRunStep,\n} from "./qeoindex-eod-runtime-steps"\n`,
)
const archiveHelpersIndex = workflow.indexOf("function archiveFailure(")
if (archiveHelpersIndex < 0) throw new Error("Missing dead Notion archive helper boundary")
workflow = workflow.slice(0, archiveHelpersIndex).trimEnd() + "\n"
if (/archiveCanonicalUniverseBatchToNotion|archiveEodTickerBatchToNotion|runDriveArchiveStep|workflow-steps-legacy/.test(workflow)) {
  throw new Error("Legacy archive/workflow references survived current workflow cleanup")
}
writeFileSync(workflowPath, workflow)

const retentionTypes = extract(currentArchive, "type RetentionCleanupResult", "/** Legacy/recovery-only Drive adapter")
let retentionFunction = extract(currentArchive, "/**\n * Safe telemetry/staging retention is operational and Supabase-only.", null)
retentionFunction = retentionFunction.replace(
  /export async function runEodRetentionCleanup\(\n  supabase: SupabaseClient,\n  input: \{\n    tradingDate: string\n[\s\S]*?\n  \},\n\): Promise<EodRetentionCleanupCheckpoint>/,
  `export async function runEodRetentionCleanup(\n  supabase: SupabaseClient,\n  input: { tradingDate: string },\n): Promise<EodRetentionCleanupCheckpoint>`,
)
const archive = `import type { SupabaseClient } from "@supabase/supabase-js"

export interface EodArchiveCheckpoint {
  status: "archived" | "partial" | "blocked" | "skipped" | "error"
  archived?: number
  requested?: number
  rowCount?: number
  detail?: string
  manifestUrl?: string | null
  manifestSha256?: string | null
}

${retentionTypes}

${retentionFunction}
`
if (/Google Drive|runEodDriveArchive|archiveEodRunToNotion|archiveCanonicalUniverseBatchToNotion|archiveEodTickerBatchToNotion|notionArchive\?:|driveArchive\?:/.test(archive)) {
  throw new Error("Legacy archive capability survived archive cleanup")
}
writeFileSync(archivePath, archive)

let backfill = read(backfillPath)
if (!backfill.includes('from "@/lib/vn-market-calendar"')) {
  backfill = backfill.replace(
    'import { loadWyckoffV2Universe } from "@/lib/wyckoff-v2-universe-source"\n',
    'import { loadWyckoffV2Universe } from "@/lib/wyckoff-v2-universe-source"\nimport { vietnamDateKey } from "@/lib/vn-market-calendar"\n',
  )
}
backfill = backfill.replace(/\nfunction vietnamDateKey\(iso: string\) \{[\s\S]*?\n\}\n/, "\n")
backfill = backfill
  .replaceAll("-EOD-v3", "-EOD-v4")
  .replaceAll('"supabase-first-eod-v3"', '"supabase-first-eod-v4-dag"')
writeFileSync(backfillPath, backfill)

let dataRefreshTest = read("tests/eod-data-refresh-contract.test.ts")
dataRefreshTest = requireReplace(
  dataRefreshTest,
  '  const legacyDelegated = source("lib/qeoindex-eod-workflow-steps-legacy.ts")',
  '  const runtimeSteps = source("lib/qeoindex-eod-runtime-steps.ts")',
  "READY legacy source fixture",
)
dataRefreshTest = requireReplace(
  dataRefreshTest,
  '  assert.match(legacyDelegated, /getCanonicalUniverse/)\n  assert.match(legacyDelegated, /loadWyckoffV2Universe/)\n  assert.doesNotMatch(legacyDelegated, /beginWyckoffV2NotionRun|claimReadyWyckoffV2Run|publishIngestingWyckoffV2Run/)',
  '  assert.match(runtimeSteps, /getCanonicalUniverse/)\n  assert.match(runtimeSteps, /loadWyckoffV2Universe/)\n  assert.match(runtimeSteps, /supabase-first-eod-v4-dag/)\n  assert.doesNotMatch(delegated, /workflow-steps-legacy/)\n  assert.doesNotMatch(runtimeSteps, /beginWyckoffV2NotionRun|claimReadyWyckoffV2Run|publishIngestingWyckoffV2Run|DRIVE_ARCHIVE|NOTION_ARCHIVE/)',
  "READY current runtime assertions",
)
writeFileSync("tests/eod-data-refresh-contract.test.ts", dataRefreshTest)

let ratingTest = read("tests/kfsp-rating-storage-refactor.test.ts")
ratingTest = requireReplace(ratingTest, '  "lib/qeoindex-eod-archive-legacy.ts",\n', "", "legacy archive rating reader")
writeFileSync("tests/kfsp-rating-storage-refactor.test.ts", ratingTest)

const manifestPath = "tests/test-contracts.json"
const manifest = JSON.parse(read(manifestPath))
const beforeEntries = manifest.entries.length
manifest.entries = manifest.entries.filter((entry) => entry.path !== "tests/legacy-eod-archive-compat.test.ts")
if (manifest.entries.length !== beforeEntries - 1) throw new Error("Legacy compatibility manifest entry not found exactly once")
writeFileSync(manifestPath, JSON.stringify(manifest))

for (const path of [legacyWorkflowPath, legacyArchivePath, "tests/legacy-eod-archive-compat.test.ts"]) rmSync(path)

for (const [path, forbidden] of [
  [workflowPath, /workflow-steps-legacy|runDriveArchiveStep|runNotionUniverseArchiveBatchStep|runNotionEodArchiveBatchStep/],
  [archivePath, /GOOGLE_DRIVE_|runEodDriveArchive|archiveEodRunToNotion|archiveEodTickerBatchToNotion/],
  [runtimePath, /supabase-first-eod-v3|DRIVE_ARCHIVE|NOTION_ARCHIVE/],
  [backfillPath, /supabase-first-eod-v3|-EOD-v3/],
]) {
  if (forbidden.test(read(path))) throw new Error(`Forbidden legacy token survived in ${path}`)
}

console.log("QEO-65 Wave 1 codemod completed")
