import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import { boardSectorGroupForSector } from "../modules/market/sectors.ts"

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

test("board maps live KFSP sector taxonomy into all six board groups", () => {
  const page = source("app/board/page.tsx")
  assert.match(page, /BOARD_SSR_CACHE_NAMESPACE = "board-ssr-v7"/)
  assert.equal(boardSectorGroupForSector("NGÂN HÀNG").key, "bank")
  assert.equal(boardSectorGroupForSector("CHỨNG KHOÁN").key, "securities")
  assert.equal(boardSectorGroupForSector("BẤT ĐỘNG SẢN").key, "real-estate")
  assert.equal(boardSectorGroupForSector("ĐẦU TƯ XÂY DỰNG").key, "real-estate")
  assert.equal(boardSectorGroupForSector("THƯƠNG MẠI").key, "consumer")
  assert.equal(boardSectorGroupForSector("THỰC PHẨM").key, "consumer")
  assert.equal(boardSectorGroupForSector("CÔNG NGHỆ").key, "industrial-tech")
  assert.equal(boardSectorGroupForSector("PHÂN BÓN").key, "other")
  assert.equal(boardSectorGroupForSector("NÔNG - LÂM - NGƯ").key, "other")
  assert.equal(boardSectorGroupForSector("DẦU KHÍ").key, "other")
})

