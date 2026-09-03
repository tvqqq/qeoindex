import assert from "node:assert/strict"
import test from "node:test"
import fs from "node:fs"
import path from "node:path"
import { buildMarketAiEvidencePacket, hashMarketAiEvidence, validateMarketAiConclusion } from "../lib/market-ai-conclusion.ts"
import { buildMarketAiEvidencePacket as buildEdgePacket, hashMarketAiEvidence as hashEdgeEvidence } from "../supabase/functions/_shared/market-ai-conclusion.ts"

function fixture() {
  return {
    sessionDate: "2026-08-31", asOf: "2026-08-31T08:00:00.000Z", qualityStatus: "healthy", isStale: false,
    dailySummary: { sentimentScore: 55, riskScore: 0.3, aboveMa20Pct: 60, totalTradedValue: 1200, foreignNetValue: 10, proprietaryNetValue: 2, missingFields: [], qualityStatus: "healthy", sentimentLabel: "Trung tính", riskLabel: "Thấp", distributionCount: 1, distributionWindow: null, sentimentHistory: [], riskHistory: [], valuationHistory: [], aboveMa10Pct: 65, aboveMa50Pct: 55, aboveMa200Pct: 50, otherFlowNetValue: 0, totalMatchedVolume: 1, evidenceRefs: [], sourceTimestamp: "2026-08-31T08:00:00.000Z" },
    indexes: [{ indexCode: "VNINDEX", value: 1200, change: 2, changePct: 0.2, reference: 1198, open: null, high: null, low: null, matchedVolume: 1, tradedValue: 1200, previousValueChangePct: null, advances: 200, unchanged: 50, declines: 100, ceilings: 2, floors: 1, marketPe: 12, foreignBuyValue: null, foreignSellValue: null, foreignNetValue: null, qualityStatus: "healthy", evidenceRefs: [], asOf: "2026-08-31T08:00:00.000Z" }], sectors: [], leaders: [], observations: [], history: [], marketInsightProvenance: { syncRunId: "run-1", payloadChecksum: "a".repeat(64), contractVersion: 2, endpointCoverage: {}, publishedCounts: {} },
  } as any
}
test("market evidence hash is order-independent and citations are bounded", () => {
  const packet = buildMarketAiEvidencePacket(fixture())
  const reordered = { ...packet, facts: [...packet.facts].reverse() }
  assert.equal(hashMarketAiEvidence(packet), hashMarketAiEvidence(reordered))
  const hash = hashMarketAiEvidence(packet)
  const result = validateMarketAiConclusion({ packet, evidenceHash: hash, payload: { schemaVersion: "market-ai-conclusion-v2", confidence: "medium", headline: "Bằng chứng chưa đủ.", sessionDate: packet.sessionDate, asOf: packet.asOf, snapshotId: packet.snapshotId, evidenceHash: hash, policyVersion: packet.policyVersion, promptVersion: packet.promptVersion, framework: "canslim_4m_inspired", posture: "insufficient_evidence", conclusion: "Bằng chứng chưa đủ.", risks: [], missingEvidence: ["leadership", "sector_rotation"], effortResult: { effort: "GTGD", effortEvidenceRefs: ["total_traded_value"], result: "VNINDEX", resultEvidenceRefs: ["vnindex_change_pct"], interpretation: "Thanh khoản và chỉ số snapshot." }, dimensions: [{ key: "index_breadth", stance: "unknown", summary: "Có chỉ số.", evidenceRefs: ["vnindex_close"] }, { key: "liquidity_flow", stance: "unknown", summary: "Có thanh khoản.", evidenceRefs: ["total_traded_value"] }, { key: "ma_health", stance: "unknown", summary: "Có MA.", evidenceRefs: ["above_ma20_pct"] }, { key: "sector_rotation", stance: "unknown", summary: "Thiếu.", evidenceRefs: [] }, { key: "leadership", stance: "unknown", summary: "Thiếu.", evidenceRefs: [] }], citations: [{ factId: "vnindex_close", claim: "conclusion", interpretation: "Giá đóng cửa snapshot." }, { factId: "total_traded_value", claim: "effort_result", interpretation: "Thanh khoản snapshot." }] } })
  assert.equal(result.valid, true, result.errors.join(", "))
})
test("market evidence rejects mixed asOf", () => {
  const data = fixture(); data.indexes[0].asOf = "2026-08-30T08:00:00.000Z"
  assert.throws(() => buildMarketAiEvidencePacket(data), /asOf-aligned/)
})

test("app and Edge evidence packet/hash fixtures stay byte-equivalent", async () => {
  const data = fixture()
  const appPacket = buildMarketAiEvidencePacket(data)
  const edgePacket = await buildEdgePacket({
    sessionDate: data.sessionDate,
    asOf: data.asOf,
    qualityStatus: data.qualityStatus,
    marketInsightProvenance: data.marketInsightProvenance,
    daily: { sentimentScore: 55, riskScore: 0.3, aboveMa20Pct: 60, totalTradedValue: 1200, foreignNetValue: 10, proprietaryNetValue: 2, missingFields: [] },
    indexes: [{ indexCode: "VNINDEX", value: 1200, changePct: 0.2, advances: 200, unchanged: 50, declines: 100, asOf: data.asOf }],
    sectors: [], leaders: [], observations: [],
  })
  assert.deepEqual(edgePacket, appPacket)
  assert.equal(await hashEdgeEvidence(edgePacket), hashMarketAiEvidence(appPacket))
})

