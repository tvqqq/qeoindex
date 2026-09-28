"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { ExternalLink, LoaderCircle, TrendingDown, TrendingUp, WalletCards } from "lucide-react"

import { computePortfolioPositions, type RawTransaction } from "@/modules/portfolio/pnl"
import { cn } from "@/modules/shared/ui/cn"

type PortfolioMeta = {
  id: string
  name: string
  is_default: boolean
}

type PortfolioListPayload =
  | { ok: true; portfolios?: PortfolioMeta[] }
  | { ok: false; error?: string }

type TransactionPayload =
  | { ok: true; transactions?: RawTransaction[] }
  | { ok: false; error?: string }

function formatPrice(value: number) {
  return new Intl.NumberFormat("vi-VN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value)
}

function formatVndFromKvnd(value: number) {
  const vnd = value * 1_000
  const sign = vnd > 0 ? "+" : vnd < 0 ? "−" : ""
  const abs = Math.abs(vnd)

  if (abs >= 1_000_000_000) return `${sign}${(abs / 1_000_000_000).toFixed(2)} tỷ`
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(2)} tr`
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(0)} nghìn`
  return `${sign}${abs.toFixed(0)} ₫`
}

function actionLabel(action: RawTransaction["action"]) {
  switch (action) {
    case "buy": return "Mua"
    case "sell": return "Bán"
    case "dividend_cash": return "Cổ tức tiền"
    case "dividend_stock": return "Cổ tức CP"
    case "rights": return "Quyền mua"
  }
}

