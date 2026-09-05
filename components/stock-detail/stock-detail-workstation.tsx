"use client"

import React from "react"

import { StockAiSidebar } from "./stock-ai-sidebar"
import { StockCompanyHeader } from "./stock-company-header"
import { StockTradingViewChart } from "./stock-tradingview-chart"
import { StockTabsPanel } from "./stock-tabs-panel"
import { StockWatchlistSidebar } from "./stock-watchlist-sidebar"
import type { StockDetailData } from "./types"
import { TopNav } from "@/components/top-nav"

export function StockDetailWorkstation({ data }: { data: StockDetailData }) {
  return (
    <div className="min-h-screen w-full bg-[#06090d] text-white">
      {/* Top Navigation Bar */}
      <TopNav />

      {/* Main Full-Width Workstation Container */}
      <main className="w-full px-2.5 py-3 sm:px-4 lg:px-5 2xl:px-6">
        {/* 3 Columns Master Layout */}
        <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-[320px_minmax(0,1fr)] xl:grid-cols-[330px_minmax(0,1fr)_270px] 2xl:grid-cols-[360px_minmax(0,1fr)_300px] items-start">
          {/* ========================================================= */}
          {/* COLUMN 1: BÊN TRÁI (~25% WIDTH)                           */}
          {/* Góc nhìn AI + AI Council tổng quan + Quick Chatbox với AI */}
          {/* ========================================================= */}
          <StockAiSidebar data={data} />

          {/* ========================================================= */}
          {/* COLUMN 2: GIỮA (~60% WIDTH)                               */}
          {/* Thông tin công ty + TradingView light chart               */}
          {/* + Cụm 4 Tabs: Tổng quan, DN, Phân tích TA, AI Council     */}
          {/* ========================================================= */}
          <section className="min-w-0 space-y-3.5">
            {/* Thông tin công ty & Giá realtime */}
            <StockCompanyHeader data={data} />

            {/* TradingView Lightweight Candlestick Chart */}
            <StockTradingViewChart ticker={data.ticker} bars={data.bars} />

            {/* 4 Tabs Panel: Tổng quan, DN, TA, AI Council */}
            <StockTabsPanel data={data} />
          </section>

          {/* ========================================================= */}
          {/* COLUMN 3: BÊN PHẢI (~15% WIDTH)                           */}
          {/* Watchlist cổ phiếu thị trường                             */}
          {/* ========================================================= */}
          <StockWatchlistSidebar currentTicker={data.ticker} items={data.watchlist} />
        </div>

        {/* Footer Methodology */}
        <footer className="mt-4 rounded-2xl border border-white/[0.06] bg-[#080d13] px-4 py-2.5 text-[9px] leading-5 text-slate-500">
          <b className="text-slate-400">Methodology:</b> Workstation chi tiết cổ phiếu kết hợp dữ liệu kỹ thuật thời gian thực, mô hình định giá cơ bản và consensus độc lập từ AI Council. Dữ liệu phân tích mang tính chất tham khảo, nhà đầu tư tự chịu trách nhiệm với quyết định giao dịch.
        </footer>
      </main>
    </div>
  )
}
