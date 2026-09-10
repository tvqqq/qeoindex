from pathlib import Path
import json

ROOT = Path('.')

def replace_once(path: str, old: str, new: str):
    p = ROOT / path
    text = p.read_text()
    if old not in text:
        raise SystemExit(f"pattern missing in {path}: {old[:120]!r}")
    if text.count(old) != 1:
        raise SystemExit(f"pattern not unique in {path}: {text.count(old)}")
    p.write_text(text.replace(old, new, 1))

# 1) Pure Qeo estimator. Inputs remain provider facts; output is explicitly derived.
estimator = ROOT / 'supabase/functions/_shared/vnindex-contributor-estimator.ts'
estimator.write_text('''export interface VnindexContributorCandidate {\n  ticker: string\n  exchange: string | null\n  marketCapBillion: number | null\n  changePct: number | null\n  price: number | null\n}\n\nexport interface EstimatedVnindexContributor {\n  ticker: string\n  category: "index_up" | "index_down"\n  rank: number\n  price: number | null\n  changePct: number\n  estimatedIndexPoints: number\n}\n\nexport type VnindexContributorEstimateStatus = "ready" | "invalid_index" | "insufficient_coverage"\n\nexport interface VnindexContributorEstimate {\n  status: VnindexContributorEstimateStatus\n  breadthCount: number\n  validCandidateCount: number\n  coverageRatio: number | null\n  estimatedNetPoints: number | null\n  contributors: EstimatedVnindexContributor[]\n}\n\nconst MIN_COVERAGE_RATIO = 0.9\n\nfunction finite(value: number | null): value is number {\n  return value != null && Number.isFinite(value)\n}\n\nfunction round6(value: number) {\n  return Number(value.toFixed(6))\n}\n\nexport function estimateVnindexContributors({\n  vnindexValue,\n  vnindexChange,\n  advances,\n  declines,\n  unchanged,\n  candidates,\n}: {\n  vnindexValue: number | null\n  vnindexChange: number | null\n  advances: number\n  declines: number\n  unchanged: number\n  candidates: readonly VnindexContributorCandidate[]\n}): VnindexContributorEstimate {\n  const breadthCount = Math.max(0, Math.trunc(advances)) + Math.max(0, Math.trunc(declines)) + Math.max(0, Math.trunc(unchanged))\n  const referenceIndex = finite(vnindexValue) && finite(vnindexChange) ? vnindexValue - vnindexChange : null\n\n  if (!finite(vnindexValue) || vnindexValue <= 0 || !finite(vnindexChange) || referenceIndex == null || referenceIndex <= 0 || breadthCount <= 0) {\n    return { status: "invalid_index", breadthCount, validCandidateCount: 0, coverageRatio: null, estimatedNetPoints: null, contributors: [] }\n  }\n\n  const unique = new Map<string, VnindexContributorCandidate>()\n  for (const candidate of candidates) {\n    const ticker = String(candidate.ticker || "").trim().toUpperCase()\n    if (!/^[A-Z0-9]{2,12}$/.test(ticker) || String(candidate.exchange || "").trim().toUpperCase() !== "HOSE") continue\n    if (!finite(candidate.marketCapBillion) || candidate.marketCapBillion <= 0) continue\n    if (!finite(candidate.changePct) || candidate.changePct <= -100) continue\n    if (!unique.has(ticker)) unique.set(ticker, { ...candidate, ticker })\n  }\n\n  const valid = [...unique.values()]\n  const validCandidateCount = valid.length\n  const coverageRatio = validCandidateCount / breadthCount\n  if (coverageRatio < MIN_COVERAGE_RATIO) {\n    return { status: "insufficient_coverage", breadthCount, validCandidateCount, coverageRatio: round6(coverageRatio), estimatedNetPoints: null, contributors: [] }\n  }\n\n  const weighted = valid.flatMap((candidate) => {\n    const marketCap = candidate.marketCapBillion as number\n    const changePct = candidate.changePct as number\n    const previousMarketCap = marketCap / (1 + changePct / 100)\n    return Number.isFinite(previousMarketCap) && previousMarketCap > 0\n      ? [{ candidate, changePct, previousMarketCap }]\n      : []\n  })\n  const totalPreviousMarketCap = weighted.reduce((sum, item) => sum + item.previousMarketCap, 0)\n  if (!Number.isFinite(totalPreviousMarketCap) || totalPreviousMarketCap <= 0) {\n    return { status: "insufficient_coverage", breadthCount, validCandidateCount, coverageRatio: round6(coverageRatio), estimatedNetPoints: null, contributors: [] }\n  }\n\n  const allImpacts = weighted.map((item) => ({\n    ticker: item.candidate.ticker,\n    price: finite(item.candidate.price) ? item.candidate.price : null,\n    changePct: item.changePct,\n    estimatedIndexPoints: round6(referenceIndex * (item.previousMarketCap / totalPreviousMarketCap) * (item.changePct / 100)),\n  }))\n  const estimatedNetPoints = round6(allImpacts.reduce((sum, item) => sum + item.estimatedIndexPoints, 0))\n\n  const pullers = allImpacts\n    .filter((item) => item.estimatedIndexPoints > 0)\n    .sort((a, b) => b.estimatedIndexPoints - a.estimatedIndexPoints)\n    .slice(0, 10)\n    .map((item, index) => ({ ...item, category: "index_up" as const, rank: index + 1 }))\n  const draggers = allImpacts\n    .filter((item) => item.estimatedIndexPoints < 0)\n    .sort((a, b) => a.estimatedIndexPoints - b.estimatedIndexPoints)\n    .slice(0, 10)\n    .map((item, index) => ({ ...item, category: "index_down" as const, rank: index + 1 }))\n\n  return {\n    status: "ready",\n    breadthCount,\n    validCandidateCount,\n    coverageRatio: round6(coverageRatio),\n    estimatedNetPoints,\n    contributors: [...pullers, ...draggers],\n  }\n}\n''')

