"use client"

import {
  memo,
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react"
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  BookOpenCheck,
  CheckCircle2,
  CircleDot,
  Compass,
  Crown,
  Gauge,
  Layers3,
  Radar,
  Search,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
  X,
  Zap,
} from "lucide-react"

import { WyckoffLightweightChart } from "@/components/insights/wyckoff-lightweight-chart"
import type { WyckoffListItem, WyckoffTickerPayload } from "@/components/insights/wyckoff-chart-dashboard"
import { StockIdentity } from "@/components/stock-identity"
import { AnimatedTabs } from "@/components/smoothui/animated-tabs"
import { PriceFlow } from "@/components/smoothui/price-flow"
import { TopNav } from "@/components/top-nav"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { BOARD_SECTOR_GROUPS, boardSectorGroupForSector } from "@/lib/market-sectors"
import type {
  WyckoffChartStudy,
  WyckoffChartTimeframe,
  WyckoffForecastHorizon,
  WyckoffScenario,
} from "@/lib/wyckoff-chart-model"
import { cn } from "@/lib/utils"

interface WyckoffTickerApiResponse {
  ok: boolean
  data?: WyckoffTickerPayload
  error?: string
}

type WatchlistFilterTab = "all" | "accumulation" | "distribution" | "top100"
type TickerSelectHandler = (event: MouseEvent<HTMLAnchorElement>, ticker: string) => void
type Accent = "emerald" | "cyan" | "amber" | "purple" | "rose" | "slate"

const WATCHLIST_TABS: Array<{ id: WatchlistFilterTab; label: string }> = [
  { id: "all", label: "Tất cả" },
  { id: "accumulation", label: "Tích lũy" },
  { id: "distribution", label: "Phân phối" },
  { id: "top100", label: "Top 100" },
]

const TICKER_SWITCH_DEBOUNCE_MS = 60
const TICKER_CACHE_LIMIT = 8
const WATCHLIST_GRID_CLASS = "grid-cols-[64px_74px_64px_minmax(0,1fr)]"

const accentClasses: Record<Accent, { border: string; icon: string; soft: string; text: string }> = {
  emerald: {
    border: "border-emerald-400/20",
    icon: "bg-emerald-400/10 text-emerald-300 ring-emerald-400/20",
    soft: "bg-emerald-400/[0.055]",
    text: "text-emerald-300",
  },
  cyan: {
    border: "border-cyan-400/20",
    icon: "bg-cyan-400/10 text-cyan-300 ring-cyan-400/20",
    soft: "bg-cyan-400/[0.055]",
    text: "text-cyan-300",
  },
  amber: {
    border: "border-amber-400/20",
    icon: "bg-amber-400/10 text-amber-300 ring-amber-400/20",
    soft: "bg-amber-400/[0.055]",
    text: "text-amber-300",
  },
  purple: {
    border: "border-purple-400/20",
    icon: "bg-purple-400/10 text-purple-300 ring-purple-400/20",
    soft: "bg-purple-400/[0.055]",
    text: "text-purple-300",
  },
  rose: {
    border: "border-rose-400/20",
    icon: "bg-rose-400/10 text-rose-300 ring-rose-400/20",
    soft: "bg-rose-400/[0.055]",
    text: "text-rose-300",
  },
  slate: {
    border: "border-white/10",
    icon: "bg-white/[0.055] text-slate-300 ring-white/10",
    soft: "bg-white/[0.025]",
    text: "text-slate-300",
  },
}

