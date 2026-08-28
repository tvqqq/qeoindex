"use client"

import { useState, useEffect, useCallback, useMemo, useRef } from "react"
import {
  Activity,
  Briefcase,
  Eye,
  RefreshCw,
  Plus,
  Calculator,
  BarChart3,
  BookOpen,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { WatchlistPanel } from "@/components/portfolio/watchlist-panel"
import { TopNav } from "@/components/top-nav"
import { computePortfolioPositions, type RawTransaction } from "@/lib/portfolio/pnl"
import { extractPortfolioMarketPrices, type PortfolioIntradayPayload } from "@/lib/portfolio/market-prices"
import { cn } from "@/lib/utils"
import styles from "@/components/portfolio/portfolio-theme.module.css"

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
const PortfolioCapitalAllocation = dynamic(
  () => import("@/components/portfolio/portfolio-capital-allocation").then((m) => m.PortfolioCapitalAllocation),
  { ssr: false },
)
const PortfolioBenchmarkChart = dynamic(
  () => import("@/components/portfolio/portfolio-benchmark-chart").then((m) => m.PortfolioBenchmarkChart),
  { ssr: false },
)
const PortfolioGuidanceDialog = dynamic(
  () => import("@/components/portfolio/portfolio-guidance-dialog").then((m) => m.PortfolioGuidanceDialog),
  { ssr: false },
)

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

interface PortfolioMeta {
  id: string
  name: string
  description: string | null
  initial_capital?: number
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

type ActiveTab = "portfolio" | "journal" | "allocation" | "benchmark" | "watchlist"

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

  // Dialog state
  const [addTxOpen, setAddTxOpen] = useState(false)
  const [addTxTicker, setAddTxTicker] = useState<string | undefined>()
  const [guidanceOpen, setGuidanceOpen] = useState(false)

  // ── Load Portfolios ──
  const loadPortfolios = useCallback(async () => {
    setLoadingPortfolio(true)
    setPortfolioError("")
    try {
      const res = await fetch("/api/portfolio", { cache: "no-store", credentials: "same-origin" })
      if (!res.ok) {
        setPortfolioError("Không thể tải danh mục đầu tư.")
        return
      }
      const data = (await res.json()) as { ok: boolean; portfolios?: PortfolioMeta[] }
      if (data.ok && data.portfolios) {
        setPortfolios(data.portfolios)
        if (!activePortfolioId && data.portfolios.length > 0) {
          const def = data.portfolios.find((p) => p.is_default) ?? data.portfolios[0]
          setActivePortfolioId(def.id)
        }
      }
    } catch {
      setPortfolioError("Lỗi kết nối khi tải danh mục.")
    } finally {
      setLoadingPortfolio(false)
    }
  }, [activePortfolioId])

  // ── Load Transactions ──
  const loadTransactions = useCallback(async (portfolioId: string) => {
    const requestId = ++transactionRequestRef.current
    setLoadingTx(true)
    try {
      const res = await fetch(`/api/portfolio/${portfolioId}/transactions`, {
        cache: "no-store",
        credentials: "same-origin",
      })
      if (!res.ok) return
      const data = (await res.json()) as { ok: boolean; transactions?: RawTransaction[] }
      if (requestId !== transactionRequestRef.current) return
      if (data.ok && data.transactions) {
        setTransactions(data.transactions)
      }
    } catch {
      // ignore
    } finally {
      if (requestId === transactionRequestRef.current) {
        setLoadingTx(false)
      }
    }
  }, [])

  // ── Load Watchlists ──
  const loadWatchlists = useCallback(async () => {
    try {
      const res = await fetch("/api/watchlist", { cache: "no-store", credentials: "same-origin" })
      if (!res.ok) return
      const data = (await res.json()) as {
        ok: boolean
        watchlists?: WatchlistMeta[]
        items?: WatchlistItem[]
        activeWatchlistId?: string
      }
      if (data.ok) {
        if (data.watchlists) setWatchlists(data.watchlists)
        if (data.activeWatchlistId) setActiveWatchlistId(data.activeWatchlistId)
        if (data.items) setWatchlistItems(data.items)
      }
    } catch {
      // ignore
    }
  }, [])

  // Initial load
  useEffect(() => {
    loadPortfolios()
    loadWatchlists()
  }, [loadPortfolios, loadWatchlists])

  useEffect(() => {
    if (activePortfolioId) loadTransactions(activePortfolioId)
  }, [activePortfolioId, loadTransactions])

  // ── Compute positions from transactions ──
  const { positions } = useMemo(() => {
    return computePortfolioPositions(transactions)
  }, [transactions])

  const tickers = useMemo(() => {
    return Array.from(new Set(positions.map((p) => p.ticker)))
  }, [positions])

  // ── Fetch live prices for open positions ──
  useEffect(() => {
    if (tickers.length === 0) return
    const symList = tickers.join(",")
    fetch(`/api/market/intraday?symbols=${symList}`, { cache: "no-store", credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: PortfolioIntradayPayload | null) => {
        if (!data) return
        const prices = extractPortfolioMarketPrices(data)
        setCurrentPrices(prices)
      })
      .catch(() => {})
  }, [tickers])

  // ── Portfolio CRUD handlers ──
  const handlePortfolioCreate = useCallback(async (name: string, initialCapital?: number) => {
    const res = await fetch("/api/portfolio", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ name, initial_capital: initialCapital }),
    })
    const data = (await res.json()) as { ok: boolean; portfolio?: PortfolioMeta; error?: string }
    if (!res.ok || !data.ok || !data.portfolio) {
      alert(data.error ?? "Không thể tạo danh mục.")
      return
    }
    setPortfolios((prev) => [...prev, data.portfolio!])
    setActivePortfolioId(data.portfolio.id)
  }, [])

  const handlePortfolioUpdate = useCallback(
    async (id: string, updates: { name?: string; initial_capital?: number }) => {
      const res = await fetch(`/api/portfolio/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(updates),
      })
      const data = (await res.json()) as { ok: boolean; portfolio?: PortfolioMeta; error?: string }
      if (!res.ok || !data.ok || !data.portfolio) {
        alert(data.error ?? "Không thể cập nhật danh mục.")
        return
      }
      setPortfolios((prev) => prev.map((p) => (p.id === id ? { ...p, ...data.portfolio } : p)))
    },
    [],
  )

  const handlePortfolioDelete = useCallback(
    async (id: string) => {
      const res = await fetch(`/api/portfolio/${id}`, { method: "DELETE", credentials: "same-origin" })
      const data = (await res.json()) as { ok: boolean; error?: string }
      if (!res.ok || !data.ok) {
        alert(data.error ?? "Không thể xóa danh mục.")
        return
      }
      setPortfolios((prev) => {
        const remaining = prev.filter((p) => p.id !== id)
        if (activePortfolioId === id && remaining.length > 0) {
          setActivePortfolioId(remaining[0].id)
        }
        return remaining
      })
      setTransactions([])
    },
    [activePortfolioId],
  )

  // ── Transaction handlers ──
  const handleOpenAddTx = useCallback((ticker?: string) => {
    setAddTxTicker(ticker)
    setAddTxOpen(true)
  }, [])

  const handleTxSuccess = useCallback(() => {
    setAddTxOpen(false)
    if (activePortfolioId) loadTransactions(activePortfolioId)
  }, [activePortfolioId, loadTransactions])

  const handleTxDelete = useCallback(
    async (txId: string) => {
      if (!activePortfolioId) return
      const res = await fetch(`/api/portfolio/${activePortfolioId}/transactions/${txId}`, {
        method: "DELETE",
        credentials: "same-origin",
      })
      const data = (await res.json()) as { ok: boolean; error?: string }
      if (!res.ok || !data.ok) {
        alert(data.error ?? "Không thể xóa giao dịch.")
        return
      }
      setTransactions((prev) => prev.filter((t) => t.id !== txId))
    },
    [activePortfolioId],
  )

  // ── Tab button helper ──
  function tabClass(tab: ActiveTab) {
    return cn(
      "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all duration-200",
      activeTab === tab
        ? "border border-purple-500/40 bg-purple-500/15 font-semibold text-purple-300 shadow-sm"
        : "text-slate-400 hover:bg-white/[0.04] hover:text-white border border-transparent",
    )
  }

  return (
    <div className={`${styles.shell} min-h-screen text-slate-100 bg-[#06080b]`}>
      <TopNav />

      {/* Sub Navigation Bar */}
      <div className="sticky top-14 z-30 border-b border-white/[0.07] bg-[#090c10]/95 px-4 sm:px-6">
        <div className="mx-auto flex min-h-14 max-w-[1480px] items-center">
          <div className="flex w-full flex-wrap items-center justify-between gap-3">
            {/* 5 Main Tabs (Tài sản | Nhật ký | Phân bổ vốn | Hiệu suất | Theo dõi) */}
            <div className="flex items-center gap-1 rounded-xl border border-white/[0.08] bg-[#0e1218] p-1">
              <button type="button" className={tabClass("portfolio")} onClick={() => setActiveTab("portfolio")}>
                <Briefcase className="h-3.5 w-3.5" />
                <span>Tài sản</span>
              </button>
              <button type="button" className={tabClass("journal")} onClick={() => setActiveTab("journal")}>
                <Activity className="h-3.5 w-3.5" />
                <span>Nhật ký</span>
              </button>
              <button type="button" className={tabClass("allocation")} onClick={() => setActiveTab("allocation")}>
                <Calculator className="h-3.5 w-3.5" />
                <span>Phân bổ vốn</span>
              </button>
              <button type="button" className={tabClass("benchmark")} onClick={() => setActiveTab("benchmark")}>
                <BarChart3 className="h-3.5 w-3.5" />
                <span>Hiệu suất</span>
              </button>
              <button type="button" className={tabClass("watchlist")} onClick={() => setActiveTab("watchlist")}>
                <Eye className="h-3.5 w-3.5" />
                <span>Theo dõi</span>
              </button>
            </div>

            {/* Right Action buttons */}
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setGuidanceOpen(true)}
                className="h-8 gap-1.5 rounded-full px-3 text-xs text-purple-300 border border-purple-500/30 bg-purple-500/10 hover:bg-purple-500/20"
              >
                <BookOpen className="h-3.5 w-3.5" />
                <span>Hướng dẫn</span>
              </Button>

              <Button
                size="sm"
                variant="ghost"
                onClick={() => activePortfolioId && loadTransactions(activePortfolioId)}
                className="h-8 gap-1.5 rounded-full px-3 text-xs text-slate-400 hover:bg-white/[0.05] hover:text-white"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span>Làm mới</span>
              </Button>

              <Button
                size="sm"
                onClick={() => handleOpenAddTx()}
                className="h-8 gap-1.5 rounded-full bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 px-4 text-xs font-semibold text-white shadow-[0_0_15px_rgba(147,51,234,0.35)]"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Thêm giao dịch</span>
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Container */}
      <div className="mx-auto max-w-[1480px] px-4 py-5 sm:px-6 lg:py-6">
        {/* Top Header Card */}
        <section className="mb-6 relative overflow-hidden rounded-3xl border border-[#2b2e40] bg-gradient-to-r from-[#0d1017] via-[#121520] to-[#0d1017] px-6 py-5 shadow-lg">
          <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-purple-400">
                <span className="h-1.5 w-1.5 rounded-full bg-purple-400 shadow-[0_0_8px_rgba(168,85,247,0.8)]" />
                Portfolio & Risk Management
              </div>
              <h1 className="text-xl font-bold tracking-tight text-white sm:text-2xl">
                Quản lý Danh mục & Nhật ký Giao dịch
              </h1>
            </div>

            {/* Portfolio Selector Pill (Screenshot 1) */}
            <PortfolioSelector
              portfolios={portfolios}
              activeId={activePortfolioId ?? ""}
              onSelect={setActivePortfolioId}
              onCreate={handlePortfolioCreate}
              onUpdate={handlePortfolioUpdate}
              onDelete={handlePortfolioDelete}
            />
          </div>
        </section>

        {portfolioError && (
          <div className="mb-4 rounded-xl border border-[var(--color-down)]/30 bg-[var(--color-down)]/10 px-4 py-3 text-sm text-[var(--color-down)]">
            {portfolioError}
          </div>
        )}

        {/* ── 1. TAB: TÀI SẢN (PORTFOLIO) ── */}
        {activeTab === "portfolio" && (
          <div className="space-y-6">
            <PortfolioSummaryBar
              positions={positions}
              currentPrices={currentPrices}
              loading={loadingPortfolio || loadingTx}
            />

            <div className="grid gap-6 lg:grid-cols-[minmax(0,1.65fr)_minmax(300px,0.75fr)]">
              <div className="min-w-0 rounded-2xl border border-[var(--color-border)] bg-[#0b0f13] p-5 shadow-sm">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <h2 className="text-sm font-bold text-white uppercase tracking-wider">Vị thế đang mở</h2>
                  <span className="rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-xs text-[var(--color-muted-2)]">
                    {positions.length} mã
                  </span>
                </div>
                <PortfolioPositionsTable
                  positions={positions}
                  currentPrices={currentPrices}
                  loading={loadingTx}
                  onAddTransaction={handleOpenAddTx}
                />
              </div>

              <div className="space-y-6">
                {positions.length > 0 && (
                  <PortfolioAllocationChart positions={positions} currentPrices={currentPrices} />
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── 2. TAB: NHẬT KÝ (JOURNAL) ── */}
        {activeTab === "journal" && (
          <div className="rounded-2xl border border-[var(--color-border)] bg-[#0b0f13] p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Activity className="h-4 w-4 text-purple-400" />
                <h2 className="text-sm font-bold text-white uppercase tracking-wider">Nhật ký giao dịch</h2>
              </div>
              <span className="text-xs text-[var(--color-muted-2)]">{transactions.length} giao dịch</span>
            </div>
            <PortfolioTransactionHistory
              transactions={transactions}
              onDelete={handleTxDelete}
              onEdit={() => {}}
              loading={loadingTx}
            />
          </div>
        )}

        {/* ── 3. TAB: PHÂN BỔ VỐN (CAPITAL ALLOCATION) ── */}
        {activeTab === "allocation" && (
          <PortfolioCapitalAllocation
            portfolios={portfolios}
            activePortfolioId={activePortfolioId ?? ""}
            positions={positions}
            currentPrices={currentPrices}
          />
        )}

        {/* ── 4. TAB: HIỆU SUẤT (BENCHMARK VS VNINDEX) ── */}
        {activeTab === "benchmark" && activePortfolioId && (
          <PortfolioBenchmarkChart portfolioId={activePortfolioId} />
        )}

        {/* ── 5. TAB: THEO DÕI (WATCHLIST) ── */}
        {activeTab === "watchlist" && (
          <div className="rounded-2xl border border-[var(--color-border)] bg-[#0b0f13] p-5 shadow-sm">
            <WatchlistPanel
              initialWatchlists={watchlists}
              initialActiveId={activeWatchlistId ?? (watchlists[0]?.id || "")}
              initialItems={watchlistItems}
            />
          </div>
        )}
      </div>

      {/* Add Transaction Dialog (2-Column Modal) */}
      <AddTransactionDialog
        portfolioId={activePortfolioId ?? ""}
        portfolios={portfolios}
        open={addTxOpen}
        onOpenChange={setAddTxOpen}
        onSuccess={handleTxSuccess}
        initialTicker={addTxTicker}
      />

      {/* Guidance Modal */}
      <PortfolioGuidanceDialog
        open={guidanceOpen}
        onOpenChange={setGuidanceOpen}
      />
    </div>
  )
}

function SummaryBarSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="h-20 animate-pulse rounded-2xl border border-[var(--color-border)] bg-white/[0.02]" />
      ))}
    </div>
  )
}
