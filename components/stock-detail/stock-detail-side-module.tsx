"use client"

import { useState, type ReactNode } from "react"
import { Bot, NotebookPen, WalletCards } from "lucide-react"

import { cn } from "@/modules/shared/ui/cn"

import { StockNotesPanel } from "./stock-notes-panel"
import { StockPortfolioPanel } from "./stock-portfolio-panel"

type StockDetailModuleTab = "ai" | "notes" | "portfolio"

const TABS: Array<{
  value: StockDetailModuleTab
  label: string
  icon: typeof Bot
}> = [
  { value: "ai", label: "AI Q&A", icon: Bot },
  { value: "notes", label: "Ghi chú", icon: NotebookPen },
  { value: "portfolio", label: "Portfolio", icon: WalletCards },
]

export function StockDetailSideModule({
  ticker,
  currentPrice,
  qna,
}: {
  ticker: string
  currentPrice: number
  qna: ReactNode
}) {
  const [activeTab, setActiveTab] = useState<StockDetailModuleTab>("ai")
  const [visitedTabs, setVisitedTabs] = useState({ notes: false, portfolio: false })

  function selectTab(tab: StockDetailModuleTab) {
    setActiveTab(tab)
    if (tab === "notes") setVisitedTabs((current) => ({ ...current, notes: true }))
    if (tab === "portfolio") setVisitedTabs((current) => ({ ...current, portfolio: true }))
  }

  return (
    <section
      data-stock-detail-side-module
      className="flex flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-[#080d13]"
    >
      <div className="border-b border-white/[0.06] bg-[#0a0f16] p-2">
        <div className="flex items-center gap-1">
          <div
            role="tablist"
            aria-label="Stock Detail tools"
            className="grid min-w-0 flex-1 grid-cols-3 gap-1 rounded-xl border border-white/[0.06] bg-black/20 p-1"
          >
            {TABS.map((tab) => {
              const Icon = tab.icon
              const selected = activeTab === tab.value
              return (
                <button
                  key={tab.value}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => selectTab(tab.value)}
                  className={cn(
                    "flex min-w-0 items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-[10px] font-bold transition-colors",
                    selected
                      ? "border border-cyan-400/25 bg-cyan-400/10 text-cyan-100 shadow-[0_0_14px_rgba(34,211,238,0.08)]"
                      : "border border-transparent text-slate-500 hover:bg-white/[0.04] hover:text-slate-300",
                  )}
                >
                  <Icon className={cn("size-3.5 shrink-0", selected && "text-cyan-400")} />
                  <span className="truncate">{tab.label}</span>
                </button>
              )
            })}
          </div>

          <span className="shrink-0 rounded-full border border-white/[0.08] bg-black/20 px-2 py-1 font-mono text-[9px] font-bold text-slate-400">
            {ticker}
          </span>
        </div>
      </div>

      <div role="tabpanel" hidden={activeTab !== "ai"}>
        {qna}
      </div>
      {visitedTabs.notes ? (
        <div role="tabpanel" hidden={activeTab !== "notes"}>
          <StockNotesPanel key={ticker} ticker={ticker} />
        </div>
      ) : null}
      {visitedTabs.portfolio ? (
        <div role="tabpanel" hidden={activeTab !== "portfolio"}>
          <StockPortfolioPanel ticker={ticker} currentPrice={currentPrice} />
        </div>
      ) : null}
    </section>
  )
}
