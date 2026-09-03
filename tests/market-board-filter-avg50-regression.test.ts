import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

import {
  canUnselectFilterSector,
  filterBoardTickers,
  groupFilterSectorsByBoardColumn,
  hasRequiredFilterSectorSelections,
  isLockedFilterSector,
  normalizeStockFilterCriteria,
} from "../lib/market-board/stock-filter.ts"

const modalSource = readFileSync(new URL("../components/market-board/stock-filter-modal.tsx", import.meta.url), "utf8")
const pageSource = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8")
const helperSource = readFileSync(new URL("../lib/market-board/stock-filter.ts", import.meta.url), "utf8")
const preferenceRouteSource = readFileSync(new URL("../app/api/me/market-board-filter/route.ts", import.meta.url), "utf8")

const sectors = [
  "Ngân hàng",
  "Chứng khoán",
  "Bất động sản",
  "Dược phẩm",
  "Công nghệ",
  "Dầu khí",
  "Bảo hiểm",
]

test("Filter CP liquidity uses average 50-session volume rather than current-session volume", () => {
  const criteria = normalizeStockFilterCriteria({
    exchanges: ["HOSE", "HNX", "UPCOM"],
    minVolumeShares: 1_000_000,
    sectors,
  }, sectors)!

  const stocks = [
    { ticker: "AAA", exchange: "HOSE", kfspSector: "Ngân hàng", averageVolume50d: 1_500_000 },
    { ticker: "BBB", exchange: "HOSE", kfspSector: "Chứng khoán", averageVolume50d: 500_000 },
  ]
  const quotes = {
    AAA: { price: 20, volume: 10_000 },
    BBB: { price: 20, volume: 9_000_000 },
  }

  assert.deepEqual(filterBoardTickers(stocks, quotes, criteria), ["AAA"])
})

test("Filter CP sector rules mirror six board columns and preserve mandatory/min-one selections", () => {
  const groups = groupFilterSectorsByBoardColumn(sectors)
  assert.equal(groups.length, 6)
  assert.deepEqual(
    groups.map((group) => group.label),
    ["Ngân hàng", "Chứng khoán", "Bán lẻ", "Bất động sản", "Công nghiệp", "Còn lại"],
  )

  assert.equal(isLockedFilterSector("Ngân hàng"), true)
  assert.equal(isLockedFilterSector("Chứng khoán"), true)
  assert.equal(isLockedFilterSector("Bất động sản"), false)

  const selected = new Set(sectors)
  assert.equal(hasRequiredFilterSectorSelections(selected, sectors), true)
  assert.equal(canUnselectFilterSector(selected, "Ngân hàng", sectors), false)
  assert.equal(canUnselectFilterSector(selected, "Bất động sản", sectors), false)
  assert.equal(canUnselectFilterSector(selected, "Dầu khí", sectors), true)

  assert.equal(
    hasRequiredFilterSectorSelections(new Set(sectors.filter((sector) => sector !== "Bất động sản")), sectors),
    false,
  )
  assert.equal(
    hasRequiredFilterSectorSelections(new Set(sectors.filter((sector) => sector !== "Chứng khoán")), sectors),
    false,
  )
})

test("Filter CP UI wires averageVolume50d and six sector columns", () => {
  assert.match(pageSource, /averageVolume50d: stock\.averageVolume50d/)
  assert.match(pageSource, /BOARD_SSR_CACHE_NAMESPACE = "board-ssr-v7"/)
  assert.match(modalSource, /Thanh khoản \(KLTB 50 phiên\)/)
  assert.match(modalSource, /groupFilterSectorsByBoardColumn/)
  assert.match(modalSource, /hasRequiredFilterSectorSelections/)
  assert.match(modalSource, /canUnselectFilterSector/)
  assert.match(modalSource, /isLockedFilterSector/)
  assert.match(modalSource, /lg:grid-cols-6/)
  assert.match(modalSource, /Bắt buộc/)
  assert.doesNotMatch(modalSource, /thanh khoản theo số cổ phiếu khớp trong phiên/)
})

test("avg50 semantic change invalidates stale daily caches and invalid persisted sector selections", () => {
  assert.match(helperSource, /liquidityBasis: "averageVolume50d"/)
  assert.match(helperSource, /readStockFilterFromSettings[\s\S]*hasRequiredFilterSectorSelections/)
  assert.match(preferenceRouteSource, /hasRequiredFilterSectorSelections\(new Set\(criteria\.sectors\), availableSectors\)/)
})
