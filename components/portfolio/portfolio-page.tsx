"use client"

import { useState, useEffect, useCallback, useMemo, useRef } from "react"
import { Activity, Briefcase, Eye, RefreshCw, Plus, ShieldCheck, Sparkles } from "lucide-react"

import { Button } from "@/components/ui/button"
import { WatchlistPanel } from "@/components/portfolio/watchlist-panel"
import { computePortfolioPositions, type RawTransaction } from "@/lib/portfolio/pnl"
import { extractPortfolioMarketPrices, type PortfolioIntradayPayload } from "@/lib/portfolio/market-prices"

import dynamic from "next/dynamic"

const PortfolioSummaryBar = dynamic(
  () => import("@/components/portfolio/portfolio-summary-bar").then((m) => m.PortfolioSummaryBar),
  { ssr: false, loading: () => <SummaryBarSkeleton /> },
)
const PortfolioPositionsTable = dynamic(
  () => import("@/components/portfolio/portfolio-positions-table").then((m) => m.PortfolioPositionsTable),
  { ssr: false, loading: () => null },
)
const PortfolioTransactionHistory = dynamic(
  () => import("@/components/portfolio/portfolio-transaction-history").then((m) => m.PortfolioTransactionHistory),
  { ssr: false, loading: () => null },
)
const AddTransactionDialog = dynamic(
  () => import("@/components/portfolio/add-transaction-dialog").then((m) => m.AddTransactionDialog),
  { ssr: false },
)
const PortfolioSelector = dynamic(
  () => import("@/components/portfolio/portfolio-selector").then((m) => m.PortfolioSelector),
  { ssr: false },
)
const PortfolioAllocationChart = dynamic(
  () => import("@/components/portfolio/portfolio-allocation-chart").then((m) => m.PortfolioAllocationChart),
  { ssr: false },
)

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

interface PortfolioMeta {
  id: string
  name: string
  description: string | null
  is_default: boolean
  sort_order: number
}

interface WatchlistMeta {
  id: string
  name: string
  is_default: boolean
  sort_order: number
}

interface WatchlistItem {
  id: string
  watchlist_id: string
  ticker: string
  sort_order: number
  note: string | null
  alert_price_above: number | null
  alert_price_below: number | null
  tags: string[]
  created_at: string
  updated_at: string
}

type ActiveTab = "portfolio" | "watchlist"

// ─────────────────────────────────────────────────────────────
// Main page component
// ─────────────────────────────────────────────────────────────

