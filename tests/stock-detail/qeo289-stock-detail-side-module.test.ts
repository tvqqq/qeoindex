import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

function source(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8")
}

test("QEO-289 exposes AI Q&A, Ghi chú and Portfolio as one Stock Detail module", () => {
  const moduleCode = source("components/stock-detail/stock-detail-side-module.tsx")
  const sidebarCode = source("components/stock-detail/stock-ai-sidebar.tsx")

  assert.match(moduleCode, /type StockDetailModuleTab = "ai" \| "notes" \| "portfolio"/)
  assert.match(moduleCode, /label: "AI Q&A"/)
  assert.match(moduleCode, /label: "Ghi chú"/)
  assert.match(moduleCode, /label: "Portfolio"/)
  assert.match(moduleCode, /useState<StockDetailModuleTab>\("ai"\)/)
  assert.match(moduleCode, /<StockNotesPanel key=\{ticker\} ticker=\{ticker\}/)
  assert.match(moduleCode, /<StockPortfolioPanel ticker=\{ticker\} currentPrice=\{currentPrice\}/)

  assert.match(sidebarCode, /<StockDetailSideModule/)
  assert.match(sidebarCode, /qna=\{\(/)
  assert.match(sidebarCode, /\/api\/insights\/\$\{encodeURIComponent\(ticker\)\}\/chat/)
})

test("QEO-289 resets and aborts ticker Q&A when Stock Detail switches ticker", () => {
  const sidebarCode = source("components/stock-detail/stock-ai-sidebar.tsx")

  assert.match(sidebarCode, /const chatAbortRef = useRef<AbortController \| null>\(null\)/)
  assert.match(sidebarCode, /chatAbortRef\.current\?\.abort\(\)/)
  assert.match(sidebarCode, /signal: requestController\.signal/)
  assert.match(sidebarCode, /setMessages\(\[/)
  assert.match(sidebarCode, /\}, \[ticker\]\)/)
})

test("QEO-289 stock notes use authenticated ticker-scoped persistence", () => {
  const panelCode = source("components/stock-detail/stock-notes-panel.tsx")
  const routeCode = source("app/api/insights/[ticker]/notes/route.ts")
  const migration = source("supabase/migrations/20260928031000_qeo289_stock_notes.sql")
  const privilegeMigration = source("supabase/migrations/20260928033000_qeo289_stock_notes_privileges.sql")
  const databaseTypes = source("modules/shared/supabase/database.types.ts")

  assert.match(panelCode, /\/api\/insights\/\$\{encodeURIComponent\(ticker\)\}\/notes/)
  assert.match(panelCode, /method: "PUT"/)
  assert.match(panelCode, /maxLength=\{NOTE_LIMIT\}/)

  assert.match(routeCode, /requireApiUser\(\)/)
  assert.match(routeCode, /\.from\("stock_notes"\)/)
  assert.match(routeCode, /\.eq\("user_id", auth\.context\.user\.id\)/)
  assert.match(routeCode, /onConflict: "user_id,ticker"/)
  assert.doesNotMatch(routeCode, /"use server"/)

  assert.match(migration, /primary key \(user_id, ticker\)/i)
  assert.match(migration, /alter table public\.stock_notes enable row level security/i)
  assert.match(migration, /create policy stock_notes_select_own/i)
  assert.match(migration, /create policy stock_notes_insert_own/i)
  assert.match(migration, /create policy stock_notes_update_own/i)
  assert.match(migration, /create policy stock_notes_delete_own/i)
  assert.match(privilegeMigration, /revoke all on table public\.stock_notes from authenticated/i)
  assert.match(privilegeMigration, /grant select, insert, update, delete on public\.stock_notes to authenticated/i)
  assert.doesNotMatch(privilegeMigration, /grant all/i)
  assert.match(databaseTypes, /stock_notes: \{/)
})

test("QEO-289 Portfolio tab reuses canonical Portfolio transactions and AVCO engine", () => {
  const panelCode = source("components/stock-detail/stock-portfolio-panel.tsx")
  const transactionsRoute = source("app/api/portfolio/[id]/transactions/route.ts")

  assert.match(panelCode, /computePortfolioPositions/)
  assert.match(panelCode, /fetch\("\/api\/portfolio"/)
  assert.match(panelCode, /\/api\/portfolio\/\$\{encodeURIComponent\(portfolioId\)\}\/transactions\?ticker=\$\{encodeURIComponent\(ticker\)\}/)
  assert.match(panelCode, /transaction\.ticker\.toUpperCase\(\) === ticker\.toUpperCase\(\)/)
  assert.match(panelCode, /summary\.calcUnrealizedPnl/)
  assert.match(panelCode, /summary\.totalRealizedPnl/)
  assert.doesNotMatch(panelCode, /fake|mock portfolio/i)

  assert.match(transactionsRoute, /searchParams\.get\("ticker"\)/)
  assert.match(transactionsRoute, /if \(rawTicker\) query = query\.eq\("ticker", rawTicker\)/)
})


test("QEO-289 follow-up keeps Stock Detail watchlist compact, market-toned and default-first", () => {
  const sidebar = source("components/stock-detail/stock-watchlist-sidebar.tsx")

  assert.doesNotMatch(sidebar, /ACTIVE_LIST_KEY/)
  assert.match(sidebar, /find\(\(watchlist\) => watchlist\.is_default\)/)
  assert.match(sidebar, /skipNextUserListLoadRef\.current = defaultWatchlistId/)
  assert.match(sidebar, /data-watchlist-system-section/)
  assert.match(sidebar, /Danh sách hệ thống/)
  assert.match(sidebar, /Top 200 · Thị trường/)
  assert.match(sidebar, /text-\[14px\] font-black leading-none tracking-wide/)
  assert.match(sidebar, /text-\[10px\] font-medium leading-tight text-slate-400/)
  assert.match(sidebar, /text-\[15px\] font-black leading-none tabular-nums text-white/)
  assert.match(sidebar, /marketToneFromChange\(item\.changePct\)/)
  assert.match(sidebar, /marketTonePill\(tone\)/)
  assert.match(sidebar, /directionLabel = item\.changePct > 0 \? "▲" : item\.changePct < 0 \? "▼" : "•"/)
  assert.doesNotMatch(sidebar, /filteredItems\.length.*mã/)
  assert.ok(
    sidebar.indexOf("data-watchlist-system-section") > sidebar.indexOf("Quản lý các watchlist"),
    "Top 200 system section should be below personal watchlist actions",
  )
})
