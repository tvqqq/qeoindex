"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import {
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  ExternalLink,
  GripVertical,
  HelpCircle,
  Search,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
} from "lucide-react"

import { WyckoffLightweightChart } from "@/components/insights/wyckoff-lightweight-chart"
import { StockLogo } from "@/components/stock-logo"
import { TopNav } from "@/components/top-nav"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { WyckoffChartStudy, WyckoffChartTimeframe } from "@/lib/wyckoff-chart-model"

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

function number(value: number | null | undefined, digits = 2) {
  if (value == null || !Number.isFinite(value)) return "—"
  return value.toLocaleString("en-US", { maximumFractionDigits: digits })
}

function percent(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—"
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`
}

function biasTone(bias: string) {
  if (bias === "Bullish") return "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
  if (bias === "Bearish") return "border-rose-400/30 bg-rose-400/10 text-rose-300"
  return "border-amber-300/25 bg-amber-300/8 text-amber-200"
}

function phaseShort(phase: string) {
  if (/Spring/i.test(phase)) return "Spring · Phase C"
  if (/UT\/UTAD/i.test(phase)) return "UT/UTAD · Phase C"
  if (/SOS/i.test(phase)) return "SOS · Phase D"
  if (/SOW/i.test(phase)) return "SOW · Phase D"
  if (/Markup/i.test(phase)) return "Markup watch"
  if (/Markdown/i.test(phase)) return "Markdown watch"
  return phase || "Chưa phân loại"
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
  const current = studies.find((study) => study.timeframe === activeTimeframe) ?? studies[0]
  const selected = stocks.find((stock) => stock.ticker === ticker)
  const filteredStocks = useMemo(() => {
    const normalized = query.trim().toUpperCase()
    if (!normalized) return stocks
    return stocks.filter((stock) => `${stock.ticker} ${stock.sector} ${stock.phase} ${stock.bias}`.toUpperCase().includes(normalized))
  }, [query, stocks])
  const latest = current?.bars.at(-1)
  const change = current?.analysis?.technical.changePct ?? selected?.changePct ?? null

  function chooseTimeframe(timeframe: WyckoffChartTimeframe) {
    setActiveTimeframe(timeframe)
    updateTimeframeQuery(timeframe)
  }

  return (
    <div className="min-h-screen bg-[#05080d] text-slate-100 font-ticker">
      <TopNav />

      <main className="mx-auto max-w-[1920px] px-3 py-4 sm:px-4 lg:px-5">
        {/* ORDERBOOK-STYLED HEADER WITH BACK BUTTON TO INSIGHTS DETAIL POPUP */}
        <header className="mb-4 flex select-none items-center justify-between gap-2.5 border border-white/[0.10] bg-gradient-to-r from-[#121820]/95 via-[#182330]/95 to-[#121820]/95 px-4 py-2.5 rounded-xl shadow-[inset_0_1px_0_0_rgba(255,255,255,0.12),0_4px_16px_rgba(0,0,0,0.4)] backdrop-blur-2xl">
          {/* Left: Back Button, Grip, Logo, Ticker & Bias */}
          <div className="flex items-center gap-2.5 min-w-0 shrink">
            <Link
              href={`/insights?ticker=${ticker}`}
              aria-label={`Quay lại Insights & mở popup chi tiết ${ticker}`}
              title={`Quay lại Insights & mở popup chi tiết ${ticker}`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-2.5 py-1 font-ticker text-xs font-bold text-cyan-300 hover:bg-cyan-500/20 hover:border-cyan-400/50 transition-all shadow-[0_0_12px_rgba(34,211,238,0.2)] shrink-0"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Chi tiết rating</span>
            </Link>

            <GripVertical className="h-4 w-4 text-white/30 hover:text-white/60 shrink-0 transition-colors hidden sm:block" />
            
            <StockLogo
              symbol={ticker}
              size={32}
              className="shrink-0 rounded-full border-white/40 drop-shadow-[0_0_8px_rgba(255,255,255,0.75)]"
            />
            
            <span className="font-ticker text-xl sm:text-2xl font-extrabold italic bg-gradient-to-br from-white via-cyan-100 to-emerald-200 bg-clip-text text-transparent pr-2 drop-shadow-[0_0_15px_rgba(34,211,238,0.2)] tracking-tight shrink-0 select-none">
              {ticker}
            </span>
            
            {selected?.sector ? (
              <span className="hidden md:inline-flex rounded-full bg-white/[0.08] border border-white/[0.12] px-2 py-0.5 font-ticker text-[9.5px] font-bold text-white/70 uppercase tracking-wider shrink-0 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.1)]">
                {selected.sector}
              </span>
            ) : null}

            <span className={`rounded-full border px-2 py-0.5 font-ticker text-[10px] font-bold shrink-0 ${biasTone(current?.analysis?.taBias ?? selected?.bias ?? "")}`}>
              {current?.analysis?.taBias ?? selected?.bias ?? "Pending"}
            </span>
          </div>

          {/* Right: Live Price & Change Pill, Divider, Action Controls */}
          <div className="flex items-center gap-2.5 shrink-0">
            {/* Price & Change Pill */}
            <div className="flex items-center gap-2">
              <span className={`font-mono text-lg sm:text-xl font-black tracking-tight rounded px-1 transition-colors drop-shadow-[0_1px_3px_rgba(0,0,0,0.6)] ${(change ?? 0) >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                {number(latest?.close ?? selected?.price)}
              </span>
              <span className={`inline-flex shrink-0 items-center justify-center font-mono text-xs font-bold px-1.5 py-0.5 rounded leading-none ${(change ?? 0) >= 0 ? "text-emerald-300 bg-emerald-500/10 border border-emerald-500/20" : "text-rose-300 bg-rose-500/10 border border-rose-500/20"}`}>
                {percent(change)}
              </span>
            </div>

            {/* Action Controls */}
            <div className="flex items-center gap-0.5 border-l border-white/10 pl-1.5 ml-0.5">
              <Link
                href={`/insights?ticker=${ticker}`}
                aria-label={`Mở popup chi tiết rating ${ticker}`}
                title="Hồ sơ rating Insights"
                className="rounded p-1.5 text-white/50 hover:bg-white/[0.08] hover:text-white transition-colors"
              >
                <Sparkles className="h-3.5 w-3.5" />
              </Link>

              <Link
                href={`/research/${ticker.toLowerCase()}`}
                aria-label={`Mở phân tích chuyên sâu ${ticker}`}
                title="Mở phân tích chuyên sâu"
                className="rounded p-1.5 text-white/50 hover:bg-white/[0.08] hover:text-white transition-colors"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>
        </header>

        <div className="grid min-h-[760px] overflow-hidden rounded-2xl border border-white/[0.09] bg-[#080c12] shadow-[0_25px_90px_-45px_rgba(0,0,0,.95)] xl:grid-cols-[minmax(0,1fr)_370px]">
          <section className="min-w-0 border-b border-white/[0.08] xl:border-b-0 xl:border-r">
            <div className="flex flex-col gap-3 border-b border-white/[0.08] bg-[#0b1018] px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-4">
              <div className="flex gap-1.5 overflow-x-auto">
                {studies.map((study) => (
                  <button
                    key={study.timeframe}
                    type="button"
                    onClick={() => chooseTimeframe(study.timeframe)}
                    className={`min-w-14 rounded-lg border px-3 py-2 text-xs font-extrabold transition-colors ${activeTimeframe === study.timeframe ? "border-emerald-300/45 bg-emerald-300/12 text-emerald-200" : "border-white/[0.08] bg-white/[0.025] text-slate-400 hover:text-white"}`}
                  >
                    {study.timeframe}
                  </button>
                ))}
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
              <div className="pointer-events-none absolute left-3 top-3 z-[3] max-w-[min(520px,calc(100%-1.5rem))] rounded-xl border border-white/10 bg-[#080d15]/90 px-3 py-2.5 shadow-2xl backdrop-blur sm:left-4 sm:top-4">
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

            <div className="border-t border-white/[0.08] bg-[#080d14] p-3 sm:p-4">
              <div className="grid gap-3 lg:grid-cols-3">
                {current?.scenarios.map((scenario) => {
                  const Icon = scenario.key === "bull" ? TrendingUp : scenario.key === "bear" ? TrendingDown : Target
                  return (
                    <article key={scenario.key} className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-3.5">
                      <div className="flex items-center justify-between gap-3">
                        <span className="inline-flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider" style={{ color: scenario.color }}><Icon className="h-4 w-4" />{scenario.label}</span>
                        <span className="font-mono text-lg font-black text-white">{scenario.probability}%</span>
                      </div>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.06]"><div className="h-full rounded-full" style={{ width: `${scenario.probability}%`, backgroundColor: scenario.color }} /></div>
                      <p className="mt-2 text-xs leading-5 text-slate-400">{scenario.description}</p>
                    </article>
                  )
                })}
              </div>
              <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                <div className="flex items-start gap-2 rounded-lg border border-emerald-400/15 bg-emerald-400/[0.04] px-3 py-2.5 text-slate-400"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" /><span><strong className="text-slate-200">Xác nhận:</strong> {current?.analysis?.confirmation ?? "Chưa đủ dữ liệu."}</span></div>
                <div className="flex items-start gap-2 rounded-lg border border-rose-400/15 bg-rose-400/[0.04] px-3 py-2.5 text-slate-400"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-300" /><span><strong className="text-slate-200">Phủ định:</strong> {current?.analysis?.invalidation ?? "Chưa đủ dữ liệu."}</span></div>
              </div>
              <p className="mt-3 text-[11px] leading-5 text-slate-500">Các đường phía trước là projection định lượng từ phase, ATR, support/resistance và xác suất rule-engine; không phải dữ liệu giá tương lai hay khuyến nghị mua bán.</p>
            </div>
          </section>

          <aside className="flex min-h-[680px] flex-col bg-[#090e15] xl:max-h-[calc(100vh-110px)]">
            <div className="border-b border-white/[0.08] p-4">
              <div className="flex items-center justify-between gap-3">
                <div><h2 className="font-ticker text-lg font-extrabold italic text-white">Top 100 Wyckoff Scan</h2><p className="mt-1 text-[11px] text-slate-500">Snapshot {generatedAt.slice(0, 10)} · {stocks.length} mã</p></div>
                <BarChart3 className="h-5 w-5 text-emerald-300" />
              </div>
              <label className="mt-3 flex items-center gap-2 rounded-lg border border-white/10 bg-[#060a10] px-3 py-2.5">
                <Search className="h-4 w-4 text-slate-500" />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm mã, ngành, phase..." className="w-full bg-transparent text-sm text-white outline-none placeholder:text-slate-600" />
              </label>
            </div>
            <div className="flex-1 overflow-y-auto">
              {filteredStocks.map((stock) => {
                const isActive = stock.ticker === ticker
                return (
                  <Link
                    key={stock.ticker}
                    href={`/insights/wyckoff?ticker=${encodeURIComponent(stock.ticker)}&timeframe=${activeTimeframe}`}
                    prefetch={false}
                    className={`grid grid-cols-[28px_1fr_auto] gap-2.5 border-b border-white/[0.055] px-3 py-3 transition-colors ${isActive ? "bg-emerald-400/[0.08] shadow-[inset_3px_0_0_#22c98a]" : "hover:bg-white/[0.035]"}`}
                  >
                    <StockLogo symbol={stock.ticker} size={28} className="rounded-md" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2"><span className="font-mono text-sm font-black text-white">{stock.ticker}</span><span className="truncate text-[10px] uppercase tracking-wide text-slate-600">#{stock.rank} · {stock.sector || "HOSE"}</span></div>
                      <div className="mt-1 truncate text-[11px] text-slate-400">{phaseShort(stock.phase)}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono text-xs font-bold text-slate-200">{number(stock.price)}</div>
                      <div className={`mt-1 font-mono text-[10px] font-bold ${(stock.changePct ?? 0) >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{percent(stock.changePct)}</div>
                    </div>
                  </Link>
                )
              })}
              {!filteredStocks.length ? <div className="p-8 text-center text-sm text-slate-500">Không có mã phù hợp.</div> : null}
            </div>
          </aside>
        </div>
      </main>
    </div>
  )
}