test("market bubbles render the canonical membership without a second liquidity cutoff", () => {
  const bubbles = source("components/insights/market-bubbles.tsx")
  const dashboard = source("components/insights/market-close-dashboard.tsx")

  assert.doesNotMatch(bubbles, /stock\.volume[^\n]*>\s*300_000/)
  assert.match(bubbles, /\[\.\.\.stocks\][\s\S]*\.sort\([\s\S]*\.slice\(0, 200\)/)
  assert.doesNotMatch(dashboard, /KLGD TB 50 phiên\s*&gt;\s*300\.000/)
  assert.match(dashboard, /canonical|Top Stocks|tối đa 200 mã/i)
})

test("Qeo Composite defaults to all canonical stocks and exposes sortable market cap", () => {
  const dashboard = source("components/insights/insights-dashboard.tsx")

  assert.doesNotMatch(dashboard, /useState<"top100"\s*\|\s*"all">/)
  assert.doesNotMatch(dashboard, /\["top100",\s*"Top 100"\]/)
  assert.match(dashboard, /Tất cả · \{data\.ratings\.length\} mã/)
  assert.doesNotMatch(dashboard, /showSectorGroups\s*=\s*universeFilter/)
  assert.match(dashboard, /"marketCapBillion"/)
  assert.match(dashboard, /sortKey="marketCapBillion"/)
  assert.match(dashboard, /Vốn h[oó]a/i)
  assert.match(dashboard, /const filteredRatings = useMemo\([\s\S]*return data\.ratings/)
})

test("QEO-162 homepage refreshes VNINDEX, replaces the CTA with a canonical stock finder, and simplifies the workspace divider", () => {
  const home = source("app/page.tsx")
  const hero = source("components/home/home-hero.tsx")
  const heroData = source("modules/home/hero-data.ts")
  const freshMarket = source("modules/home/fresh-market-snapshot.ts")
  const stockSearch = source("components/home/home-stock-search.tsx")
  const divider = source("components/home/workspace-divider.tsx")

  assert.match(home, /getCanonicalUniverse/, "homepage should load the canonical Top Stocks universe for the selector")
  assert.match(home, /<HomeHero[\s\S]*stocks=\{universe\.stocks\}/, "homepage should pass canonical stock identities into the hero")

  assert.match(heroData, /getFreshHomepageIndexSnapshot/, "hero read model should attempt a refresh-time index snapshot")
  assert.match(freshMarket, /fetchTradingViewIndexes/, "fresh homepage snapshot should reuse the bounded existing index provider path")
  assert.match(freshMarket, /VNINDEX/, "fresh homepage snapshot should explicitly select VNINDEX")
  assert.match(heroData, /freshIndex[\s\S]*persistedMarket/, "fresh provider data should overlay persisted Market Insight while retaining fallback context")
  assert.match(hero, /Cập nhật/, "market object should expose the refresh snapshot timestamp")

  assert.match(hero, /Bạn muốn hỏi cổ phiếu nào\?/, "center hero should become a stock question entry point")
  assert.match(hero, /<HomeStockSearch/, "hero should mount the canonical stock finder")
  assert.doesNotMatch(hero, /Xem phân tích thị trường|Lối tắt homepage/, "old CTA and quick-link row should be removed from the visible hero")
  assert.doesNotMatch(
    hero,
    /aria-labelledby="home-market-pulse-title"[\s\S]{0,220}overflow-hidden/,
    "hero must not vertically clip the absolutely positioned stock dropdown",
  )

  assert.match(stockSearch, /^"use client"/, "keyboard combobox behavior should stay inside a focused client component")
  assert.match(stockSearch, /role="combobox"/)
  assert.match(stockSearch, /aria-autocomplete="list"/)
  assert.match(stockSearch, /StockLogo/)
  assert.match(stockSearch, /companyName/)
  assert.match(stockSearch, /ArrowDown/)
  assert.match(stockSearch, /ArrowUp/)
  assert.match(stockSearch, /Enter/)
  assert.match(stockSearch, /router\.push\(`\/insights\/\$\{ticker\}`\)/, "Enter and submit should navigate to the selected insights ticker")
  assert.doesNotMatch(stockSearch, /transition-all|backdrop-blur|backdrop-filter/)

  assert.match(home, /<WorkspaceDivider/)
  assert.doesNotMatch(home, /QeoIndex Workspace|Chọn workspace để đi sâu|Từ snapshot tổng quan/, "old workspace marketing copy should be removed")
  assert.match(divider, /Chọn Workspace để xem chi tiết/)
  assert.match(divider, /<svg/)
  assert.match(divider, /<path/)
  assert.doesNotMatch(`${home}\n${hero}\n${stockSearch}\n${divider}`, /transition-all|backdrop-blur|backdrop-filter/)
})

test("QEO-163 pulse uses the current Vietnam date and an open stock finder reserves workspace clearance", () => {
  const hero = source("components/home/home-hero.tsx")
  const heroCss = source("components/home/home-hero.module.css")
  const stockSearch = source("components/home/home-stock-search.tsx")

  assert.match(hero, /formatCurrentVietnamDate/, "Pulse label should derive from the current Asia\/Ho_Chi_Minh date")
  assert.match(hero, /QeoIndex Pulse · \{formatCurrentVietnamDate\(\)\}/, "Pulse copy should use the approved mixed-case label and current date")
  assert.doesNotMatch(hero, /QEO Market Pulse · \{formatSessionDate\(data\.market\.sessionDate\)\}/, "Pulse must not use the persisted market session date")

  assert.match(stockSearch, /data-home-stock-search/, "stock finder root should expose open-state styling scope")
  assert.match(stockSearch, /data-open=\{isOpen \? "true" : "false"\}/, "stock finder should expose combobox open state to CSS")
  assert.match(hero, /styles\.heroShell/, "hero should own the dropdown-clearance layout instead of shifting the three-zone grid")
  assert.match(heroCss, /:has\(\[data-home-stock-search\]\[data-open="true"\]\)/, "hero should react to the open stock finder without lifting state into JavaScript")
  assert.match(heroCss, /padding-bottom:\s*360px/, "open dropdown should reserve enough vertical clearance before workspace cards")
  assert.match(heroCss, /transition:\s*padding-bottom/, "clearance should animate only the bounded padding property")
  assert.match(heroCss, /prefers-reduced-motion/, "clearance motion should respect reduced-motion")
  assert.doesNotMatch(`${hero}\n${heroCss}\n${stockSearch}`, /transition-all|backdrop-blur|backdrop-filter/)
})
