import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import {
  averagePriceboardChange,
  defaultIndustryColumnOrder,
  industryLabelForStock,
  industryPriceboardBackground,
  industryPriceboardChangeIntensity,
  industryPriceboardTone,
  moveIndustryColumn,
  moveIndustryColumnBy,
  mergeIndustryOrderIntoSettings,
  normalizeSavedIndustryOrder,
  packIndustryLanes,
  readIndustryOrderFromSettings,
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

test("authenticated industry ordering is validated, preserved, and reconciled across device universes", () => {
  assert.equal(normalizeSavedIndustryOrder(null), null)
  assert.equal(normalizeSavedIndustryOrder(["Điện", "Điện"]), null)
  assert.equal(normalizeSavedIndustryOrder(["", "Ngân hàng"]), null)
  assert.equal(normalizeSavedIndustryOrder([12]), null)
  assert.equal(normalizeSavedIndustryOrder(Array.from({ length: 121 }, (_, index) => `N${index}`)), null)
  assert.deepEqual(normalizeSavedIndustryOrder([" Chứng khoán ", "Ngân hàng"]), ["Chứng khoán", "Ngân hàng"])

  const initial = {
    locale: "vi",
    marketBoard: { stockFilter: { sectors: ["Ngân hàng"] }, otherPreference: "unchanged" },
    chartLayout: { period: "1D" },
  }
  const saved = mergeIndustryOrderIntoSettings(initial, ["Cao su", "Chứng khoán"])
  assert.deepEqual(readIndustryOrderFromSettings(saved), ["Cao su", "Chứng khoán"])
  assert.deepEqual(saved.marketBoard, {
    stockFilter: { sectors: ["Ngân hàng"] },
    otherPreference: "unchanged",
    industryOrder: ["Cao su", "Chứng khoán"],
  })
  assert.equal(saved.locale, "vi")
  assert.deepEqual(saved.chartLayout, { period: "1D" })
  assert.deepEqual(reconcileIndustryColumnOrder(readIndustryOrderFromSettings(saved), ["Ngân hàng", "Cao su", "Chứng khoán", "Dịch vụ"]), [
    "Cao su", "Chứng khoán", "Ngân hàng", "Dịch vụ",
  ])
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

test("row tones scale monotonically with percent and only use actual provider ceiling/floor metadata", () => {
  assert.equal(industryPriceboardTone({ price: 10, changePercent: 7 }), "up")
  assert.equal(industryPriceboardTone({ price: 10, changePercent: 0 }), "unchanged")
  assert.equal(industryPriceboardTone({ price: 10, changePercent: null }), "unavailable")
  assert.equal(industryPriceboardTone({ price: 10, changePercent: 3, reference: 9, ceiling: 10 }), "ceiling")
  assert.equal(industryPriceboardTone({ price: 10, changePercent: -3, reference: 11, floor: 10 }), "floor")
  assert.equal(industryPriceboardTone({ price: 10, changePercent: 3, reference: 10, ceiling: 10 }), "up")

  const quiet = industryPriceboardChangeIntensity(0.2)
  const medium = industryPriceboardChangeIntensity(2.5)
  const strong = industryPriceboardChangeIntensity(6)
  assert.ok(quiet < medium)
  assert.ok(medium < strong)
  assert.equal(industryPriceboardChangeIntensity(7), industryPriceboardChangeIntensity(15))
  assert.equal(industryPriceboardChangeIntensity(3), industryPriceboardChangeIntensity(-3))
  assert.ok(quiet >= 0.018)
  assert.ok(strong <= 0.6)

  assert.equal(industryPriceboardBackground({ price: 10, changePercent: 0 }), "rgba(255, 255, 255, 0.018)")
  assert.equal(industryPriceboardBackground({ price: 10, changePercent: 0.5 }), "rgba(255, 255, 255, 0.049)")
  assert.equal(industryPriceboardBackground({ price: 10, changePercent: -0.5 }), "rgba(255, 255, 255, 0.049)")
  assert.equal(industryPriceboardBackground({ price: 10, changePercent: 1 }), "rgba(255, 255, 255, 0.080)")
  assert.equal(industryPriceboardBackground({ price: 10, changePercent: -1 }), "rgba(255, 255, 255, 0.080)")
  assert.match(industryPriceboardBackground({ price: 10, changePercent: 1.1 }), /^rgba\\(34, 201, 138, /)
  assert.match(industryPriceboardBackground({ price: 10, changePercent: -1.1 }), /^rgba\\(255, 71, 87, /)
  assert.ok(industryPriceboardChangeIntensity(0) < industryPriceboardChangeIntensity(0.5))
  assert.ok(industryPriceboardChangeIntensity(0.5) < industryPriceboardChangeIntensity(1))
  assert.notEqual(industryPriceboardBackground({ price: 10, changePercent: 4 }), industryPriceboardBackground({ price: 10, changePercent: 0.2 }))
  assert.equal(industryPriceboardBackground({ price: 10, changePercent: 3, reference: 9, ceiling: 10 }), "rgba(176, 124, 255, 0.48)")
  assert.equal(industryPriceboardBackground({ price: 10, changePercent: -3, reference: 11, floor: 10 }), "rgba(34, 184, 207, 0.48)")
})

test("industry board reuses Insights sector icons and increases compact-board typography", () => {
  const source = readFileSync(new URL("../components/market-board/industry-priceboard.tsx", import.meta.url), "utf8")
  assert.match(source, /import \{ getSectorIcon \} from "@\/components\/stock-identity"/)
  assert.match(source, /const IndustryIcon = getSectorIcon\(industry\)/)
  assert.match(source, /<IndustryIcon className="h-3\.5 w-3\.5"/)
  assert.match(source, /h-\[25px\][\s\S]*?text-\[12px\]/)
  assert.match(source, /text-\[12px\] font-bold text-foreground/)
  assert.match(source, /text-\[10px\] font-medium text-muted-2/)
  assert.match(source, /w-\[232px\] min-w-\[232px\] max-w-\[232px\]/)
})

test("compact stock rows protect price/volume fit and strengthen hover affordance", () => {
  const source = readFileSync(new URL("../components/market-board/industry-priceboard.tsx", import.meta.url), "utf8")
  assert.match(source, /text-\[11px\] tabular-nums">\{formatPrice\(quote\?\.price\)\}/)
  assert.match(source, /text-\[10px\] tabular-nums text-white\/55/)
  assert.match(source, /space-y-\[4px\]/)
  assert.match(source, /hover:border-white\/35/)
  assert.match(source, /hover:shadow-\[0_0_0_1px_rgba\(255,255,255,0\.10\)\]/)
  assert.match(source, /font-semibold[\s\S]*?group-hover:font-extrabold/)
  assert.doesNotMatch(source, /transition-all/)
})

test("compact Price/KL mode hides those columns and narrows every industry lane", () => {
  const source = readFileSync(new URL("../components/market-board/industry-priceboard.tsx", import.meta.url), "utf8")
  assert.match(source, /const FULL_COLUMN_WIDTH = "w-\[232px\] min-w-\[232px\] max-w-\[232px\]"/)
  assert.match(source, /const COMPACT_COLUMN_WIDTH = "w-\[164px\] min-w-\[164px\] max-w-\[164px\]"/)
  assert.match(source, /const columnWidth = showPriceVolume \? FULL_COLUMN_WIDTH : COMPACT_COLUMN_WIDTH/)
  assert.match(source, /showPriceVolume \? "grid-cols-\[minmax\(34px,1fr\)_56px_54px_39px\]" : "grid-cols-\[minmax\(46px,1fr\)_58px\]"/)
  assert.match(source, /showPriceVolume \? <span className="truncate text-right text-\[11px\] tabular-nums">\{formatPrice\(quote\?\.price\)\}<\/span> : null/)
  assert.match(source, /showPriceVolume \? <span className="truncate text-right text-\[10px\] tabular-nums text-white\/55">\{formatVolume\(quote\?\.volume\)\}<\/span> : null/)
  assert.match(source, /previous\.showPriceVolume === next\.showPriceVolume/)
  assert.match(source, /pr-8 \[scrollbar-color:/)
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
