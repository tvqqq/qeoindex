import * as React from "react"
import { Activity, BarChart3, BrainCircuit, CircleDollarSign, CircleDot, Gauge, LineChart } from "lucide-react"

import {
  IndexBreadthChart, IndexPerformanceChart, InstitutionalFlowChart,
  MaBreadthChart,
} from "@/components/insights/market-close-charts"
import { MarketBubbles, type MarketBubbleStock } from "@/components/insights/market-bubbles"
import { SectorMapPanel } from "@/components/insights/sector-map-panel"
import { MarketHealthView, MarketSentimentCard } from "@/components/insights/market-health-view"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import type { MarketCloseDashboardData } from "@/modules/research/market-insight/data"
import type { InsightsRatingRow } from "@/modules/research/insights/data"
import type { MarketAiConclusionView } from "@/lib/market-ai-conclusion-loader"
import { cn } from "@/lib/utils"
import { MarketWidgetChildHeader } from "@/components/insights/market-widget-child-header"

export type { MarketBubbleStock }

interface MarketCloseDashboardProps {
  data: MarketCloseDashboardData | null
  ratings?: InsightsRatingRow[]
  bubbleStocks?: MarketBubbleStock[]
  bubbleAsOfDate?: string | null
  onOpenStockDetail?: (ticker: string) => void
  marketAiConclusion?: MarketAiConclusionView
}

type PulseTone = "up" | "down" | "warning"

function formatNumber(value: number | null | undefined, decimals = 2) {
  if (value == null || !Number.isFinite(value)) return "—"
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: decimals }).format(value)
}

function formatSigned(value: number | null | undefined, decimals = 2, suffix = "") {
  if (value == null || !Number.isFinite(value)) return "—"
  return `${value > 0 ? "+" : ""}${formatNumber(value, decimals)}${suffix}`
}

function formatTime(iso: string) {
  try {
    return new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(iso))
  } catch { return iso }
}

function getDistributionDayGuidance(value: number | null | undefined): { message: string; tone?: PulseTone } {
  if (value == null || !Number.isFinite(value)) return { message: "Chưa có dữ liệu" }

  const days = Math.max(0, Math.trunc(value))
  if (days <= 2) return { message: "Chưa cần hành động", tone: "up" }
  if (days === 3) return { message: "Bắt đầu quan sát kỹ hơn", tone: "warning" }
  if (days === 4) return { message: "Tìm kiếm tín hiệu bán", tone: "down" }
  return { message: "Ưu tiên phòng thủ", tone: "down" }
}

const surface = "insights-glass-panel border-white/[0.09] bg-[#0a1820]/90 shadow-[0_20px_60px_-48px_rgba(45,212,191,0.55)]"

export function MarketCloseDashboard({ data, ratings = [], bubbleStocks = [], bubbleAsOfDate = null, onOpenStockDetail, marketAiConclusion }: MarketCloseDashboardProps) {
  if (!data) return (
    <Card className={cn(surface, "py-12 text-center")}><CardContent className="space-y-3"><Activity className="mx-auto size-10 text-slate-500" /><CardTitle className="font-bold text-white font-sans">Chưa có dữ liệu phiên đóng cửa</CardTitle><CardDescription className="text-sm italic text-slate-300">Snapshot sau phiên được cập nhật tự động sau 15:15 vào ngày giao dịch.</CardDescription></CardContent></Card>
  )

  const { sectors, sectorHistory = [], history } = data

  return (
    <div className="space-y-10" data-stock-analytics-dashboard data-liquid-glass-dashboard>
      <style data-market-heading-typography>{`
        [data-market-sector-workspace] p.font-mono + h3,
        #top-stocks-title {
          font-size: 1.25rem;
          line-height: 1.75rem;
          font-weight: 700;
          letter-spacing: -0.025em;
          font-family: var(--font-sans);
        }

        [data-market-sector-workspace] p.font-mono + h3 + p,
        #top-stocks-title + p {
          color: #cbd5e1;
          font-size: 0.8125rem;
          line-height: 1.25rem;
        }

        [data-market-sector-workspace] .text-slate-400,
        #top-stocks .text-slate-400 {
          color: #cbd5e1;
        }

        [data-market-sector-workspace] .text-slate-500,
        [data-market-sector-workspace] .text-slate-600,
        #top-stocks .text-slate-500,
        #top-stocks .text-slate-600 {
          color: #94a3b8;
        }

        @media (min-width: 640px) {
          [data-market-sector-workspace] p.font-mono + h3,
          #top-stocks-title {
            font-size: 1.5rem;
            line-height: 2rem;
          }
        }
      `}</style>

      {/* 1. Market Bubbles Section */}
      <section aria-labelledby="market-overview-title" className="space-y-3">
        <Card className={cn(surface, "overflow-hidden py-0")}>
          <CardHeader className="flex flex-col gap-2 border-b border-white/[0.07] px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3.5">
              <span className="flex size-9 sm:size-10 shrink-0 items-center justify-center rounded-xl border border-cyan-400/20 bg-cyan-400/[0.08] text-cyan-300 shadow-sm">
                <CircleDot className="size-4 sm:size-5" />
              </span>
              <div>
                <p className="text-[10px] font-mono font-black uppercase tracking-[0.22em] text-teal-300/80">
                  Market bubbles
                </p>
                <h2 id="market-overview-title" className="mt-0.5 text-lg font-bold text-white tracking-tight font-sans">
                  Bubbles · Bản đồ giao dịch thị trường
                </h2>
                <p className="mt-0.5 text-sm text-slate-300 italic font-medium">
                  Top Stocks canonical; xếp theo KLGD TB 50 phiên giảm dần, hiển thị toàn bộ universe (tối đa 200 mã). Kích thước theo biến động giá.
                </p>
                <p className="mt-1 text-[11px] font-mono text-slate-400">Nguồn KFSP · snapshot {bubbleAsOfDate ?? "—"} · thiếu dữ liệu không được bù</p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-4 sm:p-5 min-h-[650px]">
            <MarketBubbles
              stocks={bubbleStocks}
              onOpenStockDetail={onOpenStockDetail}
              defaultPeriod="1D"
            />
          </CardContent>
        </Card>
      </section>

      {/* 2. Market Intelligence Panel */}
      <MarketIntelligencePanel data={data} marketAiConclusion={marketAiConclusion} />

      {/* 3. Sector Map Section */}
      <section aria-labelledby="market-sectors-title" className="space-y-4 border-t border-white/[0.06] pt-8">
        <h2 id="market-sectors-title" className="sr-only">Ngành & dòng tiền</h2>
        <div data-market-sector-workspace>
          <SectorMapPanel
            sectors={sectors}
            ratings={ratings}
            sectorHistory={sectorHistory}
            marketHistory={history}
            onOpenStockDetail={onOpenStockDetail}
          />
        </div>
      </section>
    </div>
  )
}