# 2) Persist the same-session provider facts required by the estimator.
migration = ROOT / 'supabase/migrations/20260910193000_qeo186_candidate_price_change_for_index_contributors.sql'
migration.write_text('''begin;\n\nalter table public.kfsp_universe_candidate_snapshots\n  add column if not exists price numeric check (price is null or price >= 0),\n  add column if not exists price_change_pct numeric;\n\ncomment on column public.kfsp_universe_candidate_snapshots.price is\n  'KFSP candidate-feed close/last price normalized by kfsp-rating-sync; input evidence for Qeo-derived VNINDEX contributor estimates.';\ncomment on column public.kfsp_universe_candidate_snapshots.price_change_pct is\n  'KFSP candidate-feed 1D price change percent; input evidence for Qeo-derived VNINDEX contributor estimates.';\n\ncommit;\n''')

replace_once(
  'supabase/functions/kfsp-rating-sync/index.ts',
  '''      market_cap_billion: row.market_cap_billion,\n      average_volume_50_sessions: row.average_volume_50_sessions,''',
  '''      market_cap_billion: row.market_cap_billion,\n      price: row.price,\n      price_change_pct: row.price_change_pct,\n      average_volume_50_sessions: row.average_volume_50_sessions,''',
)

# 3) Market-close collection consumes the frozen same-session full KFSP feed.
replace_once(
  'supabase/functions/market-insight-eod-sync/index.ts',
  '''    const normalized = parseVerifiedMarketClosePayloads({''',
  '''    const contributorCandidateRes = await supabase\n      .from("kfsp_universe_candidate_snapshots")\n      .select("ticker,exchange,market_cap_billion,price_change_pct,price")\n      .eq("as_of_date", sessionDate)\n      .eq("exchange", "HOSE")\n    if (contributorCandidateRes.error) {\n      throw new Error(`CONTRIBUTOR_CANDIDATE_READ_FAILED: ${contributorCandidateRes.error.message}`)\n    }\n    const contributorCandidates = (contributorCandidateRes.data || []).map((row) => ({\n      ticker: String(row.ticker || "").trim().toUpperCase(),\n      exchange: row.exchange != null ? String(row.exchange) : null,\n      marketCapBillion: parseNumeric(row.market_cap_billion),\n      changePct: parseNumeric(row.price_change_pct),\n      price: parseNumeric(row.price),\n    }))\n\n    const normalized = parseVerifiedMarketClosePayloads({''',
)
replace_once(
  'supabase/functions/market-insight-eod-sync/index.ts',
  '''      getLiveOk: Boolean(socketData.getLive),\n      providerIndexes,''',
  '''      getLiveOk: Boolean(socketData.getLive),\n      contributorCandidates,\n      providerIndexes,''',
)

# 4) Canonical normalizer appends Qeo-derived directional leaders while preserving top-volume facts.
normalizer = ROOT / 'supabase/functions/_shared/market-close-normalizer-base.ts'
text = normalizer.read_text()
if not text.startswith('export type MarketRegime'):
    raise SystemExit('unexpected market-close-normalizer-base header')
