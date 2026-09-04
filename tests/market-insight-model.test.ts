import test from "node:test"
import assert from "node:assert/strict"

import {
  generateMarketObservations,
  type MarketObservationSnapshotInput,
} from "../modules/research/market-insight/model.ts"

const sampleInput: MarketObservationSnapshotInput = {
  sessionDate: "2026-08-26",
  asOf: "2026-08-26T08:15:00.000Z",
  regime: "TÍCH CỰC",
  daily: {
    sentimentScore: 65,
    sentimentLabel: "Lạc quan",
    riskScore: 28,
    riskLabel: "Trung bình",
    distributionCount: 2,
    aboveMa10Pct: 68,
    aboveMa20Pct: 61.5,
    aboveMa50Pct: 53.8,
    aboveMa200Pct: 47.9,
    foreignNetValue: -145.2,
    proprietaryNetValue: 92.5,
    totalMatchedVolume: 780450000,
    totalTradedValue: 19850,
    qualityStatus: "healthy",
  },
  indexes: [
    {
      indexCode: "VNINDEX",
      value: 1284.55,
      change: 11.25,
      changePct: 0.88,
      tradedValue: 19850,
      advances: 274,
      unchanged: 68,
      declines: 122,
      ceilings: 9,
      floors: 1,
    },
  ],
  sectors: [
    {
      sectorKey: "bat_dong_san",
      displayName: "Bất động sản",
      timeWindow: "1d",
      tradedValue: 4520.3,
      averageChangePct: 2.35,
      rsScore: 79.5,
      rotationState: "leading",
      advances: 42,
      declines: 10,
    },
    {
      sectorKey: "chung_khoan",
      displayName: "Chứng khoán",
      timeWindow: "1d",
      tradedValue: 3200.5,
      averageChangePct: 1.85,
      rsScore: 81.0,
      rotationState: "leading",
      advances: 25,
      declines: 2,
    },
  ],
  leaders: [
    {
      category: "index_up",
      rank: 1,
      ticker: "VCB",
      price: 92.5,
      changePct: 1.8,
      estimatedIndexPoints: 2.10,
      metricValue: 2.1,
      metricLabel: "+2.10 điểm",
    },
    {
      category: "index_down",
      rank: 1,
      ticker: "VNM",
      price: 68.2,
      changePct: -0.9,
      estimatedIndexPoints: -0.45,
      metricValue: -0.45,
      metricLabel: "-0.45 điểm",
    },
  ],
}

test("deterministic market observations: generates 4-5 grounded factual observations", () => {
  const observations = generateMarketObservations(sampleInput)

  assert.ok(observations.length >= 4, `Expected at least 4 observations, got ${observations.length}`)

  // 1. Index breadth observation
  const indexObs = observations.find((o) => o.category === "regime")
  assert.ok(indexObs)
  assert.match(indexObs.content, /VNINDEX tăng \+11,25 điểm \(\+0,88%\)/)
  assert.match(indexObs.content, /274 mã tăng/)
  assert.equal(indexObs.sentiment, "positive")
  assert.ok(indexObs.evidenceRefs.some((ref) => ref.field === "vnindex_close" && ref.value === 1284.55))

  // 2. Liquidity & flows observation
  const flowObs = observations.find((o) => o.category === "liquidity")
  assert.ok(flowObs)
  assert.match(flowObs.content, /khối ngoại bán ròng -145,2 tỷ đồng/)
  assert.match(flowObs.content, /tự doanh mua ròng \+92,5 tỷ đồng/)

  // 3. Structural health observation
  const healthObs = observations.find((o) => o.category === "health")
  assert.ok(healthObs)
  assert.match(healthObs.content, /61,5% cổ phiếu trên MA20/)
  assert.match(healthObs.content, /2 phiên/)

  // 4. Sector rotation observation
  const secObs = observations.find((o) => o.category === "sectors")
  assert.ok(secObs)
  assert.match(secObs.content, /Chứng khoán/)
  assert.match(secObs.content, /Bất động sản/)

  // 5. Index impact observation
  const leadObs = observations.find((o) => o.category === "leaders")
  assert.ok(leadObs)
  assert.match(leadObs.content, /VCB \(\+2,1 đ\)/)
  assert.match(leadObs.content, /VNM \(-0,45 đ\)/)
})

test("deterministic market observations: detects and warns on breadth divergence", () => {
  const divergentInput: MarketObservationSnapshotInput = {
    ...sampleInput,
    indexes: [
      {
        indexCode: "VNINDEX",
        value: 1290.0,
        change: 15.0,
        changePct: 1.18, // Index is up
        tradedValue: 20000,
        advances: 90,   // Breadth is weak (90 vs 310)
        unchanged: 40,
        declines: 310,
        ceilings: 2,
        floors: 0,
      },
    ],
  }

  const observations = generateMarketObservations(divergentInput)
  const indexObs = observations.find((o) => o.category === "regime")
  assert.ok(indexObs)
  assert.equal(indexObs.sentiment, "warning")
  assert.match(indexObs.content, /phân kỳ/)
})

test("deterministic market observations: omits missing metrics cleanly without guessing", () => {
  const missingDataInput: MarketObservationSnapshotInput = {
    sessionDate: "2026-08-26",
    asOf: "2026-08-26T08:15:00.000Z",
    regime: "PHÂN HÓA",
    daily: {
      sentimentScore: null,
      sentimentLabel: null,
      riskScore: null,
      riskLabel: null,
      distributionCount: null,
      aboveMa10Pct: null,
      aboveMa20Pct: null,
      aboveMa50Pct: null,
      aboveMa200Pct: null,
      foreignNetValue: null,
      proprietaryNetValue: null,
      totalMatchedVolume: null,
      totalTradedValue: null,
      qualityStatus: "degraded",
    },
    indexes: [
      {
        indexCode: "VNINDEX",
        value: 1250.0,
        change: 0.0,
        changePct: 0.0,
        tradedValue: null,
        advances: 150,
        unchanged: 100,
        declines: 150,
        ceilings: 0,
        floors: 0,
      },
    ],
    sectors: [],
    leaders: [],
  }

  const observations = generateMarketObservations(missingDataInput)
  // Only index breadth is generated; missing health/flows/sectors/leaders are omitted without error or fabricated text
  assert.equal(observations.length, 1)
  assert.equal(observations[0].category, "regime")
})