function MarketIntelligencePanel({ data, marketAiConclusion }: { data: MarketCloseDashboardData; marketAiConclusion?: MarketAiConclusionView }) {
  const { dailySummary, indexes, history, marketRegime } = data
  const distributionGuidance = getDistributionDayGuidance(dailySummary.distributionCount)

  return (
    <section aria-labelledby="market-intelligence-title" data-market-intelligence-panel>
      <Card className={cn(surface, "overflow-hidden py-0")}>
        <div className="flex items-center border-b border-white/[0.07] bg-black/10 px-4 py-3.5 sm:px-5">
          <div className="flex items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-emerald-400/20 bg-emerald-400/[0.08] text-emerald-300 shadow-sm">
              <Activity className="size-4 sm:size-5" />
            </span>
            <div>
              <span id="market-intelligence-title" className="block text-base font-bold tracking-wide text-white font-sans">
                Nhịp đập thị trường & Sức khoẻ thị trường
              </span>
              <span className="text-sm font-medium italic text-slate-300 font-sans">
                Chỉ báo sức khỏe & bối cảnh thị trường
              </span>
            </div>
          </div>
        </div>
        <CardContent className="p-5 sm:p-6">
          {marketAiConclusion?.status === "succeeded" && (
            <div data-market-ai-conclusion className="rounded-2xl border border-violet-400/20 bg-violet-400/[0.05] p-4">
              <div className="flex items-start gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-violet-400/25 bg-violet-400/[0.08] text-violet-300 shadow-sm">
                  <BrainCircuit className="size-5" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <strong className="text-sm font-bold leading-6 text-white sm:text-base">{marketAiConclusion.payload?.headline}</strong>
                    <span className="shrink-0 font-mono text-[11px] font-bold text-violet-300">{marketAiConclusion.payload?.posture} · {marketAiConclusion.payload?.confidence}</span>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-slate-200">{marketAiConclusion.payload?.conclusion}</p>
                </div>
              </div>
            </div>
          )}

          <div data-market-intelligence-overview-row className="mt-4 grid gap-4 xl:grid-cols-3 xl:items-stretch">
            <div data-market-summary-column className="flex h-full items-center rounded-2xl border border-white/[0.08] bg-[#07131d]/90 p-4 shadow-xl sm:p-5">
              <div className="flex w-full items-center gap-3">
                <div className="flex size-20 shrink-0 items-center justify-center rounded-full border border-amber-300/20 bg-amber-300/[0.06] sm:size-24">
                  <strong className="px-2 text-center text-xs font-black uppercase text-amber-300 font-sans sm:text-sm">{marketRegime || "Không suy diễn"}</strong>
                </div>
                <div data-market-summary-stats className="grid min-w-0 flex-1 auto-rows-fr grid-cols-2 gap-2">
                  <PulseStat label="Tâm lý" value={`${formatNumber(dailySummary.sentimentScore, 0)} · ${dailySummary.sentimentLabel || "—"}`} />
                  <PulseStat label="Rủi ro" value={formatNumber(dailySummary.riskScore, 2)} tone={(dailySummary.riskScore ?? 0) >= 0.7 ? "down" : "up"} />
                  <PulseStat label="Ngày phân phối" value={`${dailySummary.distributionCount ?? "—"} ngày`} tone={distributionGuidance.tone} />
                  <PulseStat label="Hành động" value={distributionGuidance.message} tone={distributionGuidance.tone} />
                </div>
              </div>
            </div>

            <div data-market-sentiment-column className="h-full [&>*]:h-full">
              <MarketSentimentCard data={data} />
            </div>

            <div data-market-index-column className="flex h-full flex-col rounded-2xl border border-white/[0.08] bg-[#07131d]/90 p-4 shadow-xl sm:p-5">
              <div data-market-index-strip className="grid flex-1 grid-cols-2 gap-2">
                {indexes.map((item) => <IndexTile key={item.indexCode} item={item} />)}
              </div>
              <p className="mt-2 px-1 text-[11px] font-mono text-slate-400">Phiên {data.sessionDate} · cập nhật {formatTime(data.asOf)} · nguồn KFSP Ngành</p>
            </div>
          </div>

          <div data-market-health-embedded className="mt-5 border-t border-white/[0.07] pt-5">
            <MarketHealthView data={data} history={history} />
          </div>

          <div id="market-charts-title" className="mt-5">
            <h3 className="sr-only">Nội lực thị trường & Phân tích chuyên sâu</h3>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 2xl:grid-cols-4" data-market-close-chart-grid>
            <ChartPanel icon={LineChart} title="Hiệu suất chỉ số" description="Biến động và giá trị giao dịch"><IndexPerformanceChart indexes={indexes} /></ChartPanel>
            <ChartPanel icon={BarChart3} title="Độ rộng thị trường" description="Mã tăng, đứng giá và giảm"><IndexBreadthChart indexes={indexes} /></ChartPanel>
            <ChartPanel icon={Gauge} title="Sức khỏe xu hướng" description="Tỷ lệ cổ phiếu trên các đường MA"><MaBreadthChart daily={dailySummary} /></ChartPanel>
            <ChartPanel icon={CircleDollarSign} title="Dòng tiền tổ chức" description="Mua bán ròng theo nhóm nhà đầu tư"><InstitutionalFlowChart daily={dailySummary} /></ChartPanel>
          </div>
        </CardContent>
      </Card>
    </section>
  )
}

