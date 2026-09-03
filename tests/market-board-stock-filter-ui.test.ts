import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const shellSource = readFileSync(new URL("../components/market-board/market-board-filter-shell.tsx", import.meta.url), "utf8")
const modalSource = readFileSync(new URL("../components/market-board/stock-filter-modal.tsx", import.meta.url), "utf8")
const pageSource = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8")
const boardSource = readFileSync(new URL("../components/live-market-board-v2.tsx", import.meta.url), "utf8")

test("Filter CP is injected beside the existing Tất cả and Top movers controls", () => {
  assert.match(shellSource, /createPortal/)
  assert.match(shellSource, /Tất cả/)
  assert.match(shellSource, /Top movers/)
  assert.match(shellSource, /Filter CP/)
  assert.match(shellSource, /filterActive/)
})

test("filter modal exposes exchanges, price, liquidity, KFSP sectors and preview", () => {
  assert.match(modalSource, /HOSE/)
  assert.match(modalSource, /HNX/)
  assert.match(modalSource, /UPCOM/)
  assert.match(modalSource, /Giá cổ phiếu/)
  assert.match(modalSource, /Thanh khoản/)
  assert.match(modalSource, /Ngành nghề/)
  assert.match(modalSource, /Đã chọn/)
  assert.match(modalSource, /Hủy/)
  assert.match(modalSource, /Áp dụng/)
  assert.match(modalSource, /filterBoardTickers/)
})

test("page preserves canonical exchange and raw KFSP sector for filtering", () => {
  assert.match(pageSource, /exchange: stock\.exchange \|\| ""/)
  assert.match(pageSource, /kfspSector: stock\.sector \|\| sectorForTicker\(stock\.ticker\)/)
  assert.match(pageSource, /userId=\{auth\.user\.id\}/)
  assert.match(pageSource, /universeRunId=\{canonical\.runId\}/)
  assert.match(pageSource, /MarketBoardFilterShell/)
})

test("saved criteria and daily cache are scoped by user, Vietnam day, universe run and filter hash", () => {
  assert.match(shellSource, /\/api\/me\/market-board-filter/)
  assert.match(shellSource, /stockos:market-board-filter:v1:/)
  assert.match(shellSource, /vietnamSessionDay/)
  assert.match(shellSource, /universeRunId/)
  assert.match(shellSource, /stockFilterHash/)
  assert.match(shellSource, /isValidDailyFilterCache/)
})

test("Filter CP limits the child board universe so its existing DNSE symbolList is filtered", () => {
  assert.match(shellSource, /universe=\{activeUniverse\}/)
  assert.match(boardSource, /const symbolList = useMemo\(\(\) => universe\.map\(\(stock\) => stock\.ticker\)/)
  assert.match(boardSource, /\{ name: "tick\.G1\.json", symbols: symbolList \}/)
  assert.match(boardSource, /INDEX_CHANNELS\.map/)
})

test("returning to full modes reconciles quotes and forces fresh intraday bootstrap before remount", () => {
  assert.match(shellSource, /\/api\/market\/quotes/)
  assert.match(shellSource, /setHistorySeed\(\{\}\)/)
  assert.match(shellSource, /setBoardKey\(\(key\) => key \+ 1\)/)
  assert.match(shellSource, /pendingModeAfterRemount/)
})

test("persistence failure does not discard the active local filter", () => {
  assert.match(shellSource, /setFilterActive\(true\)/)
  assert.match(shellSource, /setPersistenceError/)
  assert.match(shellSource, /Không thể lưu bộ lọc/)
})
