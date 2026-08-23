"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  Crown,
  GripVertical,
  HelpCircle,
  Layers,
  Search,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
  X,
  Zap,
} from "lucide-react"

import { WyckoffLightweightChart } from "@/components/insights/wyckoff-lightweight-chart"
import { MarketChangePill } from "@/components/market-change-pill"
import { StockLogo } from "@/components/stock-logo"
import { TopNav } from "@/components/top-nav"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { WyckoffChartStudy, WyckoffChartTimeframe } from "@/lib/wyckoff-chart-model"
import { cn } from "@/lib/utils"

export interface WyckoffListItem {
  ticker: string
  rank: number
  sector: string
  price: number | null
  changePct: number | null
  phase: string
  bias: string
  confidence: string
  status: string
  date: string
}

type WatchlistFilterTab = "all" | "accumulation" | "distribution" | "top100"

function number(value: number | null | undefined, digits = 2) {
  if (value == null || !Number.isFinite(value)) return "—"
  return value.toLocaleString("en-US", { maximumFractionDigits: digits })
}

function biasTone(bias: string) {
  if (bias === "Bullish") return "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
  if (bias === "Bearish") return "border-rose-400/30 bg-rose-400/10 text-rose-300"
  return "border-amber-300/25 bg-amber-300/8 text-amber-200"
}

function phaseShort(phase: string | undefined) {
  if (!phase) return "Chưa phân loại"
  if (/Spring/i.test(phase)) return "Spring · Phase C"
  if (/UT\/UTAD/i.test(phase)) return "UT/UTAD · Phase C"
  if (/SOS/i.test(phase)) return "SOS · Phase D"
  if (/SOW/i.test(phase)) return "SOW · Phase D"
  if (/Markup/i.test(phase)) return "Markup watch"
  if (/Markdown/i.test(phase)) return "Markdown watch"
  return phase
}

function phaseShortBadge(phase: string | undefined) {
  if (!phase) return "Chờ scan"
  if (/Spring/i.test(phase)) return "Spring C"
  if (/UT\/UTAD/i.test(phase)) return "UTAD C"
  if (/SOS/i.test(phase)) return "SOS D"
  if (/SOW/i.test(phase)) return "SOW D"
  if (/Markup/i.test(phase)) return "Markup"
  if (/Markdown/i.test(phase)) return "Markdown"
  return phase.slice(0, 9)
}

function biasBadgeStyle(bias: string, phase: string) {
  if (bias === "Bullish" || /Spring|SOS|Markup/i.test(phase)) {
    return "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
  }
  if (bias === "Bearish" || /UTAD|SOW|Markdown/i.test(phase)) {
    return "bg-rose-500/15 text-rose-300 border border-rose-500/30"
  }
  return "bg-amber-500/15 text-amber-300 border border-amber-500/30"
}

function updateTimeframeQuery(timeframe: WyckoffChartTimeframe) {
  const url = new URL(window.location.href)
  url.searchParams.set("timeframe", timeframe)
  window.history.replaceState(window.history.state, "", url)
}

