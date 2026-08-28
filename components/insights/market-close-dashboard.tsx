"use client"

import * as React from "react"
import { Activity, ArrowDownRight, ArrowUpRight, BarChart3, BookOpen, CircleDollarSign, Gauge, Layers3, LineChart, TrendingDown, TrendingUp } from "lucide-react"

import { MetricGuideDialog } from "@/components/insights/metric-guide-dialog"
import {
  IndexBreadthChart, IndexImpactChart, IndexPerformanceChart, InstitutionalFlowChart,
  LiquidityLeadersChart, MaBreadthChart, MarketHistoryChart, MarketHistoryFlowChart,
  SectorBreadthChart, SectorPerformanceChart,
} from "@/components/insights/market-close-charts"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import type { MarketCloseDashboardData, MarketSectorRow } from "@/lib/market-insight-data"
import { cn } from "@/lib/utils"

interface MarketCloseDashboardProps {
  data: MarketCloseDashboardData | null
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

const surface = "border-white/[0.07] bg-[#0b111c] shadow-[0_12px_36px_-28px_rgba(15,23,42,0.9)]"

function PanelHeading({ title, description, icon: Icon }: { title: string; description: string; icon: React.ComponentType<{ className?: string }> }) {
  return (
    <CardHeader className="border-b border-white/[0.06] px-4 py-3.5">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border border-cyan-300/15 bg-cyan-300/[0.06] text-cyan-300"><Icon className="size-4" /></span>
        <div className="min-w-0"><CardTitle className="text-sm font-bold text-white">{title}</CardTitle><CardDescription className="mt-1 line-clamp-1 text-[11px]">{description}</CardDescription></div>
      </div>
    </CardHeader>
  )
}

function SectionHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return (
    <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
      <div><p className="text-[10px] font-black uppercase tracking-[0.22em] text-cyan-300/80">{eyebrow}</p><h3 className="mt-1 text-lg font-bold text-white sm:text-xl">{title}</h3></div>
      <p className="max-w-xl text-xs text-slate-500 sm:text-right">{description}</p>
    </div>
  )
}

function ScoreMetric({ label, value, helper, tone }: { label: string; value: number | null | undefined; helper: string; tone: "cyan" | "emerald" | "amber" | "rose" }) {
  const safeValue = Math.min(100, Math.max(0, value ?? 0))
  const bar = { cyan: "bg-cyan-400", emerald: "bg-emerald-400", amber: "bg-amber-400", rose: "bg-rose-400" }[tone]
  const text = { cyan: "text-cyan-300", emerald: "text-emerald-300", amber: "text-amber-300", rose: "text-rose-300" }[tone]
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.025] p-3">
      <div className="flex items-baseline justify-between gap-2"><span className="text-[11px] font-semibold text-slate-400">{label}</span><strong className={cn("font-mono text-lg", text)}>{formatNumber(value, 0)}</strong></div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.06]"><div className={cn("h-full rounded-full", bar)} style={{ width: `${safeValue}%` }} /></div>
      <p className="mt-2 truncate text-[10px] text-slate-500">{helper}</p>
    </div>
  )
}