export function PortfolioPage() {
  const [activeTab, setActiveTab] = useState<ActiveTab>("portfolio")

  // Portfolio state
  const [portfolios, setPortfolios] = useState<PortfolioMeta[]>([])
  const [activePortfolioId, setActivePortfolioId] = useState<string | null>(null)
  const [transactions, setTransactions] = useState<RawTransaction[]>([])
  const [currentPrices, setCurrentPrices] = useState<Record<string, number>>({})
  const [loadingPortfolio, setLoadingPortfolio] = useState(true)
  const [loadingTx, setLoadingTx] = useState(false)
  const [portfolioError, setPortfolioError] = useState("")
  const transactionRequestRef = useRef(0)

  // Watchlist state
  const [watchlists, setWatchlists] = useState<WatchlistMeta[]>([])
  const [activeWatchlistId, setActiveWatchlistId] = useState<string | null>(null)
  const [watchlistItems, setWatchlistItems] = useState<WatchlistItem[]>([])
  const [loadingWatchlist, setLoadingWatchlist] = useState(true)

  // Dialog state
  const [addTxOpen, setAddTxOpen] = useState(false)
  const [addTxTicker, setAddTxTicker] = useState<string | undefined>()

  // ── Load portfolios on mount ──
  useEffect(() => {
    async function loadPortfolios() {
      setLoadingPortfolio(true)
      try {
        setPortfolioError("")
        const res = await fetch("/api/portfolio", { cache: "no-store", credentials: "same-origin" })
        if (!res.ok) throw new Error("Không thể tải danh mục")
        const data = await res.json() as { ok: boolean; portfolios?: PortfolioMeta[] }
        if (data.ok && data.portfolios) {
          setPortfolios(data.portfolios)
          const def = data.portfolios.find((p) => p.is_default) ?? data.portfolios[0]
          if (def) setActivePortfolioId(def.id)
        }
      } catch {
        setPortfolioError("Không thể tải danh mục. Hãy thử làm mới lại.")
      } finally {
        setLoadingPortfolio(false)
      }
    }
    loadPortfolios()
  }, [])

  // ── Load watchlists on mount ──
  useEffect(() => {
    async function loadWatchlists() {
      setLoadingWatchlist(true)
      try {
        const res = await fetch("/api/watchlist", { cache: "no-store", credentials: "same-origin" })
        if (!res.ok) return
        const data = await res.json() as {
          ok: boolean
          watchlists?: WatchlistMeta[]
          items?: WatchlistItem[]
          watchlist?: WatchlistMeta
        }
        if (data.ok) {
          const wls = data.watchlists ?? (data.watchlist ? [data.watchlist] : [])
          setWatchlists(wls)
          const def = wls.find((w) => w.is_default) ?? wls[0]
          if (def) setActiveWatchlistId(def.id)
          if (data.items) setWatchlistItems(data.items)
        }
      } finally {
        setLoadingWatchlist(false)
      }
    }
    loadWatchlists()
  }, [])

  // ── Load transactions when portfolio changes ──
  const loadTransactions = useCallback(async (portfolioId: string) => {
    const requestId = ++transactionRequestRef.current
    setLoadingTx(true)
    try {
      setPortfolioError("")
      const res = await fetch(`/api/portfolio/${portfolioId}/transactions`, {
        cache: "no-store",
        credentials: "same-origin",
      })
      if (!res.ok) throw new Error("Không thể tải giao dịch")
      const data = await res.json() as { ok: boolean; transactions?: RawTransaction[] }
      if (requestId === transactionRequestRef.current && data.ok && data.transactions) setTransactions(data.transactions)
    } catch {
      if (requestId === transactionRequestRef.current) setPortfolioError("Không thể tải lịch sử giao dịch của danh mục này.")
    } finally {
      if (requestId === transactionRequestRef.current) setLoadingTx(false)
    }
  }, [])

  useEffect(() => {
    if (activePortfolioId) loadTransactions(activePortfolioId)
  }, [activePortfolioId, loadTransactions])

  // ── Compute positions from transactions ──
  const portfolioSummary = computePortfolioPositions(transactions)
  const { positions } = portfolioSummary

  // ── Fetch current prices for open positions ──
  const tickersKey = positions.map((p) => p.ticker).join(",")
  useEffect(() => {
    if (!tickersKey) return
    fetch(`/api/market/intraday?tickers=${tickersKey}`, { cache: "no-store", credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: PortfolioIntradayPayload | null) => {
        if (!data?.histories) return
        setCurrentPrices(extractPortfolioMarketPrices(data))
      })
      .catch(() => {})
  }, [tickersKey])

  const handlePortfolioCreate = useCallback(async (name: string) => {
    const res = await fetch("/api/portfolio", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ name }),
    })
    const data = await res.json() as { ok: boolean; portfolio?: PortfolioMeta }
    if (data.ok && data.portfolio) {
      setPortfolios((prev) => [...prev, data.portfolio!])
      setActivePortfolioId(data.portfolio.id)
    }
  }, [])

  const handlePortfolioDelete = useCallback(async (id: string) => {
    const res = await fetch(`/api/portfolio/${id}`, { method: "DELETE", credentials: "same-origin" })
    const data = await res.json() as { ok: boolean }
    if (data.ok) {
      setPortfolios((prev) => prev.filter((p) => p.id !== id))
      if (activePortfolioId === id) {
        const remaining = portfolios.filter((p) => p.id !== id)
        if (remaining.length > 0) setActivePortfolioId(remaining[0].id)
      }
    }
  }, [activePortfolioId, portfolios])

  const handleTxDelete = useCallback(async (txId: string) => {
    if (!activePortfolioId) return
    const res = await fetch(`/api/portfolio/${activePortfolioId}/transactions/${txId}`, {
      method: "DELETE",
      credentials: "same-origin",
    })
    const data = await res.json() as { ok: boolean }
    if (data.ok) {
      setTransactions((prev) => prev.filter((t) => t.id !== txId))
    }
  }, [activePortfolioId])

  const handleTxSuccess = useCallback(() => {
    if (activePortfolioId) loadTransactions(activePortfolioId)
    setAddTxOpen(false)
  }, [activePortfolioId, loadTransactions])

  const handleOpenAddTx = useCallback((ticker?: string) => {
    setAddTxTicker(ticker)
    setAddTxOpen(true)
  }, [])

  const journalStats = useMemo(() => {
    const riskControlled = positions.filter((position) => position.targetPrice != null && position.stopLoss != null).length
    return {
      tradeCount: transactions.length,
      disciplinedCount: transactions.filter((tx) => tx.target_price != null || tx.stop_loss != null).length,
      riskCoverage: positions.length > 0 ? Math.round((riskControlled / positions.length) * 100) : null,
    }
  }, [positions, transactions])

  // ── Tab styles ──
  function tabClass(tab: ActiveTab) {
    return [
      "flex items-center gap-1.5 rounded-full border px-4 py-1.5 text-xs font-medium transition-colors",
      activeTab === tab
        ? "border-[var(--color-up)]/40 bg-[var(--color-up)]/10 text-[var(--color-up)] font-bold"
        : "border-transparent text-[var(--color-muted-2)] hover:border-white/10 hover:text-white",
    ].join(" ")
  }

  return (
    <div className="min-h-screen bg-[#070a08]">
      {/* Page header */}
      <div className="sticky top-14 z-30 border-b border-white/[0.07] bg-[#070a08]/95 px-4 py-3 sm:px-6">
        <div className="mx-auto max-w-[1440px]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* Tabs */}
            <div className="flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-panel)] p-1">
              <button type="button" className={tabClass("portfolio")} onClick={() => setActiveTab("portfolio")}>
                <Briefcase className="h-3.5 w-3.5" />
                <span>Danh mục</span>
              </button>
              <button type="button" className={tabClass("watchlist")} onClick={() => setActiveTab("watchlist")}>
                <Eye className="h-3.5 w-3.5" />
                <span>Theo dõi</span>
              </button>
            </div>

            {/* Actions */}
            {activeTab === "portfolio" && (
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => activePortfolioId && loadTransactions(activePortfolioId)}
                  className="h-8 gap-1.5 rounded-full px-3 text-xs text-[var(--color-muted-2)] hover:text-white"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Làm mới
                </Button>
                <Button
                  size="sm"
                  onClick={() => handleOpenAddTx()}
                  className="h-8 gap-1.5 rounded-full border-[var(--color-up)]/30 bg-[var(--color-up)]/10 px-4 text-xs font-medium text-[var(--color-up)] hover:bg-[var(--color-up)]/20"
                  variant="outline"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Thêm giao dịch
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Page content */}
      <div className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6 lg:py-8">
        {/* ── PORTFOLIO TAB ── */}
        {activeTab === "portfolio" && (
          <div className="space-y-6">
            <section className="relative overflow-hidden rounded-[28px] border border-[#b9ff66]/15 bg-[#0d130f] px-5 py-6 shadow-[0_18px_60px_rgba(0,0,0,0.24)] sm:px-7 lg:px-8">
              <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#b9ff66]/70 to-transparent" />
              <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
                <div className="max-w-2xl">
                  <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#b9ff66]">
                    <Sparkles className="h-3.5 w-3.5" /> Portfolio command center
                  </div>
                  <h1 className="text-2xl font-semibold tracking-[-0.03em] text-white sm:text-3xl">Danh mục rõ ràng. Quyết định có kỷ luật.</h1>
                  <p className="mt-2 max-w-xl text-sm leading-6 text-[#9ba79e]">Theo dõi hiệu suất, phân bổ vốn và nhật ký giao dịch trong cùng một không gian làm việc.</p>
                </div>
                <div className="min-w-0 lg:w-[420px]">
                  <PortfolioSelector portfolios={portfolios} activeId={activePortfolioId ?? ""} onSelect={setActivePortfolioId} onCreate={handlePortfolioCreate} onDelete={handlePortfolioDelete} />
                </div>
              </div>
            </section>

            {portfolioError && (
              <div role="alert" className="rounded-xl border border-[var(--color-down)]/30 bg-[var(--color-down)]/10 px-4 py-3 text-sm text-[var(--color-down)]">{portfolioError}</div>
            )}

            {/* KPI summary */}
            <PortfolioSummaryBar
              positions={positions}
              currentPrices={currentPrices}
              loading={loadingPortfolio || loadingTx}
            />

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.65fr)_minmax(300px,0.75fr)]">
              <div className="min-w-0 rounded-2xl border border-white/[0.07] bg-[#0b0f0c] p-4 sm:p-5">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div><p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#758078]">Holdings</p><h2 className="mt-1 text-base font-semibold text-white">Vị thế đang mở</h2></div>
                  <span className="rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-xs text-[#9ba79e]">{positions.length} mã</span>
                </div>
                <PortfolioPositionsTable positions={positions} currentPrices={currentPrices} loading={loadingTx} onAddTransaction={handleOpenAddTx} />
              </div>
              <div className="space-y-4">
                {positions.length > 0 && <PortfolioAllocationChart positions={positions} currentPrices={currentPrices} />}
                <div className="rounded-2xl border border-white/[0.07] bg-[#0b0f0c] p-5">
                  <div className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-[#b9ff66]" /><h3 className="text-sm font-semibold text-white">Kỷ luật giao dịch</h3></div>
                  <div className="mt-5 grid grid-cols-3 gap-2 text-center">
                    <div><div className="font-ticker text-lg font-semibold text-white">{journalStats.tradeCount}</div><div className="mt-1 text-[10px] text-[#758078]">Giao dịch</div></div>
                    <div><div className="font-ticker text-lg font-semibold text-[#b9ff66]">{journalStats.disciplinedCount}</div><div className="mt-1 text-[10px] text-[#758078]">Có kế hoạch</div></div>
                    <div><div className="font-ticker text-lg font-semibold text-white">{journalStats.riskCoverage == null ? "—" : `${journalStats.riskCoverage}%`}</div><div className="mt-1 text-[10px] text-[#758078]">Có Target + SL</div></div>
                  </div>
                  <p className="mt-4 border-t border-white/[0.06] pt-3 text-[10px] leading-4 text-[#667169]">Chỉ đo mức độ hoàn thiện kế hoạch giao dịch; không suy diễn chất lượng hay xác suất thắng.</p>
                </div>
              </div>
            </div>

            {/* Transaction history */}
            {transactions.length > 0 && (
              <div className="rounded-2xl border border-white/[0.07] bg-[#0b0f0c] p-4 sm:p-5">
                <div className="mb-4 flex items-center gap-2"><Activity className="h-4 w-4 text-[#b9ff66]" /><h2 className="text-base font-semibold text-white">Nhật ký giao dịch</h2></div>
                <PortfolioTransactionHistory
                  transactions={transactions}
                  onDelete={handleTxDelete}
                  loading={loadingTx}
                />
              </div>
            )}
          </div>
        )}

        {/* ── WATCHLIST TAB ── */}
        {activeTab === "watchlist" && !loadingWatchlist && activeWatchlistId && (
          <WatchlistPanel
            initialWatchlists={watchlists}
            initialActiveId={activeWatchlistId}
            initialItems={watchlistItems}
          />
        )}

        {activeTab === "watchlist" && loadingWatchlist && (
          <div className="space-y-2">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-10 animate-pulse rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)]" />
            ))}
          </div>
        )}
      </div>

      {/* Add Transaction Dialog */}
      {activePortfolioId && (
        <AddTransactionDialog
          portfolioId={activePortfolioId}
          open={addTxOpen}
          onOpenChange={setAddTxOpen}
          onSuccess={handleTxSuccess}
          initialTicker={addTxTicker}
        />
      )}
    </div>
  )
}


// Skeleton for summary bar
function SummaryBarSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="h-20 animate-pulse rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)]" />
      ))}
    </div>
  )
}