function PulseStat({ label, value, tone }: { label: string; value: string; tone?: PulseTone }) {
  return (
    <div className="flex h-full min-h-[82px] flex-col rounded-lg border border-white/[0.06] bg-white/[0.025] p-2.5 sm:p-3">
      <span className="text-xs font-medium text-slate-300">{label}</span>
      <strong className={cn(
        "mt-1 block font-mono text-sm font-bold leading-5 text-white sm:text-base",
        tone === "up" && "text-teal-300",
        tone === "warning" && "text-amber-300",
        tone === "down" && "text-rose-300",
      )}>{value}</strong>
    </div>
  )
}

function IndexTile({ item }: { item: MarketCloseDashboardData["indexes"][number] }) {
  const positive = (item.changePct ?? 0) >= 0
  const total = Math.max(1, item.advances + item.unchanged + item.declines)
  return (
    <Card className={cn(surface, "group py-0 transition-colors hover:border-teal-300/20")}>
      <CardContent className="p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <span className="font-mono text-xs font-black text-slate-200">{item.indexCode}</span>
            <span className="ml-1.5 text-[10px] text-slate-400">{item.indexCode === "VNINDEX" ? "HOSE" : item.indexCode === "VN30" ? "Rổ vốn hóa lớn" : item.indexCode}</span>
          </div>
          <span className={cn("shrink-0 font-mono text-xs font-bold", positive ? "text-teal-300" : "text-rose-300")}>{formatSigned(item.changePct, 2, "%")}</span>
        </div>
        <strong className="mt-1.5 block font-mono text-xl font-black leading-none text-white">{formatNumber(item.value)}</strong>
        <div className="mt-2 flex h-1 overflow-hidden rounded-full bg-slate-700/50"><span className="bg-teal-300" style={{ width: `${item.advances / total * 100}%` }} /><span className="bg-slate-500" style={{ width: `${item.unchanged / total * 100}%` }} /><span className="bg-rose-400" style={{ width: `${item.declines / total * 100}%` }} /></div>
        <div className="mt-1.5 flex justify-between font-mono text-[10px] text-slate-400"><span>{item.advances} tăng</span><span>{item.declines} giảm</span></div>
      </CardContent>
    </Card>
  )
}

function ChartPanel({ icon, title, description, children }: { icon: React.ComponentType<{ className?: string }>; title: string; description: string; children: React.ReactNode }) {
  return <Card className={cn(surface, "py-0")}><MarketWidgetChildHeader icon={icon} title={title} description={description} /><CardContent className="p-3">{children}</CardContent></Card>
}