test("market AI migration is private, idempotent and lease-claimed", () => {
  const sql = fs.readFileSync(path.resolve("supabase/migrations/20260831190000_market_ai_conclusions.sql"), "utf8")
  const hardening = fs.readFileSync(path.resolve("supabase/migrations/20260831150501_harden_market_ai_guard_search_path.sql"), "utf8")
  assert.match(sql, /unique \(session_date, policy_version, prompt_version, evidence_hash\)/)
  assert.match(sql, /claim_market_ai_conclusion/)
  assert.match(sql, /complete_market_ai_conclusion/)
  assert.match(sql, /lease_until/)
  assert.match(sql, /claimed_at/)
  assert.match(sql, /lease_expires_at/)
  assert.match(sql, /updated_at timestamptz/)
  assert.match(sql, /market_ai_conclusion_guard/)
  assert.match(sql, /terminal market AI conclusion is immutable/)
  assert.match(sql, /select v\.id,null::uuid,v\.status/)
  assert.match(sql, /revoke all on public\.market_ai_conclusions from public, anon, authenticated/)
  assert.match(sql, /between 0 and 0\.03/)
  assert.match(hardening, /alter function public\.market_ai_conclusion_guard\(\) set search_path = public/i)
})

test("market AI corrective migration freezes manifest and quarantines uncertain model completion", () => {
  const sql = fs.readFileSync(path.resolve("supabase/migrations/20260831190500_market_ai_conclusions_v2.sql"), "utf8")
  assert.match(sql, /on conflict \(session_date, policy_version, prompt_version, evidence_hash\) do nothing/i)
  assert.match(sql, /p_evidence_manifest jsonb/)
  assert.match(sql, /model_started_at timestamptz/)
  assert.match(sql, /completion_unknown/)
  assert.match(sql, /MODEL_COMPLETION_UNKNOWN/)
  assert.match(sql, /start_market_ai_conclusion_model/)
  assert.match(sql, /v_manifest <> p_manifest/)
  assert.match(sql, /dispatch_market_ai_conclusion/)
  assert.match(sql, /market_ai_conclusion_secret/)
  assert.match(sql, /x-market-ai-secret/)
  assert.doesNotMatch(sql, /qeo_get_market_close_sync_secret/)
})

test("market AI first claimant owns the row it inserts", () => {
  const sql = fs.readFileSync(path.resolve("supabase/migrations/20260901001000_fix_market_ai_first_claim_owner.sql"), "utf8")
  const qualification = fs.readFileSync(path.resolve("supabase/migrations/20260901001500_fix_market_ai_claim_ambiguous_id.sql"), "utf8")
  assert.match(sql, /returning \* into v/i)
  assert.match(sql, /if found then[\s\S]*v\.claim_token/i)
  assert.match(sql, /status = 'running' and model_started_at is null/i)
  assert.match(qualification, /market_ai_conclusions\.id = v\.id/i)
  assert.match(qualification, /qualification target not found/i)
})

test("market AI Edge Function is machine-authenticated, bounded and idempotent", () => {
  const source = fs.readFileSync(path.resolve("supabase/functions/market-ai-conclusion/index.ts"), "utf8")
  const shared = fs.readFileSync(path.resolve("supabase/functions/_shared/market-ai-conclusion.ts"), "utf8")
  assert.doesNotMatch(source, /MARKET_AI_CONCLUSION_SECRET/)
  assert.doesNotMatch(source, /KFSP_SYNC_SECRET/)
  assert.match(source, /qeo_verify_market_ai_dispatch_secret/)
  assert.match(source, /DISPATCH_AUTH_UNAVAILABLE/)
  assert.match(source, /mode !== "latest" && mode !== "session"/)
  assert.match(source, /market_insight_daily/)
  assert.match(source, /market_insight_indexes/)
  assert.match(source, /market_insight_sectors/)
  assert.match(source, /market_insight_leaders/)
  assert.match(source, /claim_market_ai_conclusion/)
  assert.match(source, /complete_market_ai_conclusion/)
  assert.match(source, /MARKET_AI_MODEL/)
  assert.match(source, /MARKET_AI_MODEL_API_VALIDATED/)
  assert.match(source, /effort: REASONING_EFFORT/)
  assert.match(source, /max_output_tokens: MAX_OUTPUT_TOKENS/)
  assert.match(source, /MAX_INPUT_CHARS/)
  assert.match(source, /MAX_COST_USD/)
  assert.match(source, /CANSLIM\/4M chỉ là lăng kính diễn giải/)
  assert.match(source, /status: "insufficient_evidence"/)
  assert.match(shared, /crypto\.subtle\.digest\("SHA-256"/)
  assert.match(shared, /expectedMissingEvidence/)
  assert.match(shared, /slice\(0, 12\)/)
  assert.match(shared, /normalizeMarketAiConclusionReferences/)
  assert.match(shared, /citation\.claim === "effort_result"/)
  assert.match(shared, /owners\[dimension\.key\]/)
  assert.match(source, /start_market_ai_conclusion_model/)
  assert.match(source, /mark_market_ai_completion_unknown/)
  assert.match(source, /Math\.ceil\(prompt\.length \/ 3\)/)
  assert.match(source, /completion_unknown/)
})
