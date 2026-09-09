"use client"

import { BookOpen, Plus, RefreshCw } from "lucide-react"

import { Button } from "@/components/ui/button"

export type PortfolioCommandActionsProps = {
  onGuidance: () => void
  onRefresh: () => void
  onAddTransaction: () => void
  refreshing?: boolean
}

export function PortfolioCommandActions({
  onGuidance,
  onRefresh,
  onAddTransaction,
  refreshing = false,
}: PortfolioCommandActionsProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        variant="ghost"
        onClick={onGuidance}
        className="h-9 gap-2 rounded-full border border-violet-400/25 bg-violet-400/10 px-3.5 text-sm font-semibold text-violet-200 hover:bg-violet-400/15 hover:text-violet-100"
      >
        <BookOpen className="h-4 w-4" />
        Hướng dẫn
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={onRefresh}
        disabled={refreshing}
        className="h-9 gap-2 rounded-full px-3.5 text-sm font-semibold text-slate-300 hover:bg-white/[0.06] hover:text-white"
      >
        <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
        {refreshing ? "Đang làm mới" : "Làm mới"}
      </Button>
      <Button
        size="sm"
        onClick={onAddTransaction}
        className="h-9 gap-2 rounded-full bg-gradient-to-r from-violet-600 to-indigo-600 px-4 text-sm font-bold text-white shadow-[0_0_18px_rgba(124,58,237,0.28)] hover:from-violet-500 hover:to-indigo-500"
      >
        <Plus className="h-4 w-4" />
        Thêm giao dịch
      </Button>
    </div>
  )
}
