import Link from "next/link"
import {
  Activity,
  ArrowRight,
  BarChart3,
  BookOpen,
  CircleDot,
  Clock3,
  Database,
  Gauge,
  Radar,
  ShieldCheck,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Zap,
} from "lucide-react"

import { GlowCard } from "@/components/smoothui/glow-card"
import { ShineText } from "@/components/smoothui/shine-text"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { InsightsHomepageData, InsightsRatingRow } from "@/lib/insights-data"
import type { MarketIndexQuote } from "@/lib/tradingview-index"

function formatNumber(value: number | null | undefined, maximumFractionDigits = 2) {
  if (value == null || !Number.isFinite(value)) return "—"
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits }).format(value)
}

function formatPercent(value: number | null | undefined, digits = 1) {
  if (value == null || !Number.isFinite(value)) return "—"
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}%`
}

function formatMoney(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value) || value <= 0) return "—"
  if (value >= 1_000_000_000_000) return `${(value / 1_000_000_000_000).toFixed(1)} nghìn tỷ`
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)} tỷ`
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(value)
}

function shortDateTime(value: string) {
  if (!value) return "—"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}

function toneClass(value: number | null | undefined) {
  if (value == null || value === 0) return "text-ref"
  return value > 0 ? "text-up" : "text-down"
}

function scoreTone(value: number | null | undefined) {
  if (value == null) return "text-slate-500"
  if (value >= 70) return "text-emerald-300"
  if (value >= 55) return "text-cyan-300"
  if (value >= 40) return "text-amber-300"
  return "text-rose-300"
}

function rrgTone(value: string) {
  const normalized = value.toLowerCase()
  if (normalized.includes("dẫn") || normalized.includes("leading")) return "border-emerald-400/25 bg-emerald-400/10 text-emerald-300"
  if (normalized.includes("phục") || normalized.includes("improving")) return "border-cyan-400/25 bg-cyan-400/10 text-cyan-300"
  if (normalized.includes("suy") || normalized.includes("weakening")) return "border-amber-400/25 bg-amber-400/10 text-amber-300"
  if (normalized.includes("đổi") || normalized.includes("lagging")) return "border-rose-400/25 bg-rose-400/10 text-rose-300"
  return "border-white/[0.08] bg-white/[0.035] text-slate-400"
}

function ScoreBar({ value }: { value: number | null }) {
  const width = value == null ? 0 : Math.max(0, Math.min(100, value))
  return (
    <div className="min-w-[92px]">
      <div className={`mb-1 font-ticker text-[12px] font-extrabold ${scoreTone(value)}`}>{value == null ? "—" : value.toFixed(1)}</div>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.08]">
        <div
          className="h-full rounded-full bg-gradient-to-r from-emerald-400 via-cyan-400 to-purple-400"
          style={{ width: `${width}%` }}
        />
      </div>
    </div>
  )
}

function SectionHeader({
  eyebrow,
  title,
  description,
  href,
}: {
  eyebrow: string
  title: string
  description: string
  href?: string
}) {
  return (
    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <div className="mb-2 flex items-center gap-2 font-ticker text-[11px] font-extrabold uppercase tracking-[0.18em] text-emerald-400/85">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_10px_rgba(34,201,138,0.8)]" />
          {eyebrow}
        </div>
        <h2 className="font-ticker text-[24px] font-extrabold tracking-[-0.035em] text-white sm:text-[28px]">{title}</h2>
        <p className="mt-1.5 max-w-3xl font-ticker text-[13px] font-medium leading-6 text-slate-400 sm:text-sm">{description}</p>
      </div>
      {href && (
        <Link href={href} className="inline-flex shrink-0 items-center gap-1.5 font-ticker text-xs font-bold text-slate-400 transition hover:text-emerald-300">
          Xem chi tiết <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      )}
    </div>
  )
}

