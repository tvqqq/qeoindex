import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import test from "node:test"

import {
  buildQeoExVnindexEstimate,
  type QeoCandidateRow,
  type QeoPreviousEstimate,
} from "../supabase/functions/_shared/qeo-ex-vic-vhm-valuation.ts"

const sessionDate = "2026-10-12"
const observedAt = `${sessionDate}T08:05:00.000Z` // 15:05 ICT receipt time
const ratingRunId = "11111111-1111-4111-8111-111111111111"
const marketRunId = "22222222-2222-4222-8222-222222222222"
const alphanumericHoseTickerOverrides: Record<number, string> = {
  4: "PC1",
  5: "NT2",
  6: "C32",
  7: "D2D",
}

function tickerAt(index: number): string {
  const first = String.fromCharCode(65 + Math.floor(index / (26 * 26)) % 26)
  const second = String.fromCharCode(65 + Math.floor(index / 26) % 26)
  const third = String.fromCharCode(65 + index % 26)
  return `${first}${second}${third}`
}

function fixtureRows(date = sessionDate, count = 350): QeoCandidateRow[] {
  return Array.from({ length: count }, (_, index) => {
    const ticker = index === 2 ? "VIC" : index === 3 ? "VHM" : alphanumericHoseTickerOverrides[index] || tickerAt(index)
    return {
      asOfDate: date,
      ticker,
      exchange: "HOSE",
      marketCapBillion: 10,
      price: 100,
      priceChangePct: index === 4 ? 10 : 0,
      pe: index === 0 ? 10 : index === 1 ? 20 : index === 2 || index === 3 ? 1000 : -1,
      pb: index === 4 ? 5 : index === 2 || index === 3 ? 1000 : 0,
      syncRunId: ratingRunId,
      fetchedAt: `${date}T08:05:00.000Z`,
    }
  })
}

function ratingRun(date = sessionDate, rows = fixtureRows(date)) {
  return {
    id: ratingRunId,
    asOfDate: date,
    status: "completed",
    providerRowCount: rows.length,
    contractVersion: 2,
    completedAt: `${date}T08:02:00.000Z`,
  }
}

function build(input: {
  date?: string
  rows?: QeoCandidateRow[]
  previousMarketSessionDate?: string | null
  previousEstimate?: QeoPreviousEstimate | null
  breadth?: number | null
} = {}) {
  const date = input.date || sessionDate
  const rows = input.rows || fixtureRows(date)
  return buildQeoExVnindexEstimate({
    sessionDate: date,
    ratingRun: ratingRun(date, rows),
    candidates: rows,
    vnindexValue: 1300,
    providerBreadthCount: input.breadth ?? 340,
    previousMarketSessionDate: input.previousMarketSessionDate ?? null,
    previousEstimate: input.previousEstimate ?? null,
    asOf: observedAt,
    sourceMarketSyncRunId: marketRunId,
  })
}

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

test("Qeo estimate anchors the first complete EOD and excludes VIC/VHM from PE/PB subsets", () => {
  const estimate = build()

  assert.equal(estimate.status, "available")
  assert.equal(estimate.baseSessionDate, sessionDate)
  assert.equal(estimate.baseVnindexValue, 1300)
  assert.equal(estimate.estimatedVnindexValue, 1300)
  assert.equal(estimate.sourceHoseCount, 350)
  assert.equal(estimate.retainedMemberCount, 348)
  assert.equal(estimate.members.find((member) => member.ticker === "VIC")?.includedInEstimate, false)
  assert.equal(estimate.members.find((member) => member.ticker === "VHM")?.includedInEstimate, false)
  for (const ticker of ["PC1", "NT2", "C32", "D2D"]) {
    assert.equal(estimate.members.find((member) => member.ticker === ticker)?.includedInEstimate, true)
  }

  // The eligible PE subset has cap 10 at multiples 10 and 20:
  // Σ cap / Σ(cap / multiple) = 20 / (1 + 0.5) = 13.333...
  assert.equal(estimate.pe.mode, "positive_subset")
  assert.equal(estimate.pe.memberCount, 2)
  assert.equal(estimate.pe.totalMemberCount, 348)
  assert.equal(estimate.pe.value, 20 / 1.5)
  assert.equal(estimate.pe.marketCapCoveragePct, 0.57)
  assert.equal(estimate.pb.mode, "positive_subset")
  assert.equal(estimate.pb.memberCount, 1)
  assert.equal(estimate.pb.value, 5)
  assert.equal(estimate.pb.marketCapCoveragePct, 0.29)
})

