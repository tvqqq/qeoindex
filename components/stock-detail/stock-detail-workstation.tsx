"use client"

import React from "react"
import Link from "next/link"
import { ArrowLeft, BrainCircuit, CalendarDays, ExternalLink, Sparkles } from "lucide-react"

import { StockAiSidebar } from "./stock-ai-sidebar"
import { StockCompanyHeader } from "./stock-company-header"
import { StockTradingViewChart } from "./stock-tradingview-chart"
import { StockTabsPanel } from "./stock-tabs-panel"
import { StockWatchlistSidebar } from "./stock-watchlist-sidebar"
import type { StockDetailData } from "./types"
import { TopNav } from "@/components/top-nav"

export function StockDetailWorkstation({ data }: { data: StockDetailData }) {
  return (
    <div className="min-h-screen bg-[#06090d] text-white">
      {/* Top Navigation Bar */}
      <TopNav />

      {/* Main Workstation Container */}
      <main className="mx-auto max-w-[1760px] px-3 py-4 sm:px-5 lg:px-6">
        {/* Breadcrumb & Navigation Actions */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] pb-3 text-xs">
          <div className="flex items-center gap-2">
            <Link
              href="/insights"
              className="inline-flex items-center gap-1.5 text-slate-400 transition-colors hover:text-cyan-300"
            >
              <ArrowLeft className="size-3.5" />
              <span>Insights Thị trường</span>
            </Link>
            <span className="text-white/20">/</span>
            <span className="font-mono font-bold text-cyan-300">{data.ticker}</span>
            <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-2 py-0.5 text-[10px] text-slate-400">
              {data.exchange || "HOSE"}
            </span>
          </div>

          <div className="flex items-center gap-3">
            <Link
              href={`/insights/ai-council?ticker=${data.ticker}`}
              prefetch={false}
              className="inline-flex items-center gap-1.5 rounded-xl border border-violet-400/25 bg-violet-400/[0.08] px-3 py-1.5 text-[11px] font-bold text-violet-300 transition-all hover:border-violet-400/40 hover:text-white"
            >
              <BrainCircuit className="size-3.5" />
              <span>Mở AI Council chuyên sâu</span>
            </Link>
            <div className="hidden items-center gap-1.5 font-mono text-[11px] text-slate-500 sm:flex">
              <CalendarDays className="size-3.5 text-slate-500" />
              <span>{new Date().toLocaleDateString("vi-VN")}</span>
            </div>
          </div>
        </div>

        {/* 3 Columns Master Layout */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_minmax(0,1fr)] xl:grid-cols-[330px_minmax(0,1fr)_270px] 2xl:grid-cols-[360px_minmax(0,1fr)_290px] items-start">
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
          <section className="min-w-0 space-y-4">
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
        <footer className="mt-6 rounded-2xl border border-white/[0.06] bg-[#080d13] px-4 py-3 text-[10px] leading-5 text-slate-500">
          <b className="text-slate-400">Methodology:</b> Workstation chi tiết cổ phiếu kết hợp dữ liệu kỹ thuật thời gian thực, mô hình định giá cơ bản và consensus độc lập từ AI Council. Dữ liệu phân tích mang tính chất tham khảo, nhà đầu tư tự chịu trách nhiệm với quyết định giao dịch.
        </footer>
      </main>
    </div>
  )
}
