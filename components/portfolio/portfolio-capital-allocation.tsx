"use client"

import React, { useState, useMemo, memo } from "react"
import { Calculator, ShieldCheck, PieChart, ArrowRight, TrendingDown, DollarSign } from "lucide-react"

import { Input } from "@/components/ui/input"
import { PortfolioPosition } from "@/lib/portfolio/pnl"
import { PortfolioMeta } from "@/components/portfolio/portfolio-selector"
import { cn } from "@/lib/utils"

interface PortfolioCapitalAllocationProps {
  portfolios: PortfolioMeta[]
  activePortfolioId: string
  positions: PortfolioPosition[]
  currentPrices: Record<string, number>
}

function formatVNDFull(vnd: number): string {
  if (isNaN(vnd)) return "0 VNĐ"
  return `${Math.round(vnd).toLocaleString("vi-VN")} VNĐ`
}

function formatShortVND(vnd: number): string {
  const abs = Math.abs(vnd)
  if (abs >= 1_000_000_000) return `${(vnd / 1_000_000_000).toFixed(2)} tỷ`
  if (abs >= 1_000_000) return `${(vnd / 1_000_000).toFixed(1)} tr`
  return `${vnd.toLocaleString("vi-VN")} đ`
}

export const PortfolioCapitalAllocation = memo(function PortfolioCapitalAllocation({
  portfolios,
  activePortfolioId,
  positions,
  currentPrices,
}: PortfolioCapitalAllocationProps) {
  const activePortfolio = portfolios.find((p) => p.id === activePortfolioId)

  // ── Inputs for Panel 1 ──
  const [initialCapitalInput, setInitialCapitalInput] = useState<string>(() => {
    return activePortfolio?.initial_capital && activePortfolio.initial_capital > 0
      ? String(activePortfolio.initial_capital)
      : "500000000" // 500 triệu mặc định
  })
  const [accountRiskPct, setAccountRiskPct] = useState<string>("1.5") // 1.5% NAV
  const [dealStopLossPct, setDealStopLossPct] = useState<string>("7.0") // 7% Stoploss deal
  const [entryPriceInput, setEntryPriceInput] = useState<string>("25.0") // 25.0 k₫
  const [useMargin, setUseMargin] = useState<boolean>(false)
  const [marginRatio, setMarginRatio] = useState<string>("50") // 50% margin

  // ── 1. Calculate Current Portfolio State (Panel 2) ──
  const capital = parseFloat(initialCapitalInput) || 0
  const accRisk = parseFloat(accountRiskPct) || 1.5
  const dealSL = parseFloat(dealStopLossPct) || 7.0
  const entryPrice = parseFloat(entryPriceInput) || 0

  // Total stock cost basis in current portfolio (k₫ * 1000 = VNĐ)
  const totalStockCostBasis = useMemo(() => {
    return positions.reduce((sum, p) => sum + p.totalInvested * 1000, 0)
  }, [positions])

  // Total realized P&L (k₫ * 1000 = VNĐ)
  const totalRealizedPnl = useMemo(() => {
    return positions.reduce((sum, p) => sum + p.realizedPnl * 1000, 0)
  }, [positions])

  // Current market value of stocks
  const totalStockMarketValue = useMemo(() => {
    return positions.reduce((sum, p) => {
      const price = currentPrices[p.ticker] ?? p.avgCost
      return sum + price * p.openQty * 1000
    }, 0)
  }, [positions, currentPrices])

  // Available cash = Initial Capital + Realized PnL - Stock Cost Basis
  const availableCash = Math.max(0, capital + totalRealizedPnl - totalStockCostBasis)
  const totalInvestedAsset = capital + totalRealizedPnl

  // ── 2. Position Sizing for Next Deal (Panel 1 & Panel 3) ──
  // Max loss allowed on account = Capital * (accRisk / 100)
  const maxRiskAmount = capital * (accRisk / 100)

  // Max capital allocated to deal = maxRiskAmount / (dealSL / 100)
  const allocatedDealCapital = dealSL > 0 ? maxRiskAmount / (dealSL / 100) : 0

  // Max shares = allocatedDealCapital / (entryPrice * 1000)
  const maxSharesAllowed = entryPrice > 0 ? Math.floor(allocatedDealCapital / (entryPrice * 1000)) : 0

  // Deal Funding Breakdown (Cash vs Margin)
  const dealCashUsed = Math.min(allocatedDealCapital, availableCash)
  const dealMarginUsed = Math.max(0, allocatedDealCapital - dealCashUsed)

  // ── 3. Simulated State After Next Deal (Panel 4) ──
  const simulatedStockCostBasis = totalStockCostBasis + allocatedDealCapital
  const simulatedAvailableCash = Math.max(0, availableCash - dealCashUsed)
  const simulatedMarginUsed = dealMarginUsed
  const simulatedMarginRatioOnCash =
    simulatedAvailableCash > 0 ? (simulatedMarginUsed / simulatedAvailableCash) * 100 : 0
  const simulatedMarginRatioOnStock =
    simulatedStockCostBasis > 0 ? (simulatedMarginUsed / simulatedStockCostBasis) * 100 : 0

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="rounded-2xl border border-[var(--color-border)] bg-gradient-to-r from-[#0d121c] via-[#101726] to-[#0d121c] p-5 shadow-lg">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-500/20 text-purple-400 border border-purple-500/30">
              <Calculator className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Quản trị Vị thế & Phân bổ Vốn (Position Sizing)</h2>
              <p className="text-xs text-[var(--color-muted-2)]">
                Quy tắc bảo vệ tài khoản: Không bao giờ rủi ro quá 1-2% tổng NAV trên một giao dịch bất kỳ.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="rounded-xl border border-[var(--color-border)] bg-black/40 px-3.5 py-1.5 text-right">
              <div className="text-[10px] text-[var(--color-muted-2)] uppercase">Vốn danh mục</div>
              <div className="font-ticker text-sm font-bold text-white">{formatShortVND(capital)}</div>
            </div>
            <div className="rounded-xl border border-[var(--color-border)] bg-black/40 px-3.5 py-1.5 text-right">
              <div className="text-[10px] text-[var(--color-muted-2)] uppercase">Tiền mặt khả dụng</div>
              <div className="font-ticker text-sm font-bold text-[var(--color-up)]">{formatShortVND(availableCash)}</div>
            </div>
          </div>
        </div>
      </div>

      {/* 4-Panel Grid (Matching Screenshot 4) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ── PANEL 1: Phân bổ vốn theo % cắt lỗ trên tài sản ── */}
        <div className="rounded-2xl border border-[var(--color-border)] bg-[#0b0f13] p-5 space-y-4 shadow-sm">
          <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-purple-300 flex items-center gap-1.5">
              <ShieldCheck className="h-4 w-4" /> 1. Phân bổ vốn theo % cắt lỗ trên tài sản
            </h3>
            <span className="font-ticker text-xs font-semibold text-purple-400 bg-purple-500/10 px-2 py-0.5 rounded border border-purple-500/20">
              Công thức Rủi ro Cố định
            </span>
          </div>

          <div className="space-y-3.5 text-xs">
            {/* Vốn ban đầu */}
            <div className="grid grid-cols-1 sm:grid-cols-[180px_1fr] items-center gap-2">
              <label className="text-[var(--color-muted-2)]">Vốn danh mục (VNĐ)</label>
              <Input
                type="number"
                step="10000000"
                value={initialCapitalInput}
                onChange={(e) => setInitialCapitalInput(e.target.value)}
                className="font-ticker text-xs font-bold text-white bg-black/40"
              />
            </div>

            {/* % Cắt lỗ tối đa trên tổng tài sản */}
            <div className="grid grid-cols-1 sm:grid-cols-[180px_1fr] items-center gap-2">
              <label className="text-[var(--color-muted-2)]">% Cắt lỗ tối đa trên NAV</label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  step="0.1"
                  min="0.1"
                  max="10"
                  value={accountRiskPct}
                  onChange={(e) => setAccountRiskPct(e.target.value)}
                  className="font-ticker text-xs font-bold text-[var(--color-down)] bg-black/40"
                />
                <span className="text-[var(--color-muted-2)] font-ticker">%</span>
              </div>
            </div>

            {/* Giá trị cắt lỗ tối đa trên tổng tài sản */}
            <div className="grid grid-cols-1 sm:grid-cols-[180px_1fr] items-center gap-2">
              <label className="text-[var(--color-muted-2)]">Mức lỗ tối đa cho phép</label>
              <div className="font-ticker text-xs font-bold text-[var(--color-down)] bg-rose-500/10 px-3 py-2 rounded-md border border-rose-500/20">
                {formatVNDFull(maxRiskAmount)} ({accountRiskPct}% NAV)
              </div>
            </div>

            {/* % Cắt lỗ trên deal tiếp theo */}
            <div className="grid grid-cols-1 sm:grid-cols-[180px_1fr] items-center gap-2">
              <label className="text-[var(--color-muted-2)]">% Cắt lỗ deal tiếp theo</label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  step="0.5"
                  min="1"
                  max="50"
                  value={dealStopLossPct}
                  onChange={(e) => setDealStopLossPct(e.target.value)}
                  className="font-ticker text-xs font-bold text-amber-400 bg-black/40"
                />
                <span className="text-[var(--color-muted-2)] font-ticker">%</span>
              </div>
            </div>

            {/* Giá dự kiến mua (k₫) */}
            <div className="grid grid-cols-1 sm:grid-cols-[180px_1fr] items-center gap-2">
              <label className="text-[var(--color-muted-2)]">Giá dự kiến mua (k₫)</label>
              <Input
                type="number"
                step="0.1"
                value={entryPriceInput}
                onChange={(e) => setEntryPriceInput(e.target.value)}
                placeholder="VD: 25.0"
                className="font-ticker text-xs bg-black/40"
              />
            </div>

            {/* KẾT QUẢ PHÂN BỔ VỐN */}
            <div className="rounded-xl border border-purple-500/30 bg-purple-500/10 p-3.5 space-y-2 mt-4">
              <div className="flex items-center justify-between">
                <span className="font-bold text-purple-200 text-xs uppercase">Vốn giải ngân tối đa cho deal:</span>
                <span className="font-ticker text-sm font-extrabold text-white">
                  {formatVNDFull(allocatedDealCapital)}
                </span>
              </div>
              <div className="flex items-center justify-between text-[11px] text-purple-300">
                <span>Tỷ trọng trên NAV:</span>
                <span className="font-ticker font-bold">
                  {capital > 0 ? ((allocatedDealCapital / capital) * 100).toFixed(1) : 0}% NAV
                </span>
              </div>
              {entryPrice > 0 && (
                <div className="flex items-center justify-between text-[11px] text-purple-300 border-t border-purple-500/20 pt-1.5">
                  <span>Khối lượng cổ phiếu tối đa:</span>
                  <span className="font-ticker font-bold text-white">
                    {maxSharesAllowed.toLocaleString("vi-VN")} CP
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── PANEL 2: Trạng thái danh mục hiện tại ── */}
        <div className="rounded-2xl border border-[var(--color-border)] bg-[#0b0f13] p-5 space-y-4 shadow-sm">
          <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200 flex items-center gap-1.5">
              <PieChart className="h-4 w-4 text-blue-400" /> 2. Trạng thái danh mục hiện tại
            </h3>
            <span className="font-ticker text-xs text-[var(--color-muted-2)]">
              {positions.length} mã nắm giữ
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-[1fr_120px] gap-4 items-center">
            <div className="space-y-2 text-xs font-ticker">
              <div className="flex justify-between py-1 border-b border-white/5">
                <span className="text-[var(--color-muted-2)]">Vốn ban đầu:</span>
                <span className="text-white font-medium">{formatVNDFull(capital)}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-white/5">
                <span className="text-[var(--color-muted-2)]">Lãi/lỗ đã thực hiện:</span>
                <span className={cn("font-medium", totalRealizedPnl >= 0 ? "text-[var(--color-up)]" : "text-[var(--color-down)]")}>
                  {totalRealizedPnl >= 0 ? "+" : ""}{formatVNDFull(totalRealizedPnl)}
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-white/5">
                <span className="text-[var(--color-muted-2)]">Vốn khả dụng (Tiền mặt):</span>
                <span className="text-[var(--color-up)] font-bold">{formatVNDFull(availableCash)}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-white/5">
                <span className="text-[var(--color-muted-2)]">Giá vốn chứng khoán:</span>
                <span className="text-blue-400 font-medium">{formatVNDFull(totalStockCostBasis)}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-white/5">
                <span className="text-[var(--color-muted-2)]">Giá trị thị trường CK:</span>
                <span className="text-white font-medium">{formatVNDFull(totalStockMarketValue)}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-white/5">
                <span className="text-[var(--color-muted-2)]">Margin đang sử dụng:</span>
                <span className="text-white font-medium">0 VNĐ</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-[var(--color-muted-2)]">Tỷ lệ Cổ phiếu / NAV:</span>
                <span className="text-white font-bold">
                  {capital > 0 ? ((totalStockCostBasis / capital) * 100).toFixed(1) : 0}%
                </span>
              </div>
            </div>

            {/* Mini Donut Chart */}
            <div className="flex flex-col items-center justify-center text-center">
              <MiniAllocationDonut
                cash={availableCash}
                stock={totalStockCostBasis}
                total={capital + totalRealizedPnl}
              />
              <span className="text-[10px] text-[var(--color-muted-2)] mt-2">Phân bổ hiện tại</span>
            </div>
          </div>
        </div>

        {/* ── PANEL 3: Deal tiếp theo ── */}
        <div className="rounded-2xl border border-[var(--color-border)] bg-[#0b0f13] p-5 space-y-4 shadow-sm">
          <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-amber-300 flex items-center gap-1.5">
              <TrendingDown className="h-4 w-4" /> 3. Kế hoạch Deal tiếp theo
            </h3>
            <span className="font-ticker text-xs font-semibold text-amber-400">
              Giải ngân: {formatShortVND(allocatedDealCapital)}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-[1fr_120px] gap-4 items-center">
            <div className="space-y-2.5 text-xs font-ticker">
              <div className="flex justify-between py-1 border-b border-white/5">
                <span className="text-[var(--color-muted-2)]">Giá vốn cho deal tiếp theo:</span>
                <span className="text-white font-bold">{formatVNDFull(allocatedDealCapital)}</span>
              </div>
              <div className="pl-3 space-y-1.5 text-[11px] border-l-2 border-amber-500/30">
                <div className="flex justify-between">
                  <span className="text-[var(--color-muted-2)]">• Tiền mặt:</span>
                  <span className="text-[var(--color-up)] font-medium">
                    {formatVNDFull(dealCashUsed)} ({allocatedDealCapital > 0 ? ((dealCashUsed / allocatedDealCapital) * 100).toFixed(0) : 0}%)
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--color-muted-2)]">• Vay Margin:</span>
                  <span className="text-amber-400 font-medium">
                    {formatVNDFull(dealMarginUsed)} ({allocatedDealCapital > 0 ? ((dealMarginUsed / allocatedDealCapital) * 100).toFixed(0) : 0}%)
                  </span>
                </div>
              </div>
              <div className="flex justify-between py-1 text-[11px] text-[var(--color-muted-2)] pt-1">
                <span>Rủi ro tối đa nếu cắt lỗ {dealSL}%:</span>
                <span className="font-bold text-[var(--color-down)]">-{formatShortVND(maxRiskAmount)}</span>
              </div>
            </div>

            {/* Mini Donut Chart for Deal */}
            <div className="flex flex-col items-center justify-center text-center">
              <MiniAllocationDonut
                cash={dealCashUsed}
                stock={dealMarginUsed}
                total={allocatedDealCapital}
                label1="Tiền"
                label2="Margin"
              />
              <span className="text-[10px] text-[var(--color-muted-2)] mt-2">Nguồn vốn deal</span>
            </div>
          </div>
        </div>

        {/* ── PANEL 4: Trạng thái danh mục khi có deal tiếp theo ── */}
        <div className="rounded-2xl border border-[var(--color-border)] bg-[#0b0f13] p-5 space-y-4 shadow-sm">
          <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-emerald-300 flex items-center gap-1.5">
              <ArrowRight className="h-4 w-4" /> 4. Trạng thái danh mục sau khi khớp deal
            </h3>
            <span className="font-ticker text-xs font-semibold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
              Giả lập Sau giải ngân
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-[1fr_120px] gap-4 items-center">
            <div className="space-y-2 text-xs font-ticker">
              <div className="flex justify-between py-1 border-b border-white/5">
                <span className="text-[var(--color-muted-2)]">Vốn khả dụng còn lại:</span>
                <span className="text-[var(--color-up)] font-bold">{formatVNDFull(simulatedAvailableCash)}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-white/5">
                <span className="text-[var(--color-muted-2)]">Tổng giá vốn cổ phiếu mới:</span>
                <span className="text-blue-400 font-bold">{formatVNDFull(simulatedStockCostBasis)}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-white/5">
                <span className="text-[var(--color-muted-2)]">Margin đang sử dụng:</span>
                <span className={cn("font-medium", simulatedMarginUsed > 0 ? "text-amber-400" : "text-white")}>
                  {formatVNDFull(simulatedMarginUsed)}
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-white/5">
                <span className="text-[var(--color-muted-2)]">Tỷ lệ Cổ phiếu / Vốn:</span>
                <span className="text-white font-bold">
                  {capital > 0 ? ((simulatedStockCostBasis / capital) * 100).toFixed(1) : 0}%
                </span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-[var(--color-muted-2)]">Trạng thái an toàn:</span>
                <span className={cn("font-bold", simulatedMarginUsed === 0 ? "text-[var(--color-up)]" : "text-amber-400")}>
                  {simulatedMarginUsed === 0 ? "✓ 100% Tiền thật (An toàn)" : "! Có sử dụng Margin"}
                </span>
              </div>
            </div>

            {/* Simulated Donut Chart */}
            <div className="flex flex-col items-center justify-center text-center">
              <MiniAllocationDonut
                cash={simulatedAvailableCash}
                stock={simulatedStockCostBasis}
                total={capital + totalRealizedPnl + simulatedMarginUsed}
              />
              <span className="text-[10px] text-[var(--color-muted-2)] mt-2">Phân bổ sau deal</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
})

