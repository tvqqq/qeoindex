"use client"

import { useState, useEffect, useCallback } from "react"
import { Briefcase, Eye, RefreshCw, Plus } from "lucide-react"

import { Button } from "@/components/ui/button"
import { WatchlistPanel } from "@/components/portfolio/watchlist-panel"
import { computePortfolioPositions, type RawTransaction } from "@/lib/portfolio/pnl"

// These components will be used once all subagents finish writing them
// Using dynamic imports would prevent build errors during incremental development
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
        const res = await fetch("/api/portfolio", { cache: "no-store", credentials: "same-origin" })
        if (!res.ok) return
        const data = await res.json() as { ok: boolean; portfolios?: PortfolioMeta[] }
        if (data.ok && data.portfolios) {
          setPortfolios(data.portfolios)
          const def = data.portfolios.find((p) => p.is_default) ?? data.portfolios[0]
          if (def) setActivePortfolioId(def.id)
        }
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
    setLoadingTx(true)
    try {
      const res = await fetch(`/api/portfolio/${portfolioId}/transactions`, {
        cache: "no-store",
        credentials: "same-origin",
      })
      if (!res.ok) return
      const data = await res.json() as { ok: boolean; transactions?: RawTransaction[] }
      if (data.ok && data.transactions) setTransactions(data.transactions)
    } finally {
      setLoadingTx(false)
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
      .then((data: Record<string, { close?: number; last?: number }> | null) => {
        if (!data) return
        const prices: Record<string, number> = {}
        for (const [ticker, quote] of Object.entries(data)) {
          prices[ticker] = quote.close ?? quote.last ?? 0
        }
        setCurrentPrices(prices)
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
    <div className="min-h-screen bg-[var(--color-background)]">
      {/* Page header */}
      <div className="sticky top-14 z-30 border-b border-[var(--color-border)] bg-[var(--color-background)]/95 px-4 py-3 sm:px-6">
        <div className="mx-auto max-w-7xl">
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
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        {/* ── PORTFOLIO TAB ── */}
        {activeTab === "portfolio" && (
          <div className="space-y-5">
            {/* Portfolio selector */}
            <PortfolioSelector
              portfolios={portfolios}
              activeId={activePortfolioId ?? ""}
              onSelect={setActivePortfolioId}
              onCreate={handlePortfolioCreate}
              onDelete={handlePortfolioDelete}
            />

            {/* KPI summary */}
            <PortfolioSummaryBar
              positions={positions}
              currentPrices={currentPrices}
              loading={loadingPortfolio || loadingTx}
            />

            {/* Positions table & Allocation chart */}
            {positions.length > 0 && (
              <PortfolioAllocationChart positions={positions} currentPrices={currentPrices} />
            )}

            <div>
              <h2 className="mb-3 text-sm font-semibold text-[var(--color-foreground)]">
                Vị thế đang mở
              </h2>
              <PortfolioPositionsTable
                positions={positions}
                currentPrices={currentPrices}
                loading={loadingTx}
                onAddTransaction={handleOpenAddTx}
              />
            </div>

            {/* Transaction history */}
            {transactions.length > 0 && (
              <div>
                <h2 className="mb-3 text-sm font-semibold text-[var(--color-foreground)]">
                  Lịch sử giao dịch
                </h2>
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
