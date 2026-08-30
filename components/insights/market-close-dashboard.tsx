"use client"

import * as React from "react"
import { Activity, BarChart3, BookOpen, CircleDollarSign, Gauge, LineChart } from "lucide-react"

import { MetricGuideDialog } from "@/components/insights/metric-guide-dialog"
import {
  IndexBreadthChart, IndexPerformanceChart, InstitutionalFlowChart,
  MaBreadthChart, MarketHistoryChart, MarketHistoryFlowChart,
} from "@/components/insights/market-close-charts"
import { MarketBubbles, type MarketBubbleStock } from "@/components/insights/market-bubbles"
import { SectorMapPanel } from "@/components/insights/sector-map-panel"
import { MarketHealthView } from "@/components/insights/market-health-view"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import type { MarketCloseDashboardData, MarketSectorRow } from "@/lib/market-insight-data"
import type { InsightsRatingRow } from "@/lib/insights-data"
import { cn } from "@/lib/utils"

export type { MarketBubbleStock }

interface MarketCloseDashboardProps {
  data: MarketCloseDashboardData | null
  ratings?: InsightsRatingRow[]
  bubbleStocks?: MarketBubbleStock[]
  onOpenStockDetail?: (ticker: string) => void
}

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

const surface = "insights-glass-panel border-white/[0.09] bg-[#0a1820]/90 shadow-[0_20px_60px_-48px_rgba(45,212,191,0.55)]"

function PanelHeading({ title, description, icon: Icon }: { title: string; description: string; icon: React.ComponentType<{ className?: string }> }) {
  return (
    <CardHeader className="border-b border-white/[0.06] px-4 py-3.5">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border border-teal-300/20 bg-teal-300/[0.07] text-teal-200"><Icon className="size-4" /></span>
        <div className="min-w-0"><CardTitle className="text-sm font-bold text-white">{title}</CardTitle><CardDescription className="mt-1 line-clamp-1 text-[11px]">{description}</CardDescription></div>
      </div>
    </CardHeader>
  )
}

function SectionHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return (
    <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
      <div><p className="text-[10px] font-black uppercase tracking-[0.24em] text-teal-300/80">{eyebrow}</p><h3 className="mt-1 text-lg font-bold text-white sm:text-xl">{title}</h3></div>
      <p className="max-w-xl text-xs leading-5 text-slate-500 sm:text-right">{description}</p>
    </div>
  )
}

function BreadthBar({ label, value, total, tone }: { label: string; value: number; total: number; tone: "up" | "flat" | "down" }) {
  const width = total > 0 ? Math.max(2, value / total * 100) : 0
  const bar = tone === "up" ? "bg-teal-300" : tone === "down" ? "bg-rose-400" : "bg-sky-200/70"
  return (
    <div className="grid grid-cols-[68px_1fr_38px] items-center gap-3 text-[11px]">
      <span className="text-slate-500">{label}</span><div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]"><div className={cn("h-full rounded-full", bar)} style={{ width: `${width}%` }} /></div><strong className="text-right font-mono text-slate-300">{value}</strong>
    </div>
  )
}

const BUBBLE_PERIODS = ["1D", "1W", "1M", "1Y"] as const

