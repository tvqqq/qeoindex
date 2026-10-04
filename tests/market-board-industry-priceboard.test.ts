import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import {
  averagePriceboardChange,
  defaultIndustryColumnOrder,
  industryLabelForStock,
  industryPriceboardBackground,
  industryPriceboardTone,
  moveIndustryColumn,
  moveIndustryColumnBy,
  packIndustryLanes,
  reconcileIndustryColumnOrder,
  sortIndustryStocksByPerformance,
} from "../modules/market/board/industry-priceboard.ts"
import {
  DNSE_VN30_MEMBERSHIP_SOURCE,
  isValidVn30Membership,
  parseDnseVn30Membership,
} from "../modules/market/board/vn30-membership-contract.ts"

const membershipSource = readFileSync(new URL("../modules/market/board/vn30-membership.ts", import.meta.url), "utf8")
const boardSource = readFileSync(new URL("../components/live-market-board.tsx", import.meta.url), "utf8")
const filterShellSource = readFileSync(new URL("../components/market-board/market-board-filter-shell.tsx", import.meta.url), "utf8")

function stock(ticker: string, sector = "Khác", rank = 1) {
  return { ticker, sector, rank }
}

test("industry columns retain raw labels and preferred order matches uppercase source labels", () => {
  assert.equal(industryLabelForStock({ ticker: "VCB", rank: 1, sector: "Ngân hàng", kfspSector: "  NGÂN HÀNG  " }), "NGÂN HÀNG")
  assert.equal(industryLabelForStock({ ticker: "VCB", rank: 1, sector: "Ngân hàng", kfspSector: " " }), "Ngân hàng")
  const rawBank = "NGÂN HÀNG".normalize("NFD")
  const rawSecurities = "CHỨNG KHOÁN".normalize("NFD")
  const rawProperty = "BẤT ĐỘNG SẢN".normalize("NFD")
  assert.deepEqual(defaultIndustryColumnOrder(["BẢO HIỂM", rawBank, rawSecurities, rawProperty]), [
    rawSecurities,
    rawProperty,
    rawBank,
    "BẢO HIỂM",
  ])
})

test("saved industry order reconciles duplicate, removed, and newly discovered raw labels", () => {
  assert.deepEqual(
    reconcileIndustryColumnOrder(["Điện", "Điện", "Không còn", null, "Ngân hàng"], ["Ngân hàng", "Điện", "Bán lẻ"]),
    ["Điện", "Ngân hàng", "Bán lẻ"],
  )
  assert.deepEqual(reconcileIndustryColumnOrder("corrupt", ["Ngân hàng", "Bán lẻ"]), ["Ngân hàng", "Bán lẻ"])
})

