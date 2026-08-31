import * as React from "react"
import { Activity, BarChart3, CircleDollarSign, CircleDot, Gauge, Layers, LineChart } from "lucide-react"

import {
  IndexBreadthChart, IndexPerformanceChart, InstitutionalFlowChart,
  MaBreadthChart, MarketHistoryChart, MarketHistoryFlowChart,
} from "@/components/insights/market-close-charts"
import { MarketBubbles, type MarketBubbleStock } from "@/components/insights/market-bubbles"
import { SectorMapPanel } from "@/components/insights/sector-map-panel"
import { MarketHealthView, MarketSentimentCard } from "@/components/insights/market-health-view"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import type { MarketCloseDashboardData } from "@/lib/market-insight-data"
import type { InsightsRatingRow } from "@/lib/insights-data"
import { cn } from "@/lib/utils"

export type { MarketBubbleStock }

interface MarketCloseDashboardProps {
  data: MarketCloseDashboardData | null
  ratings?: InsightsRatingRow[]
  bubbleStocks?: MarketBubbleStock[]
  bubbleAsOfDate?: string | null
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

function PanelHeading({
  title,
  description,
  icon: Icon,
  iconTone = "teal",
}: {
  title: string
  description: string
  icon: React.ComponentType<{ className?: string }>
  iconTone?: "teal" | "purple" | "cyan" | "emerald" | "amber"
}) {
  const iconTones = {
    teal: "border-teal-300/20 bg-teal-300/[0.08] text-teal-300",
    purple: "border-purple-400/20 bg-purple-400/[0.08] text-purple-300",
    cyan: "border-cyan-400/20 bg-cyan-400/[0.08] text-cyan-300",
    emerald: "border-emerald-400/20 bg-emerald-400/[0.08] text-emerald-300",
    amber: "border-amber-400/20 bg-amber-400/[0.08] text-amber-300",
  }

  return (
    <CardHeader className="border-b border-white/[0.06] px-4 py-3.5">
      <div className="flex items-center gap-3">
        <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-xl border shadow-sm", iconTones[iconTone])}>
          <Icon className="size-4" />
        </span>
        <div className="min-w-0">
          <CardTitle className="text-sm font-bold text-white tracking-wide font-sans">{title}</CardTitle>
          <CardDescription className="mt-0.5 line-clamp-1 text-[11px] text-slate-400 italic font-medium">{description}</CardDescription>
        </div>
      </div>
    </CardHeader>
  )
}

function SectionHeading({
  eyebrow,
  title,
  description,
  icon: Icon,
  iconTone = "teal",
}: {
  eyebrow: string
  title: string
  description: string
  icon?: React.ComponentType<{ className?: string }>
  iconTone?: "teal" | "purple" | "cyan" | "emerald" | "amber"
}) {
  const iconTones = {
    teal: "border-teal-300/20 bg-teal-300/[0.08] text-teal-300",
    purple: "border-purple-400/20 bg-purple-400/[0.08] text-purple-300",
    cyan: "border-cyan-400/20 bg-cyan-400/[0.08] text-cyan-300",
    emerald: "border-emerald-400/20 bg-emerald-400/[0.08] text-emerald-300",
    amber: "border-amber-400/20 bg-amber-400/[0.08] text-amber-300",
  }

  return (
    <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
      <div className="flex items-start gap-3.5">
        {Icon && (
          <span
            className={cn(
              "mt-0.5 flex size-9 sm:size-10 shrink-0 items-center justify-center rounded-xl border shadow-sm",
              iconTones[iconTone]
            )}
          >
            <Icon className="size-4 sm:size-5" />
          </span>
        )}
        <div>
          <p className="text-[10px] font-mono font-black uppercase tracking-[0.24em] text-teal-300/80">
            {eyebrow}
          </p>
          <h3 className="mt-1 text-lg font-bold text-white tracking-tight sm:text-xl font-sans">
            {title}
          </h3>
        </div>
      </div>
      <p className="max-w-xl text-xs sm:text-sm leading-5 text-slate-400 italic font-medium sm:text-right">
        {description}
      </p>
    </div>
  )
}

export function MarketCloseDashboard({ data, ratings = [], bubbleStocks = [], bubbleAsOfDate = null, onOpenStockDetail }: MarketCloseDashboardProps) {
  if (!data) return (
    <Card className={cn(surface, "py-12 text-center")}><CardContent className="space-y-3"><Activity className="mx-auto size-10 text-slate-600" /><CardTitle className="font-bold text-white font-sans">Chưa có dữ liệu phiên đóng cửa</CardTitle><CardDescription className="italic text-slate-400">Snapshot sau phiên được cập nhật tự động sau 15:15 vào ngày giao dịch.</CardDescription></CardContent></Card>
  )

  const { sessionDate, asOf, indexes, sectors, sectorHistory = [], history } = data

  return (
    <div className="space-y-10" data-stock-analytics-dashboard data-liquid-glass-dashboard>
      {/* 1. Market Overview Tiles & Bubbles Section */}
      <section aria-labelledby="market-overview-title" className="space-y-3">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{indexes.map((item) => <IndexTile key={item.indexCode} item={item} />)}</div>
        <p className="px-1 text-[10px] font-mono text-slate-500">Phiên {sessionDate} · cập nhật {formatTime(asOf)} · nguồn KFSP Ngành</p>

        <Card className={cn(surface, "overflow-hidden py-0")}>
          <CardHeader className="flex flex-col gap-2 border-b border-white/[0.07] px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3.5">
              <span className="flex size-9 sm:size-10 shrink-0 items-center justify-center rounded-xl border border-cyan-400/20 bg-cyan-400/[0.08] text-cyan-300 shadow-sm">
                <CircleDot className="size-4 sm:size-5" />
              </span>
              <div>
                <p className="text-[10px] font-mono font-black uppercase tracking-[0.22em] text-teal-300/70">
                  Market bubbles
                </p>
                <h2 id="market-overview-title" className="mt-0.5 text-lg font-bold text-white tracking-tight font-sans">
                  Bubbles · Bản đồ giao dịch thị trường
                </h2>
                <p className="mt-0.5 text-xs text-slate-400 italic font-medium">
                  KFSP KLGD TB 50 phiên &gt; 500.000; xếp theo thanh khoản giảm dần, tối đa 200 mã. Kích thước theo biến động giá.
                </p>
                <p className="mt-1 text-[10px] font-mono text-slate-500">Nguồn KFSP · snapshot {bubbleAsOfDate ?? "—"} · thiếu dữ liệu không được bù</p>
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
      <MarketIntelligencePanel data={data} />

      {/* 3. Sector Map Section (Nhóm ngành đang dẫn nhịp) */}
      <section aria-labelledby="market-sectors-title" className="space-y-4 border-t border-white/[0.06] pt-8">
        <div id="market-sectors-title">
          <SectionHeading
            icon={Layers}
            iconTone="purple"
            eyebrow="Market pulse & cash flow"
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

    </div>
  )
}

function MarketIntelligencePanel({ data }: { data: MarketCloseDashboardData }) {
  const { dailySummary, indexes, history, marketRegime } = data
  return (
    <section aria-labelledby="market-intelligence-title" className="space-y-6">
      <Card className={cn(surface, "overflow-hidden py-0")}>
        <div className="border-b border-white/[0.07] bg-black/10 px-4 sm:px-5 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-emerald-400/20 bg-emerald-400/[0.08] text-emerald-300 shadow-sm">
              <Activity className="size-4 sm:size-5" />
            </span>
            <div>
              <span className="text-sm font-bold text-white tracking-wide font-sans block">
                Nhịp đập thị trường & Sức khoẻ thị trường
              </span>
              <span className="text-xs font-sans italic text-slate-400 font-medium">
                Dữ liệu tổng quan phiên & chỉ báo sức khỏe
              </span>
            </div>
          </div>
          <span className="text-xs font-mono font-bold text-slate-400">
            Dữ liệu tổng quan phiên
          </span>
        </div>
        <CardContent className="p-5 sm:p-6">
          <div className="grid gap-4 xl:grid-cols-[7fr_3fr]">
            <div>
              <p className="text-[10px] font-mono font-black uppercase tracking-[0.2em] text-teal-300/70">Tổng quan thị trường</p>
              <div className="mt-4 flex items-center gap-5">
                <div className="flex size-28 shrink-0 items-center justify-center rounded-full border border-amber-300/20 bg-amber-300/[0.06]">
                  <strong className="px-3 text-center text-sm font-black uppercase text-amber-300 font-sans">{marketRegime || "Không suy diễn"}</strong>
                </div>
                <div className="grid flex-1 grid-cols-2 gap-2">
                  <PulseStat label="Tâm lý" value={`${formatNumber(dailySummary.sentimentScore, 0)} · ${dailySummary.sentimentLabel || "—"}`} />
                  <PulseStat label="Rủi ro" value={formatNumber(dailySummary.riskScore, 2)} tone={(dailySummary.riskScore ?? 0) >= 0.7 ? "down" : "up"} />
                  <PulseStat label="Khối ngoại" value={`${formatSigned(dailySummary.foreignNetValue, 0)} tỷ`} tone={(dailySummary.foreignNetValue ?? 0) >= 0 ? "up" : "down"} />
                  <PulseStat label="Phân phối" value={`${dailySummary.distributionCount ?? "—"} ngày`} />
                </div>
              </div>
            </div>
            <MarketSentimentCard data={data} />
          </div>
          <div id="market-charts-title" className="mt-5">
            <SectionHeading icon={BarChart3} iconTone="cyan" eyebrow="Market internals" title="Nội lực thị trường & Phân tích chuyên sâu" description="Thanh khoản, độ rộng, xu hướng và dòng tiền từ snapshot hiện tại." />
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 2xl:grid-cols-4" data-market-close-chart-grid>
            <ChartPanel icon={LineChart} title="Hiệu suất chỉ số" description="Biến động và giá trị giao dịch"><IndexPerformanceChart indexes={indexes} /></ChartPanel>
            <ChartPanel icon={BarChart3} title="Độ rộng thị trường" description="Mã tăng, đứng giá và giảm"><IndexBreadthChart indexes={indexes} /></ChartPanel>
            <ChartPanel icon={Gauge} title="Sức khỏe xu hướng" description="Tỷ lệ cổ phiếu trên các đường MA"><MaBreadthChart daily={dailySummary} /></ChartPanel>
            <ChartPanel icon={CircleDollarSign} title="Dòng tiền tổ chức" description="Mua bán ròng theo nhóm nhà đầu tư"><InstitutionalFlowChart daily={dailySummary} /></ChartPanel>
          </div>
        </CardContent>
      </Card>

      {/* Khối Sức khoẻ thị trường (Chỉ báo tâm lý + Chỉ báo rủi ro trên 1 row + Định giá) */}
      <MarketHealthView data={data} history={history} />
      <div id="market-history-title">
        <SectionHeading icon={LineChart} iconTone="purple" eyebrow="20-session context" title="Bối cảnh trước khi ra quyết định" description="Đặt phiên hiện tại cạnh sức khỏe và dòng tiền gần đây, thay vì chỉ nhìn một ngày." />
      </div>
      <div className="grid gap-3 xl:grid-cols-2" data-market-close-chart-grid>
        <ChartPanel icon={Gauge} title="Tâm lý, rủi ro và MA20" description="Bối cảnh 20 phiên gần nhất"><MarketHistoryChart history={history} /></ChartPanel>
        <ChartPanel icon={CircleDollarSign} title="Dòng tiền theo phiên" description="Dòng tiền 20 phiên gần nhất"><MarketHistoryFlowChart history={history} /></ChartPanel>
      </div>
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
