import type { SupabaseClient } from "@supabase/supabase-js"

import {
  archiveCanonicalUniverseBatchToNotion,
  archiveEodRunToNotion,
  archiveEodTickerBatchToNotion,
  runEodDriveArchive as runLegacyDriveArchive,
  type EodArchiveCheckpoint,
} from "./qeoindex-eod-archive-legacy"

export {
  archiveCanonicalUniverseBatchToNotion,
  archiveEodRunToNotion,
  archiveEodTickerBatchToNotion,
}
export type { EodArchiveCheckpoint }

/**
 * Daily/Weekly cutover: the raw store contains Daily bars only. The legacy uploader
 * is retained for its proven Google Drive/auth/manifest implementation; because the
 * database constraint is Daily-only it can only receive Daily rows.
 */
export async function runEodDriveArchive(
  supabase: SupabaseClient,
  input: {
    tradingDate: string
    universeRunId: string
    validationHash: string
    stocks: Parameters<typeof runLegacyDriveArchive>[1]["stocks"]
  },
): Promise<EodArchiveCheckpoint> {
  return runLegacyDriveArchive(supabase, input)
}

/**
 * Raw Daily history is the sole source for both 1D and derived 1W Wyckoff analysis.
 * It must not be age-pruned until Plan C cold-history coverage can hydrate the model
 * without reducing the minimum 60 completed Weekly bars. Obsolete intraday rows are
 * removed once by the schema cutover migration instead of by recurring retention.
 */
export async function runEodRetentionCleanup(
  _supabase: SupabaseClient,
  input: {
    tradingDate: string
    notionArchive: EodArchiveCheckpoint
    driveArchive: EodArchiveCheckpoint
  },
): Promise<EodArchiveCheckpoint> {
  if (input.notionArchive.status !== "archived") {
    return { status: "blocked", detail: `Retention blocked: Notion archive status=${input.notionArchive.status}` }
  }
  if (input.driveArchive.status !== "archived") {
    return { status: "blocked", detail: `Retention blocked: Drive archive status=${input.driveArchive.status}` }
  }
  return {
    status: "blocked",
    detail: "Raw Daily OHLCV retention is intentionally disabled until Plan C cold-history coverage is verified; no operational Daily bars were deleted.",
  }
}
