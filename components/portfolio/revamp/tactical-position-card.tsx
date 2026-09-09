"use client"

import Link from "next/link"
import { ArrowDownRight, ArrowUpRight, Minus, Plus } from "lucide-react"

import { Button } from "@/components/ui/button"
import { PortfolioCardMotion } from "@/components/portfolio/revamp/portfolio-motion"
import { PositionBattleRail } from "@/components/portfolio/revamp/position-battle-rail"
import { resolveTacticalPositionState, type TacticalPositionState } from "@/components/portfolio/revamp/tactical-status"
import { cn } from "@/modules/shared/ui/cn"

export interface TacticalPositionCardData {
  ticker: string
  openQty: number
  avgCost: number
  currentPrice: number
  marketValue: number
  unrealizedPnl: number
  unrealizedPnlPct: number
  targetPrice: number | null
  stopLoss: number | null
}

export interface TacticalPositionCardProps {
  position: TacticalPositionCardData
  onAddTransaction: (ticker?: string) => void
}

function formatValue(kVnd: number): string {
  const abs = Math.abs(kVnd)
  if (abs >= 1_000_000) return `${(kVnd / 1_000_000).toFixed(2)} tỷ`
  if (abs >= 1_000) return `${(kVnd / 1_000).toFixed(1)} tr`
  return `${kVnd.toLocaleString("vi-VN", { maximumFractionDigits: 1 })} k₫`
}

function stateLabel(state: TacticalPositionState): string {
  if (state === "MISSING_STOP") return "THIẾU STOP"
  if (state === "PROFIT") return "Đang lãi"
  if (state === "LOSS") return "Đang lỗ"
  if (state === "FLAT") return "Hòa vốn"
  if (state === "BREACH") return "Vượt giới hạn"
  if (state === "WARNING") return "Cảnh báo"
  return "Chưa xác định"
}

function stateClass(state: TacticalPositionState): string {
  if (state === "MISSING_STOP" || state === "WARNING") return "border-amber-400/25 bg-amber-400/10 text-amber-200"
  if (state === "LOSS" || state === "BREACH") return "border-red-400/25 bg-red-400/10 text-red-200"
  if (state === "PROFIT") return "border-emerald-400/25 bg-emerald-400/10 text-emerald-200"
  return "border-slate-400/20 bg-slate-400/[0.07] text-slate-300"
}

export function TacticalPositionCard({ position, onAddTransaction }: TacticalPositionCardProps) {
  const state = resolveTacticalPositionState({
    unrealizedPnl: position.unrealizedPnl,
    stopLoss: position.stopLoss,
  })
  const direction = position.unrealizedPnl > 0 ? "up" : position.unrealizedPnl < 0 ? "down" : "flat"

  return (
    <PortfolioCardMotion>
      <article className="h-full overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-white/[0.045] via-[#0d1118] to-[#090c12] shadow-[0_18px_55px_rgba(0,0,0,0.18)] transition-[border-color,box-shadow] duration-200 hover:border-violet-400/20 hover:shadow-[0_22px_70px_rgba(70,45,120,0.2)]">
        <div className="flex items-start justify-between gap-4 border-b border-white/[0.07] px-5 py-4">
          <div className="min-w-0">
            <Link
              href={`/insights/wyckoff?ticker=${position.ticker}`}
              prefetch={false}
              className="text-2xl font-black uppercase tracking-tight text-violet-200 transition-colors hover:text-violet-100"
            >
              {position.ticker}
            </Link>
            <p className="mt-1 text-sm text-slate-400">{position.openQty.toLocaleString("vi-VN")} cp đang nắm giữ</p>
          </div>
          <span className={cn("shrink-0 rounded-full border px-3 py-1 text-xs font-bold", stateClass(state))}>
            {stateLabel(state)}
          </span>
        </div>

        <div className="space-y-4 p-5">
          <div className="grid grid-cols-2 gap-3">
            <Fact label="Giá hiện tại" value={`${position.currentPrice.toFixed(1)} k₫`} prominent />
            <Fact label="Giá vốn AVCO" value={`${position.avgCost.toFixed(1)} k₫`} />
            <Fact label="Giá trị thị trường" value={formatValue(position.marketValue)} />
            <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] px-4 py-3">
              <p className="text-sm text-slate-500">Lãi/Lỗ tạm tính</p>
              <div className={cn(
                "mt-1 flex items-center gap-1.5 text-lg font-black tabular-nums",
                direction === "up" ? "text-[var(--color-up)]" : direction === "down" ? "text-[var(--color-down)]" : "text-slate-200",
              )}>
                {direction === "up" ? <ArrowUpRight className="h-4 w-4" /> : direction === "down" ? <ArrowDownRight className="h-4 w-4" /> : <Minus className="h-4 w-4" />}
                <span>{position.unrealizedPnl > 0 ? "+" : ""}{formatValue(position.unrealizedPnl)}</span>
              </div>
              <p className={cn(
                "mt-1 text-sm font-bold tabular-nums",
                direction === "up" ? "text-[var(--color-up)]" : direction === "down" ? "text-[var(--color-down)]" : "text-slate-400",
              )}>
                {position.unrealizedPnlPct > 0 ? "+" : ""}{position.unrealizedPnlPct.toFixed(2)}%
              </p>
            </div>
          </div>

          <PositionBattleRail
            currentPrice={position.currentPrice}
            stopLoss={position.stopLoss}
            targetPrice={position.targetPrice}
          />

          <Button
            type="button"
            variant="outline"
            onClick={() => onAddTransaction(position.ticker)}
            className="h-10 w-full rounded-xl border-violet-400/25 bg-violet-400/[0.08] text-sm font-bold text-violet-200 transition-[background-color,border-color,transform] duration-150 hover:-translate-y-0.5 hover:bg-violet-400/[0.14] hover:text-violet-100"
          >
            <Plus className="h-4 w-4" />
            + Lệnh
          </Button>
        </div>
      </article>
    </PortfolioCardMotion>
  )
}

function Fact({ label, value, prominent = false }: { label: string; value: string; prominent?: boolean }) {
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] px-4 py-3">
      <p className="text-sm text-slate-500">{label}</p>
      <p className={cn("mt-1 font-bold tabular-nums text-slate-200", prominent ? "text-xl text-white" : "text-base")}>{value}</p>
    </div>
  )
}