export function MarketCloseDashboard({ data, ratings = [], bubbleStocks = [], onOpenStockDetail }: MarketCloseDashboardProps) {
  const [guideOpen, setGuideOpen] = React.useState(false)
  const [marketView, setMarketView] = React.useState<"pulse" | "health">("pulse")

  if (!data) return (
    <Card className={cn(surface, "py-12 text-center")}><CardContent className="space-y-3"><Activity className="mx-auto size-10 text-slate-600" /><CardTitle>Chưa có dữ liệu phiên đóng cửa</CardTitle><CardDescription>Snapshot sau phiên được cập nhật tự động sau 15:15 vào ngày giao dịch.</CardDescription></CardContent></Card>
  )

  const { sessionDate, asOf, dailySummary, indexes, sectors, sectorHistory = [], history } = data

  return (
    <div className="space-y-10" data-stock-analytics-dashboard data-liquid-glass-dashboard>
      {/* 1. Market Overview Tiles & Bubbles Section */}
      <section aria-labelledby="market-overview-title" className="space-y-3">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{indexes.map((item) => <IndexTile key={item.indexCode} item={item} />)}</div>
        <p className="px-1 text-[10px] text-slate-600">Phiên {sessionDate} · cập nhật {formatTime(asOf)} · dữ liệu EOD đã chuẩn hóa</p>

        <Card className={cn(surface, "overflow-hidden py-0")}>
          <CardHeader className="flex flex-col gap-2 border-b border-white/[0.07] px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-teal-300/70">Market bubbles</p>
              <h2 id="market-overview-title" className="mt-1 text-lg font-bold text-white">Bubbles · Bản đồ giao dịch thị trường</h2>
              <p className="mt-1 text-[11px] text-slate-500">Kích thước theo mức độ tăng giảm giá, màu theo biến động từng kỳ (1D, 1W, 1M, 1Y).</p>
            </div>
          </CardHeader>
          <CardContent className="p-4 sm:p-5 min-h-[650px]">
            {/* bubbleStocks supports all stocks in database or slice(0, 100) */}
            <MarketBubbles
              stocks={bubbleStocks}
              onOpenStockDetail={onOpenStockDetail}
              defaultPeriod="1D"
            />
          </CardContent>
        </Card>
      </section>

      {/* 2. Market Intelligence Panel (Nhịp đập, Nỗ lực kết quả, Sức khoẻ thị trường) */}
      <MarketIntelligencePanel view={marketView} onViewChange={setMarketView} data={data} onOpenGuide={() => setGuideOpen(true)} />

      {/* 3. Sector Map Section (Nhóm ngành đang dẫn nhịp) */}
      <section aria-labelledby="market-sectors-title" className="space-y-4 border-t border-white/[0.06] pt-8">
        <div id="market-sectors-title">
          <SectionHeading
            eyebrow="Sector map"
            title="Nhóm ngành đang dẫn nhịp"
            description="Đọc hiệu suất cùng độ lan tỏa, Nỗ lực kết quả và Luân chuyển dòng tiền ngành để tránh nhầm một vài mã tăng với sức mạnh toàn ngành."
          />
        </div>
        <SectorMapPanel
          sectors={sectors}
          ratings={ratings}
          sectorHistory={sectorHistory}
          marketHistory={history}
          onOpenStockDetail={onOpenStockDetail}
        />
      </section>

      {/* 4. Breadth & Flow Charts */}
      <section aria-labelledby="market-breadth-title" className="space-y-4 border-t border-white/[0.06] pt-8">
        <div id="market-breadth-title"><SectionHeading eyebrow="Breadth & flow" title="Độ rộng, xu hướng và dòng tiền" description="Ba góc nhìn thiết yếu để xác nhận mức bền vững của chuyển động giá." /></div>
        <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-4" data-market-close-chart-grid>
          <ChartPanel icon={LineChart} title="Hiệu suất chỉ số" description="Biến động và giá trị giao dịch"><IndexPerformanceChart indexes={indexes} /></ChartPanel><ChartPanel icon={BarChart3} title="Độ rộng thị trường" description="Mã tăng, đứng giá và giảm"><IndexBreadthChart indexes={indexes} /></ChartPanel><ChartPanel icon={Gauge} title="Sức khỏe xu hướng" description="Tỷ lệ cổ phiếu trên các đường MA"><MaBreadthChart daily={dailySummary} /></ChartPanel><ChartPanel icon={CircleDollarSign} title="Dòng tiền tổ chức" description="Mua bán ròng theo nhóm nhà đầu tư"><InstitutionalFlowChart daily={dailySummary} /></ChartPanel>
        </div>
      </section>

      {/* 5. 20-Session Market History */}
      <section aria-labelledby="market-history-title" className="space-y-4 border-t border-white/[0.06] pt-8">
        <div id="market-history-title"><SectionHeading eyebrow="20-session context" title="Bối cảnh trước khi ra quyết định" description="Đặt phiên hiện tại cạnh sức khỏe và dòng tiền gần đây, thay vì chỉ nhìn một ngày." /></div>
        <div className="grid gap-3 xl:grid-cols-2" data-market-close-chart-grid><ChartPanel icon={Gauge} title="Tâm lý, rủi ro và MA20" description="Thang điểm sức khỏe qua tối đa 20 phiên"><MarketHistoryChart history={history} /></ChartPanel><ChartPanel icon={CircleDollarSign} title="Dòng tiền theo phiên" description="Khối ngoại và tự doanh quanh trục trung tính"><MarketHistoryFlowChart history={history} /></ChartPanel></div>
      </section>

      <MetricGuideDialog open={guideOpen} onOpenChange={setGuideOpen} />
    </div>
  )
}

