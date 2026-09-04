"use client"

import { useState, useEffect, useCallback, useMemo, useRef } from "react"
import {
  Activity,
  RefreshCw,
  Plus,
  BookOpen,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { WatchlistPanel, type WatchlistMeta, type WatchlistItem } from "@/components/portfolio/watchlist-panel"
import { TopNav } from "@/components/top-nav"
import { computePortfolioPositions, type RawTransaction } from "@/modules/portfolio/pnl"
import { extractPortfolioMarketPrices, type PortfolioIntradayPayload } from "@/modules/portfolio/market-prices"
import { AnimatedTabs, type AnimatedTab } from "@/components/smoothui/animated-tabs"
import styles from "@/components/portfolio/portfolio-theme.module.css"

import dynamic from "next/dynamic"

const PortfolioSummaryBar = dynamic(
  () =>
    import("@/components/portfolio/portfolio-summary-bar").then(
      (m) => m.PortfolioSummaryBar,
    ),
  { ssr: false, loading: () => <SummaryBarSkeleton /> },
)

const PortfolioPositionsTable = dynamic(
  () =>
    import("@/components/portfolio/portfolio-positions-table").then(
      (m) => m.PortfolioPositionsTable,
    ),
  { ssr: false },
)

const PortfolioTransactionHistory = dynamic(
  () =>
    import("@/components/portfolio/portfolio-transaction-history").then(
      (m) => m.PortfolioTransactionHistory,
    ),
  { ssr: false },
)

const PortfolioAllocationChart = dynamic(
  () =>
    import("@/components/portfolio/portfolio-allocation-chart").then(
      (m) => m.PortfolioAllocationChart,
    ),
  { ssr: false },
)

const PortfolioCapitalAllocation = dynamic(
  () =>
    import("@/components/portfolio/portfolio-capital-allocation").then(
      (m) => m.PortfolioCapitalAllocation,
    ),
  { ssr: false },
)

const PortfolioBenchmarkChart = dynamic(
  () =>
    import("@/components/portfolio/portfolio-benchmark-chart").then(
      (m) => m.PortfolioBenchmarkChart,
    ),
  { ssr: false },
)

const PortfolioSelector = dynamic(
  () =>
    import("@/components/portfolio/portfolio-selector").then(
      (m) => m.PortfolioSelector,
    ),
  { ssr: false },
)

const AddTransactionDialog = dynamic(
  () =>
    import("@/components/portfolio/add-transaction-dialog").then(
      (m) => m.AddTransactionDialog,
    ),
  { ssr: false },
)

const PortfolioGuidanceDialog = dynamic(
  () =>
    import("@/components/portfolio/portfolio-guidance-dialog").then(
      (m) => m.PortfolioGuidanceDialog,
    ),
  { ssr: false },
)

// ── Types ──
export type ActiveTab = "portfolio" | "journal" | "allocation" | "benchmark" | "watchlist"

const PORTFOLIO_TABS: AnimatedTab<ActiveTab>[] = [
  { value: "portfolio", label: "Tài sản" },
  { value: "journal", label: "Nhật ký" },
  { value: "allocation", label: "Phân bổ vốn" },
  { value: "benchmark", label: "Hiệu suất" },
  { value: "watchlist", label: "Theo dõi" },
]

export interface PortfolioMeta {
  id: string
  name: string
  description: string | null
  initial_capital?: number
  is_default: boolean
  sort_order: number
}

export function PortfolioPage() {
  const [activeTab, setActiveTab] = useState<ActiveTab>("portfolio")

  // Portfolio state
  const [portfolios, setPortfolios] = useState<PortfolioMeta[]>([])
  const [activePortfolioId, setActivePortfolioId] = useState<string | null>(null)
  const [loadingPortfolio, setLoadingPortfolio] = useState(true)
  const [portfolioError, setPortfolioError] = useState<string | null>(null)

  // Transactions state is scoped to its owning portfolio so a switch never renders stale rows.
  const [transactionState, setTransactionState] = useState<{
    portfolioId: string | null
    transactions: RawTransaction[]
  }>({ portfolioId: null, transactions: [] })
  const [refreshingTxFor, setRefreshingTxFor] = useState<string | null>(null)
  const transactionRequestRef = useRef(0)
  const transactions = useMemo(() => (
    transactionState.portfolioId === activePortfolioId
      ? transactionState.transactions
      : []
  ), [activePortfolioId, transactionState])
  const loadingTx = Boolean(
    activePortfolioId
      && (
        transactionState.portfolioId !== activePortfolioId
        || refreshingTxFor === activePortfolioId
      ),
  )

  // Live market prices: { [ticker]: number }
  const [currentPrices, setCurrentPrices] = useState<Record<string, number>>({})

  // Watchlists state
  const [watchlists, setWatchlists] = useState<WatchlistMeta[]>([])
  const [activeWatchlistId, setActiveWatchlistId] = useState<string | null>(null)
  const [watchlistItems, setWatchlistItems] = useState<WatchlistItem[]>([])

  // Dialog state
  const [addTxOpen, setAddTxOpen] = useState(false)
  const [addTxTicker, setAddTxTicker] = useState<string | undefined>()
  const [guidanceOpen, setGuidanceOpen] = useState(false)

  // Effect-triggered loaders only fetch/parse. React state is applied from async callbacks.
  const loadPortfolios = useCallback(async () => {
    try {
      const res = await fetch("/api/portfolio", { cache: "no-store", credentials: "same-origin" })
      if (!res.ok) {
        return {
          portfolios: null as PortfolioMeta[] | null,
          error: res.status === 401
            ? "Vui lòng đăng nhập để xem danh mục."
            : "Không thể tải danh mục đầu tư.",
        }
      }
      const data = (await res.json()) as { ok: boolean; portfolios?: PortfolioMeta[] }
      return {
        portfolios: data.ok ? (data.portfolios ?? []) : [],
        error: null as string | null,
      }
    } catch {
      return {
        portfolios: null as PortfolioMeta[] | null,
        error: "Lỗi kết nối. Vui lòng thử lại sau.",
      }
    }
  }, [])

  const loadTransactions = useCallback(async (pid: string) => {
    const requestId = ++transactionRequestRef.current
    try {
      const res = await fetch(`/api/portfolio/${pid}/transactions`, {
        cache: "no-store",
        credentials: "same-origin",
      })
      if (!res.ok) {
        return { portfolioId: pid, requestId, transactions: null as RawTransaction[] | null }
      }
      const data = (await res.json()) as { ok: boolean; transactions?: RawTransaction[] }
      return {
        portfolioId: pid,
        requestId,
        transactions: data.ok ? (data.transactions ?? []) : null,
      }
    } catch {
      return { portfolioId: pid, requestId, transactions: null as RawTransaction[] | null }
    }
  }, [])

  const loadWatchlists = useCallback(async () => {
    try {
      const res = await fetch("/api/watchlist", { cache: "no-store", credentials: "same-origin" })
      if (!res.ok) return null
      const data = (await res.json()) as {
        ok: boolean
        watchlists?: WatchlistMeta[]
        items?: WatchlistItem[]
        activeWatchlistId?: string
      }
      if (!data.ok) return null
      return {
        watchlists: data.watchlists ?? [],
        activeWatchlistId: data.activeWatchlistId ?? null,
        items: data.items ?? [],
      }
    } catch {
      return null
    }
  }, [])

  // Initial load: state updates happen only after the external fetch promises settle.
  useEffect(() => {
    let cancelled = false

    void loadPortfolios().then((result) => {
      if (cancelled) return
      setPortfolioError(result.error)
      if (result.portfolios && result.portfolios.length > 0) {
        setPortfolios(result.portfolios)
        setActivePortfolioId((prev) => {
          if (prev && result.portfolios!.some((portfolio) => portfolio.id === prev)) return prev
          const fallback = result.portfolios!.find((portfolio) => portfolio.is_default)
          return fallback ? fallback.id : result.portfolios![0].id
        })
      }
      setLoadingPortfolio(false)
    })

    void loadWatchlists().then((result) => {
      if (cancelled || !result) return
      setWatchlists(result.watchlists)
      if (result.activeWatchlistId) setActiveWatchlistId(result.activeWatchlistId)
      setWatchlistItems(result.items)
    })

    return () => {
      cancelled = true
    }
  }, [loadPortfolios, loadWatchlists])

  useEffect(() => {
    if (!activePortfolioId) return

    void loadTransactions(activePortfolioId).then((result) => {
      if (result.requestId !== transactionRequestRef.current) return
      const { portfolioId: pid } = result
      if (result.transactions) {
        setTransactionState({ portfolioId: pid, transactions: result.transactions })
      } else {
        setTransactionState((current) => ({
          portfolioId: pid,
          transactions: current.portfolioId === pid ? current.transactions : [],
        }))
      }
      setRefreshingTxFor((current) => current === pid ? null : current)
    })
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
    if (!res.ok) return
    const data = (await res.json()) as { ok: boolean; portfolio?: PortfolioMeta }
    if (data.ok && data.portfolio) {
      setPortfolios((prev) => [...prev, data.portfolio!])
      setActivePortfolioId(data.portfolio.id)
    }
  }, [])

  const handlePortfolioUpdate = useCallback(
    async (id: string, updates: { name?: string; initial_capital?: number }) => {
      const res = await fetch(`/api/portfolio/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(updates),
      })
      if (!res.ok) return
      const data = (await res.json()) as { ok: boolean; portfolio?: PortfolioMeta }
      if (data.ok && data.portfolio) {
        setPortfolios((prev) => prev.map((p) => (p.id === id ? { ...p, ...data.portfolio } : p)))
      }
    },
    [],
  )

  const handlePortfolioDelete = useCallback(
    async (id: string) => {
      const res = await fetch(`/api/portfolio/${id}`, {
        method: "DELETE",
        credentials: "same-origin",
      })
      if (!res.ok) return
      const data = (await res.json()) as { ok: boolean }
      if (data.ok) {
        setPortfolios((prev) => {
          const next = prev.filter((p) => p.id !== id)
          if (activePortfolioId === id) {
            setActivePortfolioId(next[0]?.id ?? null)
          }
          return next
        })
      }
    },
    [activePortfolioId],
  )

  // ── Open Add Transaction dialog ──
  const handleOpenAddTx = useCallback((ticker?: string) => {
    setAddTxTicker(ticker)
    setAddTxOpen(true)
  }, [])

  const handleRefreshTransactions = useCallback(() => {
    if (!activePortfolioId) return
    setRefreshingTxFor(activePortfolioId)
    void loadTransactions(activePortfolioId).then((result) => {
      if (result.requestId !== transactionRequestRef.current) return
      const { portfolioId: pid } = result
      if (result.transactions) {
        setTransactionState({ portfolioId: pid, transactions: result.transactions })
      } else {
        setTransactionState((current) => ({
          portfolioId: pid,
          transactions: current.portfolioId === pid ? current.transactions : [],
        }))
      }
      setRefreshingTxFor((current) => current === pid ? null : current)
    })
  }, [activePortfolioId, loadTransactions])

  // ── After transaction added ──
  const handleTxSuccess = useCallback(() => {
    setAddTxOpen(false)
    if (activePortfolioId) {
      setRefreshingTxFor(activePortfolioId)
      void loadTransactions(activePortfolioId).then((result) => {
        if (result.requestId !== transactionRequestRef.current) return
        const { portfolioId: pid } = result
        if (result.transactions) {
          setTransactionState({ portfolioId: pid, transactions: result.transactions })
        } else {
          setTransactionState((current) => ({
            portfolioId: pid,
            transactions: current.portfolioId === pid ? current.transactions : [],
          }))
        }
        setRefreshingTxFor((current) => current === pid ? null : current)
      })
    }
  }, [activePortfolioId, loadTransactions])

  // ── Delete transaction ──
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
      setTransactionState((current) => {
        if (current.portfolioId !== activePortfolioId) return current
        return {
          ...current,
          transactions: current.transactions.filter((transaction) => transaction.id !== txId),
        }
      })
    },
    [activePortfolioId],
  )

  return (
    <div className={`${styles.shell} min-h-screen text-slate-100 bg-[#06080b]`}>
      <TopNav />

      {/* Sub Navigation Bar with SmoothUI AnimatedTabs */}
      <div className="sticky top-14 z-30 border-b border-white/[0.07] bg-[#090c10]/95 px-4 sm:px-6">
        <div className="mx-auto flex min-h-14 max-w-[1480px] items-center">
          <div className="flex w-full flex-wrap items-center justify-between gap-3 py-2">
            {/* 5 Main Tabs with SmoothUI Pill Indicator */}
            <AnimatedTabs
              tabs={PORTFOLIO_TABS}
              value={activeTab}
              onValueChange={(val) => setActiveTab(val as ActiveTab)}
              variant="pill"
              className="border border-[#2a2e40] bg-[#0b0e14] p-1 rounded-2xl"
              tabClassName="font-ticker font-bold text-xs sm:text-sm px-4 py-1.5 transition-colors"
              indicatorClassName="bg-gradient-to-r from-purple-600/35 to-indigo-600/35 border border-purple-500/50 rounded-xl shadow-[0_0_12px_rgba(168,85,247,0.25)]"
            />

            {/* Right Action buttons */}
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setGuidanceOpen(true)}
                className="h-8 gap-1.5 rounded-full px-3 text-xs font-bold font-ticker text-purple-300 border border-purple-500/30 bg-purple-500/10 hover:bg-purple-500/20 transition-colors"
              >
                <BookOpen className="h-3.5 w-3.5" />
                <span>Hướng dẫn</span>
              </Button>

              <Button
                size="sm"
                variant="ghost"
                onClick={handleRefreshTransactions}
                className="h-8 gap-1.5 rounded-full px-3 text-xs font-semibold font-ticker text-slate-300 hover:bg-white/[0.06] hover:text-white transition-colors"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span>Làm mới</span>
              </Button>

              <Button
                size="sm"
                onClick={() => handleOpenAddTx()}
                className="h-8 gap-1.5 rounded-full bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 px-4 text-xs font-bold font-ticker text-white shadow-[0_0_15px_rgba(147,51,234,0.35)] transition-colors cursor-pointer"
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
        <section className="mb-6 relative rounded-3xl border border-[#2b2e40] bg-gradient-to-r from-[#0d1017] via-[#131724] to-[#0d1017] px-6 py-6 shadow-xl">
          <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="mb-1.5 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-purple-400 font-ticker">
                <span className="h-2 w-2 rounded-full bg-purple-400 shadow-[0_0_10px_rgba(168,85,247,0.9)]" />
                Portfolio & Risk Management
              </div>
              <h1 className="font-ticker text-2xl font-extrabold tracking-tight text-white sm:text-3xl">
                Quản lý Danh mục & <span className="italic bg-gradient-to-r from-purple-400 via-indigo-300 to-purple-400 bg-clip-text text-transparent">Nhật ký Giao dịch</span>
              </h1>
              <p className="mt-1 font-ticker text-xs sm:text-sm text-[var(--color-muted-2)] font-medium">
                Hệ thống phân bổ vốn <span className="font-bold text-slate-200 italic">1–2% NAV</span> kết hợp nhật ký giao dịch và so sánh hiệu suất chuẩn Wyckoff.
              </p>
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
          <div className="mb-4 rounded-2xl border border-[var(--color-down)]/30 bg-[var(--color-down)]/10 px-4 py-3 text-sm text-[var(--color-down)] font-ticker font-semibold">
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
              <div className="min-w-0 rounded-3xl border border-[#2a2e40] bg-[#0c1017] p-6 shadow-sm">
                <div className="mb-4 flex items-center justify-between gap-3 border-b border-[var(--color-border)] pb-3">
                  <h2 className="font-ticker text-sm sm:text-base font-extrabold text-white uppercase tracking-wide">
                    Vị thế đang mở
                  </h2>
                  <span className="font-ticker font-bold rounded-full border border-purple-500/30 bg-purple-500/10 px-3 py-0.5 text-xs text-purple-300">
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
          <div className="rounded-3xl border border-[#2a2e40] bg-[#0c1017] p-6 shadow-sm">
            <div className="mb-4 flex items-center justify-between border-b border-[var(--color-border)] pb-3">
              <div className="flex items-center gap-2">
                <Activity className="h-5 w-5 text-purple-400" />
                <h2 className="font-ticker text-sm sm:text-base font-extrabold text-white uppercase tracking-wide">
                  Nhật ký giao dịch chi tiết
                </h2>
              </div>
              <span className="font-ticker font-bold text-xs text-[var(--color-muted-2)]">
                {transactions.length} giao dịch ghi nhận
              </span>
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
          <div className="rounded-3xl border border-[#2a2e40] bg-[#0c1017] p-6 shadow-sm">
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
        <div key={i} className="h-24 animate-pulse rounded-3xl border border-[var(--color-border)] bg-white/[0.02]" />
      ))}
    </div>
  )
}