test("fixed anchors remain outside industry reorder actions", () => {
  const source = readFileSync(new URL("../components/market-board/industry-priceboard.tsx", import.meta.url), "utf8")
  assert.match(source, /data-industry-column="watchlist" data-market-board-industry-column[\s\S]*?data-industry-column="vn30" data-market-board-industry-column[\s\S]*?industryLanes\.map\(\(lane, laneIndex\)/)
  assert.deepEqual(moveIndustryColumn(["Bán lẻ", "Điện", "Thép"], "Thép", "Bán lẻ"), ["Thép", "Bán lẻ", "Điện"])
  assert.deepEqual(moveIndustryColumnBy(["Bán lẻ", "Điện", "Thép"], "Điện", -1), ["Điện", "Bán lẻ", "Thép"])
  assert.deepEqual(moveIndustryColumnBy(["Bán lẻ", "Điện", "Thép"], "Bán lẻ", -1), ["Bán lẻ", "Điện", "Thép"])
})

test("industry lane packing compresses contiguous small industries without changing their logical order", () => {
  const byIndustry = new Map([
    ["Bảo hiểm", [stock("BVH", "Bảo hiểm")]],
    ["Cao su", [stock("DRI", "Cao su"), stock("CSM", "Cao su")]],
    ["Công nghệ", [stock("FPT", "Công nghệ"), stock("CTR", "Công nghệ"), stock("ELC", "Công nghệ")]],
    ["Dầu khí", Array.from({ length: 12 }, (_, index) => stock(`OIL${index}`, "Dầu khí", index + 1))],
    ["Dịch vụ", [stock("VTD", "Dịch vụ"), stock("YEG", "Dịch vụ")]],
  ])
  const order = ["Bảo hiểm", "Cao su", "Công nghệ", "Dầu khí", "Dịch vụ"]
  const lanes = packIndustryLanes(order, byIndustry, 18)

  assert.ok(lanes.length < order.length)
  assert.deepEqual(lanes.flatMap((lane) => lane.industries), order)
  assert.deepEqual(lanes[0]?.industries, ["Bảo hiểm", "Cao su", "Công nghệ"])
  assert.deepEqual(lanes[1]?.industries, ["Dầu khí"])
  assert.deepEqual(lanes[2]?.industries, ["Dịch vụ"])
  assert.deepEqual(packIndustryLanes(order, byIndustry, 18), lanes)
})

test("watchlist local storage hydrates after the first render and writes only after hydration", () => {
  assert.match(boardSource, /const \[watchlist, setWatchlist\] = useState<Set<string>>\(\(\) => new Set<string>\(\)\)/)
  assert.match(boardSource, /useEffect\(\(\) => \{[\s\S]*?localStorage\.getItem\(WATCHLIST_KEY\)[\s\S]*?setWatchlist\(new Set\(validSymbols\)\)[\s\S]*?setWatchlistHydrated\(true\)/)
  assert.match(boardSource, /useEffect\(\(\) => \{\s*if \(!watchlistHydrated\) return[\s\S]*?localStorage\.setItem\(WATCHLIST_KEY/)
  assert.doesNotMatch(boardSource, /useState<Set<string>>\(\(\) => \{[\s\S]*?localStorage\.getItem\(WATCHLIST_KEY\)/)
})

test("board view is user-scoped, classic by default, and persists only after matching identity hydrates", () => {
  assert.match(boardSource, /const boardViewStorageKey = `\$\{BOARD_VIEW_KEY\}:\$\{userId\}`/)
  assert.match(boardSource, /const \[boardView, setBoardView\] = useState<BoardView>\("classic"\)/)
  assert.match(boardSource, /boardViewHydratedKey !== boardViewStorageKey/)
  assert.match(boardSource, /aria-label="Kiểu bảng giá"[\s\S]*?role="tab"[\s\S]*?aria-selected=\{isSelected\}/)
  assert.doesNotMatch(boardSource, /key=\{boardView\}[\s\S]*?LiveMarketBoard/)
})

test("sorting ranks valid live quotes by gain first and averages only finite valid quotes", () => {
  const stocks = [stock("MISSING", "Ngân hàng", 1), stock("LOSS", "Ngân hàng", 2), stock("GAIN", "Ngân hàng", 3), stock("BAD", "Ngân hàng", 4)]
  const quotes = {
    MISSING: undefined,
    LOSS: { price: 12, changePercent: -2 },
    GAIN: { price: 10, changePercent: 1.25 },
    BAD: { price: Number.NaN, changePercent: 99 },
  }
  assert.deepEqual(sortIndustryStocksByPerformance(stocks, quotes).map(({ ticker }) => ticker), ["GAIN", "LOSS", "MISSING", "BAD"])
  assert.equal(averagePriceboardChange(stocks, quotes), -0.375)
  assert.equal(averagePriceboardChange([stock("BAD")], { BAD: { price: -1, changePercent: 50 } }), null)
})

test("row tones scale with percent and only use actual provider ceiling/floor metadata", () => {
  assert.equal(industryPriceboardTone({ price: 10, changePercent: 7 }), "up")
  assert.equal(industryPriceboardTone({ price: 10, changePercent: 0 }), "unchanged")
  assert.equal(industryPriceboardTone({ price: 10, changePercent: null }), "unavailable")
  assert.equal(industryPriceboardTone({ price: 10, changePercent: 3, reference: 9, ceiling: 10 }), "ceiling")
  assert.equal(industryPriceboardTone({ price: 10, changePercent: -3, reference: 11, floor: 10 }), "floor")
  assert.equal(industryPriceboardTone({ price: 10, changePercent: 3, reference: 10, ceiling: 10 }), "up")
  assert.notEqual(industryPriceboardBackground({ price: 10, changePercent: 4 }), industryPriceboardBackground({ price: 10, changePercent: 0.2 }))
})

test("DNSE membership parser requires exactly 30 unique valid symbols and uses provider time", () => {
  const fetchedAt = new Date("2026-10-04T06:00:00.000Z")
  const seconds = Math.floor(Date.parse("2026-10-04T05:59:30.000Z") / 1000)
  const rows = Array.from({ length: 30 }, (_, index) => ({
    symbol: `S${String(index).padStart(2, "0")}`,
    time: { seconds, nanos: index * 1_000_000 },
  }))
  const parsed = parseDnseVn30Membership(rows, fetchedAt)
  assert.ok(parsed)
  assert.equal(parsed.source, DNSE_VN30_MEMBERSHIP_SOURCE)
  assert.equal(parsed.symbols.length, 30)
  assert.equal(parsed.asOf, new Date((seconds + 0.029) * 1000).toISOString())
  assert.equal(parsed.fetchedAt, fetchedAt.toISOString())
  assert.equal(isValidVn30Membership(parsed), true)
  assert.equal(isValidVn30Membership(null), false)
  assert.equal(parseDnseVn30Membership(rows.slice(1), fetchedAt), null)
  assert.equal(parseDnseVn30Membership(rows.map((row, index) => index === 29 ? { ...row, symbol: "S00" } : row), fetchedAt), null)
  assert.equal(parseDnseVn30Membership(rows.map((row, index) => index === 0 ? { ...row, symbol: "vcb" } : row), fetchedAt), null)
  assert.equal(parseDnseVn30Membership(rows.map((row) => ({ ...row, time: { seconds: seconds + 100, nanos: 0 } })), fetchedAt), null)
})

test("VN30 lookup is bounded, cached, fail-open, and filtered realtime still uses the active universe", () => {
  assert.match(membershipSource, /api\.dnse\.com\.vn\/market-api\/basket-influence\?type=VN30/)
  assert.match(membershipSource, /AbortSignal\.timeout\(VN30_MEMBERSHIP_TIMEOUT_MS\)/)
  assert.match(membershipSource, /const VN30_MEMBERSHIP_TIMEOUT_MS = 4_000/)
  assert.match(membershipSource, /const VN30_MEMBERSHIP_TTL_SECONDS = 6 \* 60 \* 60/)
  assert.match(membershipSource, /validate: \(value\): value is Vn30Membership \| null => isValidVn30Membership\(value\)/)
  assert.match(membershipSource, /catch \{\s*return null\s*\}\s*\}/)
  assert.match(filterShellSource, /universe=\{activeUniverse\}[\s\S]*?canonicalUniverse=\{universe\}/)
})
