import type { SupabaseClient } from "@supabase/supabase-js"

import type { WyckoffV2Snapshot } from "./wyckoff-v2-builder.ts"
import { computeWyckoffV2ValidationHash, validateWyckoffV2SnapshotSet } from "./wyckoff-v2-contract.ts"

const ARTIFACT_WRITE_CHUNK_SIZE = 25

interface StoredBuildArtifactRow {
  run_id: string
  ticker: string
  ordinal: number
  run_key: string
  scan_date: string
  validation_hash: string
  snapshots: unknown
}

function normalizeTicker(value: string) {
  const ticker = value.trim().toUpperCase()
  if (!/^[A-Z0-9]{2,12}$/.test(ticker)) throw new Error(`Invalid Wyckoff artifact ticker: ${value}`)
  return ticker
}

export function buildWyckoffV2ArtifactRows(input: {
  runId: string
  runKey: string
  scanDate: string
  validationHash: string
  snapshots: WyckoffV2Snapshot[]
}) {
  const validation = validateWyckoffV2SnapshotSet(input.runKey, input.snapshots)
  if (computeWyckoffV2ValidationHash(input.snapshots) !== input.validationHash) {
    throw new Error("WYCKOFF_BUILD_ARTIFACT_HASH_MISMATCH")
  }

  const tickerOrder: string[] = []
  const byTicker = new Map<string, WyckoffV2Snapshot[]>()
  for (const snapshot of input.snapshots) {
    const ticker = normalizeTicker(snapshot.ticker)
    if (!byTicker.has(ticker)) tickerOrder.push(ticker)
    const rows = byTicker.get(ticker) || []
    rows.push(snapshot)
    byTicker.set(ticker, rows)
  }

  if (validation.total !== tickerOrder.length * 2) {
    throw new Error(`WYCKOFF_BUILD_ARTIFACT_INCOMPLETE: snapshots=${validation.total}; tickers=${tickerOrder.length}`)
  }

  return tickerOrder.map((ticker, index) => {
    const snapshots = byTicker.get(ticker) || []
    if (snapshots.length !== 2) throw new Error(`WYCKOFF_BUILD_ARTIFACT_INCOMPLETE: ${ticker} snapshots=${snapshots.length}`)
    const timeframes = new Set(snapshots.map((snapshot) => snapshot.timeframe))
    if (!timeframes.has("1D") || !timeframes.has("1W") || timeframes.size !== 2) {
      throw new Error(`WYCKOFF_BUILD_ARTIFACT_TIMEFRAMES_INVALID: ${ticker}`)
    }
    return {
      run_id: input.runId,
      ticker,
      ordinal: index + 1,
      run_key: input.runKey,
      scan_date: input.scanDate,
      validation_hash: input.validationHash,
      snapshots,
    }
  })
}

export async function stageWyckoffV2BuildArtifacts(
  supabase: SupabaseClient,
  input: {
    runId: string
    runKey: string
    scanDate: string
    validationHash: string
    snapshots: WyckoffV2Snapshot[]
  },
) {
  const rows = buildWyckoffV2ArtifactRows(input)
  for (let offset = 0; offset < rows.length; offset += ARTIFACT_WRITE_CHUNK_SIZE) {
    const chunk = rows.slice(offset, offset + ARTIFACT_WRITE_CHUNK_SIZE)
    const written = await supabase
      .from("wyckoff_build_artifacts")
      .upsert(chunk, { onConflict: "run_id,ticker" })
    if (written.error) throw new Error(`WYCKOFF_BUILD_ARTIFACT_WRITE_FAILED: ${written.error.message}`)
  }

  const verified = await supabase
    .from("wyckoff_build_artifacts")
    .select("ticker,validation_hash")
    .eq("run_id", input.runId)
  if (verified.error) throw new Error(`WYCKOFF_BUILD_ARTIFACT_VERIFY_FAILED: ${verified.error.message}`)
  const verifiedRows = verified.data || []
  if (verifiedRows.length !== rows.length) {
    throw new Error(`WYCKOFF_BUILD_ARTIFACT_VERIFY_INCOMPLETE: ${verifiedRows.length}/${rows.length}`)
  }
  if (verifiedRows.some((row) => row.validation_hash !== input.validationHash)) {
    throw new Error("WYCKOFF_BUILD_ARTIFACT_VERIFY_HASH_MISMATCH")
  }
  return { tickerCount: rows.length, snapshotCount: input.snapshots.length }
}

export async function loadWyckoffV2BuildArtifacts(
  supabase: SupabaseClient,
  input: {
    runId: string
    runKey: string
    scanDate: string
    expectedValidationHash: string
  },
) {
  const loaded = await supabase
    .from("wyckoff_build_artifacts")
    .select("run_id,ticker,ordinal,run_key,scan_date,validation_hash,snapshots")
    .eq("run_id", input.runId)
    .order("ordinal", { ascending: true })
  if (loaded.error) throw new Error(`WYCKOFF_BUILD_ARTIFACT_READ_FAILED: ${loaded.error.message}`)

  const rows = (loaded.data || []) as StoredBuildArtifactRow[]
  if (!rows.length) throw new Error(`WYCKOFF_BUILD_ARTIFACT_MISSING: run=${input.runId}`)

  const snapshots: WyckoffV2Snapshot[] = []
  const seenTickers = new Set<string>()
  for (const row of rows) {
    if (row.run_id !== input.runId || row.run_key !== input.runKey || row.scan_date !== input.scanDate) {
      throw new Error(`WYCKOFF_BUILD_ARTIFACT_IDENTITY_MISMATCH: ${row.ticker}`)
    }
    if (row.validation_hash !== input.expectedValidationHash) {
      throw new Error(`WYCKOFF_BUILD_ARTIFACT_HASH_MISMATCH: ${row.ticker}`)
    }
    const ticker = normalizeTicker(row.ticker)
    if (seenTickers.has(ticker)) throw new Error(`WYCKOFF_BUILD_ARTIFACT_DUPLICATE: ${ticker}`)
    seenTickers.add(ticker)
    if (!Array.isArray(row.snapshots) || row.snapshots.length !== 2) {
      throw new Error(`WYCKOFF_BUILD_ARTIFACT_INCOMPLETE: ${ticker}`)
    }
    snapshots.push(...row.snapshots as WyckoffV2Snapshot[])
  }

  const validation = validateWyckoffV2SnapshotSet(input.runKey, snapshots)
  const validationHash = computeWyckoffV2ValidationHash(snapshots)
  if (validationHash !== input.expectedValidationHash) {
    throw new Error(`WYCKOFF_BUILD_ARTIFACT_REPLAY_HASH_MISMATCH: ${validationHash} != ${input.expectedValidationHash}`)
  }

  return { snapshots, validation, validationHash, tickerCount: seenTickers.size }
}
