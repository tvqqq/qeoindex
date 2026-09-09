"use client"

import { useState, useEffect, useCallback, useMemo, useRef } from "react"
import dynamic from "next/dynamic"

import { AnimatedTabs, type AnimatedTab } from "@/components/smoothui/animated-tabs"
import { PortfolioBattleHud } from "@/components/portfolio/revamp/portfolio-battle-hud"
import { PortfolioCommandActions } from "@/components/portfolio/revamp/portfolio-command-actions"
import { PortfolioCommandHeader } from "@/components/portfolio/revamp/portfolio-command-header"
import { PortfolioPositionGrid } from "@/components/portfolio/revamp/portfolio-position-grid"
import { PortfolioSectionShell } from "@/components/portfolio/revamp/portfolio-section-shell"
import { WatchlistPanel, type WatchlistMeta, type WatchlistItem } from "@/components/portfolio/watchlist-panel"
import { TopNav } from "@/components/top-nav"
import { extractPortfolioMarketPrices, type PortfolioIntradayPayload } from "@/modules/portfolio/market-prices"
import { computePortfolioPositions, type RawTransaction } from "@/modules/portfolio/pnl"
import styles from "@/components/portfolio/portfolio-theme.module.css"

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

const PortfolioRiskPlan = dynamic(
  () =>
    import("@/components/portfolio/portfolio-risk-plan").then(
      (m) => m.PortfolioRiskPlan,
    ),
  { ssr: false },
)