test("an anchored estimate chains over the prior published session, including a weekend", () => {
  const prior: QeoPreviousEstimate = {
    sessionDate: "2026-10-09",
    status: "available",
    estimatedVnindexValue: 1280,
    baseSessionDate: "2026-10-09",
    baseVnindexValue: 1275,
    sourceHoseCount: 350,
  }
  const estimate = build({ previousMarketSessionDate: "2026-10-09", previousEstimate: prior })
  const currentCap = 348 * 10
  const referenceCap = currentCap - 10 + 10 / 1.1

  assert.equal(estimate.status, "available")
  assert.equal(estimate.baseSessionDate, "2026-10-09")
  assert.equal(estimate.baseVnindexValue, 1275)
  assert.equal(estimate.estimatedVnindexValue, 1280 * currentCap / referenceCap)
  assert.equal(estimate.previousMarketSessionDate, "2026-10-09")
})

test("an anchored series does not bridge a missing market session or rebase", () => {
  const stalePrevious: QeoPreviousEstimate = {
    sessionDate: "2026-10-08",
    status: "available",
    estimatedVnindexValue: 1270,
    baseSessionDate: "2026-10-08",
    baseVnindexValue: 1260,
    sourceHoseCount: 350,
  }
  const missing = build({ previousMarketSessionDate: "2026-10-09", previousEstimate: stalePrevious })
  assert.equal(missing.status, "unavailable")
  assert.equal(missing.unavailableReason, "PREVIOUS_MARKET_SESSION_ESTIMATE_MISSING")
  assert.equal(missing.estimatedVnindexValue, null)
  assert.equal(missing.pe.value, 20 / 1.5, "a stopped index chain must preserve valid same-session valuation evidence")

  const unanchoredUnavailable: QeoPreviousEstimate = {
    sessionDate: "2026-10-09",
    status: "unavailable",
    estimatedVnindexValue: null,
    baseSessionDate: null,
    baseVnindexValue: null,
    sourceHoseCount: 350,
  }
  const firstValidAfterFailedAttempt = build({
    previousMarketSessionDate: "2026-10-09",
    previousEstimate: unanchoredUnavailable,
  })
  assert.equal(firstValidAfterFailedAttempt.status, "available")
  assert.equal(firstValidAfterFailedAttempt.baseSessionDate, sessionDate)
  assert.equal(firstValidAfterFailedAttempt.estimatedVnindexValue, 1300)
})

test("a missing valuation subset leaves the index point available and labels the metric unavailable", () => {
  const rows = fixtureRows().map((row) => ({ ...row, pe: null, pb: null }))
  const estimate = build({ rows })

  assert.equal(estimate.status, "available")
  assert.equal(estimate.estimatedVnindexValue, 1300)
  assert.equal(estimate.pe.value, null)
  assert.equal(estimate.pe.mode, "unavailable")
  assert.equal(estimate.pb.value, null)
  assert.equal(estimate.pb.mode, "unavailable")
})

test("the source gate rejects incomplete HOSE coverage, duplicate rows, and stale or cross-date receipt times", () => {
  const tooFew = build({ rows: fixtureRows(sessionDate, 349) })
  assert.equal(tooFew.status, "unavailable")
  assert.equal(tooFew.unavailableReason, "HOSE_SOURCE_COVERAGE_INCOMPLETE")

  const duplicateRows = fixtureRows()
  duplicateRows[1] = { ...duplicateRows[1], ticker: duplicateRows[0].ticker }
  const duplicate = build({ rows: duplicateRows })
  assert.equal(duplicate.unavailableReason, "CANDIDATE_FEED_DUPLICATE_TICKER")

  const staleRows = fixtureRows()
  staleRows[0] = { ...staleRows[0], fetchedAt: "2026-10-12T07:59:00.000Z" }
  const stale = build({ rows: staleRows })
  assert.equal(stale.unavailableReason, "CANDIDATE_FEED_RUN_OR_FRESHNESS_MISMATCH")

  const nextDayRows = fixtureRows()
  nextDayRows[0] = { ...nextDayRows[0], fetchedAt: "2026-10-13T08:05:00.000Z" }
  const crossDate = build({ rows: nextDayRows })
  assert.equal(crossDate.unavailableReason, "CANDIDATE_FEED_RUN_OR_FRESHNESS_MISMATCH")
})