function IndexOverview({ indexes }: { indexes: Record<string, MarketIndexQuote> }) {
  const vn = indexes.VNINDEX
  const secondary = [indexes.VN30, indexes.HNXINDEX, indexes.UPCOMINDEX].filter(Boolean) as MarketIndexQuote[]
  const advances = vn?.advances ?? 0
  const declines = vn?.declines ?? 0
  const unchanged = vn?.unchanged ?? 0
  const breadthTotal = advances + declines + unchanged
  const advancePct = breadthTotal ? (advances / breadthTotal) * 100 : 0
  const declinePct = breadthTotal ? (declines / breadthTotal) * 100 : 0

  return (
    <section>
      <SectionHeader
        eyebrow="Market pulse"
        title="Tổng quan VNIndex"
        description="Snapshot chỉ số, độ rộng và thanh khoản. Dữ liệu index dùng read model public, độc lập với auth gate của bảng điện."
      />
      <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
        <GlowCard className="rounded-[22px]">
          <Card className="min-h-[300px] overflow-hidden border-emerald-400/15 bg-[linear-gradient(135deg,rgba(14,24,24,0.96),rgba(10,14,20,0.96)_56%,rgba(19,13,31,0.92))] shadow-[0_28px_70px_-45px_rgba(34,201,138,0.8)]">
            <CardHeader className="pb-3">
              <div>
                <div className="flex items-center gap-2">
                  <Badge className="border-emerald-400/20 bg-emerald-400/10 text-emerald-300"><Activity className="mr-1.5 h-3 w-3" />VNINDEX</Badge>
                  <Badge className="text-slate-500"><Clock3 className="mr-1.5 h-3 w-3" />{shortDateTime(vn?.updatedAt ?? "")}</Badge>
                </div>
                <CardTitle className="mt-5 text-[42px] leading-none sm:text-[56px]">{formatNumber(vn?.value, 2)}</CardTitle>
                <div className={`mt-3 flex items-center gap-2 font-ticker text-base font-extrabold ${toneClass(vn?.changePercent)}`}>
                  {(vn?.changePercent ?? 0) >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                  {formatNumber(vn?.change, 2)} · {formatPercent(vn?.changePercent, 2)}
                </div>
              </div>
              <div className="hidden rounded-2xl border border-white/[0.08] bg-black/20 p-3 text-right sm:block">
                <div className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-slate-600">GTGD</div>
                <div className="mt-1 font-ticker text-lg font-extrabold text-white">{formatMoney(vn?.valueTraded)}</div>
                <div className={`mt-1 text-xs font-bold ${toneClass(vn?.valueChangePercent)}`}>{formatPercent(vn?.valueChangePercent)}</div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-emerald-400/10 bg-emerald-400/[0.045] p-4">
                  <div className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-slate-500">Tăng</div>
                  <div className="mt-1 font-ticker text-2xl font-extrabold text-up">{advances || "—"}</div>
                </div>
                <div className="rounded-2xl border border-rose-400/10 bg-rose-400/[0.04] p-4">
                  <div className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-slate-500">Giảm</div>
                  <div className="mt-1 font-ticker text-2xl font-extrabold text-down">{declines || "—"}</div>
                </div>
                <div className="rounded-2xl border border-amber-400/10 bg-amber-400/[0.035] p-4">
                  <div className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-slate-500">Đứng giá</div>
                  <div className="mt-1 font-ticker text-2xl font-extrabold text-ref">{unchanged || "—"}</div>
                </div>
              </div>
              <div className="mt-4 overflow-hidden rounded-full bg-white/[0.06]">
                <div className="flex h-2.5 w-full">
                  <div className="bg-up" style={{ width: `${advancePct}%` }} />
                  <div className="bg-ref/70" style={{ width: `${breadthTotal ? 100 - advancePct - declinePct : 0}%` }} />
                  <div className="bg-down" style={{ width: `${declinePct}%` }} />
                </div>
              </div>
            </CardContent>
          </Card>
        </GlowCard>

        <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
          {secondary.length ? secondary.map((index) => (
            <GlowCard key={index.symbol} className="rounded-2xl">
              <Card className="h-full bg-[#0c1118]/96">
                <CardContent className="flex h-full items-center justify-between gap-3 p-4">
                  <div>
                    <div className="font-ticker text-[11px] font-extrabold uppercase tracking-[0.12em] text-slate-500">{index.symbol}</div>
                    <div className="mt-1 font-ticker text-xl font-extrabold text-white">{formatNumber(index.value, 2)}</div>
                  </div>
                  <div className={`rounded-xl border border-white/[0.07] bg-black/20 px-3 py-2 font-ticker text-sm font-extrabold ${toneClass(index.changePercent)}`}>
                    {formatPercent(index.changePercent, 2)}
                  </div>
                </CardContent>
              </Card>
            </GlowCard>
          )) : (
            <Card className="border-dashed"><CardContent className="p-5 text-sm text-slate-500">Chưa có snapshot chỉ số phụ.</CardContent></Card>
          )}
        </div>
      </div>
    </section>
  )
}

function RatingRow({ row }: { row: InsightsRatingRow }) {
  return (
    <TableRow>
      <TableCell className="sticky left-0 z-10 min-w-[84px] bg-[#0b1016] font-extrabold text-purple-300">{row.ticker}</TableCell>
      <TableCell className="min-w-[170px] text-slate-300">{row.sector}</TableCell>
      <TableCell className="min-w-[82px] text-slate-500">{row.exchange}</TableCell>
      <TableCell className="min-w-[116px]">
        <div className="font-extrabold text-white">{formatNumber(row.price, 2)}</div>
        <div className={`mt-0.5 text-[11px] font-bold ${toneClass(row.priceChangePct)}`}>{formatPercent(row.priceChangePct, 2)}</div>
      </TableCell>
      <TableCell className="min-w-[96px]"><div className={`text-base font-extrabold ${scoreTone(row.compositeScore)}`}>{row.compositeScore == null ? "—" : row.compositeScore.toFixed(1)}</div></TableCell>
      <TableCell><ScoreBar value={row.score4m} /></TableCell>
      <TableCell><ScoreBar value={row.canslimScore} /></TableCell>
      <TableCell><ScoreBar value={row.stockRsScore} /></TableCell>
      <TableCell><ScoreBar value={row.sectorRsScore} /></TableCell>
      <TableCell className="min-w-[130px]"><Badge className={rrgTone(row.stockRrgState)}>{row.stockRrgState}</Badge></TableCell>
      <TableCell className="min-w-[130px]"><Badge className={rrgTone(row.sectorRrgState)}>{row.sectorRrgState}</Badge></TableCell>
    </TableRow>
  )
}

function RatingsTable({ ratings }: { ratings: InsightsHomepageData["ratings"] }) {
  return (
    <section>
      <SectionHeader
        eyebrow="Rating engine"
        title="Top cổ phiếu theo Rating Score"
        description="Bảng dữ liệu đã tách schema để cron daily có thể upsert snapshot từ API bên thứ ba. Không tạo score giả khi pipeline chưa chạy."
      />
      <GlowCard className="rounded-[22px]">
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.07] bg-white/[0.018] px-5 py-3.5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className={ratings.status === "ready" ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-300" : "border-amber-400/20 bg-amber-400/10 text-amber-300"}>
                <Database className="mr-1.5 h-3 w-3" />{ratings.status === "ready" ? "Supabase live" : "Pipeline pending"}
              </Badge>
              <span className="font-ticker text-xs font-medium text-slate-500">{ratings.message}</span>
            </div>
            {ratings.asOfDate && <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-slate-600">As of {ratings.asOfDate}</span>}
          </div>
          <div className="overflow-x-auto">
            <Table className="min-w-[1260px]">
              <TableHeader className="bg-[#0d131c]">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="sticky left-0 z-20 bg-[#0d131c]">Mã CK</TableHead>
                  <TableHead>Ngành</TableHead>
                  <TableHead>Sàn</TableHead>
                  <TableHead>Giá</TableHead>
                  <TableHead>Rating</TableHead>
                  <TableHead>Điểm 4M</TableHead>
                  <TableHead>CANSLIM</TableHead>
                  <TableHead>RS-S cổ phiếu</TableHead>
                  <TableHead>RS-S ngành</TableHead>
                  <TableHead>RRG cổ phiếu</TableHead>
                  <TableHead>RRG ngành</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ratings.rows.slice(0, 30).map((row) => <RatingRow key={`${row.asOfDate}:${row.ticker}:${row.source}`} row={row} />)}
              </TableBody>
            </Table>
          </div>
          {!ratings.rows.length && (
            <div className="border-t border-dashed border-white/[0.08] px-6 py-12 text-center">
              <Gauge className="mx-auto h-8 w-8 text-slate-700" />
              <div className="mt-3 font-ticker text-base font-extrabold text-slate-300">Chưa có rating snapshot</div>
              <p className="mx-auto mt-2 max-w-xl font-ticker text-sm leading-6 text-slate-500">Schema + RLS public-read đã sẵn sàng. Cron/API ingest sẽ được nối sau; homepage giữ empty state thay vì suy diễn dữ liệu.</p>
            </div>
          )}
        </Card>
      </GlowCard>
    </section>
  )
}

function WyckoffRadar({ scanner }: { scanner: InsightsHomepageData["scanner"] }) {
  return (
    <GlowCard className="rounded-[22px]">
      <Card className="h-full">
        <CardHeader>
          <div>
            <Badge className="mb-3 border-cyan-400/20 bg-cyan-400/10 text-cyan-300"><Radar className="mr-1.5 h-3 w-3" />Wyckoff Radar</Badge>
            <CardTitle>Setup đáng chú ý</CardTitle>
            <CardDescription>Top scan theo Bull Probability; giữ nguyên confidence và phase từ Notion.</CardDescription>
          </div>
          <Link href="/research/scanner" className="text-slate-500 transition hover:text-cyan-300" aria-label="Mở Wyckoff Scanner"><ArrowRight className="h-4 w-4" /></Link>
        </CardHeader>
        <CardContent className="space-y-2">
          {scanner.rows.length ? scanner.rows.map((row) => (
            <div key={row.id} className="grid grid-cols-[62px_1fr_auto] items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-3">
              <div className="font-ticker text-base font-extrabold text-white">{row.ticker}</div>
              <div className="min-w-0">
                <div className="truncate font-ticker text-xs font-bold text-slate-300">{row.wyckoffState || "Structure chưa gắn nhãn"}</div>
                <div className="mt-0.5 truncate text-[11px] text-slate-600">{row.phase || "—"} · {row.confidence || "—"}</div>
              </div>
              <div className="text-right">
                <div className="font-ticker text-sm font-extrabold text-emerald-300">{row.bullProbability == null ? "—" : `${row.bullProbability.toFixed(0)}%`}</div>
                <div className="text-[10px] uppercase tracking-wider text-slate-600">Bull</div>
              </div>
            </div>
          )) : <div className="rounded-xl border border-dashed border-white/[0.08] p-5 text-sm text-slate-500">Không đọc được Daily Scan từ Notion.</div>}
        </CardContent>
      </Card>
    </GlowCard>
  )
}

function SignalMonitor({ signals }: { signals: InsightsHomepageData["signals"] }) {
  return (
    <GlowCard className="rounded-[22px]">
      <Card className="h-full">
        <CardHeader>
          <div>
            <Badge className="mb-3 border-amber-400/20 bg-amber-400/10 text-amber-300"><Zap className="mr-1.5 h-3 w-3" />Signal Monitor</Badge>
            <CardTitle>Tín hiệu & khuyến nghị đang mở</CardTitle>
            <CardDescription>Public projection từ Trade Recommendations + Signal Events trên Notion.</CardDescription>
          </div>
          <Link href="/research/signals" className="text-slate-500 transition hover:text-amber-300" aria-label="Mở Signal Monitor"><ArrowRight className="h-4 w-4" /></Link>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-emerald-400/10 bg-emerald-400/[0.035] p-4">
              <div className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-slate-500">Open</div>
              <div className="mt-1 font-ticker text-3xl font-extrabold text-emerald-300">{signals.openRecommendations.length}</div>
            </div>
            <div className="rounded-2xl border border-purple-400/10 bg-purple-400/[0.035] p-4">
              <div className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-slate-500">Recent events</div>
              <div className="mt-1 font-ticker text-3xl font-extrabold text-purple-300">{signals.recentEvents.length}</div>
            </div>
          </div>
          <div className="mt-3 space-y-2">
            {signals.openRecommendations.slice(0, 3).map((row) => (
              <div key={row.id} className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.06] px-3 py-2.5">
                <div>
                  <span className="font-ticker text-sm font-extrabold text-white">{row.ticker}</span>
                  <span className="ml-2 text-[11px] text-slate-600">{row.confidence || row.dailyBias || "Open"}</span>
                </div>
                <div className="text-right text-[11px] text-slate-500">
                  <div>Mua <span className="font-bold text-slate-300">{formatNumber(row.buyPrice, 2)}</span></div>
                  <div>Stop <span className="font-bold text-rose-300">{formatNumber(row.stopPrice, 2)}</span></div>
                </div>
              </div>
            ))}
            {!signals.openRecommendations.length && <div className="rounded-xl border border-dashed border-white/[0.08] p-4 text-sm text-slate-500">Không có recommendation Open trong read model hiện tại.</div>}
          </div>
        </CardContent>
      </Card>
    </GlowCard>
  )
}

