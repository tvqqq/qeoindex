// Async Server Component sections for /research/[ticker].
// No "use client" — all components here are server-rendered.
// Client sub-components (MultiTimeframeWorkstation, ResearchApp) are imported as leaf nodes.

import Link from "next/link"
import type { ReactNode } from "react"
import {
  Activity,
  ArrowLeft,
  BarChart3,
  ExternalLink,
  Gauge,
  Loader2,
  ShieldCheck,
  Target,
} from "lucide-react"

import { MultiTimeframeWorkstation } from "@/components/research/multi-timeframe-workstation"
import { ResearchApp } from "@/components/research/research-app"
import { NotionUnavailable } from "@/components/notion-unavailable"
import {
  getCachedResearchData,
  getCachedScannerData,
  getCachedDailyHistory,
  getCachedHourlyHistory,
} from "@/modules/shared/cache/request-cache"
import { buildMultiTimeframeStudies } from "@/modules/research/multi-timeframe"
import type { AnalysisLog, MarketRegime, ProbabilitySet } from "@/modules/research/types"
import type { DailyScanRow } from "@/modules/signals/scanner/data"
import type { OhlcvBar } from "@/modules/shared/technical/indicators"

// ─── Utility helpers ───────────────────────────────────────────────────────

function barDate(bar: OhlcvBar) {
  return new Date(bar.time * 1000).toISOString().slice(0, 10)
}
function compactDate(value: string) {
  if (!value) return "—"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Asia/Ho_Chi_Minh",
  }).format(date)
}
function num(value: number | null | undefined, digits = 2) {
  if (value == null || !Number.isFinite(value)) return "—"
  return value.toLocaleString("en-US", { maximumFractionDigits: digits })
}
function percent(value: number | null | undefined, digits = 2) {
  if (value == null || !Number.isFinite(value)) return "—"
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`
}
function confidenceLabel(value: string) {
  if (value === "HIGH") return "Cao"
  if (value === "MEDIUM") return "Trung bình"
  if (value === "LOW") return "Thấp"
  return "—"
}
function biasLabel(value: string) {
  if (value === "Bullish") return "Tích cực"
  if (value === "Bearish") return "Tiêu cực"
  if (value === "Mixed") return "Hỗn hợp"
  if (value === "Neutral") return "Trung tính"
  return value || "—"
}
function biasClass(value: string) {
  if (value === "Bullish") return "border-up/35 bg-up/10 text-up"
  if (value === "Bearish") return "border-down/35 bg-down/10 text-down"
  if (value === "Mixed") return "border-ref/35 bg-ref/10 text-ref"
  return "border-border-strong bg-panel-2 text-foreground/80"
}
function regimeLabel(value: MarketRegime) {
  if (value === "Risk-On") return "RISK-ON"
  if (value === "Risk-Off") return "RISK-OFF"
  if (value === "Neutral") return "NEUTRAL"
  return "—"
}
function probabilitiesFromScan(scan?: DailyScanRow): ProbabilitySet {
  return { bull: scan?.bullProbability ?? null, base: scan?.baseProbability ?? null, bear: scan?.bearProbability ?? null }
}

// ─── Pure UI sub-components ────────────────────────────────────────────────

const SCENARIOS = [
  { key: "bull" as const, label: "Bull", cls: "bg-up" },
  { key: "base" as const, label: "Base", cls: "bg-ref" },
  { key: "bear" as const, label: "Bear", cls: "bg-down" },
]

function ScenarioBars({ probabilities }: { probabilities: ProbabilitySet }) {
  return (
    <div className="space-y-3">
      {SCENARIOS.map((scenario) => {
        const value = probabilities[scenario.key]
        return (
          <div key={scenario.key}>
            <div className="mb-1.5 flex items-center justify-between text-sm">
              <span className="font-medium text-foreground/75">{scenario.label}</span>
              <span className="font-mono font-semibold text-foreground">{value == null ? "—" : `${value}%`}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-panel-2">
              <div className={`h-full rounded-full ${scenario.cls}`} style={{ width: `${Math.max(0, Math.min(100, value ?? 0))}%` }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

function MetricCard({ label, value, detail, icon }: { label: string; value: string; detail: string; icon: ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-panel p-5">
      <div className="flex items-center justify-between gap-3 text-sm font-semibold text-foreground/65">
        <span>{label}</span>
        <span className="text-foreground/45">{icon}</span>
      </div>
      <div className="mt-3 font-mono text-2xl font-semibold text-foreground">{value}</div>
      <p className="mt-2 text-sm leading-6 text-foreground/55">{detail}</p>
    </div>
  )
}

function Section({ title, children, tone = "default" }: { title: string; children: ReactNode; tone?: "default" | "positive" | "warning" | "danger" }) {
  const border = tone === "positive" ? "border-up/30" : tone === "warning" ? "border-ref/30" : tone === "danger" ? "border-down/30" : "border-border"
  return (
    <section className={`rounded-xl border ${border} bg-panel p-5`}>
      <h3 className="text-sm font-semibold uppercase tracking-[0.08em] text-foreground/50">{title}</h3>
      <div className="mt-3 text-base leading-7 text-foreground/78">{children}</div>
    </section>
  )
}

function rollingAverage(bars: OhlcvBar[], period: number) {
  const out: Array<number | null> = Array(bars.length).fill(null)
  let sum = 0
  for (let i = 0; i < bars.length; i += 1) {
    sum += bars[i].close
    if (i >= period) sum -= bars[i - period].close
    if (i >= period - 1) out[i] = sum / period
  }
  return out
}

function PriceHistoryChartSvg({ ticker, bars }: { ticker: string; bars: OhlcvBar[] }) {
  const shown = bars.slice(-120)
  if (shown.length < 2) return <div className="rounded-lg border border-border bg-panel-2 p-6 text-sm text-foreground/60">Chưa đủ OHLCV để vẽ biểu đồ.</div>
  const ma20 = rollingAverage(bars, 20).slice(-shown.length)
  const ma50 = rollingAverage(bars, 50).slice(-shown.length)
  const ma200 = rollingAverage(bars, 200).slice(-shown.length)
  const width = 960, height = 380, left = 54, right = 18, top = 20, priceHeight = 250, volumeTop = 300, volumeHeight = 48, chartWidth = width - left - right
  const values: number[] = []
  shown.forEach((bar, i) => {
    values.push(bar.low, bar.high)
    if (ma20[i] != null) values.push(ma20[i] as number)
    if (ma50[i] != null) values.push(ma50[i] as number)
    if (ma200[i] != null) values.push(ma200[i] as number)
  })
  const rawMin = Math.min(...values), rawMax = Math.max(...values), pad = Math.max((rawMax - rawMin) * 0.08, rawMax * 0.01)
  const min = rawMin - pad, max = rawMax + pad, maxVolume = Math.max(...shown.map((bar) => bar.volume), 1)
  const x = (i: number) => left + (i / Math.max(1, shown.length - 1)) * chartWidth
  const y = (v: number) => top + ((max - v) / Math.max(1e-9, max - min)) * priceHeight
  const path = (series: Array<number | null>) => series.map((value, i) => value == null ? "" : `${i === 0 || series[i - 1] == null ? "M" : "L"} ${x(i)} ${y(value)}`).join(" ")
  const closePath = shown.map((bar, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(bar.close)}`).join(" ")
  const firstDate = new Date(shown[0].time * 1000)
  const lastDate = new Date(shown.at(-1)!.time * 1000)
  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${height}`} className="min-w-[760px] w-full" role="img" aria-label={`Biểu đồ Daily ${ticker}`}>
        {[min, min + (max - min) / 2, max].map((tick) => (
          <g key={tick}>
            <line x1={left} x2={width - right} y1={y(tick)} y2={y(tick)} stroke="var(--color-border-strong)" strokeDasharray="4 6" opacity="0.6" />
            <text x={left - 8} y={y(tick) + 4} textAnchor="end" fill="currentColor" className="text-[11px] text-foreground/45">{num(tick, 0)}</text>
          </g>
        ))}
        {shown.map((bar, i) => {
          const barWidth = Math.max(1.5, chartWidth / shown.length - 1)
          const h = (bar.volume / maxVolume) * volumeHeight
          return <rect key={bar.time} x={x(i) - barWidth / 2} y={volumeTop + volumeHeight - h} width={barWidth} height={h} fill={bar.close >= bar.open ? "var(--color-up)" : "var(--color-down)"} opacity="0.35" />
        })}
        <path d={closePath} fill="none" stroke="var(--color-foreground)" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" />
        <path d={path(ma20)} fill="none" stroke="var(--color-brand)" strokeWidth="1.8" strokeLinecap="round" />
        <path d={path(ma50)} fill="none" stroke="var(--color-ref)" strokeWidth="1.8" strokeLinecap="round" />
        <path d={path(ma200)} fill="none" stroke="var(--color-down)" strokeWidth="1.5" strokeLinecap="round" opacity="0.75" />
        <text x={left} y={height - 10} fill="currentColor" className="text-[11px] text-foreground/45">{firstDate.toISOString().slice(0, 10)}</text>
        <text x={width - right} y={height - 10} textAnchor="end" fill="currentColor" className="text-[11px] text-foreground/45">{lastDate.toISOString().slice(0, 10)}</text>
      </svg>
      <div className="mt-2 flex flex-wrap gap-4 text-xs text-foreground/55">
        <span>Giá đóng cửa</span>
        <span className="text-brand">MA20</span>
        <span className="text-ref">MA50</span>
        <span className="text-down">MA200</span>
        <span>Volume phía dưới</span>
      </div>
    </div>
  )
}

function MovingAverageRow({ label, ma, price }: { label: string; ma: number | null | undefined; price: number | null | undefined }) {
  const distance = ma != null && price != null && ma !== 0 ? ((price - ma) / ma) * 100 : null
  return (
    <div className="flex items-center justify-between gap-4 border-t border-border/70 py-3 first:border-t-0 first:pt-0">
      <div>
        <div className="font-medium text-foreground/75">{label}</div>
        <div className="mt-1 font-mono text-sm text-foreground/55">{num(ma, 2)}</div>
      </div>
      <div className={`font-mono text-sm font-semibold ${distance == null ? "text-foreground/50" : distance >= 0 ? "text-up" : "text-down"}`}>
        {distance == null ? "—" : `${distance >= 0 ? "+" : ""}${distance.toFixed(2)}%`}
      </div>
    </div>
  )
}

function AnalysisTimeline({ logs }: { logs: AnalysisLog[] }) {
  if (!logs.length) return <div className="p-5 text-sm text-foreground/60">Chưa có Analysis Log cho mã này.</div>
  return (
    <div className="divide-y divide-border/70">
      {logs.slice(0, 8).map((row) => (
        <article key={row.id} className="p-5">
          <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-start">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-xs text-foreground/50">
                <span>{compactDate(row.date || row.updated)}</span>
                {row.timeframes.map((tf) => (
                  <span key={tf} className="rounded border border-border bg-panel-2 px-2 py-0.5">{tf}</span>
                ))}
              </div>
              <a href={row.notionUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1.5 text-base font-semibold text-foreground hover:text-brand">
                {row.analysis}<ExternalLink className="h-3.5 w-3.5" />
              </a>
              <p className="mt-2 text-sm leading-6 text-foreground/70">{row.summary}</p>
            </div>
            <div className="shrink-0 text-xs text-foreground/55">{row.outcome === "Pending" ? "Đang theo dõi" : row.outcome || "—"}</div>
          </div>
        </article>
      ))}
    </div>
  )
}

// ─── Skeleton components ────────────────────────────────────────────────────

function SectionLoader({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-foreground/50">
      <Loader2 className="h-4 w-4 animate-spin text-brand" />
      <span>{label}</span>
    </div>
  )
}

export function TickerHeaderSkeleton({ ticker }: { ticker: string }) {
  return (
    <div className="border-b border-border bg-panel/75">
      <div className="mx-auto max-w-[1600px] px-4 py-5 lg:px-6">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="h-4 w-16 animate-pulse rounded bg-panel-2" />
              <span className="text-foreground/25">/</span>
              <span className="font-mono text-3xl font-bold text-foreground">{ticker}</span>
              <div className="h-5 w-40 animate-pulse rounded bg-panel-2" />
              <div className="h-6 w-32 animate-pulse rounded-md bg-panel-2" />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2.5">
              <div className="h-6 w-28 animate-pulse rounded-md bg-panel-2" />
              <div className="h-6 w-20 animate-pulse rounded-md bg-panel-2" />
              <div className="h-6 w-24 animate-pulse rounded-md bg-panel-2" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-9 w-20 animate-pulse rounded-md bg-panel-2" />
            <div className="h-9 w-20 animate-pulse rounded-md bg-panel-2" />
          </div>
        </div>
      </div>
    </div>
  )
}

export function PriceSnapshotSkeleton() {
  return (
    <section className="rounded-xl border border-border bg-panel p-5">
      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <div>
          <SectionLoader label="Đang tải dữ liệu giá..." />
          <div className="mt-3 h-10 w-36 animate-pulse rounded bg-panel-2" />
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
            {[1, 2, 3].map((i) => <div key={i} className="h-4 w-24 animate-pulse rounded bg-panel-2" />)}
          </div>
        </div>
        <div>
          <div className="mb-3 h-4 w-32 animate-pulse rounded bg-panel-2" />
          <div className="space-y-3">
            {["Bull", "Base", "Bear"].map((s) => (
              <div key={s}>
                <div className="mb-1.5 flex items-center justify-between">
                  <div className="h-4 w-10 animate-pulse rounded bg-panel-2" />
                  <div className="h-4 w-10 animate-pulse rounded bg-panel-2" />
                </div>
                <div className="h-2 rounded-full bg-panel-2" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

export function MultiTimeframeSkeleton() {
  return (
    <section className="rounded-xl border border-border bg-panel p-5">
      <div className="mb-4 flex items-center gap-3">
        <SectionLoader label="Đang tải biểu đồ MTF..." />
        <span className="text-xs text-foreground/40">(Daily + 1H bars)</span>
      </div>
      <div className="h-[280px] animate-pulse rounded-lg bg-panel-2" />
    </section>
  )
}

export function PriceHistorySkeleton() {
  return (
    <section className="rounded-xl border border-border bg-panel p-5">
      <div className="mb-4 flex items-center gap-3">
        <SectionLoader label="Đang tải biểu đồ Daily..." />
        <span className="text-xs text-foreground/40">(lịch sử giá)</span>
      </div>
      <div className="h-[380px] animate-pulse rounded-lg bg-panel-2" />
    </section>
  )
}

export function MetricCardsSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: skeleton
        <div key={i} className="rounded-xl border border-border bg-panel p-5">
          <div className="flex items-center justify-between">
            <SectionLoader label="Đang tải..." />
          </div>
          <div className="mt-3 h-8 w-20 animate-pulse rounded bg-panel-2" />
          <div className="mt-2 h-4 w-36 animate-pulse rounded bg-panel-2" />
        </div>
      ))}
    </div>
  )
}

export function AnalysisBodySkeleton() {
  return (
    <div className="grid gap-5 xl:grid-cols-[1.25fr_0.75fr]">
      <div className="space-y-5">
        {[1, 2, 3].map((i) => (
          <div key={i} className="rounded-xl border border-border bg-panel p-5">
            <SectionLoader label="Đang tải phân tích..." />
            <div className="mt-3 space-y-2">
              <div className="h-4 w-full animate-pulse rounded bg-panel-2" />
              <div className="h-4 w-4/5 animate-pulse rounded bg-panel-2" />
            </div>
          </div>
        ))}
      </div>
      <div className="space-y-5">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="rounded-xl border border-border bg-panel p-5">
            <div className="h-4 w-24 animate-pulse rounded bg-panel-2" />
            <div className="mt-3 h-4 w-full animate-pulse rounded bg-panel-2" />
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Async Server Section Components ────────────────────────────────────────

export async function VnindexResearchSection({ ticker }: { ticker: string }) {
  const research = await getCachedResearchData()
  if (!research.connection.notionLive) {
    return <NotionUnavailable section={`Nghiên cứu ${ticker}`} detail={research.connection.message} />
  }
  return <ResearchApp data={research} mode="ticker" ticker={ticker} />
}

export async function TickerHeaderSection({ ticker }: { ticker: string }) {
  const [research, scanner] = await Promise.all([getCachedResearchData(), getCachedScannerData().catch(() => null)])
  if (!research.connection.notionLive) {
    return <NotionUnavailable section={`Nghiên cứu ${ticker}`} detail={research.connection.message} />
  }
  const thesis = research.theses.find((r) => r.ticker === ticker)
  const universeIndex = scanner ? scanner.universe.findIndex((r) => r.ticker === ticker) : -1
  const universe = universeIndex >= 0 ? scanner!.universe[universeIndex] : undefined
  const scan = scanner?.latestScans[ticker]
  const canonical = Boolean(thesis)
  const displayName = thesis?.company || (universe?.sector ? universe.sector : "Việt Nam")
  const previousTicker = universeIndex > 0 ? scanner!.universe[universeIndex - 1]?.ticker : undefined
  const nextTicker = universeIndex >= 0 && universeIndex < (scanner?.universe.length ?? 0) - 1
    ? scanner!.universe[universeIndex + 1]?.ticker : undefined

  return (
    <div className="border-b border-border bg-panel/75">
      <div className="mx-auto max-w-[1600px] px-4 py-5 lg:px-6">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <Link href="/research/scanner" className="inline-flex items-center gap-1.5 text-sm text-foreground/55 hover:text-brand">
                <ArrowLeft className="h-4 w-4" /> Scanner
              </Link>
              <span className="text-foreground/25">/</span>
              <span className="font-mono text-3xl font-bold text-foreground">{ticker}</span>
              <span className="text-base text-foreground/55">{displayName}</span>
              <span className={`rounded-md border px-2.5 py-1 text-xs font-semibold ${canonical ? "border-brand/35 bg-brand/10 text-brand" : "border-ref/35 bg-ref/10 text-ref"}`}>
                {canonical ? "Canonical Thesis" : "Scanner Candidate"}
              </span>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2.5">
              {scan && <span className={`rounded-md border px-2.5 py-1 text-xs font-semibold ${biasClass(scan.taBias)}`}>Daily TA · {biasLabel(scan.taBias)}</span>}
              {thesis?.faBias && <span className={`rounded-md border px-2.5 py-1 text-xs font-semibold ${biasClass(thesis.faBias)}`}>FA · {biasLabel(thesis.faBias)}</span>}
              {thesis && <span className="rounded-md border border-border-strong bg-panel-2 px-2.5 py-1 text-xs font-semibold text-foreground/70">{regimeLabel(thesis.marketRegime)}</span>}
              {universe && <span className="rounded-md border border-border bg-panel-2 px-2.5 py-1 text-xs text-foreground/55">Top 100 HOSE · #{universe.rank} · {num(universe.marketCapT)}T</span>}
            </div>
            {!canonical && <p className="mt-3 max-w-4xl text-sm leading-6 text-foreground/60">Scanner-level evidence; chỉ trở thành canonical thesis sau MTF review và explicit promotion.</p>}
          </div>
          <div className="flex items-center gap-2">
            {previousTicker && <Link href={`/research/${previousTicker.toLowerCase()}`} className="rounded-md border border-border-strong bg-panel-2 px-3 py-2 text-sm text-foreground/65">← {previousTicker}</Link>}
            {nextTicker && <Link href={`/research/${nextTicker.toLowerCase()}`} className="rounded-md border border-border-strong bg-panel-2 px-3 py-2 text-sm text-foreground/65">{nextTicker} →</Link>}
          </div>
        </div>
      </div>
    </div>
  )
}

export async function PriceSnapshotSection({ ticker }: { ticker: string }) {
  const [research, scanner] = await Promise.all([getCachedResearchData(), getCachedScannerData().catch(() => null)])
  const thesis = research.theses.find((r) => r.ticker === ticker)
  const scan = scanner?.latestScans[ticker]
  const canonical = Boolean(thesis)
  const scenario: ProbabilitySet = thesis?.probabilities ?? probabilitiesFromScan(scan)
  const dailyPrice = scan?.price
  const vnindex = research.theses.find((r) => r.ticker === "VNINDEX")

  return (
    <>
      <section className="rounded-xl border border-border bg-panel p-5">
        <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
          <div>
            <div className="text-sm font-semibold text-foreground/55">Daily snapshot · {scan?.date ? compactDate(scan.date) : "chưa có scan"}</div>
            <div className="mt-2 flex flex-wrap items-baseline gap-3">
              <span className="font-mono text-4xl font-semibold text-foreground">{num(dailyPrice, 2)}</span>
              <span className={`font-mono text-base font-semibold ${(scan?.changePct ?? 0) >= 0 ? "text-up" : "text-down"}`}>{percent(scan?.changePct)}</span>
            </div>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm text-foreground/55">
              <span>Volume <strong>{num(scan?.volume, 0)}</strong></span>
              <span>Provider <strong>{scan?.provider || "—"}</strong></span>
              <span>Status <strong>{scan?.status || "—"}</strong></span>
              <span>Confidence <strong>{confidenceLabel(scan?.confidence || thesis?.confidence || "")}</strong></span>
            </div>
          </div>
          <div>
            <div className="mb-3 text-sm font-semibold text-foreground/55">Xác suất {canonical ? "canonical" : "scanner"}</div>
            <ScenarioBars probabilities={scenario} />
          </div>
        </div>
      </section>

      {vnindex && (
        <section className="rounded-xl border border-border bg-panel p-5">
          <div className="flex flex-col justify-between gap-4 lg:flex-row">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono font-bold">VNINDEX</span>
                <span className="rounded-md border border-border-strong bg-panel-2 px-2 py-1 text-xs">{regimeLabel(vnindex.marketRegime)}</span>
              </div>
              <p className="mt-2 max-w-5xl text-sm leading-6 text-foreground/65">{vnindex.baseCase}</p>
            </div>
            <Link href="/research/vnindex" className="text-sm font-medium text-brand">Mở market structure →</Link>
          </div>
        </section>
      )}
    </>
  )
}

export async function MultiTimeframeSection({ ticker }: { ticker: string }) {
  const [researchResult, dailyResult, hourlyResult] = await Promise.allSettled([
    getCachedResearchData(),
    getCachedDailyHistory(ticker),
    getCachedHourlyHistory(ticker),
  ])

  const research = researchResult.status === "fulfilled" ? researchResult.value : null
  const daily = dailyResult.status === "fulfilled" ? dailyResult.value : null
  const hourly = hourlyResult.status === "fulfilled" ? hourlyResult.value : null

  const thesis = research?.theses.find((r) => r.ticker === ticker)
  const canonical = Boolean(thesis)

  const studies = buildMultiTimeframeStudies({
    dailyBars: daily?.bars ?? [],
    hourlyBars: hourly?.bars ?? [],
    dailyProvider: daily?.provider ?? "Unavailable",
    dailyDetail: daily?.detail ?? "Daily provider unavailable",
    hourlyProvider: hourly?.provider ?? "Unavailable",
    hourlyDetail: hourly?.detail ?? "1H provider unavailable",
  })

  return <MultiTimeframeWorkstation ticker={ticker} studies={studies} canPromote={!canonical} />
}

export async function PriceHistorySection({ ticker }: { ticker: string }) {
  const [scannerResult, dailyResult] = await Promise.allSettled([
    getCachedScannerData(),
    getCachedDailyHistory(ticker),
  ])

  const scanner = scannerResult.status === "fulfilled" ? scannerResult.value : null
  const daily = dailyResult.status === "fulfilled" ? dailyResult.value : null
  const scan = scanner?.latestScans[ticker]

  let bars = daily?.bars ?? []
  if (scan?.date) bars = bars.filter((bar) => barDate(bar) <= scan.date)

  const chartAlignment = scan?.date
    ? "Tối đa 120 phiên, khóa tới ngày scan để không trộn nến intraday hiện tại với indicator Daily đã chốt."
    : "Tối đa 120 phiên lịch sử khả dụng; chưa có Daily scan canonical để khóa cùng một timestamp."

  return (
    <section className="rounded-xl border border-border bg-panel p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Price structure — Daily</h2>
          <p className="mt-1 text-sm leading-6 text-foreground/55">{chartAlignment}</p>
        </div>
        <div className="text-right text-xs leading-5 text-foreground/45">
          <div>{daily?.detail || "Historical provider chưa khả dụng"}</div>
          {scan?.date && <div>Aligned to {scan.date}</div>}
        </div>
      </div>
      <div className="mt-4">
        <PriceHistoryChartSvg ticker={ticker} bars={bars} />
      </div>
    </section>
  )
}

export async function MetricCardsSection({ ticker }: { ticker: string }) {
  const scanner = await getCachedScannerData().catch(() => null)
  const scan = scanner?.latestScans[ticker]

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <MetricCard label="RSI14" value={num(scan?.rsi14, 1)} detail="Momentum evidence." icon={<Gauge className="h-5 w-5" />} />
      <MetricCard label="Relative Volume" value={scan?.relVolume == null ? "—" : `${scan.relVolume.toFixed(2)}x`} detail="Effort vs 20 phiên." icon={<BarChart3 className="h-5 w-5" />} />
      <MetricCard label="MACD" value={num(scan?.macd, 2)} detail={`Signal ${num(scan?.macdSignal, 2)}.`} icon={<Activity className="h-5 w-5" />} />
      <MetricCard label="ATR14" value={num(scan?.atr14, 2)} detail="Biên độ 14 phiên." icon={<ShieldCheck className="h-5 w-5" />} />
    </div>
  )
}

export async function AnalysisBodySection({ ticker }: { ticker: string }) {
  const [research, scanner] = await Promise.all([getCachedResearchData(), getCachedScannerData().catch(() => null)])
  const thesis = research.theses.find((r) => r.ticker === ticker)
  const scan = scanner?.latestScans[ticker]
  const canonical = Boolean(thesis)
  const dailyPrice = scan?.price
  const logs = research.logs
    .filter((r) => r.ticker === ticker)
    .sort((a, b) => new Date(b.date || b.updated || 0).getTime() - new Date(a.date || a.updated || 0).getTime())

  return (
    <div className="grid gap-5 xl:grid-cols-[1.25fr_0.75fr]">
      <div className="space-y-5">
        <Section title="Wyckoff / Structure">
          {scan?.wyckoffState || thesis?.wyckoffState || "Chưa đủ dữ liệu."}
          <div className="mt-3 text-sm text-foreground/55">Phase: <strong>{scan?.phase || "Unclassified"}</strong></div>
        </Section>
        <Section title="What changed" tone="warning">
          {scan?.whatChanged || thesis?.whatChanged || "Chưa có thay đổi."}
        </Section>
        {thesis ? (
          <section className="rounded-xl border border-brand/25 bg-panel p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Canonical investment thesis</h2>
                <p className="mt-1 text-sm text-foreground/55">Đã review và lưu trong Stock Thesis.</p>
              </div>
              <a href={thesis.notionUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm font-medium text-brand">
                Notion <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              <Section title="Base case">{thesis.baseCase}</Section>
              <Section title="Canonical Wyckoff">{thesis.wyckoffState}</Section>
            </div>
          </section>
        ) : (
          <section className="rounded-xl border border-ref/30 bg-ref/5 p-5">
            <div className="flex items-start gap-3">
              <Target className="mt-0.5 h-5 w-5 text-ref" />
              <div>
                <h3 className="font-semibold">Chưa có canonical thesis</h3>
                <p className="mt-1.5 text-sm leading-6 text-foreground/65">Review MTF phía trên và dùng nút Promote khi evidence đạt yêu cầu.</p>
              </div>
            </div>
          </section>
        )}
        <section className="overflow-hidden rounded-xl border border-border bg-panel">
          <div className="border-b border-border px-5 py-4">
            <h2 className="text-lg font-semibold">Analysis timeline</h2>
          </div>
          <AnalysisTimeline logs={logs} />
        </section>
      </div>
      <div className="space-y-5">
        <section className="rounded-xl border border-border bg-panel p-5">
          <h3 className="text-sm font-semibold uppercase tracking-[0.08em] text-foreground/50">Position vs moving averages</h3>
          <div className="mt-4">
            <MovingAverageRow label="MA20" ma={scan?.ma20} price={dailyPrice} />
            <MovingAverageRow label="MA50" ma={scan?.ma50} price={dailyPrice} />
            <MovingAverageRow label="MA200" ma={scan?.ma200} price={dailyPrice} />
          </div>
        </section>
        <Section title="Support">{thesis?.support || scan?.support || "—"}</Section>
        <Section title="Resistance">{thesis?.resistance || scan?.resistance || "—"}</Section>
        <Section title="Confirmation" tone="positive">{thesis?.confirmation || scan?.confirmation || "—"}</Section>
        <Section title="Invalidation" tone="danger">{thesis?.invalidation || scan?.invalidation || "—"}</Section>
        <section className="rounded-xl border border-border bg-panel p-5">
          <h3 className="text-sm font-semibold uppercase tracking-[0.08em] text-foreground/50">Data provenance</h3>
          <div className="mt-4 space-y-3 text-sm leading-6 text-foreground/65">
            <div><strong>Live:</strong> Finhay MCP panel, timestamp riêng.</div>
            <div><strong>Daily scan:</strong> {scan?.provider || "—"} · {scan?.date || "—"}.</div>
            <div><strong>Research state:</strong> {canonical ? "Canonical Notion Stock Thesis" : "Scanner Candidate"}.</div>
          </div>
        </section>
      </div>
    </div>
  )
}