// ─────────────────────────────────────────────────────────────
// Mini Donut Chart Component (Pure SVG)
// ─────────────────────────────────────────────────────────────

interface MiniAllocationDonutProps {
  cash: number
  stock: number
  total: number
  label1?: string
  label2?: string
}

const MiniAllocationDonut = memo(function MiniAllocationDonut({
  cash,
  stock,
  total,
  label1 = "Tiền",
  label2 = "CP",
}: MiniAllocationDonutProps) {
  const size = 96
  const strokeWidth = 14
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius

  const safeTotal = total > 0 ? total : 1
  const cashPct = Math.min(100, Math.max(0, (cash / safeTotal) * 100))
  const stockPct = 100 - cashPct

  return (
    <div className="relative flex items-center justify-center">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        {/* Background circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="#1b222c"
          strokeWidth={strokeWidth}
        />
        {/* Cash circle (Emerald) */}
        {cashPct > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="#22c98a"
            strokeWidth={strokeWidth}
            strokeDasharray={circumference}
            strokeDashoffset={circumference - (circumference * cashPct) / 100}
          />
        )}
        {/* Stock circle (Blue) */}
        {stockPct > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="#3b82f6"
            strokeWidth={strokeWidth}
            strokeDasharray={circumference}
            strokeDashoffset={circumference - (circumference * stockPct) / 100}
            style={{ transform: `rotate(${(cashPct / 100) * 360}deg)`, transformOrigin: "center" }}
          />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none">
        <span className="font-ticker text-[10px] font-bold text-white">{stockPct.toFixed(0)}%</span>
        <span className="text-[8px] text-[var(--color-muted-2)]">{label2}</span>
      </div>
    </div>
  )
})