function ThesisPulse({ research }: { research: InsightsHomepageData["research"] }) {
  return (
    <GlowCard className="rounded-[22px]">
      <Card className="h-full">
        <CardHeader>
          <div>
            <Badge className="mb-3 border-purple-400/20 bg-purple-400/10 text-purple-300"><BookOpen className="mr-1.5 h-3 w-3" />Thesis Pulse</Badge>
            <CardTitle>Luận điểm vừa cập nhật</CardTitle>
            <CardDescription>Stock Thesis projection từ canonical Notion Hub.</CardDescription>
          </div>
          <Badge className="border-amber-400/15 bg-amber-400/[0.06] text-amber-300">{research.pendingReviews} hậu kiểm</Badge>
        </CardHeader>
        <CardContent className="space-y-2">
          {research.rows.length ? research.rows.slice(0, 5).map((row) => (
            <div key={row.id} className="rounded-xl border border-white/[0.06] bg-white/[0.018] px-3.5 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="font-ticker text-sm font-extrabold text-white">{row.ticker}</div>
                <div className="flex items-center gap-1.5">
                  {row.taBias && <Badge className="px-2 py-0.5 text-[9px]">TA {row.taBias}</Badge>}
                  {row.faBias && <Badge className="px-2 py-0.5 text-[9px]">FA {row.faBias}</Badge>}
                </div>
              </div>
              <p className="mt-2 line-clamp-2 font-ticker text-xs leading-5 text-slate-500">{row.whatChanged || row.baseCase || "Chưa có mô tả thay đổi."}</p>
            </div>
          )) : <div className="rounded-xl border border-dashed border-white/[0.08] p-5 text-sm text-slate-500">Notion Stock Thesis hiện không khả dụng.</div>}
        </CardContent>
      </Card>
    </GlowCard>
  )
}