test("long ETF/warrant-shaped and malformed HOSE tickers invalidate the source instead of shrinking it", () => {
  const invalidTickers = ["E1VFVN30", "WARRANT1", "AB-", "AB"]

  for (const ticker of invalidTickers) {
    const rows = fixtureRows()
    rows[8] = { ...rows[8], ticker }
    const estimate = build({ rows })

    assert.equal(estimate.status, "unavailable", `${ticker} must invalidate the complete source`)
    assert.equal(estimate.unavailableReason, "HOSE_MEMBERSHIP_INVALID")
    assert.equal(estimate.sourceHoseCount, rows.length, "invalid members remain visible in source coverage evidence")
  }
})

test("the calculator and member-table migration share the uppercase alphanumeric three-character rule", () => {
  const calculator = source("supabase/functions/_shared/qeo-ex-vic-vhm-valuation.ts")
  const migration = source("supabase/migrations/20261014173000_qeo408_alphanumeric_hose_tickers.sql")

  assert.equal(calculator.split("^[A-Z0-9]{3}$").length - 1, 2)
  assert.ok(migration.includes("drop constraint if exists market_insight_qeo_ex_vnindex_members_ticker_check"))
  assert.ok(migration.includes("check (ticker ~ '^[A-Z0-9]{3}$')"))
})

