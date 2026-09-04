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

const retentionTypes = extract(
  currentArchive,
  "type RetentionCleanupResult",
  "/** Legacy/recovery-only Drive adapter",
)
let retentionFunction = extract(
  currentArchive,
  "/**\n * Safe telemetry/staging retention is operational and Supabase-only.",
  null,
)
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
ratingTest = requireReplace(
  ratingTest,
  '  "lib/qeoindex-eod-archive-legacy.ts",\n',
  "",
  "legacy archive rating reader",
)
writeFileSync("tests/kfsp-rating-storage-refactor.test.ts", ratingTest)

const manifestPath = "tests/test-contracts.json"
const manifest = JSON.parse(read(manifestPath))
const beforeEntries = manifest.entries.length
manifest.entries = manifest.entries.filter((entry) => entry.path !== "tests/legacy-eod-archive-compat.test.ts")
if (manifest.entries.length !== beforeEntries - 1) throw new Error("Legacy compatibility manifest entry not found exactly once")
writeFileSync(manifestPath, JSON.stringify(manifest))

let handover = read("docs/HANDOVER.md")
handover = handover
  .replace("Last updated: 2026-09-02.", "Last updated: 2026-09-04.")
  .replace("## EOD v3 phase contract", "## EOD v4 DAG contract")
  .replace(/Canonical phase order remains:[\s\S]*?Key invariants:/, `Canonical dependency flow is:\n\n1. \\`KFSP_RATING_REFRESH\\` freezes the exact canonical universe for the session.\n2. \\`TTAI_REFRESH\\` and \\`MARKET_CLOSE_COLLECT\\` run as bounded sibling branches.\n3. \\`EOD_READY\\` verifies exact frozen membership and same-session market evidence.\n4. \\`HISTORY_REFRESH\\` persists Daily-only OHLCV with bounded concurrency.\n5. No-trade repair and Wyckoff build produce exactly \\`universeCount × 2\\` 1D/1W snapshots.\n6. \\`SUPABASE_VALIDATE\\` and \\`SUPABASE_PUBLISH\\` publish canonical operational evidence.\n7. AI Council deterministic → market synthesis → bounded LLM debate consume the published session.\n8. \\`RETENTION_CLEANUP\\` prunes only approved transient/terminal evidence; raw Daily retention remains blocked.\n9. Notion analytical summary runs downstream and is not operational state.\n10. \\`COMPLETE\\` records \\`supabase-first-eod-v4-dag\\`.\n\nKey invariants:`)
  .replace("- Notion/Drive archival is downstream of the market-analysis critical path.", "- Notion analytical summary is downstream of the market-analysis critical path; Google Drive is not part of the active EOD graph.")
  .replace(/## Storage lifecycle \/ Plan B and Plan C foundation[\s\S]*?## Database migrations/, `## Storage lifecycle\n\nSupabase is the operational source of truth. Notion receives a compact downstream analytical summary only. The active EOD runtime has no Google Drive archive dependency.\n\nRaw Daily OHLCV retention is intentionally fail-closed while 1W is derived from Daily and no independently verified cold-history hydration/restore path exists. Safe retention only prunes approved telemetry, staging, expired raw evidence and terminal build artifacts.\n\nLegacy archive ledgers such as \\`eod_archive_checkpoints\\` and \\`market_ohlcv_archive_ranges\\` are QEO-65 deletion candidates only after zero-consumer database dependency proof.\n\n## Database migrations`)
  .replace("- archive phases report their real state and do not fake success;", "- retention and analytical-summary phases report their real state and do not fake success;")
  .replace(/, and `eod_archive_checkpoints` before interpreting UI state\./, " before interpreting UI state.")
writeFileSync("docs/HANDOVER.md", handover)

const runbook = `# QeoIndex — Canonical Top Stocks 200 EOD Runbook

Last updated: 2026-09-04  
Canonical universe: \\`vn_top_stocks\\`  
Operational architecture: \\`supabase-first-eod-v4-dag\\`

## 1. Source of truth

- Supabase is the operational source of truth for the canonical universe, raw Daily OHLCV, Wyckoff publication, AI Council evidence and job telemetry.
- Notion is downstream analytical/audit output only. It must not gate EOD publication or retention.
- Google Drive is not part of the active EOD graph.
- Runtime execution evidence comes from \\`system_job_runs\\` and \\`system_job_phases\\`, not scheduler dispatch alone.

## 2. Canonical universe

The current universe is the latest successfully published \\`vn_top_stocks\\` run, maximum 200 tickers. Runtime consumers must use the exact same published membership. A failed refresh never replaces the previous published universe.

## 3. Scheduling contract

The canonical scheduled parent is Supabase \\`pg_cron\\` job \\`qeoindex-eod-pipeline-1515-ict\\` at 15:15 ICT on trading weekdays. KFSP Rating and TTAI refresh are part of the EOD dependency flow; their standalone admin entries are manual recovery capabilities, not independent daily scheduler ownership.

The active scheduler/admin catalog is authoritative for the rest of the market/universe jobs. Legacy Vercel EOD cron paths are not scheduler owners.

## 4. EOD v4 dependency DAG

1. \\`KFSP_RATING_REFRESH\\` — refresh rating and freeze exact canonical membership.
2. Parallel sibling branches:
   - \\`TTAI_REFRESH\\` — bounded 50-ticker batches tied to the frozen universe.
   - \\`MARKET_CLOSE_COLLECT\\` — final same-session market snapshot collection with bounded retry.
3. \\`EOD_READY\\` — validate exact frozen run identity/membership and current-session evidence.
4. \\`HISTORY_REFRESH\\` — Daily-only persistent OHLCV, batch size 10 with bounded concurrency.
5. Verified no-trade Daily repair when required.
6. \\`WYCKOFF_BUILD\\` — 1D + 1W only; 1W is derived from Daily.
7. \\`SUPABASE_VALIDATE\\` — exact membership, snapshot count and validation hash.
8. \\`SUPABASE_PUBLISH\\` — publish canonical Supabase read models.
9. \\`AI_COUNCIL_DETERMINISTIC\\`.
10. \\`MARKET_SYNTHESIS\\`.
11. \\`AI_COUNCIL_LLM\\` — selective/cost-bounded; deterministic Council remains authority.
12. \\`RETENTION_CLEANUP\\` — safe transient/terminal retention only.
13. Notion analytical summary — one downstream run-level analytical/audit record.
14. \\`COMPLETE\\`.

Active run key format: \\`WYCKOFF-YYYY-MM-DD-EOD-v4\\`.

For \\`N\\` canonical tickers:

- expected Wyckoff snapshots = \\`N × 2\\` (1D + 1W);
- persistent raw OHLCV = \\`1D\\` only;
- raw Daily history is not age-pruned by the active retention path.

## 5. Retry and failure semantics

- \\`MARKET_CLOSE_COLLECT\\`: maximum 3 attempts, 5-minute spacing for retryable network/readiness/408/429/5xx classes; credential/auth failures are terminal.
- \\`EOD_READY\\`: maximum 4 bounded attempts for known not-ready conditions.
- Current-session history/build failures are ticker-isolated where the v4 fault-isolation contract allows it; incomplete coverage ends as explicit partial state rather than false success.
- Historical backfill never substitutes today's provider market evidence for a past session.
- Failures before operational Supabase publication preserve the previous healthy published read model.

## 6. Retention contract

Active retention calls Supabase-only cleanup RPCs for approved telemetry/staging/raw-evidence/build-artifact classes. It must never delete \\`market_ohlcv_history\\` Daily bars until an independently verified cold-history hydration/restore design is approved.

\\`eod_archive_checkpoints\\` and \\`market_ohlcv_archive_ranges\\` are legacy deletion candidates under QEO-65, not active retention authority.

## 7. Manual recovery acceptance

After a manual current-session or historical EOD run, verify:

- parent \\`system_job_runs\\` terminal state and phase summaries;
- exact canonical universe identity;
- Daily history accounting for every requested ticker;
- Wyckoff snapshot count = \\`universeCount × 2\\`;
- Supabase publish validation hash and exact ticker membership;
- deterministic Council coverage;
- market synthesis / LLM real status;
- retention real status;
- downstream Notion analytical-summary status;
- \\`COMPLETE\\` telemetry contains \\`supabase-first-eod-v4-dag\\`.

## 8. Release verification

Before merge/deploy:

- \\`pnpm test:manifest\\`;
- \\`pnpm test:current\\`;
- \\`pnpm lint:touched\\`;
- \\`pnpm typecheck\\`;
- \\`pnpm build\\`;
- DB-changing releases additionally require drift/replay/generated-types gates.

Production acceptance requires the GitHub head to be green, Vercel deployment READY, and runtime smoke evidence from the deployed architecture.
`
writeFileSync("docs/automation/CRON_WORKFLOW_TOP_STOCKS_200.md", runbook)

for (const path of [legacyWorkflowPath, legacyArchivePath, "tests/legacy-eod-archive-compat.test.ts"]) {
  rmSync(path)
}

for (const [path, forbidden] of [
  [workflowPath, /workflow-steps-legacy|runDriveArchiveStep|runNotionUniverseArchiveBatchStep|runNotionEodArchiveBatchStep/],
  [archivePath, /GOOGLE_DRIVE_|runEodDriveArchive|archiveEodRunToNotion|archiveEodTickerBatchToNotion/],
  [runtimePath, /supabase-first-eod-v3|DRIVE_ARCHIVE|NOTION_ARCHIVE/],
  [backfillPath, /supabase-first-eod-v3|-EOD-v3/],
]) {
  if (forbidden.test(read(path))) throw new Error(`Forbidden legacy token survived in ${path}`)
}

console.log("QEO-65 Wave 1 codemod completed")
