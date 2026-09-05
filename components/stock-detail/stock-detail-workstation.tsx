"use client"

import React from "react"
import Link from "next/link"
import { ArrowLeft, ExternalLink, ShieldCheck } from "lucide-react"

import { StockAiSidebar } from "./stock-ai-sidebar"
import { StockCompanyHeader } from "./stock-company-header"
import { StockTradingViewChart } from "./stock-tradingview-chart"
import { StockTabsPanel } from "./stock-tabs-panel"
import { StockWatchlistSidebar } from "./stock-watchlist-sidebar"
import type { StockDetailData } from "./types"
import { TopNav } from "@/components/top-nav"

export function StockDetailWorkstation({ data }: { data: StockDetailData }) {
  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-[#06080a] text-[#e1e7ec]">
      {/* Top Bar Navigation */}
      <TopNav />

      {/* 3 Columns Master Layout (1 Screen Viewport) */}
      <main className="flex min-h-0 flex-1 w-full overflow-hidden bg-[#06080a]">
        {/* ========================================================= */}
        {/* COLUMN 1: BÊN TRÁI (25% WIDTH)                            */}
        {/* Góc nhìn AI + AI Council tổng quan + Quick Chatbox với AI */}
        {/* ========================================================= */}
        <StockAiSidebar data={data} />

        {/* ========================================================= */}
        {/* COLUMN 2: GIỮA (60% WIDTH)                                */}
        {/* Thông tin công ty (cố định) + TradingView chart (cố định)  */}
        {/* + Cụm 4 Tabs: Tổng quan, DN, Phân tích TA, AI Council chi tiết */}
        {/* ========================================================= */}
        <section className="flex flex-1 min-w-0 flex-col h-full overflow-hidden bg-[#06080a]">
          {/* Cố định phần trên: Thông tin công ty */}
          <StockCompanyHeader data={data} />

          {/* Cố định phần trên: TradingView Light Chart */}
          <StockTradingViewChart ticker={data.ticker} bars={data.bars} />

          {/* Cụm Tabs liên quan đến cổ phiếu */}
          <StockTabsPanel data={data} />
        </section>

        {/* ========================================================= */}
        {/* COLUMN 3: BÊN PHẢI (15% WIDTH)                            */}
        {/* Watchlist cổ phiếu                                        */}
        {/* ========================================================= */}
        <StockWatchlistSidebar currentTicker={data.ticker} items={data.watchlist} />
      </main>
    </div>
  )
}