function MarketIntelligencePanel({ view, onViewChange, data, onOpenGuide }: { view: "pulse" | "health"; onViewChange: (view: "pulse" | "health") => void; data: MarketCloseDashboardData; onOpenGuide: () => void }) {
  const { dailySummary, indexes, history, marketRegime } = data
  const vnindex = indexes.find((item) => item.indexCode === "VNINDEX")
  const breadthTotal = Math.max(1, (vnindex?.advances ?? 0) + (vnindex?.unchanged ?? 0) + (vnindex?.declines ?? 0))
  return (
    <section aria-labelledby="market-intelligence-title">
      <Card className={cn(surface, "overflow-hidden py-0")}>
        <div className="grid grid-cols-2 gap-1 border-b border-white/[0.07] bg-black/10 p-1.5">{([{ key: "pulse", label: "Nhịp đập thị trường" }, { key: "health", label: "Sức khoẻ thị trường" }] as const).map((item) => <button key={item.key} type="button" onClick={() => onViewChange(item.key)} className={cn("rounded-lg px-2 py-3 text-xs font-bold transition-colors sm:text-sm", view === item.key ? "bg-white/[0.08] text-white" : "text-slate-500 hover:text-slate-200")}>{item.label}</button>)}</div>
        <CardContent className="p-5 sm:p-6">
          {view === "pulse" && <div className="grid gap-6 xl:grid-cols-[.85fr_1.15fr]">
            <div><p className="text-[10px] font-black uppercase tracking-[0.2em] text-teal-300/70">Tổng quan thị trường</p><div className="mt-4 flex items-center gap-5"><div className="flex size-28 shrink-0 items-center justify-center rounded-full border border-amber-300/20 bg-amber-300/[0.06]"><strong className="text-center text-lg font-black uppercase text-amber-300">{marketRegime || "Chưa rõ"}</strong></div><div className="grid flex-1 grid-cols-2 gap-2"><PulseStat label="Tâm lý" value={`${formatNumber(dailySummary.sentimentScore, 0)} · ${dailySummary.sentimentLabel || "—"}`} /><PulseStat label="Rủi ro" value={formatNumber(dailySummary.riskScore, 2)} tone={(dailySummary.riskScore ?? 0) >= 60 ? "down" : "up"} /><PulseStat label="Khối ngoại" value={`${formatSigned(dailySummary.foreignNetValue, 0)} tỷ`} tone={(dailySummary.foreignNetValue ?? 0) >= 0 ? "up" : "down"} /><PulseStat label="Phân phối" value={`${dailySummary.distributionCount ?? "—"} ngày`} /></div></div></div>
            <div className="space-y-4"><BreadthBar label="Tăng giá" value={vnindex?.advances ?? 0} total={breadthTotal} tone="up" /><BreadthBar label="Đứng giá" value={vnindex?.unchanged ?? 0} total={breadthTotal} tone="flat" /><BreadthBar label="Giảm giá" value={vnindex?.declines ?? 0} total={breadthTotal} tone="down" /><div className="grid grid-cols-2 gap-2 pt-2 sm:grid-cols-4"><PulseStat label="Trên MA10" value={`${formatNumber(dailySummary.aboveMa10Pct, 0)}%`} /><PulseStat label="Trên MA20" value={`${formatNumber(dailySummary.aboveMa20Pct, 0)}%`} /><PulseStat label="Trên MA50" value={`${formatNumber(dailySummary.aboveMa50Pct, 0)}%`} /><PulseStat label="Trên MA200" value={`${formatNumber(dailySummary.aboveMa200Pct, 0)}%`} /></div></div>
          </div>}
          {view === "health" && <MarketHealthView data={data} history={history} />}
        </CardContent>
      </Card>
    </section>
  )
}

function PulseStat({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" }) {
  return <div className="rounded-lg border border-white/[0.06] bg-white/[0.025] p-3"><span className="text-[10px] text-slate-500">{label}</span><strong className={cn("mt-1 block font-mono text-sm text-white", tone === "up" && "text-teal-300", tone === "down" && "text-rose-300")}>{value}</strong></div>
}

function IndexTile({ item }: { item: MarketCloseDashboardData["indexes"][number] }) {
  const positive = (item.changePct ?? 0) >= 0
  const total = Math.max(1, item.advances + item.unchanged + item.declines)
  return <Card className={cn(surface, "group py-0 transition-colors hover:border-teal-300/20")}><CardContent className="p-4"><div className="flex items-center justify-between gap-2"><div><span className="font-mono text-xs font-black text-slate-300">{item.indexCode}</span><span className="ml-2 text-[9px] text-slate-600">{item.indexCode === "VNINDEX" ? "HOSE" : item.indexCode === "VN30" ? "Rổ vốn hóa lớn" : item.indexCode}</span></div><span className={cn("font-mono text-[11px] font-bold", positive ? "text-teal-300" : "text-rose-300")}>{formatSigned(item.changePct, 2, "%")}</span></div><strong className="mt-3 block font-mono text-xl font-black text-white">{formatNumber(item.value)}</strong><div className="mt-3 flex h-1.5 overflow-hidden rounded-full bg-slate-700/50"><span className="bg-teal-300" style={{ width: `${item.advances / total * 100}%` }} /><span className="bg-slate-500" style={{ width: `${item.unchanged / total * 100}%` }} /><span className="bg-rose-400" style={{ width: `${item.declines / total * 100}%` }} /></div><div className="mt-2 flex justify-between font-mono text-[9px] text-slate-600"><span>{item.advances} tăng</span><span>{item.declines} giảm</span></div></CardContent></Card>
}

function ChartPanel({ icon, title, description, children }: { icon: React.ComponentType<{ className?: string }>; title: string; description: string; children: React.ReactNode }) {
  return <Card className={cn(surface, "py-0")}><PanelHeading icon={icon} title={title} description={description} /><CardContent className="p-3">{children}</CardContent></Card>
}

