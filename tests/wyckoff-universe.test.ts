import assert from "node:assert/strict"
import test from "node:test"

import { BOARD_SECTOR_GROUPS, boardSectorGroupForSector, sectorForTicker } from "../lib/market-sectors.ts"
import { UNIVERSE_SIZE } from "../modules/wyckoff/universe.ts"

const NEW_TICKERS = "GEL VCI VND NAB FRT KDH VPI SBT PNJ HAG VGC PVD DCM DGC CRV DPM KDC VBB SJS DXG LGC TAL DHG SIP BMP PDR BAF NLG VCG VHC TCH VSH CTR KLB BWE DSE CII EVF PVT VTP HPA ORS DGW HAH HSG PC1 DIG FTS VAB BVB".split(" ")

test("source-of-truth universe safety cap is 200", () => {
  assert.equal(UNIVERSE_SIZE, 200)
})

test("all 50 newly added Notion tickers have an explicit sector fallback", () => {
  assert.equal(NEW_TICKERS.length, 50)
  assert.deepEqual(NEW_TICKERS.filter((ticker) => sectorForTicker(ticker) === "Công nghiệp & Vật liệu"), ["GEL", "HAG", "VGC", "DCM", "DGC", "DPM", "LGC", "BMP", "VCG", "CII", "HSG", "PC1"])
})

test("market board uses six groups and folds energy and utilities into other", () => {
  assert.equal(BOARD_SECTOR_GROUPS.length, 6)
  assert.equal(boardSectorGroupForSector("Năng lượng").key, "other")
  assert.equal(boardSectorGroupForSector("Điện & Utilities").key, "other")
})