text = 'import { estimateVnindexContributors, type VnindexContributorCandidate } from "./vnindex-contributor-estimator.ts"\n\n' + text
text = text.replace(
  '  getLiveOk?: boolean\n  providerIndexes: NormalizedIndexRow[]',
  '  getLiveOk?: boolean\n  contributorCandidates?: VnindexContributorCandidate[]\n  providerIndexes: NormalizedIndexRow[]',
  1,
)
text = text.replace(
  '    getLiveOk = false,\n    providerIndexes,',
  '    getLiveOk = false,\n    contributorCandidates = [],\n    providerIndexes,',
  1,
)
leader_anchor = '''  // 9. Build compound staged items\n'''
if leader_anchor not in text:
    raise SystemExit('leader staging anchor missing')
contributor_block = '''  const vnindex = providerIndexes.find((index) => index.index_code === "VNINDEX")\n  const contributorEstimate = estimateVnindexContributors({\n    vnindexValue: vnindex?.value ?? null,\n    vnindexChange: vnindex?.change ?? null,\n    advances: vnindex?.advances ?? 0,\n    declines: vnindex?.declines ?? 0,\n    unchanged: vnindex?.unchanged ?? 0,\n    candidates: contributorCandidates,\n  })\n\n  if (contributorEstimate.status === "ready") {\n    for (const contributor of contributorEstimate.contributors) {\n      leaders.push({\n        session_date: sessionDate,\n        category: contributor.category,\n        rank: contributor.rank,\n        ticker: contributor.ticker,\n        price: contributor.price,\n        change_pct: contributor.changePct,\n        estimated_index_points: contributor.estimatedIndexPoints,\n        metric_value: contributor.estimatedIndexPoints,\n        metric_label: "Qeo ước tính · cap-weight từ dữ liệu KFSP",\n        quality_status: "healthy",\n        missing_fields: [],\n        evidence_refs: [\n          { field: "estimated_index_points", source_class: "market_leaders", observed_at: asOfIso, unit: "Qeo estimated index points" },\n        ],\n        source_timestamp: asOfIso,\n        as_of: asOfIso,\n      })\n    }\n  }\n\n'''
text = text.replace(leader_anchor, contributor_block + leader_anchor, 1)
normalizer.write_text(text)

# 5) User-facing provenance: never present derived points as provider-owned facts.
replace_once(
  'components/insights/market-close-dashboard.tsx',
  'description="Top mã kéo tăng/giảm và mức độ tập trung đóng góp"',
  'description="Qeo ước tính từ dữ liệu vốn hóa & biến động giá KFSP · top mã kéo tăng/giảm"',
)

# 6) Keep generated DB types aligned with the migration without touching unrelated tables.
types_path = ROOT / 'modules/shared/supabase/database.types.ts'
types = types_path.read_text()
start = types.find('      kfsp_universe_candidate_snapshots: {')
if start < 0:
    raise SystemExit('candidate snapshot type block missing')
end = types.find('\n      ', start + len('      kfsp_universe_candidate_snapshots: {'))
# find the next table marker after Relationships closes, not an inner section
next_marker = types.find('\n      kfsp_', start + 50)
while next_marker > 0 and next_marker < start + 200:
    next_marker = types.find('\n      kfsp_', next_marker + 1)
if next_marker < 0:
    raise SystemExit('next KFSP type marker missing')
block = types[start:next_marker]
if 'price_change_pct' not in block:
    block = block.replace('          market_cap_billion: number | null\n', '          market_cap_billion: number | null\n          price: number | null\n          price_change_pct: number | null\n', 1)
    block = block.replace('          market_cap_billion?: number | null\n', '          market_cap_billion?: number | null\n          price?: number | null\n          price_change_pct?: number | null\n', 1)
    # second optional occurrence is Update
    pos = block.find('          market_cap_billion?: number | null\n', block.find('          market_cap_billion?: number | null\n') + 1)
    if pos >= 0:
        needle = '          market_cap_billion?: number | null\n'
        block = block[:pos] + block[pos:].replace(needle, needle + '          price?: number | null\n          price_change_pct?: number | null\n', 1)
    types = types[:start] + block + types[next_marker:]
    types_path.write_text(types)

# 7) Register the regression test in Current contracts.
manifest_path = ROOT / 'tests/test-contracts.json'
manifest = json.loads(manifest_path.read_text())
if not any(entry.get('path') == 'tests/qeo186-contributor-producer.test.ts' for entry in manifest['entries']):
    manifest['entries'].append({
        'path': 'tests/qeo186-contributor-producer.test.ts',
        'owner': 'market',
        'invariant': 'QEO-186 persists full-feed KFSP return inputs and derives fail-closed Qeo VNINDEX contributor estimates for Market Insights.',
        'bucket': 'canonical',
        'suites': ['fast', 'ui-contracts'],
    })
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')

print('QEO-186 producer GREEN patch applied')
