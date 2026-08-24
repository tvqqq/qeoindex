import test from "node:test"
import assert from "node:assert/strict"

import {
  INSIGHTS_METRIC_GUIDE_VERSION,
  INSIGHTS_METRIC_SEMANTICS,
  getMetricSemantic,
  buildAiMetricDictionary,
} from "../lib/insights-metric-semantics.ts"

const CORE_REQUIRED_KEYS = [
  "market_breadth",
  "market_liquidity",
  "market_risk_score",
  "kfsp_canslim_score",
  "kfsp_score_4m",
  "kfsp_price_potential",
  "kfsp_stock_rs_score",
  "kfsp_sector_rs_score",
  "rs_short",
  "rs_medium",
  "kfsp_stock_rrg_state",
  "kfsp_sector_rrg_state",
  "weekly_change_pct",
  "monthly_change_pct",
  "kfsp_composite_score",
  "beta",
  "pe_ttm",
  "pb_ttm",
  "net_revenue_growth_pct",
  "net_income_growth_pct",
  "roe_ttm_pct",
  "net_margin_ttm_pct",
  "price_vs_sma10_pct",
  "price_vs_sma20_pct",
  "price_vs_sma50_pct",
  "price_vs_sma100_pct",
  "price_vs_sma200_pct",
  "macd_vs_signal",
  "volume_1d",
  "average_volume_20d",
  "volume_vs_previous_session_pct",
  "traded_value_vs_previous_session_pct",
  "net_foreign_trading_billion",
  "net_proprietary_trading_billion",
  "vnindex_close",
  "vnindex_sma20",
  "vnindex_return_20d_pct",
  "vnindex_regime",
]

test("INSIGHTS_METRIC_GUIDE_VERSION is defined and stable", () => {
  assert.equal(INSIGHTS_METRIC_GUIDE_VERSION, "metric-guide-v1")
})

test("semantic registry covers all required core keys with unique keys and valid schemas", () => {
  const keys = new Set<string>()
  const validCategories = new Set(["market", "quality", "relative_strength", "momentum", "rotation", "risk", "valuation", "liquidity"])
  const validSources = new Set(["kfsp", "qeoindex", "market_feed"])
  const validUnits = new Set(["score_0_100", "percent", "price_thousand_vnd", "billion_vnd", "ratio", "state", "text", "volume"])
  const validDirections = new Set(["higher_is_supportive", "higher_is_risk", "context_only", "categorical"])

  for (const metric of INSIGHTS_METRIC_SEMANTICS) {
    assert.ok(!keys.has(metric.key), `Duplicate metric key found: ${metric.key}`)
    keys.add(metric.key)

    assert.ok(metric.key.length > 0)
    assert.ok(metric.label.length > 0)
    assert.ok(validCategories.has(metric.category), `Invalid category: ${metric.category}`)
    assert.ok(validSources.has(metric.source), `Invalid source: ${metric.source}`)
    assert.ok(validUnits.has(metric.unit), `Invalid unit: ${metric.unit}`)
    assert.ok(validDirections.has(metric.direction), `Invalid direction: ${metric.direction}`)

    // Beginner copy validation
    assert.ok(metric.beginner.what.length > 10, `beginner.what too short for ${metric.key}`)
    assert.ok(metric.beginner.read.length > 10, `beginner.read too short for ${metric.key}`)
    assert.ok(metric.beginner.combineWith.length > 0, `beginner.combineWith empty for ${metric.key}`)
    assert.ok(metric.beginner.notMeaning.length > 10, `beginner.notMeaning too short for ${metric.key}`)

    // AI grounding validation
    assert.ok(metric.ai.meaning.length > 10, `ai.meaning too short for ${metric.key}`)
    assert.ok(metric.ai.interpretationRules.length > 0, `ai.interpretationRules empty for ${metric.key}`)
    assert.ok(metric.ai.forbiddenInferences.length > 0, `ai.forbiddenInferences empty for ${metric.key}`)
    assert.ok(metric.provenanceNote.length > 5, `provenanceNote too short for ${metric.key}`)
  }

  for (const requiredKey of CORE_REQUIRED_KEYS) {
    assert.ok(keys.has(requiredKey), `Missing required core key: ${requiredKey}`)
  }
})

test("getMetricSemantic resolves keys and aliases case-insensitively", () => {
  const byKey = getMetricSemantic("kfsp_canslim_score")
  assert.ok(byKey)
  assert.equal(byKey?.key, "kfsp_canslim_score")

  const byAliasCanslim = getMetricSemantic("CANSLIM")
  assert.equal(byAliasCanslim?.key, "kfsp_canslim_score")

  const byAlias4M = getMetricSemantic("4M")
  assert.equal(byAlias4M?.key, "kfsp_score_4m")

  const byAliasRss = getMetricSemantic("RSs")
  assert.equal(byAliasRss?.key, "rs_short")

  const byAliasRsm = getMetricSemantic("RSm")
  assert.equal(byAliasRsm?.key, "rs_medium")

  const byAliasRrg = getMetricSemantic("RRG")
  assert.equal(byAliasRrg?.key, "kfsp_stock_rrg_state")

  const byAliasBeta = getMetricSemantic("Beta")
  assert.equal(byAliasBeta?.key, "beta")

  const missing = getMetricSemantic("non_existent_key_123")
  assert.equal(missing, null)
})

