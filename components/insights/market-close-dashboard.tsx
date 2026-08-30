"use client"

import * as React from "react"
import { Activity, BarChart3, BookOpen, CircleDollarSign, Gauge, Layers3, LineChart, Search, Sparkles, TrendingUp } from "lucide-react"

import { MetricGuideDialog } from "@/components/insights/metric-guide-dialog"
import {
  IndexBreadthChart, IndexImpactChart, IndexPerformanceChart, InstitutionalFlowChart,
  LiquidityLeadersChart, MaBreadthChart, MarketHistoryChart, MarketHistoryFlowChart,
  SectorBreadthChart, SectorPerformanceChart,
} from "@/components/insights/market-close-charts"
import { StockLogo } from "@/components/stock-logo"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import type { MarketCloseDashboardData, MarketSectorRow } from "@/lib/market-insight-data"
import { cn } from "@/lib/utils"

interface MarketCloseDashboardProps {
  data: MarketCloseDashboardData | null
  bubbleStocks?: MarketBubbleStock[]
  onOpenStockDetail?: (ticker: string) => void
}

export interface MarketBubbleStock {
  ticker: string
  companyName: string
  sector: string
  volume: number | null
  change1d: number | null
  change1w: number | null
  change1m: number | null
  change1y: number | null
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

export function MarketCloseDashboard({ data, bubbleStocks = [], onOpenStockDetail }: MarketCloseDashboardProps) {
  const [selectedSector, setSelectedSector] = React.useState<MarketSectorRow | null>(null)
  const [guideOpen, setGuideOpen] = React.useState(false)
  const [bubblePeriod, setBubblePeriod] = React.useState<"1D" | "1W" | "1M" | "1Y">("1D")
  const [marketView, setMarketView] = React.useState<"pulse" | "effort" | "health">("pulse")
  const [bubbleQuery, setBubbleQuery] = React.useState("")

  if (!data) return (
    <Card className={cn(surface, "py-12 text-center")}><CardContent className="space-y-3"><Activity className="mx-auto size-10 text-slate-600" /><CardTitle>Chưa có dữ liệu phiên đóng cửa</CardTitle><CardDescription>Snapshot sau phiên được cập nhật tự động sau 15:15 vào ngày giao dịch.</CardDescription></CardContent></Card>
  )

  const { sessionDate, asOf, dailySummary, indexes, sectors, leaders, history } = data
  const topVolumeLeaders = leaders.filter((item) => item.category === "top_volume").slice(0, 6)
  const leadingSectors = [...sectors].filter((item) => item.timeWindow === "1d").sort((a, b) => (b.averageChangePct ?? 0) - (a.averageChangePct ?? 0)).slice(0, 5)

  const leaderRank = new Map(leaders.filter((item) => item.category === "top_volume").map((item, index) => [item.ticker, index]))
  const bubbles = bubbleStocks
    .filter((item) => !bubbleQuery || item.ticker.toLowerCase().includes(bubbleQuery.toLowerCase()))
    .sort((a, b) => (leaderRank.get(a.ticker) ?? 999) - (leaderRank.get(b.ticker) ?? 999) || (b.volume ?? 0) - (a.volume ?? 0))
    .slice(0, 30)

  return (
    <div className="space-y-10" data-stock-analytics-dashboard data-liquid-glass-dashboard>
      <section aria-labelledby="market-overview-title" className="space-y-3">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{indexes.map((item) => <IndexTile key={item.indexCode} item={item} />)}</div>
        <p className="px-1 text-[10px] text-slate-600">Phiên {sessionDate} · cập nhật {formatTime(asOf)} · dữ liệu EOD đã chuẩn hóa</p>

        <Card className={cn(surface, "overflow-hidden py-0")}>
          <CardHeader className="flex flex-col gap-4 border-b border-white/[0.07] px-4 py-4 lg:flex-row lg:items-center lg:justify-between">
            <div><p className="text-[10px] font-black uppercase tracking-[0.22em] text-teal-300/70">Market bubbles</p><h2 id="market-overview-title" className="mt-1 text-lg font-bold text-white">Bubbles · Bản đồ giao dịch thị trường</h2><p className="mt-1 text-[11px] text-slate-500">Kích thước theo thanh khoản, màu theo biến động từng kỳ.</p></div>
            <div className="flex flex-wrap items-center gap-2"><div className="flex rounded-lg border border-white/[0.08] bg-black/15 p-1">{(["1D", "1W", "1M", "1Y"] as const).map((period) => <button key={period} type="button" onClick={() => setBubblePeriod(period)} className={cn("rounded-md px-3 py-1.5 font-mono text-[11px] font-bold transition-colors", bubblePeriod === period ? "bg-teal-300/15 text-teal-200" : "text-slate-500 hover:text-slate-200")}>{period}</button>)}</div><label className="flex h-9 items-center gap-2 rounded-lg border border-white/[0.08] bg-black/15 px-3"><Search className="size-3.5 text-slate-600" /><input value={bubbleQuery} onChange={(event) => setBubbleQuery(event.target.value)} placeholder="Tìm mã..." className="w-24 bg-transparent text-xs text-white outline-none placeholder:text-slate-600" /></label></div>
          </CardHeader>
          <CardContent className="min-h-[460px] p-4 sm:p-6"><div className="flex min-h-[420px] flex-wrap content-center items-center justify-center gap-2.5" aria-label={`Bản đồ cổ phiếu ${bubblePeriod}`}>{bubbles.map((stock, index) => <MarketBubble key={stock.ticker} stock={stock} period={bubblePeriod} rank={index} onOpen={onOpenStockDetail} />)}{bubbles.length === 0 && <p className="m-auto text-sm text-slate-500">Không tìm thấy mã phù hợp.</p>}</div></CardContent>
        </Card>
      </section>

      <MarketIntelligencePanel view={marketView} onViewChange={setMarketView} data={data} onOpenGuide={() => setGuideOpen(true)} />

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

function bubbleChange(stock: MarketBubbleStock, period: "1D" | "1W" | "1M" | "1Y") {
  if (period === "1W") return stock.change1w
  if (period === "1M") return stock.change1m
  if (period === "1Y") return stock.change1y
  return stock.change1d
}

function MarketBubble({ stock, period, rank, onOpen }: { stock: MarketBubbleStock; period: "1D" | "1W" | "1M" | "1Y"; rank: number; onOpen?: (ticker: string) => void }) {
  const change = bubbleChange(stock, period)
  const diameter = rank < 3 ? 132 - rank * 12 : rank < 10 ? 98 - (rank % 3) * 7 : 68 - (rank % 4) * 4
  const positive = (change ?? 0) >= 0
  return (
    <button type="button" onClick={() => onOpen?.(stock.ticker)} title={`${stock.companyName} · ${stock.sector}`} className={cn("group flex shrink-0 flex-col items-center justify-center rounded-full border bg-[#071219] text-center shadow-[inset_0_0_24px_rgba(255,255,255,0.025)] transition-[border-color,background-color,transform] duration-150 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-300/50", change == null ? "border-slate-600/45" : positive ? "border-teal-400/70 hover:bg-teal-400/[0.07]" : "border-rose-500/70 hover:bg-rose-400/[0.07]")} style={{ width: diameter, height: diameter }}>
      {diameter >= 82 && <StockLogo symbol={stock.ticker} size={diameter >= 110 ? 38 : 28} className="mb-1" />}
      <strong className={cn("font-mono font-black text-white", diameter >= 110 ? "text-lg" : diameter >= 82 ? "text-sm" : "text-[11px]")}>{stock.ticker}</strong>
      <span className={cn("mt-0.5 font-mono font-bold", diameter >= 82 ? "text-xs" : "text-[9px]", change == null ? "text-slate-500" : positive ? "text-teal-300" : "text-rose-300")}>{formatSigned(change, 2, "%")}</span>
    </button>
  )
}

function MarketIntelligencePanel({ view, onViewChange, data, onOpenGuide }: { view: "pulse" | "effort" | "health"; onViewChange: (view: "pulse" | "effort" | "health") => void; data: MarketCloseDashboardData; onOpenGuide: () => void }) {
  const { dailySummary, indexes, sectors, history, marketRegime } = data
  const vnindex = indexes.find((item) => item.indexCode === "VNINDEX")
  const breadthTotal = Math.max(1, (vnindex?.advances ?? 0) + (vnindex?.unchanged ?? 0) + (vnindex?.declines ?? 0))
  const effortRows = sectors.filter((item) => item.timeWindow === "1d").sort((a, b) => Math.abs(b.effortPct ?? b.resultPct ?? 0) - Math.abs(a.effortPct ?? a.resultPct ?? 0)).slice(0, 12)
  return (
    <section aria-labelledby="market-intelligence-title">
      <Card className={cn(surface, "overflow-hidden py-0")}>
        <div className="grid grid-cols-3 gap-1 border-b border-white/[0.07] bg-black/10 p-1.5">{([{ key: "pulse", label: "Nhịp đập thị trường" }, { key: "effort", label: "Nỗ lực kết quả" }, { key: "health", label: "Sức khoẻ thị trường" }] as const).map((item) => <button key={item.key} type="button" onClick={() => onViewChange(item.key)} className={cn("rounded-lg px-2 py-3 text-xs font-bold transition-colors sm:text-sm", view === item.key ? "bg-white/[0.08] text-white" : "text-slate-500 hover:text-slate-200")}>{item.label}</button>)}</div>
        <CardContent className="p-5 sm:p-6">
          {view === "pulse" && <div className="grid gap-6 xl:grid-cols-[.85fr_1.15fr]">
            <div><p className="text-[10px] font-black uppercase tracking-[0.2em] text-teal-300/70">Tổng quan thị trường</p><div className="mt-4 flex items-center gap-5"><div className="flex size-28 shrink-0 items-center justify-center rounded-full border border-amber-300/20 bg-amber-300/[0.06]"><strong className="text-center text-lg font-black uppercase text-amber-300">{marketRegime || "Chưa rõ"}</strong></div><div className="grid flex-1 grid-cols-2 gap-2"><PulseStat label="Tâm lý" value={`${formatNumber(dailySummary.sentimentScore, 0)} · ${dailySummary.sentimentLabel || "—"}`} /><PulseStat label="Rủi ro" value={formatNumber(dailySummary.riskScore, 2)} tone={(dailySummary.riskScore ?? 0) >= 60 ? "down" : "up"} /><PulseStat label="Khối ngoại" value={`${formatSigned(dailySummary.foreignNetValue, 0)} tỷ`} tone={(dailySummary.foreignNetValue ?? 0) >= 0 ? "up" : "down"} /><PulseStat label="Phân phối" value={`${dailySummary.distributionCount ?? "—"} ngày`} /></div></div></div>
            <div className="space-y-4"><BreadthBar label="Tăng giá" value={vnindex?.advances ?? 0} total={breadthTotal} tone="up" /><BreadthBar label="Đứng giá" value={vnindex?.unchanged ?? 0} total={breadthTotal} tone="flat" /><BreadthBar label="Giảm giá" value={vnindex?.declines ?? 0} total={breadthTotal} tone="down" /><div className="grid grid-cols-2 gap-2 pt-2 sm:grid-cols-4"><PulseStat label="Trên MA10" value={`${formatNumber(dailySummary.aboveMa10Pct, 0)}%`} /><PulseStat label="Trên MA20" value={`${formatNumber(dailySummary.aboveMa20Pct, 0)}%`} /><PulseStat label="Trên MA50" value={`${formatNumber(dailySummary.aboveMa50Pct, 0)}%`} /><PulseStat label="Trên MA200" value={`${formatNumber(dailySummary.aboveMa200Pct, 0)}%`} /></div></div>
          </div>}
          {view === "effort" && <div><div className="mb-5 flex flex-wrap items-end justify-between gap-3"><div><h3 id="market-intelligence-title" className="text-base font-bold text-white">Nỗ lực và kết quả theo ngành</h3><p className="mt-1 text-xs text-slate-500">Nỗ lực là thay đổi thanh khoản; kết quả là biến động giá bình quân trong phiên.</p></div><Badge variant="outline" className="border-white/10 text-slate-400">1 ngày · Ngành</Badge></div><div className="space-y-3">{effortRows.map((sector) => <div key={sector.sectorKey} className="grid grid-cols-[110px_1fr] items-center gap-3 sm:grid-cols-[180px_1fr]"><span className="truncate text-[11px] font-semibold uppercase text-slate-500">{sector.displayName}</span><div className="grid gap-1 sm:grid-cols-2"><MetricBar label="Nỗ lực" value={sector.effortPct} missing="Chưa có dữ liệu nỗ lực" striped /><MetricBar label="Kết quả" value={sector.resultPct ?? sector.averageChangePct} /></div></div>)}</div></div>}
          {view === "health" && <div><div className="mb-4 flex items-start justify-between gap-3"><div><h3 id="market-intelligence-title" className="text-base font-bold text-white">Chỉ báo tâm lý và rủi ro</h3><p className="mt-1 text-xs text-slate-500">Theo dõi diễn biến tối đa 20 phiên gần nhất trên cùng thang đo.</p></div><Button variant="outline" size="sm" onClick={onOpenGuide} className="border-white/10 bg-white/[0.025] text-xs"><BookOpen className="size-3.5" /> Cách đọc</Button></div><MarketHistoryChart history={history} /></div>}
        </CardContent>
      </Card>
    </section>
  )
}

function MetricBar({ label, value, missing, striped }: { label: string; value: number | null; missing?: string; striped?: boolean }) {
  const positive = (value ?? 0) >= 0
  const width = value == null ? 0 : Math.min(100, Math.max(3, Math.abs(value)))
  return <div className="grid grid-cols-[58px_1fr_70px] items-center gap-2"><span className="text-[9px] text-slate-600">{label}</span><div className="h-5 overflow-hidden rounded bg-white/[0.04]" title={value == null ? missing : undefined}><div className={cn("h-full rounded", positive ? "bg-teal-400/80" : "bg-rose-500/80", striped && "bg-[repeating-linear-gradient(135deg,rgba(255,255,255,.12)_0_7px,transparent_7px_14px)]")} style={{ width: `${width}%` }} /></div><span className={cn("truncate font-mono text-[10px]", value == null ? "text-slate-600" : positive ? "text-teal-300" : "text-rose-300")} title={value == null ? missing : undefined}>{value == null ? "Thiếu data" : formatSigned(value, 2, "%")}</span></div>
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