test("SQL publication serializes chain writes, binds the published market run, and preserves available points", () => {
  const migration = source("supabase/migrations/20261013120000_qeo408_ex_vic_vhm_vnindex_estimate.sql")
  assert.match(migration, /pg_advisory_xact_lock\(hashtextextended\('market_insight_qeo_ex_vnindex_daily'/)
  assert.match(migration, /v_market_daily\.sync_run_id is distinct from v_source_market_sync_run_id/)
  assert.match(migration, /QEO_ESTIMATE_CONFLICT:AVAILABLE_POINT_IMMUTABLE/)
  assert.match(migration, /QEO_ESTIMATE_CONFLICT:PREVIOUS_QEO_SESSION_MISSING/)
  assert.match(migration, /jsonb_array_elements\(v_market_daily\.valuation_history\)/)
  assert.match(migration, /PROVIDER_MARKET_SESSION_GAP/)
  assert.match(migration, /on conflict \(session_date\) do update set/)
  assert.match(migration, /delete from public\.market_insight_qeo_ex_vnindex_members/)
})

test("full Qeo history is paginated and valuation renders one aligned four-series overlay", () => {
  const loader = source("modules/research/market-insight/data.ts")
  const valuation = source("modules/research/market-insight/valuation-snapshot.ts")
  const view = source("components/insights/market-health-view.tsx")
  const valuationChart = view.slice(view.indexOf("function ValuationBandChart"), view.indexOf("function qeoUnavailableCopy"))
  const edge = source("supabase/functions/market-insight-eod-sync/index.ts")

  assert.match(loader, /for \(let offset = 0; offset < 50_000; offset \+= 1_000\)/)
  assert.match(loader, /\.range\(offset, offset \+ 999\)/)
  assert.match(loader, /\.lte\("session_date", targetDate\)/)
  assert.match(edge, /\.select\("ticker", \{ count: "exact", head: true \}\)/)
  assert.match(edge, /\.range\(offset, Math\.min\(offset \+ pageSize - 1, actualCount - 1\)\)/)
  assert.match(valuation, /vnindex: finiteOrNull\(original\?\.price\)/)
  assert.match(view, /mergeValuationHistories\(visibleValuationHistory, visibleQeoExVnindexHistory\)/)
  assert.doesNotMatch(view, /function QeoExVnindexChart|data-qeo-ex-vnindex-chart/)
  assert.match(view, /VNI \(trừ VIN\) · HOSE loại VIC, VHM/)
  assert.match(view, /VNI \(trừ VIN\)/)
  assert.match(view, /P\/E \(trừ VIN\)/)
  assert.match(view, /P\/B \(trừ VIN\)/)
  assert.match(view, /dataKey="tradingDate"/)
  assert.match(view, /dataKey="vnindex"/)
  assert.match(view, /dataKey="qeoEstimatedVnindexValue"/)
  assert.match(view, /dataKey=\{metric === "PE" \? "qeoPe" : "qeoPb"\}/)
  assert.match(view, /strokeDasharray="7 4"/)
  assert.match(view, /strokeDasharray="3 3"/)
  assert.match(view, /flex flex-wrap items-center justify-start/)
  assert.match(view, /isAnimationActive=\{false\}/)
  assert.match(view, /Number\(value\)\.toFixed\(2\)/)
  assert.match(view, /max-w-\[min\(280px,calc\(100vw-112px\)\)\]/)
  assert.match(valuationChart, /<Tooltip\s+position=\{\{ x: 0 \}\}/)
  assert.match(view, /Hệ thống nhận snapshot lúc[\s\S]*không phải timestamp cập nhật từ nhà cung cấp/)
  assert.match(view, /isolatedDot\("qeoEstimatedVnindexValue"/)
  assert.match(view, /connectNulls=\{false\}/)
  assert.match(view, /valuationRangeYears, data\.sessionDate/)
})


test("historical reverse prefix migration is fixed-window, provenance-bound, dry-run-first, and insert-only", () => {
  const migrationName = readdirSync(new URL("../supabase/migrations/", import.meta.url))
    .find((name) => name.endsWith("_qeo408_historical_vni_prefix.sql"))
  assert.ok(migrationName, "the historical prefix migration must be present")
  const migration = source("supabase/migrations/" + migrationName)
  const functionBody = migration.slice(
    migration.indexOf("create or replace function public.backfill_market_insight_qeo_ex_vnindex_prefix"),
    migration.indexOf("$function$;", migration.indexOf("create or replace function public.backfill_market_insight_qeo_ex_vnindex_prefix")),
  )

  assert.match(functionBody, /p_start date,[\s\S]*p_anchor date,[\s\S]*p_expected_anchor_hash text,[\s\S]*p_dry_run boolean default true/)
  assert.match(functionBody, /date '2026-10-01'[\s\S]*date '2026-10-13'/)
  assert.match(functionBody, /p_expected_anchor_hash !~ '\^\[0-9a-f\]\{64\}\$'/)
  assert.match(functionBody, /pg_advisory_xact_lock\([\s\S]*market_insight_qeo_ex_vnindex_daily/)
  assert.match(functionBody, /v_anchor\.estimated_vnindex_value is distinct from 1719\.42::numeric/)
  assert.match(functionBody, /v_anchor\.calculation_input_hash is distinct from p_expected_anchor_hash/)
  assert.match(functionBody, /source_candidate_count is distinct from 1753/)
  assert.match(functionBody, /source_hose_count is distinct from 413/)
  assert.match(functionBody, /retained_member_count is distinct from 411/)
  assert.match(functionBody, /v_session_date < date '2026-10-09' then 1752[\s\S]*else 1753/)
  assert.match(functionBody, /v_candidate_count <> v_expected_candidate_count[\s\S]*v_candidate_count <> v_rating\.provider_row_count/)
  assert.match(functionBody, /v_rating\.provider is distinct from 'kfsp'/)
  assert.match(functionBody, /v_rating\.contract_version is distinct from v_anchor\.source_contract_version/)
  assert.match(functionBody, /select count\(\*\)::integer into v_rating_run_count[\s\S]*r\.status = 'completed'[\s\S]*completed_at/)
  assert.match(functionBody, /v_hose_count <> 413/)
  assert.match(functionBody, /v_vic_vhm_count <> 2/)
  assert.match(functionBody, /timezone\('Asia\/Ho_Chi_Minh', c\.fetched_at\)[\s\S]*time '15:00'/)
  assert.match(functionBody, /for share/)
  assert.match(functionBody, /select \* into v_existing[\s\S]*q\.session_date = \(v_point ->> 'session_date'\)::date\s+for share/)
  assert.match(functionBody, /where m\.session_date = \(v_point ->> 'session_date'\)::date\s+order by m\.ticker\s+for share/)
  assert.match(functionBody, /PROVIDER_VALUATION_SESSION_GAP/)
  assert.match(functionBody, /v_next_estimated_value \* v_next_reference_cap \/ v_next_current_cap/)
  assert.match(functionBody, /qeo-ex-vic-vhm-reverse-prefix-v1/)
  assert.match(functionBody, /pg_catalog\.sha256/)
  assert.match(functionBody, /'next_session_chain_hash', v_next_chain_hash/)
  assert.match(functionBody, /'anchor_calculation_input_hash', p_expected_anchor_hash/)
  assert.match(functionBody, /'pe_mode', v_pe_mode/)
  assert.match(functionBody, /'pb_mode', v_pb_mode/)
  assert.match(functionBody, /if p_dry_run then[\s\S]*return jsonb_build_object[\s\S]*insert into public\.market_insight_qeo_ex_vnindex_daily/)
  assert.match(functionBody, /EXISTING_DAILY_ROW_MISMATCH/)
  assert.match(functionBody, /EXISTING_MEMBER_ROWS_MISMATCH/)
  assert.doesNotMatch(functionBody, /^\s*(update|delete)\s/im)
  assert.match(migration, /revoke all on function public\.backfill_market_insight_qeo_ex_vnindex_prefix[\s\S]*to service_role/)
})
