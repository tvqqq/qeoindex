"use client"

import Link from "next/link"
import { memo, useDeferredValue, useMemo, useState } from "react"
import { LazyMotion, domAnimation, m, useReducedMotion } from "motion/react"
import {
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  Crown,
  HelpCircle,
  Layers,
  Search,
  ShieldCheck,
  Target,
  TrendingDown,
  TrendingUp,
  X,
  Zap,
} from "lucide-react"

import { WyckoffLightweightChart } from "@/components/insights/wyckoff-lightweight-chart"
import { StockLogo } from "@/components/stock-logo"
import { AnimatedTabs } from "@/components/smoothui/animated-tabs"
import { PriceFlow } from "@/components/smoothui/price-flow"
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

const WATCHLIST_TABS: Array<{ id: WatchlistFilterTab; label: string }> = [
  { id: "all", label: "Tất cả" },
  { id: "accumulation", label: "Tích lũy" },
  { id: "distribution", label: "Phân phối" },
  { id: "top100", label: "Top 100" },
]

function number(value: number | null | undefined, digits = 2) {
  if (value == null || !Number.isFinite(value)) return "—"
  return value.toLocaleString("en-US", { maximumFractionDigits: digits })
}

function signedPercent(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—"
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`
}

function changeTone(value: number | null | undefined) {
  if ((value ?? 0) > 0) return "text-emerald-300"
  if ((value ?? 0) < 0) return "text-rose-300"
  return "text-amber-200"
}

function changePillTone(value: number | null | undefined) {
  if ((value ?? 0) > 0) return "border-emerald-400/25 bg-emerald-400/[0.08] text-emerald-300"
  if ((value ?? 0) < 0) return "border-rose-400/25 bg-rose-400/[0.08] text-rose-300"
  return "border-amber-300/20 bg-amber-300/[0.06] text-amber-200"
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
    return "border-emerald-500/30 bg-emerald-500/12 text-emerald-300"
  }
  if (bias === "Bearish" || /UTAD|SOW|Markdown/i.test(phase)) {
    return "border-rose-500/30 bg-rose-500/12 text-rose-300"
  }
  return "border-amber-500/30 bg-amber-500/12 text-amber-300"
}

function updateTimeframeQuery(timeframe: WyckoffChartTimeframe) {
  const url = new URL(window.location.href)
  url.searchParams.set("timeframe", timeframe)
  window.history.replaceState(window.history.state, "", url)
}

function SymbolIdentity({
  ticker,
  companyName,
  exchange,
  sector,
  reduceMotion,
}: {
  ticker: string
  companyName: string
  exchange: string
  sector: string
  reduceMotion: boolean
}) {
  return (
    <LazyMotion features={domAnimation} strict>
      <m.div
        key={ticker}
        initial={reduceMotion ? false : { opacity: 0, x: 8 }}
        animate={{ opacity: 1, x: 0 }}
        transition={reduceMotion ? { duration: 0 } : { duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
        className="min-w-0"
      >
        <div className="flex min-w-0 items-baseline gap-2.5">
          <span className="shrink-0 font-ticker text-2xl font-extrabold italic tracking-tight text-white sm:text-[28px]">{ticker}</span>
          <span className="min-w-0 truncate font-ticker text-sm font-bold text-slate-200 sm:text-base" title={companyName}>{companyName}</span>
        </div>
        <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] font-medium text-slate-500">
          <span className="shrink-0">{exchange}</span>
          <span aria-hidden="true">·</span>
          <span className="min-w-0 truncate">{sector || "Chưa phân ngành"}</span>
        </div>
      </m.div>
    </LazyMotion>
  )
}

const WatchlistRow = memo(function WatchlistRow({
  stock,
  isActive,
  activeTimeframe,
}: {
  stock: WyckoffListItem
  isActive: boolean
  activeTimeframe: WyckoffChartTimeframe
}) {
  return (
    <Link
      href={`/insights/wyckoff?ticker=${encodeURIComponent(stock.ticker)}&timeframe=${activeTimeframe}`}
      prefetch={false}
      scroll={false}
      className={cn(
        "grid min-h-12 grid-cols-[minmax(70px,1fr)_76px_72px_88px] items-center gap-1 border-b border-white/[0.035] px-3 py-2 transition-colors [contain-intrinsic-size:48px] [content-visibility:auto]",
        isActive ? "border-l-2 border-l-cyan-400 bg-cyan-400/[0.08]" : "hover:bg-white/[0.035]",
      )}
      aria-current={isActive ? "page" : undefined}
    >
      <div className={cn("font-ticker text-[15px] font-extrabold tracking-wide sm:text-base", isActive ? "text-cyan-300" : "text-slate-100")}>{stock.ticker}</div>
      <div className="text-right font-mono text-[14px] font-bold tabular-nums text-slate-100">{number(stock.price)}</div>
      <div className={cn("text-right font-mono text-[12.5px] font-bold tabular-nums", changeTone(stock.changePct))}>{signedPercent(stock.changePct)}</div>
      <div className="text-right">
        <span className={cn("inline-flex max-w-full justify-center whitespace-nowrap rounded border px-1.5 py-0.5 text-[10.5px] font-bold", biasBadgeStyle(stock.bias, stock.phase))}>{phaseShortBadge(stock.phase)}</span>
      </div>
    </Link>
  )
})

export function WyckoffChartDashboard({
  ticker,
  companyName,
  exchange,
  studies,
  initialTimeframe,
  stocks,
  generatedAt,
  dataSource = "Notion canonical",
}: {
  ticker: string
  companyName?: string
  exchange?: string | null
  studies: WyckoffChartStudy[]
  initialTimeframe: WyckoffChartTimeframe
  stocks: WyckoffListItem[]
  generatedAt: string
  dataSource?: string
}) {
  const [activeTimeframe, setActiveTimeframe] = useState(initialTimeframe)
  const [query, setQuery] = useState("")
  const [activeTab, setActiveTab] = useState<WatchlistFilterTab>("all")
  const deferredQuery = useDeferredValue(query)
  const shouldReduceMotion = useReducedMotion() ?? false

  const stockByTicker = useMemo(() => new Map(stocks.map((stock) => [stock.ticker, stock])), [stocks])
  const selected = stockByTicker.get(ticker)
  const current = useMemo(() => studies.find((study) => study.timeframe === activeTimeframe) ?? studies[0], [activeTimeframe, studies])
  const timeframeTabs = useMemo(() => studies.map((study) => ({ value: study.timeframe, label: study.timeframe })), [studies])
  const latest = current?.bars.at(-1)
  const change = current?.analysis?.technical.changePct ?? selected?.changePct ?? null
  const headerCompanyName = companyName?.trim() || ticker
  const headerExchange = exchange?.trim() || "HOSE"

  const filteredStocks = useMemo(() => {
    let list = stocks
    if (activeTab === "accumulation") {
      list = list.filter((stock) => stock.bias === "Bullish" || /Spring|SOS|Markup/i.test(stock.phase))
    } else if (activeTab === "distribution") {
      list = list.filter((stock) => stock.bias === "Bearish" || /UTAD|SOW|Markdown/i.test(stock.phase))
    } else if (activeTab === "top100") {
      list = list.filter((stock) => stock.rank > 0 && stock.rank <= 100)
    }

    const normalized = deferredQuery.trim().toUpperCase()
    if (!normalized) return list
    return list.filter((stock) => `${stock.ticker} ${stock.phase} ${stock.bias}`.toUpperCase().includes(normalized))
  }, [activeTab, deferredQuery, stocks])

  function chooseTimeframe(timeframe: WyckoffChartTimeframe) {
    if (timeframe === activeTimeframe) return
    setActiveTimeframe(timeframe)
    updateTimeframeQuery(timeframe)
  }

  return (
    <div className="min-h-screen bg-[#05080d] text-slate-100">
      <TopNav />

      <main className="mx-auto max-w-[1920px] px-3 py-3 sm:px-4 lg:px-5">
        <div className="grid gap-3.5 lg:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[minmax(0,1fr)_390px]">
          <div className="min-w-0 space-y-3">
            <div data-wyckoff-back-row className="flex min-h-8 items-center">
              <Link
                href={`/insights?ticker=${ticker}`}
                prefetch={false}
                className="inline-flex items-center gap-1.5 rounded-md border border-purple-400/20 bg-purple-500/[0.06] px-2.5 py-1.5 font-ticker text-[11px] font-bold text-purple-300 transition-colors hover:border-purple-400/40 hover:bg-purple-500/[0.12]"
                aria-label={`Quay lại Rating ${ticker}`}
              >
                <ArrowLeft className="size-3.5" />
                Rating
              </Link>
            </div>

            <header className="rounded-xl border border-white/[0.09] bg-[#0b1119] px-3 py-2.5 shadow-sm sm:px-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <StockLogo symbol={ticker} size={36} className="shrink-0 rounded-full border-white/30" />
                  <SymbolIdentity
                    ticker={ticker}
                    companyName={headerCompanyName}
                    exchange={headerExchange}
                    sector={selected?.sector || ""}
                    reduceMotion={shouldReduceMotion}
                  />
                </div>

                <div className="shrink-0 text-right">
                  <PriceFlow value={latest?.close ?? selected?.price} digits={2} className="font-mono text-2xl font-black tracking-tight text-white sm:text-[28px]" />
                  <div className="mt-0.5 flex justify-end">
                    <span className={cn("rounded border px-2 py-0.5", changePillTone(change))}>
                      <PriceFlow value={change} digits={2} suffix="%" showSign className="font-mono text-[11px] font-bold" />
                    </span>
                  </div>
                </div>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-12">
                <span className={cn("rounded-full border px-2 py-0.5 font-ticker text-[9.5px] font-bold uppercase tracking-wide", biasTone(current?.analysis?.taBias ?? selected?.bias ?? ""))}>
                  {current?.analysis?.taBias ?? selected?.bias ?? "Pending"}
                </span>
                {selected?.rank ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/25 bg-amber-400/[0.08] px-2 py-0.5 font-ticker text-[9.5px] font-bold text-amber-300">
                    <Crown className="size-2.5" /> Top 100 · #{selected.rank}
                  </span>
                ) : null}
                <span className="rounded-full border border-white/[0.08] bg-white/[0.035] px-2 py-0.5 text-[9.5px] font-semibold text-slate-400">{current?.provider || dataSource}</span>
              </div>
            </header>

            <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
              <MetricCard tone="emerald" icon={<TrendingUp className="size-3.5" />} title={`Giá & Động lượng ${activeTimeframe}`}>
                <div className="mt-1.5 flex items-baseline gap-2">
                  <PriceFlow value={latest?.close ?? selected?.price} digits={2} className="font-mono text-xl font-black text-white" />
                  <PriceFlow value={change} digits={2} suffix="%" showSign className={cn("font-mono text-xs font-bold", changeTone(change))} />
                </div>
                <div className="mt-1 text-[10.5px] text-slate-500">{current?.bars.length ?? 0} nến hoàn tất</div>
              </MetricCard>

              <MetricCard tone="cyan" icon={<Layers className="size-3.5" />} title="Pha Wyckoff hiện tại">
                <div className="mt-1.5 truncate font-ticker text-[15px] font-extrabold text-cyan-300" title={current?.phaseGuide.title}>{current?.phaseGuide.title || phaseShort(selected?.phase)}</div>
                <div className="mt-1 flex items-center gap-2 font-mono text-[10.5px] text-slate-500">
                  <span>Bull <strong className="text-emerald-300">{current?.analysis?.bullProbability ?? 0}%</strong></span>
                  <span>Base <strong className="text-amber-300">{current?.analysis?.baseProbability ?? 0}%</strong></span>
                  <span>Bear <strong className="text-rose-300">{current?.analysis?.bearProbability ?? 0}%</strong></span>
                </div>
              </MetricCard>

              <MetricCard tone="amber" icon={<Target className="size-3.5" />} title="Vùng giá then chốt">
                <div className="mt-1.5 truncate font-mono text-[15px] font-black text-amber-300" title={`${current?.analysis?.support || "—"} / ${current?.analysis?.resistance || "—"}`}>
                  {current?.analysis?.support || "—"} <span className="text-slate-600">/</span> {current?.analysis?.resistance || "—"}
                </div>
                <div className="mt-1 truncate text-[10.5px] text-slate-500" title={current?.analysis?.confirmation}>{current?.analysis?.confirmation || "Chờ confirmation ở vùng quyết định"}</div>
              </MetricCard>

              <MetricCard tone="purple" icon={<Zap className="size-3.5" />} title="Cấu trúc & tín hiệu">
                <div className="mt-1.5 truncate font-ticker text-[15px] font-extrabold text-purple-200">
                  {current?.analysis?.taBias === "Bullish" ? "TÍCH LŨY MẠNH" : current?.analysis?.taBias === "Bearish" ? "PHÂN PHỐI / SOW" : current?.analysis?.taBias === "Mixed" ? "TÍCH LŨY BIÊN ĐỘ" : "TRUNG LẬP"}
                </div>
                <div className="mt-1 truncate text-[10.5px] text-slate-500" title={current?.analysis?.whatChanged}>{current?.analysis?.whatChanged || "Theo dõi price-volume behavior"}</div>
              </MetricCard>
            </div>

            <section className="overflow-hidden rounded-xl border border-white/[0.09] bg-[#080c12] shadow-sm">
              <div data-wyckoff-chart-toolbar className="flex min-h-11 flex-wrap items-center justify-between gap-2 border-b border-white/[0.08] bg-[#0b1018] px-2.5 py-1.5 sm:px-3">
                <AnimatedTabs
                  tabs={timeframeTabs}
                  value={activeTimeframe}
                  onValueChange={chooseTimeframe}
                  ariaLabel="Khung thời gian biểu đồ"
                  variant="segment"
                  tabClassName="font-mono text-[11px] font-bold"
                />

                <div className="flex items-center gap-2 text-[10.5px] text-slate-500">
                  <span className="hidden items-center gap-1.5 sm:inline-flex"><Layers className="size-3" /> Wyckoff structure</span>
                  <span className="rounded border border-white/[0.08] bg-white/[0.035] px-2 py-1 font-mono text-slate-400">{current?.bars.length ?? 0} bars</span>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.06] bg-[#080d14] px-3 py-2 text-[10.5px]">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-slate-400">
                  <strong className="font-ticker text-[12px] text-slate-100">{ticker} · {activeTimeframe} · {headerExchange}</strong>
                  {latest ? (
                    <>
                      <span className="inline-flex items-center gap-1">O <PriceFlow value={latest.open} digits={2} className="font-bold text-slate-300" /></span>
                      <span className="inline-flex items-center gap-1">H <PriceFlow value={latest.high} digits={2} className="font-bold text-emerald-300" /></span>
                      <span className="inline-flex items-center gap-1">L <PriceFlow value={latest.low} digits={2} className="font-bold text-rose-300" /></span>
                      <span className="inline-flex items-center gap-1">C <PriceFlow value={latest.close} digits={2} className="font-bold text-slate-100" /></span>
                    </>
                  ) : null}
                </div>
                <div className="flex min-w-0 items-center gap-2 text-slate-600">
                  <span className="max-w-[320px] truncate" title={current?.detail}>{current?.detail}</span>
                  <span>·</span>
                  <span className="shrink-0">{dataSource}</span>
                </div>
              </div>

              <div className="relative">
                {current ? <WyckoffLightweightChart ticker={ticker} study={current} /> : null}
                <div className="pointer-events-none absolute left-3 top-3 z-[3] max-w-[min(480px,calc(100%-1.5rem))] rounded-lg border border-white/[0.09] bg-[#080d15]/92 px-3 py-2 font-ticker sm:left-4 sm:top-4">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="shrink-0 rounded border border-purple-400/20 bg-purple-400/[0.08] px-1.5 py-0.5 text-[9.5px] font-extrabold uppercase tracking-wide text-purple-200">{current?.timeframe}</span>
                    <span className="min-w-0 truncate text-[11px] font-bold text-white">{current?.phaseGuide.title}</span>
                    <Tooltip>
                      <TooltipTrigger render={<button type="button" className="pointer-events-auto shrink-0 rounded p-1 text-slate-500 transition-colors hover:bg-white/[0.06] hover:text-white" aria-label="Giải thích pha Wyckoff"><HelpCircle className="h-3.5 w-3.5" /></button>} />
                      <TooltipContent side="bottom" align="start" className="block max-w-sm border border-white/10 bg-[#0b111b] p-3 text-left text-xs leading-5 text-slate-200 shadow-lg">
                        <div className="font-bold text-emerald-300">Hiện tại</div>
                        <p className="mt-1">{current?.phaseGuide.now}</p>
                        <div className="mt-2 font-bold text-cyan-300">Cần quan sát tiếp</div>
                        <p className="mt-1">{current?.phaseGuide.next}</p>
                        <div className="mt-2 font-bold text-rose-300">Rủi ro / phủ định</div>
                        <p className="mt-1">{current?.phaseGuide.risk}</p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <p className="mt-1 line-clamp-2 text-[10.5px] leading-4 text-slate-500">{current?.analysis?.wyckoffState ?? current?.error}</p>
                </div>
              </div>

              <div className="border-t border-white/[0.08] bg-[#080d14] p-3 font-ticker sm:p-4">
                <div className="grid gap-2.5 lg:grid-cols-3">
                  {current?.scenarios.map((scenario) => {
                    const Icon = scenario.key === "bull" ? TrendingUp : scenario.key === "bear" ? TrendingDown : Target
                    return (
                      <article key={scenario.key} className="rounded-lg border border-white/[0.07] bg-white/[0.022] p-3">
                        <div className="flex items-center justify-between gap-3">
                          <span className="inline-flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wide" style={{ color: scenario.color }}><Icon className="h-3.5 w-3.5" />{scenario.label}</span>
                          <PriceFlow value={scenario.probability} digits={0} suffix="%" className="font-mono text-sm font-black text-white" />
                        </div>
                        <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/[0.06]"><div className="h-full rounded-full" style={{ width: `${scenario.probability}%`, backgroundColor: scenario.color }} /></div>
                        <p className="mt-2 text-[11px] leading-5 text-slate-500">{scenario.description}</p>
                      </article>
                    )
                  })}
                </div>
                <div className="mt-2.5 grid gap-2 text-[11px] sm:grid-cols-2">
                  <div className="flex items-start gap-2 rounded-lg border border-emerald-400/12 bg-emerald-400/[0.03] px-3 py-2 text-slate-500"><ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-300" /><span><strong className="text-slate-300">Xác nhận:</strong> {current?.analysis?.confirmation ?? "Chưa đủ dữ liệu."}</span></div>
                  <div className="flex items-start gap-2 rounded-lg border border-rose-400/12 bg-rose-400/[0.03] px-3 py-2 text-slate-500"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-300" /><span><strong className="text-slate-300">Phủ định:</strong> {current?.analysis?.invalidation ?? "Chưa đủ dữ liệu."}</span></div>
                </div>
                <p className="mt-2 text-[10px] leading-relaxed text-slate-600">Projection định lượng từ cấu trúc pha, ATR và xác suất; không phải dữ liệu giá tương lai hay khuyến nghị mua bán.</p>
              </div>
            </section>
          </div>

          <aside className="sticky top-3.5 flex h-[calc(100vh-76px)] min-h-[620px] flex-col overflow-hidden rounded-xl border border-white/[0.09] bg-[#090e15] shadow-sm">
            <div className="space-y-2.5 border-b border-white/[0.08] bg-[#080d14] p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <BarChart3 className="size-4 shrink-0 text-cyan-400" />
                  <h2 className="truncate font-ticker text-[14px] font-extrabold uppercase tracking-wide text-white">Watchlist Wyckoff</h2>
                  <span className="shrink-0 rounded-full border border-cyan-500/25 bg-cyan-500/[0.08] px-1.5 py-0.5 font-mono text-[11px] font-bold text-cyan-300">{filteredStocks.length}</span>
                </div>
                <span className="shrink-0 font-mono text-[10px] text-slate-600">{generatedAt.slice(0, 10)}</span>
              </div>

              <div className="relative flex items-center">
                <Search className="pointer-events-none absolute left-2.5 size-4 text-slate-600" />
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Tìm mã..."
                  className="w-full rounded-md border border-white/[0.09] bg-[#05080e] py-2.5 pl-9 pr-8 text-[13px] font-medium text-white outline-none transition-colors placeholder:text-slate-600 focus:border-cyan-400/45"
                />
                {query ? (
                  <button type="button" onClick={() => setQuery("")} className="absolute right-2 rounded p-1 text-slate-600 transition-colors hover:bg-white/[0.05] hover:text-white" aria-label="Xóa tìm kiếm">
                    <X className="size-3.5" />
                  </button>
                ) : null}
              </div>

              <div className="flex items-center gap-0.5 overflow-x-auto" role="tablist" aria-label="Lọc watchlist Wyckoff">
                {WATCHLIST_TABS.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={activeTab === tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={cn(
                      "shrink-0 rounded px-2.5 py-1.5 text-[11px] font-bold transition-colors",
                      activeTab === tab.id ? "bg-cyan-500/16 text-cyan-300" : "text-slate-500 hover:bg-white/[0.04] hover:text-slate-200",
                    )}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-[minmax(70px,1fr)_76px_72px_88px] items-center gap-1 border-b border-white/[0.06] bg-[#070b10] px-3 py-2 font-ticker text-[10.5px] font-bold uppercase tracking-wide text-slate-600">
              <div>Mã</div>
              <div className="text-right">Giá</div>
              <div className="text-right">+/- %</div>
              <div className="text-right">Pha</div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              {filteredStocks.map((stock) => (
                <WatchlistRow key={stock.ticker} stock={stock} isActive={stock.ticker === ticker} activeTimeframe={activeTimeframe} />
              ))}
              {!filteredStocks.length ? <div className="p-8 text-center text-sm text-slate-500">Không tìm thấy mã phù hợp</div> : null}
            </div>
          </aside>
        </div>
      </main>
    </div>
  )
}

function MetricCard({
  tone,
  icon,
  title,
  children,
}: {
  tone: "emerald" | "cyan" | "amber" | "purple"
  icon: React.ReactNode
  title: string
  children: React.ReactNode
}) {
  const toneClass = {
    emerald: "border-emerald-400/16 text-emerald-300",
    cyan: "border-cyan-400/16 text-cyan-300",
    amber: "border-amber-400/16 text-amber-300",
    purple: "border-purple-400/16 text-purple-300",
  }[tone]

  return (
    <div className={cn("min-w-0 rounded-lg border bg-[#081019] p-3 shadow-sm", toneClass)}>
      <div className="flex items-center gap-1.5 font-ticker text-[10.5px] font-bold uppercase tracking-wide">
        {icon}
        <span className="truncate">{title}</span>
      </div>
      {children}
    </div>
  )
}