function formatNumber(value: number | null | undefined, digits = 2) {
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

function biasAccent(bias: string | null | undefined): Accent {
  if (bias === "Bullish") return "emerald"
  if (bias === "Bearish") return "rose"
  if (bias === "Mixed") return "purple"
  return "amber"
}

function biasBadgeClass(bias: string | null | undefined) {
  if (bias === "Bullish") return "border-emerald-400/25 bg-emerald-400/10 text-emerald-200"
  if (bias === "Bearish") return "border-rose-400/25 bg-rose-400/10 text-rose-200"
  if (bias === "Mixed") return "border-purple-400/25 bg-purple-400/10 text-purple-200"
  return "border-amber-400/25 bg-amber-400/10 text-amber-200"
}

function phaseCompactLabel(phase: string | null | undefined) {
  if (!phase) return "—"
  const normalized = phase.toLowerCase().replaceAll("-", "")
  if (/re\s*accum|reaccum/.test(normalized)) return "RE-ACC"
  if (/re\s*distrib|redistrib/.test(normalized)) return "RE-DIST"
  if (normalized.includes("accum")) return "ACC"
  if (normalized.includes("distrib")) return "DIST"
  if (normalized.includes("markup")) return "MARKUP"
  if (normalized.includes("markdown")) return "MARKDOWN"
  if (normalized.includes("unclass")) return "UNCLASS"
  const compact = phase.trim().toUpperCase()
  return compact.length > 12 ? `${compact.slice(0, 11)}…` : compact
}

function updateUrlQuery(key: "ticker" | "timeframe", value: string) {
  if (typeof window === "undefined") return
  const url = new URL(window.location.href)
  url.searchParams.set(key, value)
  window.history.replaceState(window.history.state, "", url)
}

function rememberTickerData(cache: Map<string, WyckoffTickerPayload>, payload: WyckoffTickerPayload) {
  if (cache.has(payload.ticker)) cache.delete(payload.ticker)
  cache.set(payload.ticker, payload)
  if (cache.size > TICKER_CACHE_LIMIT) {
    const first = cache.keys().next().value
    if (first) cache.delete(first)
  }
}

function dominantScenario(scenarios: WyckoffScenario[]) {
  return scenarios.reduce<WyckoffScenario | null>((best, scenario) => {
    if (!best || scenario.probability > best.probability) return scenario
    return best
  }, null)
}

function signalAccent(signal: string): Accent {
  if (/spring|sos|lps|demand|absorp|no supply|test/i.test(signal)) return "emerald"
  if (/utad|\but\b|sow|lpsy|supply|no demand|failed/i.test(signal)) return "rose"
  return "cyan"
}

function signalIcon(signal: string) {
  if (/spring|sos|lps|demand|absorp|no supply/i.test(signal)) return <ArrowUpRight className="size-3.5" />
  if (/utad|\but\b|sow|lpsy|supply|no demand|failed/i.test(signal)) return <ArrowDownRight className="size-3.5" />
  return <CircleDot className="size-3.5" />
}

function probabilitySegments(study: WyckoffChartStudy | null | undefined) {
  const bull = study?.analysis?.bullProbability ?? 0
  const base = study?.analysis?.baseProbability ?? 0
  const bear = study?.analysis?.bearProbability ?? 0
  return { bull, base, bear }
}

function probabilitySegmentsFromScenarios(scenarios: WyckoffScenario[]) {
  const map = new Map(scenarios.map((scenario) => [scenario.key, scenario.probability]))
  return {
    bull: map.get("bull") ?? 0,
    base: map.get("base") ?? 0,
    bear: map.get("bear") ?? 0,
  }
}

function ProbabilityBar({ bull, base, bear, className }: { bull: number; base: number; bear: number; className?: string }) {
  return (
    <div className={cn("overflow-hidden rounded-full bg-white/[0.055]", className)} aria-label={`Bull ${bull}%, Base ${base}%, Bear ${bear}%`}>
      <div className="flex h-full w-full">
        <div className="bg-emerald-400/80" style={{ width: `${bull}%` }} />
        <div className="bg-amber-300/70" style={{ width: `${base}%` }} />
        <div className="bg-rose-400/80" style={{ width: `${bear}%` }} />
      </div>
    </div>
  )
}

function SectionTitle({ icon, eyebrow, title, description }: { icon: ReactNode; eyebrow: string; title: string; description?: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 grid size-10 shrink-0 place-items-center rounded-xl bg-cyan-400/[0.08] text-cyan-300 ring-1 ring-cyan-400/15">
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-cyan-300/80">{eyebrow}</div>
        <h2 className="mt-0.5 text-xl font-extrabold tracking-[-0.02em] text-white sm:text-2xl">{title}</h2>
        {description ? <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-400">{description}</p> : null}
      </div>
    </div>
  )
}

function InfographicCard({
  accent,
  icon,
  label,
  value,
  description,
  children,
}: {
  accent: Accent
  icon: ReactNode
  label: string
  value: ReactNode
  description: string
  children?: ReactNode
}) {
  const tone = accentClasses[accent]
  return (
    <Card className={cn("gap-0 rounded-2xl border bg-[#0b1118] py-0 ring-0", tone.border)}>
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-slate-500">{label}</div>
            <div className={cn("mt-2 text-[22px] font-extrabold leading-tight tracking-[-0.03em] sm:text-[26px]", tone.text)}>{value}</div>
          </div>
          <div className={cn("grid size-10 shrink-0 place-items-center rounded-xl ring-1", tone.icon)}>{icon}</div>
        </div>
        <p className="mt-2 text-sm leading-5 text-slate-400">{description}</p>
        {children ? <div className="mt-4">{children}</div> : null}
      </CardContent>
    </Card>
  )
}

function PhaseNarrative({ study }: { study: WyckoffChartStudy }) {
  const items = [
    { label: "Hiện tại", value: study.phaseGuide.now, icon: <Radar className="size-4" />, accent: "cyan" as const },
    { label: "Cần quan sát tiếp", value: study.phaseGuide.next, icon: <CheckCircle2 className="size-4" />, accent: "emerald" as const },
    { label: "Rủi ro / phủ định", value: study.phaseGuide.risk, icon: <AlertTriangle className="size-4" />, accent: "rose" as const },
  ]

  return (
    <div className="grid gap-3 lg:grid-cols-3">
      {items.map((item) => {
        const tone = accentClasses[item.accent]
        return (
          <div key={item.label} className={cn("rounded-xl border p-4", tone.border, tone.soft)}>
            <div className={cn("flex items-center gap-2 text-xs font-extrabold uppercase tracking-[0.1em]", tone.text)}>
              {item.icon}
              {item.label}
            </div>
            <p className="mt-2 text-sm font-medium leading-6 text-slate-300">{item.value}</p>
          </div>
        )
      })}
    </div>
  )
}

function DecisionZones({ study }: { study: WyckoffChartStudy }) {
  const analysis = study.analysis
  const support = analysis?.support || "—"
  const resistance = analysis?.resistance || "—"

  return (
    <Card className="gap-0 rounded-2xl border border-amber-400/18 bg-[#0b1118] py-0 ring-0">
      <CardHeader className="border-b border-white/[0.07] px-4 py-4 sm:px-5">
        <SectionTitle
          icon={<Target className="size-5" />}
          eyebrow="Decision map"
          title="Vùng giá then chốt"
          description="Tách riêng các vùng quyết định để không nhầm support/resistance với tín hiệu vào lệnh. Chart vẫn giữ nearest level để đọc cấu trúc trực quan."
        />
      </CardHeader>
      <CardContent className="p-4 sm:p-5">
        <div className="grid gap-3 lg:grid-cols-[1fr_1fr_1.15fr]">
          <div className="rounded-xl border border-emerald-400/18 bg-emerald-400/[0.045] p-4">
            <div className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-[0.12em] text-emerald-300">
              <TrendingUp className="size-4" /> Demand / Support
            </div>
            <div className="mt-3 break-words font-mono text-2xl font-black tracking-tight text-white">{support}</div>
            <p className="mt-2 text-sm leading-5 text-slate-400">Ưu tiên quan sát khả năng giữ vùng, chất lượng Test và volume co lại khi reaction.</p>
          </div>

          <div className="rounded-xl border border-rose-400/18 bg-rose-400/[0.045] p-4">
            <div className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-[0.12em] text-rose-300">
              <TrendingDown className="size-4" /> Supply / Resistance
            </div>
            <div className="mt-3 break-words font-mono text-2xl font-black tracking-tight text-white">{resistance}</div>
            <p className="mt-2 text-sm leading-5 text-slate-400">Breakout chỉ có giá trị khi giữ được phía trên và có follow-through; rejection làm tăng rủi ro failed break.</p>
          </div>

          <div className="rounded-xl border border-amber-400/18 bg-amber-400/[0.04] p-4">
            <div className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-[0.12em] text-amber-300">
              <Compass className="size-4" /> Confirmation sequence
            </div>
            <div className="mt-4 grid grid-cols-4 gap-2">
              {["Break", "Hold", "Test", "Follow-through"].map((step, index) => (
                <div key={step} className="text-center">
                  <div className="mx-auto grid size-8 place-items-center rounded-full border border-amber-400/25 bg-amber-400/[0.08] font-mono text-xs font-black text-amber-200">{index + 1}</div>
                  <div className="mt-2 text-[10px] font-bold uppercase tracking-wide text-slate-400">{step}</div>
                </div>
              ))}
            </div>
            <div className="mt-4 space-y-2 text-sm leading-5">
              <p className="text-slate-300"><strong className="text-emerald-300">Xác nhận:</strong> {analysis?.confirmation || "Chưa đủ dữ liệu."}</p>
              <p className="text-slate-400"><strong className="text-rose-300">Phủ định:</strong> {analysis?.invalidation || "Chưa đủ dữ liệu."}</p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function SignalEvidence({ study }: { study: WyckoffChartStudy }) {
  const analysis = study.analysis
  const ruleSignals = analysis?.tags ?? []
  const markerSignals = study.markers.slice(-8).map((marker) => marker.label)
  const signals = [...new Set([...ruleSignals, ...markerSignals])].slice(0, 14)
  const technical = analysis?.technical

  const technicalItems = [
    { label: "RSI 14", value: technical?.rsi14 == null ? "—" : formatNumber(technical.rsi14, 1) },
    { label: "Relative Vol", value: technical?.relVolume == null ? "—" : `${formatNumber(technical.relVolume, 2)}×` },
    { label: "MA20", value: technical?.ma20 == null ? "—" : formatNumber(technical.ma20, 2) },
    { label: "MA50", value: technical?.ma50 == null ? "—" : formatNumber(technical.ma50, 2) },
  ]

  return (
    <Card className="gap-0 rounded-2xl border border-cyan-400/16 bg-[#0b1118] py-0 ring-0">
      <CardHeader className="border-b border-white/[0.07] px-4 py-4 sm:px-5">
        <SectionTitle
          icon={<Zap className="size-5" />}
          eyebrow="Evidence layer"
          title="Wyckoff signals & evidence"
          description="Signal chỉ được hiển thị khi snapshot hoặc marker có evidence. Không suy diễn institutional intent từ một nến hoặc một cột volume."
        />
      </CardHeader>
      <CardContent className="p-4 sm:p-5">
        <div className="grid gap-4 xl:grid-cols-[1.25fr_.75fr]">
          <div>
            <div className="flex flex-wrap gap-2">
              {signals.length ? signals.map((signal) => {
                const accent = signalAccent(signal)
                const tone = accentClasses[accent]
                return (
                  <Badge key={signal} variant="outline" className={cn("h-7 gap-1.5 rounded-full px-2.5 text-[11px] font-bold", tone.border, tone.soft, tone.text)}>
                    {signalIcon(signal)}
                    {signal}
                  </Badge>
                )
              }) : <span className="text-sm text-slate-500">Chưa có rule/marker đủ điều kiện gắn nhãn.</span>}
            </div>

            <div className="mt-4 rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
              <div className="text-xs font-extrabold uppercase tracking-[0.12em] text-slate-500">Cấu trúc đang đọc</div>
              <p className="mt-2 text-base font-semibold leading-7 text-slate-200">{analysis?.wyckoffState || study.error || "Chưa đủ dữ liệu để phân loại Wyckoff."}</p>
              {analysis?.whatChanged ? <p className="mt-2 text-sm leading-6 text-slate-400">{analysis.whatChanged}</p> : null}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-2">
            {technicalItems.map((item) => (
              <div key={item.label} className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-3">
                <div className="text-[10px] font-extrabold uppercase tracking-[0.1em] text-slate-500">{item.label}</div>
                <div className="mt-1.5 font-mono text-lg font-black text-white">{item.value}</div>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function OutlookCard({ outlook }: { outlook: WyckoffForecastHorizon }) {
  const probabilities = probabilitySegmentsFromScenarios(outlook.scenarios)
  const dominant = dominantScenario(outlook.scenarios)
  const accent = biasAccent(outlook.bias)
  const tone = accentClasses[accent]

  return (
    <Card className={cn("gap-0 rounded-2xl border bg-[#0b1118] py-0 ring-0", tone.border)}>
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-extrabold uppercase tracking-[0.12em] text-slate-500">{outlook.sourceTimeframe} source</div>
            <h3 className="mt-1 text-xl font-extrabold tracking-tight text-white">{outlook.label}</h3>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <Badge variant="outline" className={cn("h-6 rounded-full px-2.5 text-[10px] font-extrabold", biasBadgeClass(outlook.bias))}>{outlook.bias ?? "Pending"}</Badge>
            <span className="text-[10px] font-bold uppercase tracking-wide text-slate-600">Confidence {outlook.confidence ?? "—"}</span>
          </div>
        </div>

        <p className="mt-3 line-clamp-2 min-h-10 text-sm font-semibold leading-5 text-slate-300">{outlook.phase}</p>

        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between font-mono text-[11px] font-bold">
            <span className="text-emerald-300">Bull {probabilities.bull}%</span>
            <span className="text-amber-200">Base {probabilities.base}%</span>
            <span className="text-rose-300">Bear {probabilities.bear}%</span>
          </div>
          <ProbabilityBar {...probabilities} className="h-2.5" />
        </div>

        {dominant ? (
          <div className="mt-4 rounded-xl border border-white/[0.07] bg-white/[0.025] p-3.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-extrabold uppercase tracking-[0.1em] text-slate-500">Kịch bản trội</span>
              <span className={cn("font-mono text-sm font-black", dominant.key === "bull" ? "text-emerald-300" : dominant.key === "bear" ? "text-rose-300" : "text-amber-200")}>{dominant.probability}%</span>
            </div>
            <div className="mt-1 text-base font-extrabold text-white">{dominant.label}</div>
            <div className="mt-2 flex items-baseline justify-between gap-3">
              <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Conditional target</span>
              <span className="font-mono text-xl font-black text-white">{formatNumber(dominant.target, 2)}</span>
            </div>
            <div className="mt-3 space-y-2 text-sm leading-5">
              <p className="text-slate-400"><strong className="text-cyan-300">Trigger:</strong> {dominant.trigger || dominant.description || "Chờ event mới tại vùng quyết định."}</p>
              <p className="text-slate-400"><strong className="text-emerald-300">Confirm:</strong> {dominant.confirmation || "Chờ confirmation price-volume."}</p>
              <p className="text-slate-400"><strong className="text-rose-300">Invalidate:</strong> {dominant.invalidation || "Chưa có invalidation rõ."}</p>
            </div>
          </div>
        ) : <div className="mt-4 rounded-xl border border-white/[0.07] bg-white/[0.02] p-4 text-sm text-slate-500">Chưa đủ dữ liệu để dựng 3 kịch bản cho horizon này.</div>}
      </CardContent>
    </Card>
  )
}

function OutlookBoard({ outlooks }: { outlooks: WyckoffForecastHorizon[] }) {
  return (
    <section>
      <div className="mb-4">
        <SectionTitle
          icon={<Sparkles className="size-5" />}
          eyebrow="Multi-horizon outlook"
          title="Kịch bản theo thời gian"
          description="1D đại diện tuần, 1W đại diện tháng và 1M đại diện dài hạn. Xác suất là conditional allocation từ evidence hiện có, không phải forecast chắc chắn."
        />
      </div>
      <div className="grid gap-3 xl:grid-cols-3">
        {outlooks.map((outlook) => <OutlookCard key={outlook.key} outlook={outlook} />)}
      </div>
    </section>
  )
}

function WatchlistRow({
  stock,
  activeTicker,
  pendingTicker,
  activeTimeframe,
  onSelectTicker,
}: {
  stock: WyckoffListItem
  activeTicker: string
  pendingTicker: string
  activeTimeframe: WyckoffChartTimeframe
  onSelectTicker: TickerSelectHandler
}) {
  const isActive = stock.ticker === activeTicker
  const isPending = stock.ticker === pendingTicker
  const href = `/insights/wyckoff?ticker=${encodeURIComponent(stock.ticker)}&timeframe=${activeTimeframe}`

  return (
    <a
      href={href}
      onClick={(event) => onSelectTicker(event, stock.ticker)}
      className={cn(
        "grid min-h-14 items-center gap-1 border-b border-white/[0.04] px-3 py-2.5 [contain-intrinsic-size:56px] [content-visibility:auto]",
        WATCHLIST_GRID_CLASS,
        isActive
          ? "border-l-2 border-l-cyan-400 bg-cyan-400/[0.075]"
          : isPending
            ? "border-l-2 border-l-cyan-400/50 bg-cyan-400/[0.035]"
            : "hover:bg-white/[0.03]",
      )}
      aria-current={isActive ? "page" : undefined}
      aria-busy={isPending || undefined}
    >
      <div className={cn("text-base font-extrabold tracking-tight", isActive || isPending ? "text-cyan-300" : "text-slate-100")}>{stock.ticker}</div>
      <div className="text-right font-mono text-sm font-bold tabular-nums text-slate-100">{formatNumber(stock.price)}</div>
      <div className={cn("text-right font-mono text-xs font-bold tabular-nums", changeTone(stock.changePct))}>{signedPercent(stock.changePct)}</div>
      <div className="min-w-0 text-right">
        <Badge variant="outline" className={cn("max-w-full justify-center overflow-hidden text-ellipsis whitespace-nowrap border-white/10 bg-white/[0.025] px-1.5 text-[9px] font-extrabold", biasBadgeClass(stock.bias))}>
          {phaseCompactLabel(stock.phase)}
        </Badge>
      </div>
    </a>
  )
}

const MemoWatchlistRow = memo(WatchlistRow)

export function WyckoffInfographicDashboard(props: {
  ticker: string
  companyName?: string
  exchange?: string | null
  studies: WyckoffChartStudy[]
  initialTimeframe: WyckoffChartTimeframe
  stocks: WyckoffListItem[]
  generatedAt: string
  dataSource?: string
}) {
  const initialTickerData: WyckoffTickerPayload = {
    ticker: props.ticker,
    companyName: props.companyName?.trim() || props.ticker,
    exchange: props.exchange?.trim() || "HOSE",
    studies: props.studies,
    generatedAt: props.generatedAt,
  }
  const [tickerData, setTickerData] = useState<WyckoffTickerPayload>(() => initialTickerData)
  const [activeTimeframe, setActiveTimeframe] = useState(props.initialTimeframe)
  const [query, setQuery] = useState("")
  const [activeTab, setActiveTab] = useState<WatchlistFilterTab>("all")
  const [pendingTicker, setPendingTicker] = useState("")
  const [switchError, setSwitchError] = useState("")
  const [suppressValueMotion, setSuppressValueMotion] = useState(false)
  const switchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const switchAbortRef = useRef<AbortController | null>(null)
  const switchSequenceRef = useRef(0)
  const motionReleaseFrameRef = useRef(0)
  const tickerCacheRef = useRef<Map<string, WyckoffTickerPayload>>(new Map([[props.ticker, initialTickerData]]))
  const deferredQuery = useDeferredValue(query)

  const activeTicker = tickerData.ticker
  const activeStudies = tickerData.studies
  const current = useMemo(() => activeStudies.find((study) => study.timeframe === activeTimeframe) ?? activeStudies[0], [activeStudies, activeTimeframe])
  const latest = current?.bars.at(-1)
  const selectedStock = useMemo(() => props.stocks.find((stock) => stock.ticker === activeTicker), [activeTicker, props.stocks])
  const change = current?.analysis?.technical.changePct ?? selectedStock?.changePct ?? null
  const probabilities = probabilitySegments(current)
  const timeframeTabs = useMemo(() => activeStudies.map((study) => ({ value: study.timeframe, label: study.timeframe })), [activeStudies])
  const primarySignal = current?.analysis?.tags?.[0] || current?.markers.at(-1)?.label || "Chờ event mới"

  const filteredStocks = useMemo(() => {
    let list = props.stocks
    if (activeTab === "accumulation") {
      list = list.filter((stock) => stock.bias === "Bullish" || /Spring|SOS|Markup|LPS/i.test(stock.phase))
    } else if (activeTab === "distribution") {
      list = list.filter((stock) => stock.bias === "Bearish" || /UTAD|SOW|Markdown|LPSY/i.test(stock.phase))
    } else if (activeTab === "top100") {
      list = list.filter((stock) => stock.rank > 0 && stock.rank <= 100)
    }
    const normalized = deferredQuery.trim().toUpperCase()
    if (!normalized) return list
    return list.filter((stock) => `${stock.ticker} ${stock.phase} ${stock.bias} ${stock.sector}`.toUpperCase().includes(normalized))
  }, [activeTab, deferredQuery, props.stocks])

  const groupedStocks = useMemo(() => BOARD_SECTOR_GROUPS
    .map((group) => ({
      key: group.key,
      label: group.label,
      items: filteredStocks.filter((stock) => boardSectorGroupForSector(stock.sector).key === group.key),
    }))
    .filter((group) => group.items.length > 0), [filteredStocks])

  const releaseValueMotion = useCallback(() => {
    cancelAnimationFrame(motionReleaseFrameRef.current)
    motionReleaseFrameRef.current = requestAnimationFrame(() => {
      motionReleaseFrameRef.current = requestAnimationFrame(() => setSuppressValueMotion(false))
    })
  }, [])

  const commitTickerData = useCallback((nextData: WyckoffTickerPayload) => {
    setSuppressValueMotion(true)
    rememberTickerData(tickerCacheRef.current, nextData)
    startTransition(() => setTickerData(nextData))
    updateUrlQuery("ticker", nextData.ticker)
    setPendingTicker("")
    setSwitchError("")
    releaseValueMotion()
  }, [releaseValueMotion])

  const scheduleTickerLoad = useCallback((nextTicker: string) => {
    const sequence = ++switchSequenceRef.current
    if (switchTimerRef.current) clearTimeout(switchTimerRef.current)
    switchAbortRef.current?.abort()
    switchAbortRef.current = null

    if (nextTicker === activeTicker) {
      setPendingTicker("")
      setSwitchError("")
      return
    }

    setPendingTicker(nextTicker)
    setSwitchError("")
    switchTimerRef.current = setTimeout(() => {
      if (sequence !== switchSequenceRef.current) return
      const cached = tickerCacheRef.current.get(nextTicker)
      if (cached) {
        commitTickerData(cached)
        return
      }

      const controller = new AbortController()
      switchAbortRef.current = controller
      void (async () => {
        try {
          const response = await fetch(`/api/insights/wyckoff?ticker=${encodeURIComponent(nextTicker)}`, {
            signal: controller.signal,
            headers: { Accept: "application/json" },
          })
          const payload = await response.json() as WyckoffTickerApiResponse
          if (!response.ok || !payload.ok || !payload.data) throw new Error(payload.error || `Không tải được dữ liệu ${nextTicker}`)
          if (controller.signal.aborted || sequence !== switchSequenceRef.current) return
          commitTickerData(payload.data)
        } catch (error) {
          if (controller.signal.aborted || sequence !== switchSequenceRef.current) return
          setPendingTicker("")
          setSwitchError(error instanceof Error ? error.message : `Không tải được dữ liệu ${nextTicker}`)
        } finally {
          if (switchAbortRef.current === controller) switchAbortRef.current = null
        }
      })()
    }, TICKER_SWITCH_DEBOUNCE_MS)
  }, [activeTicker, commitTickerData])

  useEffect(() => () => {
    switchSequenceRef.current += 1
    if (switchTimerRef.current) clearTimeout(switchTimerRef.current)
    switchAbortRef.current?.abort()
    cancelAnimationFrame(motionReleaseFrameRef.current)
  }, [])

  const selectTicker = useCallback<TickerSelectHandler>((event, nextTicker) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    if (props.dataSource !== "Supabase unified") return
    event.preventDefault()
    scheduleTickerLoad(nextTicker)
  }, [props.dataSource, scheduleTickerLoad])

  function chooseTimeframe(timeframe: WyckoffChartTimeframe) {
    if (timeframe === activeTimeframe) return
    setActiveTimeframe(timeframe)
    updateUrlQuery("timeframe", timeframe)
  }

  const priceMotion = !suppressValueMotion
  const headerSector = selectedStock?.sector || "Chưa phân ngành"
  const currentAccent = biasAccent(current?.analysis?.taBias)
  const phaseTone = accentClasses[currentAccent]

  return (
    <div className="min-h-screen bg-[#05080d] font-ticker text-slate-100">
      <TopNav />
      <main className="mx-auto max-w-[2000px] px-3 py-4 sm:px-4 lg:px-5 xl:px-6">
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_390px] 2xl:grid-cols-[minmax(0,1fr)_420px]">
          <div className="min-w-0 space-y-4">
            <Card className="gap-0 rounded-2xl border border-white/[0.09] bg-[#0a1017] py-0 ring-0">
              <CardContent className="p-4 sm:p-5 lg:p-6">
                <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0">
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className="h-7 border-cyan-400/20 bg-cyan-400/[0.06] px-2.5 text-[10px] font-extrabold uppercase tracking-[0.12em] text-cyan-300">
                        <Layers3 className="size-3.5" /> Insights / Wyckoff
                      </Badge>
                      <Badge variant="outline" className={cn("h-7 px-2.5 text-[10px] font-extrabold uppercase tracking-[0.1em]", biasBadgeClass(current?.analysis?.taBias))}>
                        {current?.analysis?.taBias ?? "Pending"}
                      </Badge>
                      {selectedStock?.rank ? (
                        <Badge variant="outline" className="h-7 border-amber-400/20 bg-amber-400/[0.06] px-2.5 text-[10px] font-extrabold text-amber-300">
                          <Crown className="size-3.5" /> Top 100 · #{selectedStock.rank}
                        </Badge>
                      ) : null}
                    </div>
                    <StockIdentity
                      ticker={activeTicker}
                      companyName={tickerData.companyName}
                      exchange={tickerData.exchange}
                      detail={headerSector}
                      logoSize={48}
                      className="min-w-0"
                    />
                    <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-slate-500">
                      <span className="inline-flex items-center gap-1.5"><BookOpenCheck className="size-4 text-cyan-400" /> {props.dataSource || "Canonical data"}</span>
                      <span className="text-slate-700">•</span>
                      <span>Snapshot {tickerData.generatedAt.slice(0, 10)}</span>
                      <span className="text-slate-700">•</span>
                      <span>{current?.bars.length ?? 0} completed bars · {activeTimeframe}</span>
                    </div>
                  </div>

                  <div className="min-w-[220px] rounded-2xl border border-white/[0.08] bg-white/[0.025] p-4 text-left lg:text-right">
                    <div className="text-xs font-extrabold uppercase tracking-[0.12em] text-slate-500">Giá hiện tại</div>
                    <div className="mt-1 flex items-end gap-3 lg:justify-end">
                      <PriceFlow animate={priceMotion} value={latest?.close ?? selectedStock?.price} digits={2} className="font-mono text-4xl font-black tracking-[-0.04em] text-white" />
                      <PriceFlow animate={priceMotion} value={change} digits={2} suffix="%" showSign className={cn("pb-1 font-mono text-base font-black", changeTone(change))} />
                    </div>
                    <div className="mt-2 text-sm font-semibold text-slate-400">{current?.phaseGuide.title || "Đang cập nhật cấu trúc"}</div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-4">
              <InfographicCard
                accent={currentAccent}
                icon={<Radar className="size-5" />}
                label="Pha Wyckoff hiện tại"
                value={current?.phaseGuide.title || "Pending"}
                description={current?.analysis?.confidence ? `Confidence ${current.analysis.confidence} · ${activeTimeframe}` : `Đang đọc cấu trúc ${activeTimeframe}`}
              >
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline" className={cn("border-white/10 bg-white/[0.025] text-[10px] font-bold", biasBadgeClass(current?.analysis?.taBias))}>{current?.analysis?.taBias ?? "Pending"}</Badge>
                  <span className="text-xs font-semibold text-slate-500">{current?.analysis?.phase || "Unclassified"}</span>
                </div>
              </InfographicCard>

              <InfographicCard
                accent="amber"
                icon={<Target className="size-5" />}
                label="Vùng giá then chốt"
                value={<span className="font-mono text-[21px] text-white sm:text-[24px]">{current?.analysis?.support || "—"} <span className="text-slate-600">/</span> {current?.analysis?.resistance || "—"}</span>}
                description="Demand / Support ở trái · Supply / Resistance ở phải"
              >
                <div className="text-xs font-semibold text-amber-200/80">Break → Hold → Test → Follow-through</div>
              </InfographicCard>

              <InfographicCard
                accent="purple"
                icon={<Gauge className="size-5" />}
                label="Bias & xác suất"
                value={`${Math.max(probabilities.bull, probabilities.base, probabilities.bear)}% kịch bản trội`}
                description={`Bull ${probabilities.bull}% · Base ${probabilities.base}% · Bear ${probabilities.bear}%`}
              >
                <ProbabilityBar {...probabilities} className="h-2.5" />
              </InfographicCard>

              <InfographicCard
                accent={signalAccent(primarySignal)}
                icon={<Activity className="size-5" />}
                label="Tín hiệu nổi bật"
                value={primarySignal}
                description={current?.analysis?.whatChanged || "Theo dõi price-volume behavior tại vùng quyết định."}
              >
                <div className="flex items-center gap-3 text-xs font-semibold text-slate-500">
                  <span>RSI {formatNumber(current?.analysis?.technical.rsi14, 1)}</span>
                  <span>RelVol {current?.analysis?.technical.relVolume == null ? "—" : `${formatNumber(current.analysis.technical.relVolume, 2)}×`}</span>
                </div>
              </InfographicCard>
            </div>

            {current ? (
              <Card className="gap-0 overflow-hidden rounded-2xl border border-white/[0.09] bg-[#080c12] py-0 ring-0">
                <CardHeader className="border-b border-white/[0.07] px-4 py-4 sm:px-5">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <SectionTitle
                      icon={<BarChart3 className="size-5" />}
                      eyebrow="Price × Volume × Structure"
                      title="Bản đồ cung – cầu"
                      description="Chart là evidence layer; các scenario phía dưới chỉ là đường đi có điều kiện dựa trên snapshot đã hoàn tất."
                    />
                    <AnimatedTabs
                      tabs={timeframeTabs}
                      value={activeTimeframe}
                      onValueChange={chooseTimeframe}
                      ariaLabel="Khung thời gian biểu đồ"
                      variant="segment"
                      tabClassName="min-w-12 font-mono text-[12px] font-extrabold"
                    />
                  </div>
                </CardHeader>

                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] bg-[#070c12] px-4 py-3 text-xs sm:px-5">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 font-mono text-slate-500">
                    <strong className="font-ticker text-sm text-slate-100">{activeTicker} · {activeTimeframe} · {tickerData.exchange}</strong>
                    {latest ? (
                      <>
                        <span>O <strong className="text-slate-300">{formatNumber(latest.open)}</strong></span>
                        <span>H <strong className="text-emerald-300">{formatNumber(latest.high)}</strong></span>
                        <span>L <strong className="text-rose-300">{formatNumber(latest.low)}</strong></span>
                        <span>C <strong className="text-white">{formatNumber(latest.close)}</strong></span>
                      </>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2 text-slate-600">
                    <Badge variant="outline" className="border-white/10 bg-white/[0.025] text-[10px] font-bold text-slate-400">{current.provider}</Badge>
                    <span className="hidden max-w-[280px] truncate sm:block" title={current.detail}>{current.detail}</span>
                  </div>
                </div>

                <div className="relative">
                  <WyckoffLightweightChart ticker={activeTicker} study={current} loading={Boolean(pendingTicker)} />
                  <div className="pointer-events-none absolute left-4 top-4 z-[3] hidden max-w-[420px] rounded-xl border border-white/[0.09] bg-[#081019]/95 p-3 lg:block">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className={cn("border-white/10 bg-white/[0.025] text-[10px] font-extrabold", phaseTone.text)}>{activeTimeframe}</Badge>
                      <span className="text-sm font-extrabold text-white">{current.phaseGuide.title}</span>
                    </div>
                    <p className="mt-2 line-clamp-2 text-xs font-medium leading-5 text-slate-400">{current.analysis?.wyckoffState || current.error}</p>
                  </div>
                </div>

                <CardContent className="border-t border-white/[0.07] p-4 sm:p-5">
                  <PhaseNarrative study={current} />
                </CardContent>
              </Card>
            ) : null}

            {current ? <DecisionZones study={current} /> : null}
            {current ? <SignalEvidence study={current} /> : null}
            {current ? <OutlookBoard outlooks={current.outlooks} /> : null}

            <div className="flex items-start gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.02] px-4 py-3.5 text-sm leading-6 text-slate-500">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-cyan-400" />
              <span><strong className="text-slate-300">Methodology guardrail:</strong> Projection là kịch bản điều kiện từ cấu trúc Wyckoff, price-volume và completed bars; không phải dữ liệu giá tương lai hay khuyến nghị mua bán.</span>
            </div>
          </div>

          <Card className="hidden h-[680px] gap-0 overflow-hidden rounded-2xl border border-white/[0.09] bg-[#090e15] py-0 ring-0 lg:flex xl:sticky xl:top-3.5 xl:h-[calc(100vh-76px)] xl:min-h-[660px]">
            <div className="border-b border-white/[0.08] bg-[#080d14] p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2.5">
                  <div className="grid size-9 place-items-center rounded-xl bg-cyan-400/[0.08] text-cyan-300 ring-1 ring-cyan-400/15"><BarChart3 className="size-4" /></div>
                  <div>
                    <CardTitle className="text-base font-extrabold text-white">Watchlist Wyckoff</CardTitle>
                    <div className="mt-0.5 text-xs text-slate-500">Top 100 · grouped by sector</div>
                  </div>
                </div>
                <Badge variant="outline" className="h-7 border-cyan-400/20 bg-cyan-400/[0.06] px-2.5 font-mono text-xs font-black text-cyan-300">{filteredStocks.length}</Badge>
              </div>

              {switchError ? <div className="mt-3 rounded-lg border border-rose-400/18 bg-rose-400/[0.05] px-3 py-2 text-xs font-semibold leading-5 text-rose-300" role="alert">{switchError}</div> : null}

              <div className="relative mt-4">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-600" />
                <Input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Tìm mã, pha, ngành..."
                  className="h-10 rounded-xl border-white/[0.09] bg-[#05080e] pl-9 pr-9 text-sm font-semibold text-white placeholder:text-slate-600 focus-visible:border-cyan-400/40"
                />
                {query ? (
                  <Button type="button" variant="ghost" size="icon-sm" onClick={() => setQuery("")} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white" aria-label="Xóa tìm kiếm">
                    <X className="size-3.5" />
                  </Button>
                ) : null}
              </div>

              <div className="mt-3 grid grid-cols-4 gap-1" role="tablist" aria-label="Lọc watchlist Wyckoff">
                {WATCHLIST_TABS.map((tab) => (
                  <Button
                    key={tab.id}
                    type="button"
                    variant="ghost"
                    size="sm"
                    role="tab"
                    aria-selected={activeTab === tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={cn("h-8 rounded-lg px-1 text-[10px] font-extrabold", activeTab === tab.id ? "bg-cyan-400/[0.1] text-cyan-300" : "text-slate-500")}
                  >
                    {tab.label}
                  </Button>
                ))}
              </div>
            </div>

            <div className={cn("grid items-center gap-1 border-b border-white/[0.06] bg-[#070b10] px-3 py-2.5 text-[10px] font-extrabold uppercase tracking-[0.08em] text-slate-600", WATCHLIST_GRID_CLASS)}>
              <div>Mã</div><div className="text-right">Giá</div><div className="text-right">+/- %</div><div className="text-right">Pha</div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              {groupedStocks.map((group) => (
                <section key={group.key} aria-label={group.label}>
                  <div className="flex items-center justify-between border-b border-white/[0.05] bg-[#0a1119] px-3 py-2 text-[10px] font-extrabold uppercase tracking-[0.1em] text-slate-500">
                    <span>{group.label}</span>
                    <span className="font-mono text-slate-600">{group.items.length}</span>
                  </div>
                  {group.items.map((stock) => (
                    <MemoWatchlistRow
                      key={stock.ticker}
                      stock={stock}
                      activeTicker={activeTicker}
                      pendingTicker={pendingTicker}
                      activeTimeframe={activeTimeframe}
                      onSelectTicker={selectTicker}
                    />
                  ))}
                </section>
              ))}
              {!filteredStocks.length ? <div className="p-8 text-center text-sm text-slate-500">Không tìm thấy mã phù hợp</div> : null}
            </div>
          </Card>
        </div>
      </main>
    </div>
  )
}