const PortfolioRiskDashboard = dynamic(
  () =>
    import("@/components/portfolio/risk-engine/portfolio-risk-dashboard").then(
      (m) => m.PortfolioRiskDashboard,
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
  const [portfolios, setPortfolios] = useState<PortfolioMeta[]>([])
  const [activePortfolioId, setActivePortfolioId] = useState<string | null>(null)
  const [loadingPortfolio, setLoadingPortfolio] = useState(true)
  const [portfolioError, setPortfolioError] = useState<string | null>(null)

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

  const [currentPrices, setCurrentPrices] = useState<Record<string, number>>({})
  const [watchlists, setWatchlists] = useState<WatchlistMeta[]>([])
  const [activeWatchlistId, setActiveWatchlistId] = useState<string | null>(null)
  const [watchlistItems, setWatchlistItems] = useState<WatchlistItem[]>([])
  const [addTxOpen, setAddTxOpen] = useState(false)
  const [addTxTicker, setAddTxTicker] = useState<string | undefined>()
  const [guidanceOpen, setGuidanceOpen] = useState(false)

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

  const portfolioSummary = useMemo(() => computePortfolioPositions(transactions), [transactions])
  const { positions, totalRealizedPnl } = portfolioSummary

  const tickers = useMemo(() => Array.from(new Set(positions.map((position) => position.ticker))), [positions])

  useEffect(() => {
    if (tickers.length === 0) return
    const symList = tickers.join(",")
    fetch(`/api/market/intraday?symbols=${symList}`, { cache: "no-store", credentials: "same-origin" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: PortfolioIntradayPayload | null) => {
        if (!data) return
        setCurrentPrices(extractPortfolioMarketPrices(data))
      })
      .catch(() => {})
  }, [tickers])

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
        setPortfolios((prev) => prev.map((portfolio) => (portfolio.id === id ? { ...portfolio, ...data.portfolio } : portfolio)))
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
          const next = prev.filter((portfolio) => portfolio.id !== id)
          if (activePortfolioId === id) setActivePortfolioId(next[0]?.id ?? null)
          return next
        })
      }
    },
    [activePortfolioId],
  )

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
    <div className={`${styles.shell} min-h-screen bg-[#06080b] text-slate-100`}>
      <TopNav />

      <div className="sticky top-14 z-30 border-b border-white/[0.07] bg-[#090c10]/95 px-4 sm:px-6">
        <div className="mx-auto flex min-h-14 max-w-[1480px] items-center py-2">
          <AnimatedTabs
            tabs={PORTFOLIO_TABS}
            value={activeTab}
            onValueChange={(value) => setActiveTab(value as ActiveTab)}
            variant="pill"
            className="rounded-2xl border border-[#2a2e40] bg-[#0b0e14] p-1"
            tabClassName="font-ticker font-bold text-xs sm:text-sm px-4 py-1.5 transition-colors"
            indicatorClassName="bg-gradient-to-r from-purple-600/35 to-indigo-600/35 border border-purple-500/50 rounded-xl shadow-[0_0_12px_rgba(168,85,247,0.25)]"
          />
        </div>
      </div>

      <div className="mx-auto max-w-[1480px] px-4 py-5 sm:px-6 lg:py-6">
        <PortfolioCommandHeader
          selector={(
            <PortfolioSelector
              portfolios={portfolios}
              activeId={activePortfolioId ?? ""}
              onSelect={setActivePortfolioId}
              onCreate={handlePortfolioCreate}
              onUpdate={handlePortfolioUpdate}
              onDelete={handlePortfolioDelete}
            />
          )}
          actions={(
            <PortfolioCommandActions
              onGuidance={() => setGuidanceOpen(true)}
              onRefresh={handleRefreshTransactions}
              onAddTransaction={() => handleOpenAddTx()}
              refreshing={refreshingTxFor === activePortfolioId && Boolean(activePortfolioId)}
            />
          )}
        />

        {portfolioError && (
          <div className="mb-4 rounded-2xl border border-[var(--color-down)]/30 bg-[var(--color-down)]/10 px-4 py-3 text-sm font-semibold text-[var(--color-down)]">
            {portfolioError}
          </div>
        )}

        {activeTab === "portfolio" && (
          <div className="space-y-6">
            <PortfolioBattleHud
              positions={positions}
              currentPrices={currentPrices}
              loading={loadingPortfolio || loadingTx}
            />

            {activePortfolioId && (
              <PortfolioRiskDashboard key={activePortfolioId} portfolioId={activePortfolioId} />
            )}

            <PortfolioPositionGrid
              positions={positions}
              currentPrices={currentPrices}
              loading={loadingTx}
              onAddTransaction={handleOpenAddTx}
            />

            {positions.length > 0 && (
              <PortfolioAllocationChart positions={positions} currentPrices={currentPrices} />
            )}

            <details className="rounded-3xl border border-[#2a2e40] bg-[#0c1017] shadow-sm">
              <summary className="cursor-pointer px-6 py-4 font-ticker text-sm font-extrabold uppercase tracking-wide text-white">
                Chi tiết đội hình
              </summary>
              <div className="border-t border-[var(--color-border)] px-6 py-4">
                <PortfolioPositionsTable
                  positions={positions}
                  currentPrices={currentPrices}
                  loading={loadingTx}
                  onAddTransaction={handleOpenAddTx}
                />
              </div>
            </details>
          </div>
        )}

        {activeTab === "journal" && (
          <PortfolioSectionShell
            title="Battle Log · Nhật ký giao dịch"
            description="Dòng thời gian các giao dịch đã ghi nhận. Thẻ hiển thị dữ kiện giao dịch và provenance hiện có, không suy diễn trạng thái Trade từ raw fills."
            action={(
              <span className="font-ticker text-xs font-bold text-[var(--color-muted-2)]">
                {transactions.length} giao dịch ghi nhận
              </span>
            )}
          >
            <PortfolioTransactionHistory
              transactions={transactions}
              onDelete={handleTxDelete}
              onEdit={() => {}}
              loading={loadingTx}
            />
          </PortfolioSectionShell>
        )}

        {activeTab === "allocation" && (
          <div className="space-y-6">
            <PortfolioCapitalAllocation
              key={activePortfolioId ?? ""}
              portfolios={portfolios}
              activePortfolioId={activePortfolioId ?? ""}
              positions={positions}
              currentPrices={currentPrices}
              totalRealizedPnlKvnd={totalRealizedPnl}
            />
            {activePortfolioId && (
              <details className="rounded-3xl border border-[#2a2e40] bg-[#0c1017] shadow-sm">
                <summary className="cursor-pointer px-6 py-4 font-ticker text-sm font-extrabold uppercase tracking-wide text-white">
                  Kế hoạch quản trị vốn nâng cao
                </summary>
                <div className="border-t border-[var(--color-border)] p-4 sm:p-6">
                  <PortfolioRiskPlan key={activePortfolioId} portfolioId={activePortfolioId} />
                </div>
              </details>
            )}
          </div>
        )}

        {activeTab === "benchmark" && activePortfolioId && (
          <PortfolioBenchmarkChart portfolioId={activePortfolioId} />
        )}

        {activeTab === "watchlist" && (
          <PortfolioSectionShell
            title="Scouting Board · Trinh sát"
            description="Danh sách theo dõi theo dữ kiện: quote phiên, cảnh báo, ghi chú và tags đã lưu."
          >
            <WatchlistPanel
              initialWatchlists={watchlists}
              initialActiveId={activeWatchlistId ?? (watchlists[0]?.id || "")}
              initialItems={watchlistItems}
            />
          </PortfolioSectionShell>
        )}
      </div>

      <AddTransactionDialog
        portfolioId={activePortfolioId ?? ""}
        portfolios={portfolios}
        open={addTxOpen}
        onOpenChange={setAddTxOpen}
        onSuccess={handleTxSuccess}
        initialTicker={addTxTicker}
      />

      <PortfolioGuidanceDialog
        open={guidanceOpen}
        onOpenChange={setGuidanceOpen}
      />
    </div>
  )
}
