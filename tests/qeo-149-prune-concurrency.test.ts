import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

type HotRow = {
  key: string
  contentDigest: string
  contentVersion: number
}

type ArchiveProof = {
  contentDigest: string
  contentVersion: number
  rowCount: number
}

function aggregate(rows: HotRow[]): ArchiveProof {
  return {
    contentDigest: rows.map((row) => row.contentDigest).join("")
      .padEnd(64, "0")
      .slice(0, 64),
    contentVersion: Math.max(...rows.map((row) => row.contentVersion)),
    rowCount: rows.length,
  }
}

function pruneLocked(rows: HotRow[], proof: ArchiveProof) {
  if (!proof.contentDigest || !proof.contentVersion || !proof.rowCount) {
    return { status: "deferred" as const, reason: "missing_proof" as const, deletedRows: 0 }
  }
  const current = aggregate(rows)
  if (current.rowCount !== proof.rowCount || current.contentDigest !== proof.contentDigest || current.contentVersion !== proof.contentVersion) {
    return { status: "deferred" as const, reason: "content_mismatch" as const, deletedRows: 0 }
  }
  rows.splice(0, rows.length)
  return { status: "pruned" as const, deletedRows: proof.rowCount }
}

function upsert(rows: HotRow[], row: HotRow) {
  const index = rows.findIndex((current) => current.key === row.key)
  if (index === -1) rows.push(row)
  else rows[index] = row
}

test("QEO-149 isolated model defers a committed correction before locked validation", () => {
  const rows = [{ key: "09:15", contentDigest: "a".repeat(64), contentVersion: 10 }]
  const archived = aggregate(rows)

  upsert(rows, { key: "09:15", contentDigest: "b".repeat(64), contentVersion: 11 })
  const result = pruneLocked(rows, archived)

  assert.deepEqual(result, { status: "deferred", reason: "content_mismatch", deletedRows: 0 })
  assert.equal(rows[0].contentDigest, "b".repeat(64))
})

test("QEO-149 equal counts cannot authorize timestamp or provenance substitutions", () => {
  for (const key of ["09:16", "09:15:provenance"]) {
    const rows = [{ key, contentDigest: "a".repeat(64), contentVersion: 20 }]
    const archived = aggregate(rows)
    upsert(rows, { key, contentDigest: "c".repeat(64), contentVersion: 21 })

    const result = pruneLocked(rows, archived)
    assert.equal(result.status, "deferred")
    assert.equal(result.deletedRows, 0)
    assert.equal(rows.length, 1)
  }
})

test("QEO-149 a writer queued behind the prune lock survives after commit", () => {
  const rows = [{ key: "09:17", contentDigest: "a".repeat(64), contentVersion: 30 }]
  const archived = aggregate(rows)
  let lockHeld = true
  let queuedWriter: HotRow | null = { key: "09:17", contentDigest: "d".repeat(64), contentVersion: 31 }

  const prune = pruneLocked(rows, archived)
  assert.equal(prune.status, "pruned")
  assert.equal(rows.length, 0)

  lockHeld = false
  if (!lockHeld && queuedWriter) {
    upsert(rows, queuedWriter)
    queuedWriter = null
  }
  assert.deepEqual(rows, [{ key: "09:17", contentDigest: "d".repeat(64), contentVersion: 31 }])
})

test("QEO-149 unknown archive proof fails closed without deleting HOT rows", () => {
  const rows = [{ key: "09:18", contentDigest: "e".repeat(64), contentVersion: 40 }]
  const result = pruneLocked(rows, { contentDigest: "", contentVersion: 0, rowCount: 0 })

  assert.deepEqual(result, { status: "deferred", reason: "missing_proof", deletedRows: 0 })
  assert.equal(rows.length, 1)
})

test("QEO-149 migration enforces shared locks, exact proof, fail-closed legacy calls, and safe deferral", () => {
  const migration = readFileSync(new URL("../supabase/pending-migrations/20260909100000_qeo149_correction_safe_prune.sql", import.meta.url), "utf8")
  assert.match(migration, /create sequence if not exists public\.chart_ohlcv_intraday_content_version_seq/i)
  assert.match(migration, /create trigger qeo149_chart_intraday_content_identity/i)
  assert.match(migration, /before insert or update or delete on public\.chart_ohlcv_intraday/i)
  assert.match(migration, /revoke trigger on table public\.chart_ohlcv_intraday from service_role/i)
  assert.match(migration, /qeo149-chart-ticker-session/i)
  assert.match(migration, /p_expected_content_digest/i)
  assert.match(migration, /p_expected_content_version/i)
  assert.match(migration, /p_expected_newer_sessions/i)
  assert.match(migration, /string_agg\(h\.content_digest, '' order by h\.bar_time\)/i)
  assert.match(migration, /return jsonb_build_object\([\s\S]*'status', 'deferred'/i)
  assert.match(migration, /drop function if exists public\.qeo_prune_verified_chart_intraday_partition\(uuid, text, integer\)/i)
  assert.match(migration, /qeo149_chart_intraday_content_identity[\s\S]*?before insert or update or delete/i)
  assert.doesNotMatch(migration, /delete from public\.chart_ohlcv_intraday[\s\S]*?v_hot_rows <> p_expected_row_count[\s\S]*?delete from/i)
})

test("QEO-147 routing and recovery require the same durable complete-generation validator", () => {
  const store = readFileSync(new URL("../modules/market/chart-data/derived-hourly-store.ts", import.meta.url), "utf8")
  const recovery = readFileSync(new URL("../modules/market/chart-data/derived-hourly-recovery.ts", import.meta.url), "utf8")
  assert.match(store, /validateDerivedHourlyManifestReadiness/)
  assert.match(store, /persistVerifiedDerivedHourlyGeneration/)
  assert.doesNotMatch(store, /manifestIds\.every\(\(id\) => covered\.has\(id\)\)/)
  assert.match(recovery, /validateDerivedHourlyManifestReadiness/)
  assert.doesNotMatch(recovery, /derivedManifestIds/)
})

test("QEO-147 publication schema fails closed on partial stale corrupt or mutated cache generations", () => {
  const migration = readFileSync(new URL("../supabase/pending-migrations/20260909143000_qeo147_derived_hourly_readiness.sql", import.meta.url), "utf8")
  assert.match(migration, /chart_ohlcv_derived_hourly_readiness/i)
  assert.match(migration, /generation_id/i)
  assert.match(migration, /content_digest/i)
  assert.match(migration, /qeo_publish_chart_derived_hourly_readiness/i)
  assert.match(migration, /qeo_validate_chart_derived_hourly_manifests/i)
  assert.match(migration, /after insert or update or delete on public\.chart_ohlcv_derived_hourly/i)
  assert.match(migration, /derived_row_count/i)
  assert.match(migration, /aggregation_version/i)
  assert.match(migration, /source_raw_row_count/i)
  assert.match(migration, /source_sha256/i)
  assert.match(migration, /source_range_start/i)
  assert.match(migration, /source_range_end/i)
  assert.match(migration, /qeo_validate_chart_derived_hourly_manifests\(array\[p_manifest_id\]\)/i)
  assert.doesNotMatch(migration, /derived hourly cache missing for manifest/i)
})
