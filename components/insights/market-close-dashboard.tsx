"use client"

import * as React from "react"
import { Activity, ArrowDownRight, ArrowUpRight, BarChart3, BookOpen, CircleDollarSign, Gauge, Layers3, LineChart, Sparkles, TrendingDown, TrendingUp } from "lucide-react"

import { MetricGuideDialog } from "@/components/insights/metric-guide-dialog"
import {
  IndexBreadthChart, IndexImpactChart, IndexPerformanceChart, InstitutionalFlowChart,
  LiquidityLeadersChart, MaBreadthChart, MarketHistoryChart, MarketHistoryFlowChart,
  SectorBreadthChart, SectorPerformanceChart, VnindexHistoryChart,
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

export function MarketCloseDashboard({ data, onOpenStockDetail }: MarketCloseDashboardProps) {
  const [selectedSector, setSelectedSector] = React.useState<MarketSectorRow | null>(null)
  const [guideOpen, setGuideOpen] = React.useState(false)

  if (!data) return (
    <Card className={cn(surface, "py-12 text-center")}><CardContent className="space-y-3"><Activity className="mx-auto size-10 text-slate-600" /><CardTitle>Chưa có dữ liệu phiên đóng cửa</CardTitle><CardDescription>Snapshot sau phiên được cập nhật tự động sau 15:15 vào ngày giao dịch.</CardDescription></CardContent></Card>
  )

  const { sessionDate, marketRegime, asOf, dailySummary, indexes, sectors, leaders, observations, history } = data
  const vnindex = indexes.find((item) => item.indexCode === "VNINDEX")
  const isPositive = (vnindex?.changePct ?? 0) >= 0
  const breadthTotal = Math.max(1, (vnindex?.advances ?? 0) + (vnindex?.unchanged ?? 0) + (vnindex?.declines ?? 0))
  const topVolumeLeaders = leaders.filter((item) => item.category === "top_volume").slice(0, 6)
  const leadingSectors = [...sectors].filter((item) => item.timeWindow === "1d").sort((a, b) => (b.averageChangePct ?? 0) - (a.averageChangePct ?? 0)).slice(0, 5)

  return (
    <div className="space-y-10" data-stock-analytics-dashboard data-liquid-glass-dashboard>
      <section aria-labelledby="market-overview-title" className="space-y-3">
        <Card className={cn(surface, "overflow-hidden py-0")}>
          <CardContent className="grid p-0 xl:grid-cols-[minmax(0,1.55fr)_minmax(320px,.75fr)]">
            <div className="relative border-b border-white/[0.07] p-5 sm:p-6 xl:border-b-0 xl:border-r">
              <div className="pointer-events-none absolute right-0 top-0 size-48 rounded-bl-full border-b border-l border-teal-300/[0.08] bg-teal-300/[0.025]" aria-hidden="true" />
              <div className="relative flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2.5">
                    <span className={cn("flex size-9 items-center justify-center rounded-lg border", isPositive ? "border-teal-300/25 bg-teal-300/[0.09] text-teal-200" : "border-rose-400/25 bg-rose-400/[0.09] text-rose-300")}>{isPositive ? <TrendingUp className="size-4" /> : <TrendingDown className="size-4" />}</span>
                    <div><p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">VN-INDEX · HOSE</p><h2 id="market-overview-title" className="mt-0.5 text-xs font-semibold text-slate-400">Tổng quan 20 phiên</h2></div>
                  </div>
                  <div className="mt-4 flex flex-wrap items-end gap-x-4 gap-y-2">
                    <strong className="font-mono text-4xl font-black tracking-[-0.04em] text-white sm:text-5xl">{formatNumber(vnindex?.value)}</strong>
                    <span className={cn("mb-1 inline-flex items-center gap-1 font-mono text-sm font-bold", isPositive ? "text-teal-300" : "text-rose-300")}>{isPositive ? <ArrowUpRight className="size-4" /> : <ArrowDownRight className="size-4" />}{formatSigned(vnindex?.change, 2)} ({formatSigned(vnindex?.changePct, 2, "%")})</span>
                  </div>
                </div>
                <Badge variant="outline" className="border-teal-300/20 bg-teal-300/[0.07] text-[10px] font-black uppercase tracking-wider text-teal-200">{marketRegime || "Đang cập nhật"}</Badge>
              </div>
              <div className="relative mt-5 grid grid-cols-2 gap-x-5 gap-y-3 border-y border-white/[0.05] py-3 text-[10px] sm:grid-cols-4">
                <MiniStat label="Tham chiếu" value={formatNumber(vnindex?.reference)} /><MiniStat label="Cao nhất" value={formatNumber(vnindex?.high)} /><MiniStat label="Thấp nhất" value={formatNumber(vnindex?.low)} /><MiniStat label="Thanh khoản" value={`${formatNumber(vnindex?.tradedValue, 0)} tỷ`} />
              </div>
              <div className="relative -mx-2 mt-2"><VnindexHistoryChart history={history} /></div>
            </div>

            <aside className="flex flex-col justify-between p-5 sm:p-6" aria-label="Sức khỏe thị trường">
              <div>
                <div className="flex items-start justify-between gap-4">
                  <div><p className="text-[10px] font-black uppercase tracking-[0.22em] text-teal-300/70">Market pulse</p><h3 className="mt-1 text-base font-bold text-white">Sức khỏe thị trường</h3><p className="mt-1 text-[11px] text-slate-500">Mức đồng thuận của cổ phiếu trong phiên</p></div>
                  <div className="text-right"><strong className="font-mono text-3xl font-black text-white">{formatNumber(dailySummary.sentimentScore, 0)}</strong><span className="mt-1 block text-[10px] font-bold text-teal-300">{dailySummary.sentimentLabel || "Chưa phân loại"}</span></div>
                </div>
                <div className="mt-6 space-y-4"><BreadthBar label="Tăng giá" value={vnindex?.advances ?? 0} total={breadthTotal} tone="up" /><BreadthBar label="Đứng giá" value={vnindex?.unchanged ?? 0} total={breadthTotal} tone="flat" /><BreadthBar label="Giảm giá" value={vnindex?.declines ?? 0} total={breadthTotal} tone="down" /></div>
              </div>
              <div className="mt-7 grid grid-cols-2 gap-2 border-t border-white/[0.07] pt-5">
                <PulseStat label="Trên MA20" value={`${formatNumber(dailySummary.aboveMa20Pct, 0)}%`} /><PulseStat label="Rủi ro" value={formatNumber(dailySummary.riskScore, 0)} tone={(dailySummary.riskScore ?? 0) >= 60 ? "down" : "up"} /><PulseStat label="Khối ngoại" value={`${formatSigned(dailySummary.foreignNetValue, 0)} tỷ`} tone={(dailySummary.foreignNetValue ?? 0) >= 0 ? "up" : "down"} /><PulseStat label="Phân phối" value={`${dailySummary.distributionCount ?? "—"} ngày`} />
              </div>
              <Button variant="outline" size="sm" onClick={() => setGuideOpen(true)} className="mt-4 h-8 justify-center border-white/10 bg-white/[0.025] text-xs text-slate-300 hover:bg-white/[0.06] hover:text-white"><BookOpen className="size-3.5" /> Hiểu cách đọc chỉ số</Button>
            </aside>
          </CardContent>
        </Card>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{indexes.map((item) => <IndexTile key={item.indexCode} item={item} />)}</div>
        <p className="px-1 text-[10px] text-slate-600">Phiên {sessionDate} · cập nhật {formatTime(asOf)} · dữ liệu EOD đã chuẩn hóa</p>
      </section>

      {observations.length > 0 && <section aria-label="Tín hiệu định lượng nổi bật" className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">{observations.slice(0, 4).map((item) => <div key={item.id} className="insights-glass-chip flex min-h-20 gap-3 rounded-xl border border-white/[0.07] bg-white/[0.025] p-3.5"><span className={cn("mt-1 size-2 shrink-0 rounded-full", item.sentiment === "positive" ? "bg-teal-300" : item.sentiment === "negative" ? "bg-rose-400" : item.sentiment === "warning" ? "bg-amber-300" : "bg-slate-400")} /><div className="min-w-0"><strong className="block truncate text-xs text-slate-200">{item.title}</strong><p className="mt-1 line-clamp-2 text-[10px] leading-4 text-slate-500">{item.content}</p></div></div>)}</section>}

      <section aria-labelledby="market-sectors-title" className="space-y-4 border-t border-white/[0.06] pt-8">
        <div id="market-sectors-title"><SectionHeading eyebrow="Sector map" title="Nhóm ngành đang dẫn nhịp" description="Đọc hiệu suất cùng độ lan tỏa để tránh nhầm một vài mã tăng với sức mạnh toàn ngành." /></div>
        <div className="grid gap-3 xl:grid-cols-[1.2fr_1.2fr_.72fr]" data-market-close-chart-grid>
          <ChartPanel icon={TrendingUp} title="Hiệu suất ngành" description="12 nhóm mạnh nhất đến yếu nhất"><SectorPerformanceChart sectors={sectors} /></ChartPanel>
          <ChartPanel icon={Layers3} title="Độ rộng ngành" description="Mức đồng thuận trong từng nhóm"><SectorBreadthChart sectors={sectors} /></ChartPanel>
          <Card className={cn(surface, "py-0")}><PanelHeading icon={Sparkles} title="Nhóm nổi bật" description="Xếp theo biến động trung bình" /><CardContent className="space-y-2 p-3">{leadingSectors.map((sector, index) => <button key={sector.sectorKey} type="button" onClick={() => setSelectedSector(sector)} className="flex w-full items-center gap-3 rounded-lg border border-white/[0.05] bg-white/[0.02] p-2.5 text-left transition-colors hover:border-teal-300/15 hover:bg-white/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-300/40"><span className="font-mono text-[10px] text-slate-600">0{index + 1}</span><span className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-200">{sector.displayName}</span><span className={cn("font-mono text-xs font-bold", (sector.averageChangePct ?? 0) >= 0 ? "text-teal-300" : "text-rose-300")}>{formatSigned(sector.averageChangePct, 2, "%")}</span></button>)}</CardContent></Card>
        </div>
      </section>

      <section aria-labelledby="market-breadth-title" className="space-y-4 border-t border-white/[0.06] pt-8">
        <div id="market-breadth-title"><SectionHeading eyebrow="Breadth & flow" title="Độ rộng, xu hướng và dòng tiền" description="Ba góc nhìn thiết yếu để xác nhận mức bền vững của chuyển động giá." /></div>
        <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-4" data-market-close-chart-grid>
          <ChartPanel icon={LineChart} title="Hiệu suất chỉ số" description="Biến động và giá trị giao dịch"><IndexPerformanceChart indexes={indexes} /></ChartPanel><ChartPanel icon={BarChart3} title="Độ rộng thị trường" description="Mã tăng, đứng giá và giảm"><IndexBreadthChart indexes={indexes} /></ChartPanel><ChartPanel icon={Gauge} title="Sức khỏe xu hướng" description="Tỷ lệ cổ phiếu trên các đường MA"><MaBreadthChart daily={dailySummary} /></ChartPanel><ChartPanel icon={CircleDollarSign} title="Dòng tiền tổ chức" description="Mua bán ròng theo nhóm nhà đầu tư"><InstitutionalFlowChart daily={dailySummary} /></ChartPanel>
        </div>
      </section>

      <section aria-labelledby="market-leaders-title" className="space-y-4 border-t border-white/[0.06] pt-8">
        <div id="market-leaders-title"><SectionHeading eyebrow="Liquidity map" title="Thanh khoản và mã dẫn dắt" description="Nhìn nhanh nơi dòng tiền tập trung và cổ phiếu đang kéo hoặc ghìm VNINDEX." /></div>
        <div className="grid gap-3 xl:grid-cols-[1.2fr_1.2fr_.65fr] 2xl:grid-cols-3" data-market-close-chart-grid>
          <ChartPanel icon={BarChart3} title="Thanh khoản dẫn đầu" description="Khối lượng khớp theo triệu cổ phiếu"><LiquidityLeadersChart leaders={leaders} /></ChartPanel><ChartPanel icon={Activity} title="Tác động VNINDEX" description="Đóng góp tăng và giảm điểm"><IndexImpactChart leaders={leaders} /></ChartPanel>
          <Card className={cn(surface, "py-0")}><PanelHeading icon={CircleDollarSign} title="Mã sôi động" description="Bấm để mở hồ sơ cổ phiếu" /><CardContent className="grid grid-cols-2 gap-2 p-3 xl:grid-cols-1">{topVolumeLeaders.map((item) => <button key={`${item.rank}:${item.ticker}`} type="button" onClick={() => onOpenStockDetail?.(item.ticker)} className="flex items-center justify-between gap-2 rounded-lg border border-white/[0.05] bg-white/[0.02] p-2.5 text-left transition-colors hover:border-teal-300/15 hover:bg-white/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-300/40"><span className="font-mono text-xs font-black text-white">{item.ticker}</span><span className={cn("font-mono text-[10px] font-bold", (item.changePct ?? 0) >= 0 ? "text-teal-300" : "text-rose-300")}>{formatSigned(item.changePct, 2, "%")}</span></button>)}</CardContent></Card>
        </div>
      </section>

      <section aria-labelledby="market-history-title" className="space-y-4 border-t border-white/[0.06] pt-8">
        <div id="market-history-title"><SectionHeading eyebrow="20-session context" title="Bối cảnh trước khi ra quyết định" description="Đặt phiên hiện tại cạnh sức khỏe và dòng tiền gần đây, thay vì chỉ nhìn một ngày." /></div>
        <div className="grid gap-3 xl:grid-cols-2" data-market-close-chart-grid><ChartPanel icon={Gauge} title="Tâm lý, rủi ro và MA20" description="Thang điểm sức khỏe qua tối đa 20 phiên"><MarketHistoryChart history={history} /></ChartPanel><ChartPanel icon={CircleDollarSign} title="Dòng tiền theo phiên" description="Khối ngoại và tự doanh quanh trục trung tính"><MarketHistoryFlowChart history={history} /></ChartPanel></div>
      </section>

      <Dialog open={Boolean(selectedSector)} onOpenChange={(open) => { if (!open) setSelectedSector(null) }}>
        <DialogContent className="max-w-md border-white/10 bg-[#0b151d]"><DialogHeader><DialogTitle className="flex items-center justify-between text-base"><span>{selectedSector?.displayName}</span><Badge variant="outline" className="font-mono text-xs">{selectedSector?.timeWindow || "1d"}</Badge></DialogTitle><DialogDescription>Snapshot sức mạnh và thanh khoản ngành</DialogDescription></DialogHeader>{selectedSector && <div className="grid grid-cols-2 gap-2 py-2">{[["Biến động TB", formatSigned(selectedSector.averageChangePct, 2, "%")], ["Thanh khoản", `${formatNumber(selectedSector.tradedValue, 1)} tỷ`], ["Độ rộng", `${selectedSector.advances} tăng / ${selectedSector.declines} giảm`], ["Điểm RS", formatNumber(selectedSector.rsScore, 1)]].map(([label, value]) => <div key={label} className="rounded-lg border border-white/[0.06] bg-white/[0.025] p-3"><span className="text-[10px] text-slate-500">{label}</span><strong className="mt-1 block font-mono text-sm text-white">{value}</strong></div>)}</div>}</DialogContent>
      </Dialog>
      <MetricGuideDialog open={guideOpen} onOpenChange={setGuideOpen} />
    </div>
  )
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return <div><span className="block text-slate-600">{label}</span><strong className="mt-1 block font-mono text-xs text-slate-300">{value}</strong></div>
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
