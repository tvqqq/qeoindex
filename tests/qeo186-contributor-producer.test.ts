import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

const read = (relativePath: string) => fs.readFileSync(path.resolve(relativePath), "utf8")

test("QEO-186 estimator derives cap-weighted directional contributors without calibrating to net move", async () => {
  const modulePath = path.resolve("supabase/functions/_shared/vnindex-contributor-estimator.ts")
  assert.ok(fs.existsSync(modulePath), "QEO-186 must add a pure VNINDEX contributor estimator")
  const { estimateVnindexContributors } = await import(pathToFileURL(modulePath).href)

  const result = estimateVnindexContributors({
    vnindexValue: 1010,
    vnindexChange: 10,
    advances: 1,
    declines: 1,
    unchanged: 0,
    candidates: [
      { ticker: "AAA", exchange: "HOSE", marketCapBillion: 660, changePct: 10, price: 66 },
      { ticker: "BBB", exchange: "HOSE", marketCapBillion: 380, changePct: -5, price: 38 },
    ],
  })

  assert.equal(result.status, "ready")
  assert.equal(result.validCandidateCount, 2)
  assert.equal(result.breadthCount, 2)
  assert.equal(result.contributors.length, 2)
  assert.deepEqual(
    result.contributors.map((item: { ticker: string; category: string; estimatedIndexPoints: number }) => ({
      ticker: item.ticker,
      category: item.category,
      estimatedIndexPoints: item.estimatedIndexPoints,
    })),
    [
      { ticker: "AAA", category: "index_up", estimatedIndexPoints: 60 },
      { ticker: "BBB", category: "index_down", estimatedIndexPoints: -20 },
    ],
  )
  assert.equal(result.estimatedNetPoints, 40, "estimator must not rescale contributions to force the actual +10 point move")
})

test("QEO-186 estimator fails closed when same-session HOSE candidate coverage is insufficient", async () => {
  const modulePath = path.resolve("supabase/functions/_shared/vnindex-contributor-estimator.ts")
  assert.ok(fs.existsSync(modulePath), "QEO-186 must add a pure VNINDEX contributor estimator")
  const { estimateVnindexContributors } = await import(pathToFileURL(modulePath).href)

  const result = estimateVnindexContributors({
    vnindexValue: 1010,
    vnindexChange: 10,
    advances: 50,
    declines: 40,
    unchanged: 10,
    candidates: Array.from({ length: 20 }, (_, index) => ({
      ticker: `A${String(index).padStart(2, "0")}`,
      exchange: "HOSE",
      marketCapBillion: 100,
      changePct: 1,
      price: 10,
    })),
  })

  assert.equal(result.status, "insufficient_coverage")
  assert.equal(result.contributors.length, 0)
})

test("QEO-186 persists KFSP candidate returns and feeds same-session candidates into Market Close", () => {
  const ratingSync = read("supabase/functions/kfsp-rating-sync/index.ts")
  const marketClose = read("supabase/functions/market-insight-eod-sync/index.ts")
  const normalizer = read("supabase/functions/_shared/market-close-normalizer-base.ts")
  const migrations = fs.readdirSync(path.resolve("supabase/migrations"))
    .filter((name) => name.includes("qeo186") && name.endsWith(".sql"))
    .map((name) => read(`supabase/migrations/${name}`))
    .join("\n")

  assert.match(migrations, /kfsp_universe_candidate_snapshots[\s\S]*price_change_pct/i)
  assert.match(ratingSync, /candidateRows[\s\S]*price_change_pct:\s*row\.price_change_pct/)
  assert.match(marketClose, /kfsp_universe_candidate_snapshots/)
  assert.match(marketClose, /\.eq\("as_of_date",\s*sessionDate\)/)
  assert.match(marketClose, /price_change_pct/)
  assert.match(marketClose, /contributorCandidates/)
  assert.match(normalizer, /estimateVnindexContributors/)
  assert.match(normalizer, /category:\s*contributor\.category/)
  assert.match(normalizer, /estimated_index_points:\s*contributor\.estimatedIndexPoints/)
})

test("QEO-186 UI discloses that index-point contribution is a Qeo estimate from KFSP inputs", () => {
  const dashboard = read("components/insights/market-close-dashboard.tsx")
  const contributors = read("components/insights/vnindex-contributors-view.tsx")
  assert.match(`${dashboard}\n${contributors}`, /Qeo[^\n]*(ước tính|estimate)[^\n]*KFSP/i)
})

import "./qeo188-leadership-concentration.cases.ts"
