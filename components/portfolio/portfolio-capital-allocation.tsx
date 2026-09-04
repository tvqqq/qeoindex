"use client"

import React, { useState, useMemo, memo } from "react"
import { ShieldCheck, PieChart, ArrowRight, TrendingDown, DollarSign } from "lucide-react"

import { Input } from "@/components/ui/input"
import { PortfolioPosition } from "@/modules/portfolio/pnl"
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

  return (
    <div className="space-y-6 font-ticker">
      {/* Overview Banner */}
      <div className="rounded-3xl border border-[#2a2e40] bg-gradient-to-br from-[#121522] via-[#0d1017] to-[#0d1017] p-6 shadow-md">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="font-ticker text-lg sm:text-xl font-extrabold text-white tracking-tight flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-purple-400" />
              Công Cụ Phân Bổ Vốn & <span className="italic text-purple-300">Quản Trị Rủi Ro Cố Định</span>
            </h2>
            <p className="mt-1 font-ticker text-xs sm:text-sm text-[var(--color-muted-2)] font-medium">
              Tính toán quy mô vị thế <span className="font-bold text-slate-200 italic">(Position Sizing)</span> dựa trên % rủi ro danh mục (1–2% NAV) nhằm triệt tiêu hoàn toàn nguy cơ cháy tài khoản.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="rounded-2xl border border-white/[0.08] bg-black/40 px-4 py-2 text-right">
              <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--color-muted-2)] block">
                Vốn danh mục
              </span>
              <span className="font-ticker text-base sm:text-lg font-black text-white">
                {formatShortVND(capital)}
              </span>
            </div>
            <div className="rounded-2xl border border-purple-500/30 bg-purple-500/10 px-4 py-2 text-right">
              <span className="text-[11px] font-bold uppercase tracking-wider text-purple-300 block">
                Tiền khả dụng
              </span>
              <span className="font-ticker text-base sm:text-lg font-black text-[var(--color-up)]">
                {formatShortVND(availableCash)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 4-Panel Grid (Matching Screenshot 4) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ── PANEL 1: Phân bổ vốn theo % cắt lỗ trên tài sản ── */}
        <div className="rounded-3xl border border-[#2a2e40] bg-[#0c1017] p-6 space-y-4 shadow-sm">
          <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-3.5">
            <h3 className="font-ticker text-sm sm:text-base font-extrabold uppercase tracking-wide text-purple-300 flex items-center gap-2">
              <ShieldCheck className="h-4 w-4" /> 1. Phân bổ vốn theo % cắt lỗ NAV
            </h3>
            <span className="font-ticker text-xs font-bold text-purple-300 bg-purple-500/15 px-2.5 py-1 rounded-full border border-purple-500/30">
              Fixed Account Risk
            </span>
          </div>

          <div className="space-y-4 text-xs">
            {/* Vốn ban đầu */}
            <div className="grid grid-cols-1 sm:grid-cols-[190px_1fr] items-center gap-2">
              <label className="font-semibold text-slate-300">Vốn danh mục (VNĐ)</label>
              <Input
                type="number"
                step="10000000"
                value={initialCapitalInput}
                onChange={(e) => setInitialCapitalInput(e.target.value)}
                className="font-ticker text-xs sm:text-sm font-bold text-white bg-black/40 h-9"
              />
            </div>

            {/* % Cắt lỗ tối đa trên tổng tài sản */}
            <div className="grid grid-cols-1 sm:grid-cols-[190px_1fr] items-center gap-2">
              <label className="font-semibold text-slate-300">% Cắt lỗ tối đa trên NAV</label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  step="0.1"
                  min="0.1"
                  max="10"
                  value={accountRiskPct}
                  onChange={(e) => setAccountRiskPct(e.target.value)}
                  className="font-ticker text-xs sm:text-sm font-bold text-[var(--color-down)] bg-black/40 h-9"
                />
                <span className="text-[var(--color-muted-2)] font-ticker font-bold">%</span>
              </div>
            </div>

            {/* Giá trị cắt lỗ tối đa trên tổng tài sản */}
            <div className="grid grid-cols-1 sm:grid-cols-[190px_1fr] items-center gap-2">
              <label className="font-semibold text-slate-300">Mức lỗ tối đa cho phép</label>
              <div className="font-ticker text-xs sm:text-sm font-black text-[var(--color-down)] bg-rose-500/10 px-3.5 py-2 rounded-xl border border-rose-500/20">
                {formatVNDFull(maxRiskAmount)} <span className="font-normal text-[11px] italic">({accountRiskPct}% NAV)</span>
              </div>
            </div>

            {/* % Cắt lỗ trên deal tiếp theo */}
            <div className="grid grid-cols-1 sm:grid-cols-[190px_1fr] items-center gap-2">
              <label className="font-semibold text-slate-300">% Cắt lỗ deal tiếp theo</label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  step="0.5"
                  min="1"
                  max="50"
                  value={dealStopLossPct}
                  onChange={(e) => setDealStopLossPct(e.target.value)}
                  className="font-ticker text-xs sm:text-sm font-bold text-amber-400 bg-black/40 h-9"
                />
                <span className="text-[var(--color-muted-2)] font-ticker font-bold">%</span>
              </div>
            </div>

            {/* Giá dự kiến mua (k₫) */}
            <div className="grid grid-cols-1 sm:grid-cols-[190px_1fr] items-center gap-2">
              <label className="font-semibold text-slate-300">Giá dự kiến mua (k₫)</label>
              <Input
                type="number"
                step="0.1"
                value={entryPriceInput}
                onChange={(e) => setEntryPriceInput(e.target.value)}
                placeholder="VD: 25.0"
                className="font-ticker text-xs sm:text-sm font-bold bg-black/40 h-9"
              />
            </div>

            {/* KẾT QUẢ PHÂN BỔ VỐN */}
            <div className="rounded-2xl border border-purple-500/40 bg-gradient-to-r from-purple-900/20 to-indigo-900/20 p-4 space-y-2.5 mt-4 shadow-inner">
              <div className="flex items-center justify-between">
                <span className="font-extrabold text-purple-200 text-xs sm:text-sm uppercase tracking-wide">
                  Vốn giải ngân tối đa deal này:
                </span>
                <span className="font-ticker text-base sm:text-lg font-black text-white">
                  {formatVNDFull(allocatedDealCapital)}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs text-purple-300">
                <span className="font-medium">Tỷ trọng an toàn trên NAV:</span>
                <span className="font-ticker font-black text-white italic">
                  {capital > 0 ? ((allocatedDealCapital / capital) * 100).toFixed(1) : 0}% NAV
                </span>
              </div>
              {entryPrice > 0 && (
                <div className="flex items-center justify-between text-xs text-purple-300 border-t border-purple-500/20 pt-2">
                  <span className="font-medium">Số lượng CP tối đa được mua:</span>
                  <span className="font-ticker font-black text-[var(--color-up)] text-sm">
                    {maxSharesAllowed.toLocaleString("vi-VN")} CP
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── PANEL 2: Trạng thái danh mục hiện tại ── */}
        <div className="rounded-3xl border border-[#2a2e40] bg-[#0c1017] p-6 space-y-4 shadow-sm">
          <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-3.5">
            <h3 className="font-ticker text-sm sm:text-base font-extrabold uppercase tracking-wide text-slate-200 flex items-center gap-2">
              <PieChart className="h-4 w-4 text-blue-400" /> 2. Trạng thái danh mục hiện tại
            </h3>
            <span className="font-ticker text-xs font-bold text-[var(--color-muted-2)]">
              {positions.length} mã nắm giữ
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-[1fr_130px] gap-4 items-center">
            <div className="space-y-2.5 text-xs font-ticker">
              <div className="flex justify-between py-1 border-b border-white/5">
                <span className="text-[var(--color-muted-2)]">Vốn ban đầu:</span>
                <span className="font-bold text-white">{formatVNDFull(capital)}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-white/5">
                <span className="text-[var(--color-muted-2)]">Lãi/lỗ đã chốt:</span>
                <span
                  className={cn(
                    "font-bold",
                    totalRealizedPnl > 0
                      ? "text-[var(--color-up)]"
                      : totalRealizedPnl < 0
                      ? "text-[var(--color-down)]"
                      : "text-white",
                  )}
                >
                  {totalRealizedPnl > 0 ? "+" : ""}
                  {formatVNDFull(totalRealizedPnl)}
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-white/5">
                <span className="text-[var(--color-muted-2)]">Vốn khả dụng (Tiền mặt):</span>
                <span className="font-black text-[var(--color-up)]">{formatVNDFull(availableCash)}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-white/5">
                <span className="text-[var(--color-muted-2)]">Giá vốn cổ phiếu đang nắm:</span>
                <span className="font-bold text-slate-300">{formatVNDFull(totalStockCostBasis)}</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-[var(--color-muted-2)]">Giá trị thị trường cổ phiếu:</span>
                <span className="font-black text-purple-300">{formatVNDFull(totalStockMarketValue)}</span>
              </div>
            </div>

            {/* Donut Chart: Tiền mặt vs Cổ phiếu */}
            <div className="flex flex-col items-center justify-center p-2 rounded-2xl bg-black/30 border border-white/5">
              <MiniAllocationDonut
                cash={availableCash}
                total={capital + totalRealizedPnl}
                size={90}
              />
              <div className="mt-2 text-center text-[10px] space-y-0.5">
                <div className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-emerald-400" />
                  <span className="text-slate-300">Tiền mặt</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-indigo-500" />
                  <span className="text-slate-300">Cổ phiếu</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── PANEL 3: Deal tiếp theo ── */}
        <div className="rounded-3xl border border-[#2a2e40] bg-[#0c1017] p-6 space-y-4 shadow-sm">
          <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-3.5">
            <h3 className="font-ticker text-sm sm:text-base font-extrabold uppercase tracking-wide text-amber-300 flex items-center gap-2">
              <ArrowRight className="h-4 w-4" /> 3. Nguồn vốn deal tiếp theo
            </h3>
            <span className="font-ticker text-xs font-bold text-amber-400 bg-amber-500/15 px-2.5 py-1 rounded-full border border-amber-500/30">
              Kế hoạch giải ngân
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-[1fr_130px] gap-4 items-center">
            <div className="space-y-2.5 text-xs font-ticker">
              <div className="flex justify-between py-1 border-b border-white/5">
                <span className="text-[var(--color-muted-2)]">Giá vốn deal tiếp theo:</span>
                <span className="font-black text-white">{formatVNDFull(allocatedDealCapital)}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-white/5">
                <span className="text-[var(--color-muted-2)]">Nguồn Tiền mặt:</span>
                <span className="font-bold text-[var(--color-up)]">{formatVNDFull(dealCashUsed)}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-white/5">
                <span className="text-[var(--color-muted-2)]">Nguồn Vay ký quỹ (Margin):</span>
                <span
                  className={cn(
                    "font-bold",
                    dealMarginUsed > 0 ? "text-amber-400" : "text-[var(--color-muted-2)]",
                  )}
                >
                  {formatVNDFull(dealMarginUsed)}
                </span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-[var(--color-muted-2)]">Tỷ lệ Vay trên deal mới:</span>
                <span className="font-bold text-slate-300">
                  {allocatedDealCapital > 0
                    ? ((dealMarginUsed / allocatedDealCapital) * 100).toFixed(1)
                    : 0}
                  %
                </span>
              </div>
            </div>

            {/* Donut Chart: Tiền mặt vs Margin */}
            <div className="flex flex-col items-center justify-center p-2 rounded-2xl bg-black/30 border border-white/5">
              <MiniAllocationDonut
                cash={dealCashUsed}
                total={allocatedDealCapital > 0 ? allocatedDealCapital : 1}
                size={90}
              />
              <div className="mt-2 text-center text-[10px] space-y-0.5">
                <div className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-emerald-400" />
                  <span className="text-slate-300">Tiền mặt</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-indigo-500" />
                  <span className="text-slate-300">Margin</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── PANEL 4: Trạng thái danh mục khi có deal tiếp theo ── */}
        <div className="rounded-3xl border border-[#2a2e40] bg-[#0c1017] p-6 space-y-4 shadow-sm">
          <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-3.5">
            <h3 className="font-ticker text-sm sm:text-base font-extrabold uppercase tracking-wide text-emerald-300 flex items-center gap-2">
              <DollarSign className="h-4 w-4" /> 4. Giả lập danh mục sau giải ngân
            </h3>
            <span className="font-ticker text-xs font-bold text-emerald-400 bg-emerald-500/15 px-2.5 py-1 rounded-full border border-emerald-500/30">
              Kịch bản tương lai
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-[1fr_130px] gap-4 items-center">
            <div className="space-y-2.5 text-xs font-ticker">
              <div className="flex justify-between py-1 border-b border-white/5">
                <span className="text-[var(--color-muted-2)]">Tổng giá vốn CK sau deal:</span>
                <span className="font-black text-purple-300">
                  {formatVNDFull(simulatedStockCostBasis)}
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-white/5">
                <span className="text-[var(--color-muted-2)]">Tiền mặt còn lại:</span>
                <span className="font-bold text-[var(--color-up)]">
                  {formatVNDFull(simulatedAvailableCash)}
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-white/5">
                <span className="text-[var(--color-muted-2)]">Dư nợ Margin sử dụng:</span>
                <span
                  className={cn(
                    "font-bold",
                    simulatedMarginUsed > 0 ? "text-amber-400" : "text-[var(--color-muted-2)]",
                  )}
                >
                  {formatVNDFull(simulatedMarginUsed)}
                </span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-[var(--color-muted-2)]">Tỷ lệ Cổ phiếu / Vốn:</span>
                <span className="font-black text-white italic">
                  {capital > 0 ? ((simulatedStockCostBasis / capital) * 100).toFixed(1) : 0}% NAV
                </span>
              </div>
            </div>

            {/* Donut Chart: Tiền mặt vs Cổ phiếu sau deal */}
            <div className="flex flex-col items-center justify-center p-2 rounded-2xl bg-black/30 border border-white/5">
              <MiniAllocationDonut
                cash={simulatedAvailableCash}
                total={capital + totalRealizedPnl}
                size={90}
              />
              <div className="mt-2 text-center text-[10px] space-y-0.5">
                <div className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-emerald-400" />
                  <span className="text-slate-300">Tiền còn</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-indigo-500" />
                  <span className="text-slate-300">Cổ phiếu</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
})

// ─────────────────────────────────────────────────────────────
// Mini Allocation Donut (SVG)
// ─────────────────────────────────────────────────────────────

interface MiniAllocationDonutProps {
  cash: number
  total: number
  size?: number
}

const MiniAllocationDonut = memo(function MiniAllocationDonut({
  cash,
  total,
  size = 80,
}: MiniAllocationDonutProps) {
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
        {/* Stock slice (indigo) */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="#6366f1"
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={0}
        />
        {/* Cash slice (emerald) */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="#10b981"
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (stockPct / 100)}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="font-ticker text-[11px] font-black text-white">
          {cashPct.toFixed(0)}%
        </span>
        <span className="text-[8px] text-[var(--color-muted-2)] font-semibold">Tiền</span>
      </div>
    </div>
  )
})