test("anti-confusion rules enforce explicit boundaries between RS, RSI, RRG and snapshot deltas", () => {
  const rsShort = getMetricSemantic("rs_short")
  assert.ok(rsShort)
  assert.ok(rsShort.beginner.notMeaning.includes("RSI"))
  assert.ok(rsShort.beginner.notMeaning.includes("RRG"))
  assert.ok(rsShort.ai.forbiddenInferences.some((rule) => rule.includes("RSI")))

  const rsi = getMetricSemantic("rsi_14")
  assert.ok(rsi)
  assert.ok(rsi.beginner.notMeaning.includes("RSs/RSm"))
  assert.ok(rsi.beginner.notMeaning.includes("RRG"))

  const stockRrg = getMetricSemantic("kfsp_stock_rrg_state")
  assert.ok(stockRrg)
  assert.ok(stockRrg.ai.forbiddenInferences.some((rule) => rule.toLowerCase().includes("trajectory") || rule.toLowerCase().includes("vector")))

  const weeklyChange = getMetricSemantic("weekly_change_pct")
  assert.ok(weeklyChange)
  assert.ok(weeklyChange.beginner.notMeaning.includes("7D"))

  const monthlyChange = getMetricSemantic("monthly_change_pct")
  assert.ok(monthlyChange)
  assert.ok(monthlyChange.beginner.notMeaning.includes("30D"))
})

test("derived metrics identify exact formula ownership", () => {
  const riskScore = getMetricSemantic("market_risk_score")
  assert.ok(riskScore?.provenanceNote.includes("lib/insights-data.ts"))

  const composite = getMetricSemantic("kfsp_composite_score")
  assert.ok(composite?.provenanceNote.includes("lib/insights-rating-model.ts"))

  const regime = getMetricSemantic("vnindex_regime")
  assert.ok(regime?.provenanceNote.includes("lib/ai-council-market.ts"))
})

test("buildAiMetricDictionary compacts and deduplicates entries", () => {
  const dict = buildAiMetricDictionary(["rs_short", "RSs", "kfsp_canslim_score", "unknown_key"])
  assert.equal(dict.length, 2)
  assert.equal(dict[0].key, "rs_short")
  assert.equal(dict[1].key, "kfsp_canslim_score")
  assert.ok(dict[0].meaning)
  assert.ok(Array.isArray(dict[0].interpretationRules))
  assert.ok(Array.isArray(dict[0].forbiddenInferences))
})

test("insights dashboard follows accessibility and deep-link contract for ScorePill and SortableHead", async () => {
  const fs = await import("node:fs/promises")
  const path = await import("node:path")

  const dashboardFile = path.resolve(process.cwd(), "components/insights/insights-dashboard.tsx")
  const content = await fs.readFile(dashboardFile, "utf-8")

  // 1. SortableHead does not nest <MetricLabel> or buttons inside sort button
  assert.ok(content.includes("aria-label={`Sắp xếp theo ${displayLabel}`"))
  assert.ok(content.includes("aria-label={`Xem giải thích chỉ số ${displayLabel}`"))

  // 2. ScorePill renders a native button when hasGuide is true, with e.stopPropagation() and accessible aria-label
  assert.ok(content.includes("const hasGuide = Boolean(metricKey && onOpenGuide)"))
  assert.ok(content.includes("e.stopPropagation()"))
  assert.ok(content.includes("onOpenGuide?.(metricKey!)"))
  assert.ok(content.includes("aria-label={`${label}: ${rounded}/100. Nhấp để xem giải thích chỉ số`}"))

  // 3. TooltipContent is non-interactive and does not nest interactive buttons
  assert.ok(content.includes("pointer-events-none"))

  // 4. All ScorePill calls pass onOpenGuide={openGuide} and a metricKey
  const scorePillMatches = content.match(/<ScorePill\s+[^>]+>/g) || []
  assert.ok(scorePillMatches.length >= 12, `Expected at least 12 ScorePill usages, found ${scorePillMatches.length}`)
  for (const match of scorePillMatches) {
    assert.ok(match.includes("onOpenGuide={openGuide}"), `ScorePill missing onOpenGuide: ${match}`)
    assert.ok(match.includes("metricKey="), `ScorePill missing metricKey: ${match}`)
  }

  // 5. Performance guard: ScorePill and table elements avoid CSS filter/brightness hover classes and transition-all
  assert.ok(!content.includes("brightness-"), "insights-dashboard must not use brightness filter on table elements")
  assert.ok(!content.includes("backdrop-blur"), "insights-dashboard must not use heavy backdrop-blur near dense tables")
  assert.ok(!content.includes("transition-all"), "insights-dashboard must not use transition-all in performance-sensitive UI")
})

test("aggregate volume semantics avoid unsupported institutional attribution", () => {
  for (const key of ["market_liquidity", "average_volume_20d"]) {
    const semantic = getMetricSemantic(key)
    assert.ok(semantic)
    const aiText = [...semantic.ai.interpretationRules, ...semantic.ai.forbiddenInferences].join(" ").toLowerCase()
    assert.ok(!aiText.includes("institutional"), `${key} should not infer institutional participation from aggregate volume`)
  }
})