export function MarketCloseDashboard({ data, onOpenStockDetail }: MarketCloseDashboardProps) {
  const [selectedSector, setSelectedSector] = React.useState<MarketSectorRow | null>(null)
  const [guideOpen, setGuideOpen] = React.useState(false)

  if (!data) return (
    <Card className={cn(surface, "py-12 text-center")}><CardContent className="space-y-3"><Activity className="mx-auto size-10 text-slate-600" /><CardTitle>Chưa có dữ liệu phiên đóng cửa</CardTitle><CardDescription>Snapshot sau phiên được cập nhật tự động sau 15:15 vào ngày giao dịch.</CardDescription></CardContent></Card>
  )

  const { sessionDate, marketRegime, asOf, dailySummary, indexes, sectors, leaders, observations, history } = data
  const vnindex = indexes.find((item) => item.indexCode === "VNINDEX")
  const isPositive = (vnindex?.changePct ?? 0) >= 0
  const topVolumeLeaders = leaders.filter((item) => item.category === "top_volume").slice(0, 8)
  const leadingSectors = [...sectors].filter((item) => item.timeWindow === "1d").sort((a, b) => (b.averageChangePct ?? 0) - (a.averageChangePct ?? 0)).slice(0, 5)

  return (
    <div className="space-y-8" data-stock-analytics-dashboard>
      <section aria-labelledby="market-overview-title" className="space-y-4">
        <Card className={cn(surface, "overflow-hidden py-0")}>
          <CardContent className="grid gap-0 p-0 xl:grid-cols-[1.35fr_1fr]">
            <div className="border-b border-white/[0.06] p-5 xl:border-b-0 xl:border-r sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className={cn("flex size-9 items-center justify-center rounded-lg border", isPositive ? "border-emerald-400/20 bg-emerald-400/[0.08] text-emerald-300" : "border-rose-400/20 bg-rose-400/[0.08] text-rose-300")}>{isPositive ? <TrendingUp className="size-4" /> : <TrendingDown className="size-4" />}</span>
                    <div><p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Market pulse · {sessionDate}</p><h2 id="market-overview-title" className="mt-0.5 text-sm font-bold text-white">VNINDEX</h2></div>
                  </div>
                  <div className="mt-5 flex flex-wrap items-end gap-x-4 gap-y-2">
                    <strong className="font-mono text-4xl font-black tracking-[-0.04em] text-white sm:text-5xl">{formatNumber(vnindex?.value)}</strong>
                    <span className={cn("mb-1 inline-flex items-center gap-1 font-mono text-sm font-bold", isPositive ? "text-emerald-300" : "text-rose-300")}>{isPositive ? <ArrowUpRight className="size-4" /> : <ArrowDownRight className="size-4" />}{formatSigned(vnindex?.change, 2)} · {formatSigned(vnindex?.changePct, 2, "%")}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">{marketRegime && <Badge variant="outline" className="border-cyan-300/20 bg-cyan-300/[0.06] text-[10px] font-black uppercase tracking-wider text-cyan-200">{marketRegime}</Badge>}<Button variant="outline" size="sm" onClick={() => setGuideOpen(true)} className="h-8 border-white/10 bg-white/[0.03] text-xs text-slate-300 hover:bg-white/[0.06] hover:text-white"><BookOpen className="size-3.5" /> Sổ tay</Button></div>
              </div>
              <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <MiniStat label="Thanh khoản" value={`${formatNumber(vnindex?.tradedValue, 0)} tỷ`} />
                <MiniStat label="Độ rộng" value={`${vnindex?.advances ?? 0} / ${vnindex?.declines ?? 0}`} />
                <MiniStat label="Khối ngoại" value={`${formatSigned(dailySummary.foreignNetValue, 0)} tỷ`} tone={(dailySummary.foreignNetValue ?? 0) >= 0 ? "up" : "down"} />
                <MiniStat label="Phân phối" value={`${dailySummary.distributionCount ?? "—"} ngày`} />
              </div>
              <p className="mt-4 text-[10px] text-slate-600">Cập nhật {formatTime(asOf)} · dữ liệu EOD đã chuẩn hóa</p>
            </div>
            <div className="grid grid-cols-2 gap-2 p-4 sm:p-5">
              <ScoreMetric label="Tâm lý" value={dailySummary.sentimentScore} helper={dailySummary.sentimentLabel || "Chưa phân loại"} tone="cyan" />
              <ScoreMetric label="Rủi ro" value={dailySummary.riskScore} helper={dailySummary.riskLabel || "Chưa phân loại"} tone={(dailySummary.riskScore ?? 0) >= 60 ? "rose" : "emerald"} />
              <ScoreMetric label="Trên MA20" value={dailySummary.aboveMa20Pct} helper="Độ rộng trung hạn" tone="emerald" />
              <ScoreMetric label="Trên MA200" value={dailySummary.aboveMa200Pct} helper="Sức khỏe dài hạn" tone="amber" />
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {indexes.map((item) => <IndexTile key={item.indexCode} item={item} />)}
        </div>

        <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-4" data-market-close-chart-grid>
          <ChartPanel icon={LineChart} title="Hiệu suất chỉ số" description="Biến động và giá trị giao dịch"><IndexPerformanceChart indexes={indexes} /></ChartPanel>
          <ChartPanel icon={BarChart3} title="Độ rộng thị trường" description="Mã tăng, đứng giá và giảm"><IndexBreadthChart indexes={indexes} /></ChartPanel>
          <ChartPanel icon={Gauge} title="Sức khỏe xu hướng" description="Tỷ lệ cổ phiếu trên các đường MA"><MaBreadthChart daily={dailySummary} /></ChartPanel>
          <ChartPanel icon={CircleDollarSign} title="Dòng tiền tổ chức" description="Mua bán ròng theo nhóm nhà đầu tư"><InstitutionalFlowChart daily={dailySummary} /></ChartPanel>
        </div>

        {observations.length > 0 && <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4" aria-label="Tín hiệu định lượng nổi bật">{observations.slice(0, 4).map((item) => <div key={item.id} className="flex gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3"><span className={cn("mt-1 size-1.5 shrink-0 rounded-full", item.sentiment === "positive" ? "bg-emerald-400" : item.sentiment === "negative" ? "bg-rose-400" : item.sentiment === "warning" ? "bg-amber-400" : "bg-slate-400")} /><div className="min-w-0"><strong className="block truncate text-[11px] text-slate-200">{item.title}</strong><p className="mt-1 line-clamp-2 text-[10px] leading-4 text-slate-500">{item.content}</p></div></div>)}</div>}
      </section>

      <section aria-labelledby="market-sectors-title" className="space-y-4 border-t border-white/[0.06] pt-7">
        <div id="market-sectors-title"><SectionHeading eyebrow="Sector analytics" title="Sức mạnh và độ lan tỏa nhóm ngành" description="Đọc rotation bằng hiệu suất và breadth thay vì bảng dữ liệu dài." /></div>
        <div className="grid gap-3 xl:grid-cols-[1.15fr_1.15fr_.7fr]" data-market-close-chart-grid>
          <ChartPanel icon={TrendingUp} title="Hiệu suất ngành" description="12 nhóm mạnh nhất đến yếu nhất"><SectorPerformanceChart sectors={sectors} /></ChartPanel>
          <ChartPanel icon={Layers3} title="Độ rộng ngành" description="Mức độ đồng thuận trong từng nhóm"><SectorBreadthChart sectors={sectors} /></ChartPanel>
          <Card className={cn(surface, "py-0")}><PanelHeading icon={Activity} title="Nhóm nổi bật" description="Xếp theo biến động trung bình" /><CardContent className="space-y-2 p-3">{leadingSectors.map((sector, index) => <button key={sector.sectorKey} type="button" onClick={() => setSelectedSector(sector)} className="flex w-full items-center gap-3 rounded-lg border border-white/[0.05] bg-white/[0.02] p-2.5 text-left transition-colors hover:bg-white/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/40"><span className="font-mono text-[10px] text-slate-600">0{index + 1}</span><span className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-200">{sector.displayName}</span><span className={cn("font-mono text-xs font-bold", (sector.averageChangePct ?? 0) >= 0 ? "text-emerald-300" : "text-rose-300")}>{formatSigned(sector.averageChangePct, 2, "%")}</span></button>)}</CardContent></Card>
        </div>
      </section>

      <section aria-labelledby="market-leaders-title" className="space-y-4 border-t border-white/[0.06] pt-7">
        <div id="market-leaders-title"><SectionHeading eyebrow="Liquidity map" title="Dẫn dắt, thanh khoản và tác động chỉ số" description="Tập trung vào nơi dòng tiền đang hoạt động và mã nào kéo thị trường." /></div>
        <div className="grid gap-3 xl:grid-cols-[1.2fr_1.2fr_.6fr] 2xl:grid-cols-3" data-market-close-chart-grid>
          <ChartPanel icon={BarChart3} title="Thanh khoản dẫn đầu" description="Khối lượng khớp theo triệu cổ phiếu"><LiquidityLeadersChart leaders={leaders} /></ChartPanel>
          <ChartPanel icon={Activity} title="Tác động VNINDEX" description="Đóng góp tăng và giảm điểm"><IndexImpactChart leaders={leaders} /></ChartPanel>
          <Card className={cn(surface, "py-0")}><PanelHeading icon={CircleDollarSign} title="Mã sôi động" description="Bấm để mở hồ sơ cổ phiếu" /><CardContent className="grid grid-cols-2 gap-2 p-3 xl:grid-cols-1">{topVolumeLeaders.map((item) => <button key={`${item.rank}:${item.ticker}`} type="button" onClick={() => onOpenStockDetail?.(item.ticker)} className="flex items-center justify-between gap-2 rounded-lg border border-white/[0.05] bg-white/[0.02] p-2 text-left transition-colors hover:bg-white/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/40"><span className="font-mono text-xs font-black text-white">{item.ticker}</span><span className={cn("font-mono text-[10px] font-bold", (item.changePct ?? 0) >= 0 ? "text-emerald-300" : "text-rose-300")}>{formatSigned(item.changePct, 2, "%")}</span></button>)}</CardContent></Card>
        </div>
      </section>

      <section aria-labelledby="market-history-title" className="space-y-4 border-t border-white/[0.06] pt-7">
        <div id="market-history-title"><SectionHeading eyebrow="20-session context" title="Xu hướng thị trường gần đây" description="Tâm lý, rủi ro, độ rộng và dòng tiền trong một nhịp đọc." /></div>
        <div className="grid gap-3 xl:grid-cols-2" data-market-close-chart-grid>
          <ChartPanel icon={Gauge} title="Tâm lý, rủi ro và MA20" description="Thang điểm sức khỏe qua tối đa 20 phiên"><MarketHistoryChart history={history} /></ChartPanel>
          <ChartPanel icon={CircleDollarSign} title="Dòng tiền theo phiên" description="Khối ngoại và tự doanh quanh trục trung tính"><MarketHistoryFlowChart history={history} /></ChartPanel>
        </div>
      </section>

      <Dialog open={Boolean(selectedSector)} onOpenChange={(open) => { if (!open) setSelectedSector(null) }}>
        <DialogContent className="max-w-md border-white/10 bg-[#0b111c]"><DialogHeader><DialogTitle className="flex items-center justify-between text-base"><span>{selectedSector?.displayName}</span><Badge variant="outline" className="font-mono text-xs">{selectedSector?.timeWindow || "1d"}</Badge></DialogTitle><DialogDescription>Snapshot sức mạnh và thanh khoản ngành</DialogDescription></DialogHeader>{selectedSector && <div className="grid grid-cols-2 gap-2 py-2">{[["Biến động TB", formatSigned(selectedSector.averageChangePct, 2, "%")], ["Thanh khoản", `${formatNumber(selectedSector.tradedValue, 1)} tỷ`], ["Độ rộng", `${selectedSector.advances} tăng / ${selectedSector.declines} giảm`], ["Điểm RS", formatNumber(selectedSector.rsScore, 1)]].map(([label, value]) => <div key={label} className="rounded-lg border border-white/[0.06] bg-white/[0.025] p-3"><span className="text-[10px] text-slate-500">{label}</span><strong className="mt-1 block font-mono text-sm text-white">{value}</strong></div>)}</div>}</DialogContent>
      </Dialog>
      <MetricGuideDialog open={guideOpen} onOpenChange={setGuideOpen} />
    </div>
  )
}

function MiniStat({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" }) {
  return <div className="rounded-lg border border-white/[0.06] bg-white/[0.025] p-3"><span className="text-[10px] text-slate-500">{label}</span><strong className={cn("mt-1 block font-mono text-sm text-white", tone === "up" && "text-emerald-300", tone === "down" && "text-rose-300")}>{value}</strong></div>
}

function IndexTile({ item }: { item: MarketCloseDashboardData["indexes"][number] }) {
  const positive = (item.changePct ?? 0) >= 0
  const total = Math.max(1, item.advances + item.unchanged + item.declines)
  return <Card className={cn(surface, "py-0")}><CardContent className="p-4"><div className="flex items-center justify-between gap-2"><span className="font-mono text-xs font-black text-slate-300">{item.indexCode}</span><span className={cn("font-mono text-[11px] font-bold", positive ? "text-emerald-300" : "text-rose-300")}>{formatSigned(item.changePct, 2, "%")}</span></div><strong className="mt-3 block font-mono text-xl font-black text-white">{formatNumber(item.value)}</strong><div className="mt-3 flex h-1.5 overflow-hidden rounded-full bg-slate-700/50"><span className="bg-emerald-400" style={{ width: `${item.advances / total * 100}%` }} /><span className="bg-slate-500" style={{ width: `${item.unchanged / total * 100}%` }} /><span className="bg-rose-400" style={{ width: `${item.declines / total * 100}%` }} /></div><div className="mt-2 flex justify-between font-mono text-[9px] text-slate-600"><span>{item.advances} tăng</span><span>{item.declines} giảm</span></div></CardContent></Card>
}

function ChartPanel({ icon, title, description, children }: { icon: React.ComponentType<{ className?: string }>; title: string; description: string; children: React.ReactNode }) {
  return <Card className={cn(surface, "py-0")}><PanelHeading icon={icon} title={title} description={description} /><CardContent className="p-3">{children}</CardContent></Card>
}