export function StockPortfolioPanel({
  ticker,
  currentPrice,
}: {
  ticker: string
  currentPrice: number
}) {
  const [portfolios, setPortfolios] = useState<PortfolioMeta[]>([])
  const [portfolioId, setPortfolioId] = useState<string | null>(null)
  const [transactions, setTransactions] = useState<RawTransaction[]>([])
  const [loadingPortfolios, setLoadingPortfolios] = useState(true)
  const [loadingTransactions, setLoadingTransactions] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    setLoadingPortfolios(true)
    setError(null)

    void fetch("/api/portfolio", {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => null) as PortfolioListPayload | null
        if (!response.ok || !payload || !payload.ok) {
          if (response.status === 401) throw new Error("Vui lòng đăng nhập để xem Portfolio.")
          throw new Error(payload && !payload.ok ? payload.error || "Không thể tải Portfolio." : "Không thể tải Portfolio.")
        }

        const next = payload.portfolios ?? []
        setPortfolios(next)
        setPortfolioId((current) => {
          if (current && next.some((portfolio) => portfolio.id === current)) return current
          return next.find((portfolio) => portfolio.is_default)?.id ?? next[0]?.id ?? null
        })
      })
      .catch((loadError: unknown) => {
        if ((loadError as Error)?.name === "AbortError") return
        setError(loadError instanceof Error ? loadError.message : "Không thể tải Portfolio.")
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingPortfolios(false)
      })

    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (!portfolioId) {
      setTransactions([])
      return
    }

    const controller = new AbortController()
    setLoadingTransactions(true)
    setError(null)
    setTransactions([])

    void fetch(`/api/portfolio/${encodeURIComponent(portfolioId)}/transactions`, {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => null) as TransactionPayload | null
        if (!response.ok || !payload || !payload.ok) {
          throw new Error(payload && !payload.ok ? payload.error || "Không thể tải giao dịch." : "Không thể tải giao dịch.")
        }
        setTransactions(payload.transactions ?? [])
      })
      .catch((loadError: unknown) => {
        if ((loadError as Error)?.name === "AbortError") return
        setError(loadError instanceof Error ? loadError.message : "Không thể tải giao dịch.")
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingTransactions(false)
      })

    return () => controller.abort()
  }, [portfolioId, ticker])

  const tickerTransactions = useMemo(
    () => transactions.filter((transaction) => transaction.ticker.toUpperCase() === ticker.toUpperCase()),
    [ticker, transactions],
  )

  const summary = useMemo(
    () => computePortfolioPositions(tickerTransactions),
    [tickerTransactions],
  )

  const position = summary.positions[0] ?? null
  const pnl = position && Number.isFinite(currentPrice)
    ? summary.calcUnrealizedPnl({ [ticker]: currentPrice }).positionDetails[0] ?? null
    : null

  const recentTransactions = useMemo(
    () => [...tickerTransactions]
      .sort((left, right) => right.transaction_date.localeCompare(left.transaction_date))
      .slice(0, 5),
    [tickerTransactions],
  )

  const activePortfolio = portfolios.find((portfolio) => portfolio.id === portfolioId) ?? null
  const loading = loadingPortfolios || loadingTransactions

  return (
    <div className="min-h-[340px] p-3">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <div>
          <p className="text-[11px] font-bold text-slate-200">Giao dịch {ticker}</p>
          <p className="mt-0.5 text-[9px] text-slate-500">Dữ liệu từ Portfolio của tài khoản hiện tại.</p>
        </div>
        <Link
          href="/portfolio"
          className="inline-flex shrink-0 items-center gap-1 text-[9px] font-semibold text-cyan-300/75 hover:text-cyan-200"
        >
          Mở Portfolio
          <ExternalLink className="size-2.5" />
        </Link>
      </div>

      {portfolios.length > 1 ? (
        <select
          value={portfolioId ?? ""}
          onChange={(event) => setPortfolioId(event.target.value || null)}
          className="mb-2.5 w-full rounded-lg border border-white/[0.08] bg-[#05080c] px-2.5 py-1.5 text-[10px] font-semibold text-slate-300 outline-none focus:border-cyan-400/30"
        >
          {portfolios.map((portfolio) => (
            <option key={portfolio.id} value={portfolio.id}>
              {portfolio.name}{portfolio.is_default ? " · Mặc định" : ""}
            </option>
          ))}
        </select>
      ) : activePortfolio ? (
        <div className="mb-2.5 rounded-lg border border-white/[0.06] bg-black/20 px-2.5 py-1.5 text-[9px] text-slate-500">
          {activePortfolio.name}
        </div>
      ) : null}

      {loading ? (
        <div className="flex h-52 items-center justify-center rounded-xl border border-white/[0.06] bg-black/20 text-[10px] text-slate-500">
          <LoaderCircle className="mr-2 size-3.5 animate-spin text-cyan-400" />
          Đang tải Portfolio...
        </div>
      ) : portfolios.length === 0 && !error ? (
        <div className="flex h-52 flex-col items-center justify-center rounded-xl border border-dashed border-white/[0.08] bg-black/10 px-5 text-center">
          <WalletCards className="size-5 text-slate-600" />
          <p className="mt-2 text-[10px] font-semibold text-slate-400">Chưa có danh mục đầu tư.</p>
          <p className="mt-1 text-[9px] leading-4 text-slate-600">Tạo Portfolio để theo dõi vị thế và lịch sử giao dịch theo từng cổ phiếu.</p>
        </div>
      ) : tickerTransactions.length === 0 && !error ? (
        <div className="flex h-52 flex-col items-center justify-center rounded-xl border border-dashed border-white/[0.08] bg-black/10 px-5 text-center">
          <WalletCards className="size-5 text-slate-600" />
          <p className="mt-2 text-[10px] font-semibold text-slate-400">Chưa có giao dịch {ticker}.</p>
          <p className="mt-1 text-[9px] leading-4 text-slate-600">Portfolio này chưa ghi nhận lệnh mua, bán hoặc quyền liên quan tới {ticker}.</p>
        </div>
      ) : !error ? (
        <div className="space-y-2.5">
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-xl border border-white/[0.06] bg-black/20 p-2.5">
              <p className="text-[8px] font-black uppercase tracking-[0.12em] text-slate-600">Vị thế mở</p>
              <p className="mt-1 font-mono text-sm font-black text-slate-200">
                {position ? position.openQty.toLocaleString("vi-VN") : "0"} CP
              </p>
              <p className="mt-1 text-[9px] text-slate-500">
                Giá vốn {position ? formatPrice(position.avgCost) : "—"}
              </p>
            </div>

            <div className="rounded-xl border border-white/[0.06] bg-black/20 p-2.5">
              <p className="text-[8px] font-black uppercase tracking-[0.12em] text-slate-600">P/L chưa chốt</p>
              {pnl ? (
                <>
                  <p
                    className={cn(
                      "mt-1 flex items-center gap-1 font-mono text-sm font-black",
                      pnl.unrealizedPnl > 0
                        ? "text-emerald-300"
                        : pnl.unrealizedPnl < 0
                        ? "text-rose-300"
                        : "text-slate-300",
                    )}
                  >
                    {pnl.unrealizedPnl > 0 ? <TrendingUp className="size-3" /> : pnl.unrealizedPnl < 0 ? <TrendingDown className="size-3" /> : null}
                    {formatVndFromKvnd(pnl.unrealizedPnl)}
                  </p>
                  <p className="mt-1 font-mono text-[9px] text-slate-500">
                    {pnl.unrealizedPnlPct >= 0 ? "+" : ""}{pnl.unrealizedPnlPct.toFixed(2)}%
                  </p>
                </>
              ) : (
                <p className="mt-1 font-mono text-sm font-black text-slate-500">—</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-white/[0.05] bg-white/[0.02] px-2.5 py-2">
              <p className="text-[8px] uppercase tracking-wide text-slate-600">Giá hiện tại</p>
              <p className="mt-0.5 font-mono text-[11px] font-bold text-cyan-100">{formatPrice(currentPrice)}</p>
            </div>
            <div className="rounded-lg border border-white/[0.05] bg-white/[0.02] px-2.5 py-2">
              <p className="text-[8px] uppercase tracking-wide text-slate-600">P/L đã chốt</p>
              <p className={cn(
                "mt-0.5 font-mono text-[11px] font-bold",
                summary.totalRealizedPnl > 0 ? "text-emerald-300" : summary.totalRealizedPnl < 0 ? "text-rose-300" : "text-slate-300",
              )}>
                {formatVndFromKvnd(summary.totalRealizedPnl)}
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-white/[0.06] bg-black/20">
            <div className="border-b border-white/[0.05] px-2.5 py-2 text-[8px] font-black uppercase tracking-[0.12em] text-slate-600">
              Giao dịch gần đây
            </div>
            <div className="divide-y divide-white/[0.05]">
              {recentTransactions.map((transaction) => (
                <div key={transaction.id} className="flex items-center justify-between gap-2 px-2.5 py-2 text-[9px]">
                  <div className="min-w-0">
                    <span className={cn(
                      "font-bold",
                      transaction.action === "buy" || transaction.action === "rights"
                        ? "text-emerald-300"
                        : transaction.action === "sell"
                        ? "text-rose-300"
                        : "text-slate-300",
                    )}>
                      {actionLabel(transaction.action)}
                    </span>
                    <span className="ml-2 font-mono text-slate-500">
                      {transaction.quantity.toLocaleString("vi-VN")} @ {formatPrice(transaction.price)}
                    </span>
                  </div>
                  <span className="shrink-0 font-mono text-[8px] text-slate-600">
                    {transaction.transaction_date}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="rounded-lg border border-amber-400/15 bg-amber-400/[0.04] px-2.5 py-2 text-[9px] leading-4 text-amber-100/75">
          {error}
        </p>
      ) : null}
    </div>
  )
}