export function WyckoffChartDashboard({
  ticker,
  studies,
  initialTimeframe,
  stocks,
  generatedAt,
  dataSource = "Notion canonical",
}: {
  ticker: string
  studies: WyckoffChartStudy[]
  initialTimeframe: WyckoffChartTimeframe
  stocks: WyckoffListItem[]
  generatedAt: string
  dataSource?: string
}) {
  const [activeTimeframe, setActiveTimeframe] = useState(initialTimeframe)
  const [query, setQuery] = useState("")
  const [activeTab, setActiveTab] = useState<WatchlistFilterTab>("all")
  const shouldReduceMotion = useReducedMotion()

  const current = studies.find((study) => study.timeframe === activeTimeframe) ?? studies[0]
  const selected = stocks.find((stock) => stock.ticker === ticker)
  const latest = current?.bars.at(-1)
  const change = current?.analysis?.technical.changePct ?? selected?.changePct ?? null

  const filteredStocks = useMemo(() => {
    let list = stocks
    if (activeTab === "accumulation") {
      list = list.filter((s) => s.bias === "Bullish" || /Spring|SOS|Markup/i.test(s.phase))
    } else if (activeTab === "distribution") {
      list = list.filter((s) => s.bias === "Bearish" || /UTAD|SOW|Markdown/i.test(s.phase))
    } else if (activeTab === "top100") {
      list = list.filter((s) => s.rank && s.rank <= 100)
    }

    const normalized = query.trim().toUpperCase()
    if (!normalized) return list
    return list.filter((stock) => `${stock.ticker} ${stock.sector} ${stock.phase} ${stock.bias}`.toUpperCase().includes(normalized))
  }, [query, activeTab, stocks])

  function chooseTimeframe(timeframe: WyckoffChartTimeframe) {
    setActiveTimeframe(timeframe)
    updateTimeframeQuery(timeframe)
  }

  return (
    <div className="min-h-screen bg-[#05080d] text-slate-100">
      <TopNav />

      <main className="mx-auto max-w-[1920px] px-3 py-3 sm:px-4 lg:px-5">
        {/* TWO-COLUMN WORKSPACE: LEFT CHART WORKSPACE + RIGHT STANDALONE WATCHLIST */}
        <div className="grid gap-3.5 lg:grid-cols-[minmax(0,1fr)_380px] xl:grid-cols-[minmax(0,1fr)_420px]">
          {/* LEFT: MAIN CHART & ANALYTICS WORKSPACE */}
          <div className="min-w-0 space-y-3.5">
            {/* Stock Header / Navigation Bar */}
            <header className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/[0.10] bg-gradient-to-r from-[#121820] via-[#182330] to-[#121820] px-4 py-2.5 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.10),0_4px_16px_rgba(0,0,0,0.32)]">
              {/* Left: Back Button, Logo, Ticker, Badges */}
              <div className="flex flex-wrap items-center gap-2.5 min-w-0">
                <Link
                  href={`/insights?ticker=${ticker}`}
                  prefetch={false}
                  aria-label={`Quay lại Insights & mở popup chi tiết ${ticker}`}
                  title={`Quay lại Insights & mở popup chi tiết ${ticker}`}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-purple-400/30 bg-purple-500/10 px-2.5 py-1 font-ticker text-xs font-bold text-purple-300 hover:bg-purple-500/20 hover:border-purple-400/50 transition-colors shrink-0"
                >
                  <ArrowLeft className="size-3.5" />
                  <span>Rating</span>
                </Link>

                <GripVertical className="h-4 w-4 text-white/30 hover:text-white/60 shrink-0 transition-colors hidden sm:block" />

                <StockLogo
                  symbol={ticker}
                  size={34}
                  className="shrink-0 rounded-full border-white/40"
                />

                <span className="shrink-0 select-none bg-gradient-to-br from-white via-cyan-100 to-emerald-200 bg-clip-text pr-1 font-ticker text-2xl font-extrabold italic tracking-tight text-transparent">
                  {ticker}
                </span>

                {selected?.sector ? (
                  <span className="hidden sm:inline-flex shrink-0 rounded-full border border-white/[0.12] bg-white/[0.08] px-2.5 py-0.5 font-ticker text-[10px] font-bold uppercase tracking-wider text-white/80 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.1)]">
                    {selected.sector}
                  </span>
                ) : null}

                <span className={cn("shrink-0 rounded-full border px-2.5 py-0.5 font-ticker text-[10px] font-bold uppercase tracking-wider", biasTone(current?.analysis?.taBias ?? selected?.bias ?? ""))}>
                  {current?.analysis?.taBias ?? selected?.bias ?? "Pending"}
                </span>

                {selected?.rank ? (
                  <span className="hidden md:inline-flex items-center gap-1 rounded-full border border-amber-400/30 bg-amber-400/10 px-2.5 py-0.5 font-ticker text-[10px] font-bold text-amber-300">
                    <Crown className="size-3" /> Top 100 · #{selected.rank}
                  </span>
                ) : null}
              </div>

              {/* Right: Live Price + Timeframe Navigation Tabs */}
              <div className="flex items-center gap-3 shrink-0">
                {/* Live Price & Change */}
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xl sm:text-2xl font-black text-white tracking-tight">
                    {number(latest?.close ?? selected?.price)}
                  </span>
                  <MarketChangePill
                    value={change}
                    tone={(change ?? 0) > 0 ? "up" : (change ?? 0) < 0 ? "down" : "ref"}
                    decimals={2}
                  />
                </div>

                <div className="hidden sm:block h-5 w-px bg-white/10" />

                {/* Timeframe selector pills */}
                <nav className="inline-flex items-center gap-1 p-0.5 rounded-lg bg-[#080c10] border border-white/[0.08]" role="tablist" aria-label="Khung thời gian">
                  {studies.map((study) => (
                    <button
                      key={study.timeframe}
                      type="button"
                      onClick={() => chooseTimeframe(study.timeframe)}
                      className={cn(
                        "px-2.5 py-1 text-xs font-extrabold rounded-md transition-colors select-none",
                        activeTimeframe === study.timeframe
                          ? "bg-emerald-500/20 text-emerald-300 border border-emerald-400/40 font-black"
                          : "text-slate-400 hover:text-white hover:bg-white/[0.05] border border-transparent"
                      )}
                    >
                      {study.timeframe}
                    </button>
                  ))}
                </nav>
              </div>
            </header>

            {/* SmoothUI Animated Transition Container for Metric Cards & Chart */}
            <AnimatePresence mode="wait">
              <motion.div
                key={`${ticker}-${activeTimeframe}`}
                initial={shouldReduceMotion ? false : { opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={shouldReduceMotion ? undefined : { opacity: 0, y: -8 }}
                transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                className="space-y-3.5"
              >
                {/* Top 4 Rich Metric Cards */}
                <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
                  {/* Card 1: Giá đóng cửa & Biến động */}
                  <div className="rounded-xl border border-emerald-400/20 bg-gradient-to-b from-[#0a1622] to-[#070e17] p-3 shadow-[0_0_20px_-8px_rgba(52,211,153,0.2)] flex flex-col justify-between">
                    <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-emerald-300/80 font-ticker">
                      <span className="flex items-center gap-1.5"><TrendingUp className="size-3.5 text-emerald-400" /> Giá & Động lượng {activeTimeframe}</span>
                      <Activity className="size-3.5 text-emerald-400/70" />
                    </div>
                    <div className="mt-1.5 flex items-baseline gap-2">
                      <span className="font-mono text-2xl font-black text-white">
                        {number(latest?.close ?? selected?.price)}
                      </span>
                      <MarketChangePill
                        value={change}
                        tone={(change ?? 0) > 0 ? "up" : (change ?? 0) < 0 ? "down" : "ref"}
                        decimals={2}
                      />
                    </div>
                    <div className="mt-1.5 text-[10.5px] font-medium text-slate-400 truncate font-ticker">
                      {current?.bars.length ?? 0} nến hoàn tất · {current?.detail || `Khung ${activeTimeframe}`}
                    </div>
                  </div>

                  {/* Card 2: Pha Wyckoff & Xác suất */}
                  <div className="rounded-xl border border-cyan-400/20 bg-gradient-to-b from-[#081524] to-[#070e17] p-3 shadow-[0_0_20px_-8px_rgba(34,211,238,0.2)] flex flex-col justify-between">
                    <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-cyan-300/80 font-ticker">
                      <span className="flex items-center gap-1.5"><Layers className="size-3.5 text-cyan-400" /> Pha Wyckoff hiện tại</span>
                      <Sparkles className="size-3.5 text-cyan-400/70" />
                    </div>
                    <div className="mt-1.5 font-ticker text-lg font-black text-cyan-300 truncate">
                      {current?.phaseGuide.title || phaseShort(selected?.phase)}
                    </div>
                    <div className="mt-1.5 flex items-center gap-1.5 text-[10.5px] font-mono text-slate-400">
                      <span>Bull <strong className="text-emerald-300 font-bold">{current?.analysis?.bullProbability ?? 0}%</strong></span>
                      <span>·</span>
                      <span>Base <strong className="text-amber-300 font-bold">{current?.analysis?.baseProbability ?? 0}%</strong></span>
                      <span>·</span>
                      <span>Bear <strong className="text-rose-300 font-bold">{current?.analysis?.bearProbability ?? 0}%</strong></span>
                    </div>
                  </div>

                  {/* Card 3: Vùng Hỗ trợ / Kháng cự */}
                  <div className="rounded-xl border border-amber-400/20 bg-gradient-to-b from-[#16140b] to-[#070e17] p-3 shadow-[0_0_20px_-8px_rgba(251,191,36,0.2)] flex flex-col justify-between">
                    <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-amber-300/80 font-ticker">
                      <span className="flex items-center gap-1.5"><Target className="size-3.5 text-amber-400" /> Vùng giá Then chốt</span>
                      <ShieldCheck className="size-3.5 text-amber-400/70" />
                    </div>
                    <div className="mt-1.5 font-mono text-lg font-black text-amber-300 truncate">
                      {current?.analysis?.support || "—"} <span className="text-sm text-slate-500 font-normal">/</span> {current?.analysis?.resistance || "—"}
                    </div>
                    <div className="mt-1.5 text-[10.5px] font-medium text-slate-400 truncate font-ticker">
                      {current?.analysis?.confirmation || "Theo dõi phản ứng giá tại hỗ trợ / kháng cự"}
                    </div>
                  </div>

                  {/* Card 4: Tín hiệu & Hành vi Volume */}
                  <div className="rounded-xl border border-purple-400/20 bg-gradient-to-b from-[#150f24] to-[#070e17] p-3 shadow-[0_0_20px_-8px_rgba(168,85,247,0.2)] flex flex-col justify-between">
                    <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-purple-300/80 font-ticker">
                      <span className="flex items-center gap-1.5"><Zap className="size-3.5 text-purple-400" /> Cấu trúc & Tín hiệu</span>
                      <Activity className="size-3.5 text-purple-400/70" />
                    </div>
                    <div className="mt-1.5 font-ticker text-lg font-black text-purple-200 truncate">
                      {current?.analysis?.taBias === "Bullish" ? "TÍCH LŨY MẠNH" : current?.analysis?.taBias === "Bearish" ? "PHÂN PHỐI / SOW" : current?.analysis?.taBias === "Mixed" ? "TÍCH LŨY BIÊN ĐỘ" : "TRUNG LẬP"}
                    </div>
                    <div className="mt-1.5 text-[10.5px] font-medium text-slate-400 truncate font-ticker">
                      {current?.analysis?.whatChanged || "Biến động volume và cấu trúc nến đồng thuận"}
                    </div>
                  </div>
                </div>

                {/* Main Chart Card */}
                <div className="overflow-hidden rounded-2xl border border-white/[0.09] bg-[#080c12] shadow-[0_20px_70px_-35px_rgba(0,0,0,.95)]">
                  <div className="flex flex-col gap-2 border-b border-white/[0.08] bg-[#0b1018] px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:px-4 font-ticker">
                    <div className="flex items-center gap-2 text-xs font-bold text-slate-300">
                      <span className="rounded bg-emerald-500/20 px-2 py-0.5 font-mono text-emerald-300">{activeTimeframe}</span>
                      <span>Biểu đồ kỹ thuật & Vùng giá cấu trúc Wyckoff</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                      <span>{current?.bars.length ?? 0} nến hoàn tất</span>
                      <span>·</span>
                      <span>{current?.detail}</span>
                      <span>·</span>
                      <span>Nguồn: {dataSource}</span>
                    </div>
                  </div>

                  <div className="relative">
                    {current ? <WyckoffLightweightChart ticker={ticker} study={current} /> : null}
                    <div className="pointer-events-none absolute left-3 top-3 z-[3] max-w-[min(520px,calc(100%-1.5rem))] rounded-xl border border-white/10 bg-[#080d15]/90 px-3 py-2.5 shadow-2xl sm:left-4 sm:top-4 font-ticker">
                      <div className="flex items-center gap-2">
                        <span className="rounded-md border border-purple-400/25 bg-purple-400/10 px-2 py-1 text-[10px] font-extrabold uppercase tracking-wider text-purple-200">{current?.timeframe}</span>
                        <span className="truncate text-xs font-bold text-white">{current?.phaseGuide.title}</span>
                        <Tooltip>
                          <TooltipTrigger render={<button type="button" className="pointer-events-auto rounded-full p-1 text-slate-400 hover:bg-white/10 hover:text-white" aria-label="Giải thích pha Wyckoff"><HelpCircle className="h-4 w-4" /></button>} />
                          <TooltipContent side="bottom" align="start" className="block max-w-sm border border-white/10 bg-[#0b111b] p-3 text-left text-xs leading-5 text-slate-200 shadow-2xl">
                            <div className="font-bold text-emerald-300">Hiện tại</div>
                            <p className="mt-1">{current?.phaseGuide.now}</p>
                            <div className="mt-2 font-bold text-cyan-300">Cần quan sát tiếp</div>
                            <p className="mt-1">{current?.phaseGuide.next}</p>
                            <div className="mt-2 font-bold text-rose-300">Rủi ro / phủ định</div>
                            <p className="mt-1">{current?.phaseGuide.risk}</p>
                          </TooltipContent>
                        </Tooltip>
                      </div>
                      <p className="mt-1.5 line-clamp-2 text-[11px] leading-5 text-slate-400">{current?.analysis?.wyckoffState ?? current?.error}</p>
                    </div>
                  </div>

                  {/* Scenarios Projection Footer */}
                  <div className="border-t border-white/[0.08] bg-[#080d14] p-3 sm:p-4 font-ticker">
                    <div className="grid gap-3 lg:grid-cols-3">
                      {current?.scenarios.map((scenario) => {
                        const Icon = scenario.key === "bull" ? TrendingUp : scenario.key === "bear" ? TrendingDown : Target
                        return (
                          <article key={scenario.key} className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-3">
                            <div className="flex items-center justify-between gap-3">
                              <span className="inline-flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider" style={{ color: scenario.color }}><Icon className="h-4 w-4" />{scenario.label}</span>
                              <span className="font-mono text-base font-black text-white">{scenario.probability}%</span>
                            </div>
                            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.06]"><div className="h-full rounded-full" style={{ width: `${scenario.probability}%`, backgroundColor: scenario.color }} /></div>
                            <p className="mt-2 text-xs leading-5 text-slate-400">{scenario.description}</p>
                          </article>
                        )
                      })}
                    </div>
                    <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                      <div className="flex items-start gap-2 rounded-lg border border-emerald-400/15 bg-emerald-400/[0.04] px-3 py-2 text-slate-400"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" /><span><strong className="text-slate-200">Xác nhận:</strong> {current?.analysis?.confirmation ?? "Chưa đủ dữ liệu."}</span></div>
                      <div className="flex items-start gap-2 rounded-lg border border-rose-400/15 bg-rose-400/[0.04] px-3 py-2 text-slate-400"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-300" /><span><strong className="text-slate-200">Phủ định:</strong> {current?.analysis?.invalidation ?? "Chưa đủ dữ liệu."}</span></div>
                    </div>
                    <p className="mt-2.5 text-[10.5px] leading-relaxed text-slate-500">
                      Các đường phía trước là projection định lượng từ cấu trúc pha, ATR và xác suất; không phải dữ liệu giá tương lai hay khuyến nghị mua bán.
                    </p>
                  </div>
                </div>
              </motion.div>
            </AnimatePresence>
          </div>

          {/* RIGHT: DEDICATED TRADINGVIEW-STYLE WATCHLIST WIDGET (Plus Jakarta Sans & Bảng điện typography) */}
          <aside className="flex flex-col h-[calc(100vh-76px)] rounded-2xl border border-white/[0.09] bg-[#090e15] shadow-xl overflow-hidden sticky top-3.5 font-ticker">
            {/* Watchlist Header */}
            <div className="border-b border-white/[0.08] p-3 space-y-2.5 bg-[#080d14]">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm sm:text-[15px] font-extrabold tracking-wide uppercase text-white flex items-center gap-1.5">
                    <BarChart3 className="size-4 text-emerald-400" />
                    Watchlist Wyckoff
                  </h2>
                  <span className="rounded-full bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 font-mono text-xs font-bold text-emerald-300">
                    {filteredStocks.length}
                  </span>
                </div>
                <div className="text-xs text-slate-400 font-mono">
                  {generatedAt.slice(0, 10)}
                </div>
              </div>

              {/* Compact Search Box */}
              <div className="relative flex items-center">
                <Search className="absolute left-2.5 size-3.5 text-slate-500 pointer-events-none" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Tìm mã hoặc ngành..."
                  className="w-full rounded-lg border border-white/10 bg-[#05080e] pl-8 pr-7 py-2 text-xs font-medium text-white placeholder:text-slate-500 outline-none focus:border-cyan-400/50 transition-colors"
                />
                {query ? (
                  <button
                    type="button"
                    onClick={() => setQuery("")}
                    className="absolute right-2 text-slate-500 hover:text-white p-0.5 transition-colors"
                    aria-label="Xóa tìm kiếm"
                  >
                    <X className="size-3.5" />
                  </button>
                ) : null}
              </div>

              {/* Filter Tabs (TradingView-style) */}
              <div className="flex items-center gap-1 overflow-x-auto pb-0.5">
                {[
                  { id: "all", label: "Tất cả" },
                  { id: "accumulation", label: "Tích lũy" },
                  { id: "distribution", label: "Phân phối" },
                  { id: "top100", label: "Top 100" },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id as WatchlistFilterTab)}
                    className={cn(
                      "px-2.5 py-1 rounded-md text-xs font-bold whitespace-nowrap transition-colors",
                      activeTab === tab.id
                        ? "bg-cyan-500/20 text-cyan-300 border border-cyan-400/40 font-extrabold"
                        : "text-slate-400 hover:text-white hover:bg-white/[0.04] border border-transparent"
                    )}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {/* TradingView Column Headers */}
            <div className="grid grid-cols-[1fr_68px_68px_76px] items-center px-3 py-2 text-xs font-bold text-slate-400 uppercase tracking-wider border-b border-white/[0.06] bg-[#070b10]">
              <div>Mã / Ngành</div>
              <div className="text-right">Giá</div>
              <div className="text-right">+/- %</div>
              <div className="text-right">Pha</div>
            </div>

            {/* Watchlist Rows (Scrollable with Bảng điện Plus Jakarta Sans font & sizing) */}
            <div className="flex-1 overflow-y-auto divide-y divide-white/[0.03]">
              {filteredStocks.map((stock) => {
                const isActive = stock.ticker === ticker
                return (
                  <Link
                    key={stock.ticker}
                    href={`/insights/wyckoff?ticker=${encodeURIComponent(stock.ticker)}&timeframe=${activeTimeframe}`}
                    prefetch={false}
                    className={cn(
                      "grid grid-cols-[1fr_68px_68px_76px] items-center px-3 py-2.5 text-xs transition-colors",
                      isActive
                        ? "bg-gradient-to-r from-emerald-500/15 via-cyan-500/10 to-transparent border-l-2 border-emerald-400 font-bold"
                        : "hover:bg-white/[0.04]"
                    )}
                  >
                    {/* Symbol + Sector */}
                    <div className="flex items-center gap-2 min-w-0 pr-1">
                      <StockLogo symbol={stock.ticker} size={22} className="rounded shrink-0" />
                      <div className="min-w-0">
                        <div className={cn("font-ticker text-sm sm:text-[15px] font-bold truncate leading-tight", isActive ? "text-cyan-300" : "text-white")}>
                          {stock.ticker}
                        </div>
                        <div className="text-xs text-slate-400 truncate leading-none mt-0.5 font-medium">
                          {stock.sector || "HOSE"}
                        </div>
                      </div>
                    </div>

                    {/* Price */}
                    <div className="text-right font-mono text-sm sm:text-[14px] font-bold text-slate-100">
                      {number(stock.price)}
                    </div>

                    {/* % Change (MarketChangePill) */}
                    <div className="text-right flex justify-end">
                      <MarketChangePill
                        value={stock.changePct}
                        tone={(stock.changePct ?? 0) > 0 ? "up" : (stock.changePct ?? 0) < 0 ? "down" : "ref"}
                        decimals={2}
                      />
                    </div>

                    {/* Phase Badge */}
                    <div className="text-right pl-1">
                      <span className={cn("inline-block rounded px-2 py-0.5 text-xs font-bold truncate max-w-full font-ticker", biasBadgeStyle(stock.bias, stock.phase))}>
                        {phaseShortBadge(stock.phase)}
                      </span>
                    </div>
                  </Link>
                )
              })}
              {!filteredStocks.length ? (
                <div className="p-8 text-center text-xs text-slate-400 font-medium">
                  Không tìm thấy mã phù hợp
                </div>
              ) : null}
            </div>
          </aside>
        </div>
      </main>
    </div>
  )
}