function ValuationBreadth({ valuation }: { valuation: InsightsHomepageData["valuation"] }) {
  const rows = Object.entries(valuation.counts) as Array<[keyof typeof valuation.counts, number]>
  const max = Math.max(...rows.map(([, count]) => count), 1)
  return (
    <GlowCard className="rounded-[22px]">
      <Card className="h-full">
        <CardHeader>
          <div>
            <Badge className="mb-3 border-emerald-400/20 bg-emerald-400/10 text-emerald-300"><BarChart3 className="mr-1.5 h-3 w-3" />FA Breadth</Badge>
            <CardTitle>Bản đồ định giá</CardTitle>
            <CardDescription>{valuation.total} mã · snapshot {valuation.snapshotDate}</CardDescription>
          </div>
          <Link href="/research/fa" className="text-slate-500 transition hover:text-emerald-300" aria-label="Mở FA Screen"><ArrowRight className="h-4 w-4" /></Link>
        </CardHeader>
        <CardContent className="space-y-3">
          {rows.map(([label, count]) => (
            <div key={label}>
              <div className="mb-1.5 flex items-center justify-between gap-3 font-ticker text-xs">
                <span className="font-bold text-slate-400">{label}</span>
                <span className="font-extrabold text-white">{count}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]">
                <div className="h-full rounded-full bg-gradient-to-r from-emerald-400 via-cyan-400 to-purple-400" style={{ width: `${(count / max) * 100}%` }} />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </GlowCard>
  )
}

export function InsightsHomepage({ data }: { data: InsightsHomepageData }) {
  return (
    <div className="font-ticker">
      <section className="relative overflow-hidden border-b border-white/[0.06]">
        <div aria-hidden="true" className="pointer-events-none absolute -left-20 top-8 h-72 w-72 rounded-full bg-emerald-400/[0.045] blur-[90px]" />
        <div aria-hidden="true" className="pointer-events-none absolute right-[12%] top-0 h-64 w-64 rounded-full bg-purple-400/[0.04] blur-[100px]" />
        <div className="relative mx-auto max-w-[1580px] px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-4xl">
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-emerald-400/15 bg-emerald-400/[0.055] px-3 py-1.5 text-[11px] font-extrabold uppercase tracking-[0.15em] text-emerald-300">
                <Sparkles className="h-3.5 w-3.5" /> Insights Homepage
              </div>
              <h1 className="text-[40px] font-extrabold leading-[1.02] tracking-[-0.055em] text-white sm:text-[54px] lg:text-[64px]">
                Đọc thị trường qua <ShineText className="italic" baseColor="#6ee7b7" shineColor="#f4b84b">một lớp dữ liệu.</ShineText>
              </h1>
              <p className="mt-5 max-w-3xl text-[15px] font-medium leading-7 text-slate-400 sm:text-base">
                VNIndex, rating cổ phiếu, Wyckoff, tín hiệu, thesis và định giá — gom vào một dashboard public, ưu tiên dữ liệu có nguồn và không lấp chỗ trống bằng suy đoán.
              </p>
            </div>
            <div className="grid min-w-[280px] grid-cols-2 gap-2 sm:min-w-[360px]">
              <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-3.5">
                <div className="flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[0.13em] text-slate-600"><ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />Access</div>
                <div className="mt-1.5 text-sm font-extrabold text-white">Public read</div>
              </div>
              <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-3.5">
                <div className="flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[0.13em] text-slate-600"><CircleDot className="h-3.5 w-3.5 text-purple-400" />Updated</div>
                <div className="mt-1.5 text-sm font-extrabold text-white">{shortDateTime(data.generatedAt)}</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <main className="mx-auto max-w-[1580px] space-y-12 px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
        <IndexOverview indexes={data.indexes} />
        <RatingsTable ratings={data.ratings} />

        <section>
          <SectionHeader
            eyebrow="Research layers"
            title="Các lớp Insights từ Research"
            description="Tóm tắt trực tiếp từ các read model hiện có; trang chi tiết /research vẫn giữ security boundary riêng."
          />
          <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-4">
            <WyckoffRadar scanner={data.scanner} />
            <SignalMonitor signals={data.signals} />
            <ThesisPulse research={data.research} />
            <ValuationBreadth valuation={data.valuation} />
          </div>
        </section>
      </main>
    </div>
  )
}
