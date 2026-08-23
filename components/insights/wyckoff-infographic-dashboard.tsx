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
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  CircleDot,
  Layers3,
  Radar,
  Search,
  ShieldCheck,
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
import type { WyckoffChartStudy, WyckoffChartTimeframe } from "@/lib/wyckoff-chart-model"
import { cn } from "@/lib/utils"

interface WyckoffTickerApiResponse {
  ok: boolean
  data?: WyckoffTickerPayload
  error?: string
}

type WatchlistFilterTab = "all" | "accumulation" | "distribution" | "top100"
type TickerSelectHandler = (event: MouseEvent<HTMLAnchorElement>, ticker: string) => void

type Tone = "emerald" | "cyan" | "amber" | "rose" | "slate"

const WATCHLIST_TABS: Array<{ id: WatchlistFilterTab; label: string }> = [
  { id: "all", label: "Tất cả" },
  { id: "accumulation", label: "Tích lũy" },
  { id: "distribution", label: "Phân phối" },
  { id: "top100", label: "Top 100" },
]

const TICKER_SWITCH_DEBOUNCE_MS = 60
const TICKER_CACHE_LIMIT = 8
const WATCHLIST_GRID_CLASS = "grid-cols-[70px_88px_minmax(0,1fr)]"

const TYPE = {
  display: "text-2xl font-extrabold leading-tight tracking-[-0.03em]",
  section: "text-lg font-extrabold leading-tight tracking-[-0.02em]",
  value: "text-lg font-bold leading-snug",
  body: "text-sm font-medium leading-6",
  meta: "text-xs font-semibold leading-5",
} as const

const TONE: Record<Tone, { border: string; soft: string; text: string }> = {
  emerald: { border: "border-emerald-400/18", soft: "bg-emerald-400/[0.045]", text: "text-emerald-300" },
  cyan: { border: "border-cyan-400/18", soft: "bg-cyan-400/[0.045]", text: "text-cyan-300" },
  amber: { border: "border-amber-400/18", soft: "bg-amber-400/[0.045]", text: "text-amber-300" },
  rose: { border: "border-rose-400/18", soft: "bg-rose-400/[0.045]", text: "text-rose-300" },
  slate: { border: "border-white/[0.08]", soft: "bg-white/[0.025]", text: "text-slate-300" },
}

function formatNumber(value: number | null | undefined, digits = 2) {
  if (value == null || !Number.isFinite(value)) return "—"
  return value.toLocaleString("vi-VN", { maximumFractionDigits: digits })
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

function eventFromPhase(phase: string | null | undefined) {
  if (!phase) return "—"
  if (/Spring/i.test(phase)) return "SPR"
  if (/UTAD|\bUT\b/i.test(phase)) return "UT"
  if (/SOS/i.test(phase)) return "SOS"
  if (/SOW/i.test(phase)) return "SOW"
  if (/LPSY/i.test(phase)) return "LPSY"
  if (/LPS/i.test(phase)) return "LPS"
  if (/Test/i.test(phase)) return "TEST"
  return "—"
}

function latestStudyEvent(study: WyckoffChartStudy | null | undefined) {
  return study?.markers.at(-1)?.label || study?.analysis?.tags?.[0] || eventFromPhase(study?.analysis?.phase)
}

function watchlistEvent(stock: WyckoffListItem) {
  return stock.latestEvent || eventFromPhase(stock.phase)
}

function eventTone(value: string): Tone {
  if (/SPR|SOS|LPS|TEST|demand|absorp|no supply/i.test(value)) return "emerald"
  if (/UT|SOW|LPSY|supply|no demand|failed/i.test(value)) return "rose"
  if (value === "—") return "slate"
  return "cyan"
}

function numericLevels(value: string | null | undefined) {
  return (value?.match(/[0-9][0-9,.]*/g) ?? [])
    .map((item) => Number(item.replaceAll(",", "")))
    .filter((item) => Number.isFinite(item) && item > 0)
}

function rangePosition(study: WyckoffChartStudy) {
  const close = study.bars.at(-1)?.close
  const support = numericLevels(study.analysis?.support).sort((a, b) => a - b)[0]
  const resistance = numericLevels(study.analysis?.resistance).sort((a, b) => b - a)[0]
  if (close == null || support == null || resistance == null || resistance <= support) return "Chưa rõ range"
  if (close > resistance) return "Trên supply"
  if (close < support) return "Dưới demand"
  const ratio = (close - support) / (resistance - support)
  if (ratio >= 0.66) return "Nửa trên range"
  if (ratio <= 0.34) return "Nửa dưới range"
  return "Giữa range"
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

function SectionHeader({ icon, title, note }: { icon: ReactNode; title: string; note?: string }) {
  return (
    <div className="flex min-w-0 items-start gap-3">
      <div className="grid size-9 shrink-0 place-items-center rounded-xl border border-cyan-400/15 bg-cyan-400/[0.06] text-cyan-300">{icon}</div>
      <div className="min-w-0">
        <h2 className={cn(TYPE.section, "text-white")}>{title}</h2>
        {note ? <p className={cn(TYPE.meta, "mt-0.5 text-slate-500")}>{note}</p> : null}
      </div>
    </div>
  )
}

function StructureSummary({ study }: { study: WyckoffChartStudy }) {
  const items = [
    { label: "Hiện tại", value: study.phaseGuide.now, icon: <Radar className="size-4" />, tone: "cyan" as Tone },
    { label: "Quan sát tiếp", value: study.phaseGuide.next, icon: <CheckCircle2 className="size-4" />, tone: "emerald" as Tone },
    { label: "Phủ định", value: study.phaseGuide.risk, icon: <AlertTriangle className="size-4" />, tone: "rose" as Tone },
  ]
  return (
    <Card className="gap-0 rounded-2xl border border-white/[0.08] bg-[#0a1017] py-0 ring-0">
      <CardHeader className="border-b border-white/[0.06] px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <SectionHeader icon={<Radar className="size-4" />} title="Cấu trúc Wyckoff hiện tại" note={`${study.timeframe} · completed bars only`} />
          <div className="text-right">
            <div className={cn(TYPE.display, "text-cyan-200")}>{study.phaseGuide.title}</div>
            <div className={cn(TYPE.meta, "mt-1 text-slate-500")}>{study.analysis?.phase || "Unclassified"}</div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3 p-4 sm:p-5 lg:grid-cols-3">
        {items.map((item) => {
          const tone = TONE[item.tone]
          return (
            <div key={item.label} className={cn("rounded-xl border p-3.5", tone.border, tone.soft)}>
              <div className={cn(TYPE.meta, "flex items-center gap-2 uppercase tracking-[0.08em]", tone.text)}>{item.icon}{item.label}</div>
              <p className={cn(TYPE.body, "mt-2 line-clamp-3 text-slate-300")}>{item.value}</p>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}

function DecisionZones({ study }: { study: WyckoffChartStudy }) {
  const analysis = study.analysis
  return (
    <Card className="gap-0 rounded-2xl border border-amber-400/15 bg-[#0a1017] py-0 ring-0">
      <CardHeader className="border-b border-white/[0.06] px-4 py-4 sm:px-5">
        <SectionHeader icon={<Target className="size-4" />} title="Vùng giá then chốt" note="Demand / Supply và điều kiện xác nhận cấu trúc" />
      </CardHeader>
      <CardContent className="space-y-3 p-4 sm:p-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-emerald-400/18 bg-emerald-400/[0.045] p-4">
            <div className={cn(TYPE.meta, "flex items-center gap-2 uppercase tracking-[0.08em] text-emerald-300")}><TrendingUp className="size-4" />Demand / Support</div>
            <div className={cn(TYPE.value, "mt-2 break-words tabular-nums text-white")}>{analysis?.support || "—"}</div>
            <p className={cn(TYPE.meta, "mt-1 text-slate-500")}>Giữ vùng + Test với supply co lại.</p>
          </div>
          <div className="rounded-xl border border-rose-400/18 bg-rose-400/[0.045] p-4">
            <div className={cn(TYPE.meta, "flex items-center gap-2 uppercase tracking-[0.08em] text-rose-300")}><TrendingDown className="size-4" />Supply / Resistance</div>
            <div className={cn(TYPE.value, "mt-2 break-words tabular-nums text-white")}>{analysis?.resistance || "—"}</div>
            <p className={cn(TYPE.meta, "mt-1 text-slate-500")}>Break cần Hold → Test → Follow-through.</p>
          </div>
        </div>
        <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
          <div className={cn(TYPE.meta, "text-amber-300")}>Break → Hold → Test → Follow-through</div>
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            <p className={cn(TYPE.body, "text-slate-300")}><strong className="text-emerald-300">Confirm:</strong> {analysis?.confirmation || "Chưa đủ dữ liệu."}</p>
            <p className={cn(TYPE.body, "text-slate-400")}><strong className="text-rose-300">Invalid:</strong> {analysis?.invalidation || "Chưa đủ dữ liệu."}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function WyckoffEvents({ study }: { study: WyckoffChartStudy }) {
  const analysis = study.analysis
  const markerEvents = study.markers.slice(-8).map((marker) => marker.label)
  const ruleEvents = analysis?.tags ?? []
  const events = [...new Set([...markerEvents, ...ruleEvents])].slice(0, 10)
  const relVolume = analysis?.technical.relVolume

  return (
    <Card className="gap-0 rounded-2xl border border-cyan-400/15 bg-[#0a1017] py-0 ring-0">
      <CardHeader className="border-b border-white/[0.06] px-4 py-4 sm:px-5">
        <SectionHeader icon={<Zap className="size-4" />} title="Wyckoff events & evidence" note="Chỉ giữ event, price-volume behavior và thay đổi cấu trúc" />
      </CardHeader>
      <CardContent className="p-4 sm:p-5">
        <div className="flex flex-wrap gap-2">
          {events.length ? events.map((event) => {
            const tone = TONE[eventTone(event)]
            return <Badge key={event} variant="outline" className={cn("h-7 rounded-full px-2.5 text-xs font-bold", tone.border, tone.soft, tone.text)}>{event}</Badge>
          }) : <span className={cn(TYPE.body, "text-slate-500")}>Chưa có event đủ điều kiện gắn nhãn.</span>}
        </div>
        <div className="mt-4 rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className={cn(TYPE.meta, "uppercase tracking-[0.08em] text-slate-500")}>Price × Volume reading</div>
            <Badge variant="outline" className="border-white/[0.08] bg-white/[0.025] text-xs font-semibold text-slate-300">RelVol {relVolume == null ? "—" : `${formatNumber(relVolume, 2)}×`}</Badge>
          </div>
          <p className={cn(TYPE.body, "mt-2 text-slate-300")}>{analysis?.wyckoffState || study.error || "Chưa đủ dữ liệu để phân loại Wyckoff."}</p>
          {analysis?.whatChanged ? <p className={cn(TYPE.meta, "mt-2 text-slate-500")}>{analysis.whatChanged}</p> : null}
        </div>
      </CardContent>
    </Card>
  )
}

function MultiTimeframeStructure({ studies }: { studies: WyckoffChartStudy[] }) {
  return (
    <Card className="gap-0 rounded-2xl border border-white/[0.08] bg-[#0a1017] py-0 ring-0">
      <CardHeader className="border-b border-white/[0.06] px-4 py-4 sm:px-5">
        <SectionHeader icon={<Layers3 className="size-4" />} title="Multi-timeframe Wyckoff structure" note="Đọc conflict / alignment giữa 1H → 1M, không dùng forecast target" />
      </CardHeader>
      <CardContent className="grid gap-2 p-4 sm:grid-cols-2 sm:p-5 xl:grid-cols-5">
        {studies.map((study) => {
          const event = latestStudyEvent(study)
          const tone = TONE[eventTone(event)]
          return (
            <div key={study.timeframe} className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3.5">
              <div className="flex items-center justify-between gap-2">
                <span className={cn(TYPE.value, "text-white")}>{study.timeframe}</span>
                <Badge variant="outline" className={cn("h-6 px-2 text-xs font-bold", tone.border, tone.soft, tone.text)}>{event}</Badge>
              </div>
              <div className={cn(TYPE.body, "mt-3 text-slate-300")}>{study.phaseGuide.title}</div>
              <div className="mt-3 space-y-1">
                <div className={cn(TYPE.meta, "text-slate-500")}>{phaseCompactLabel(study.analysis?.phase)} · {rangePosition(study)}</div>
                <div className={cn(TYPE.meta, "tabular-nums text-slate-600")}>RelVol {study.analysis?.technical.relVolume == null ? "—" : `${formatNumber(study.analysis.technical.relVolume, 2)}×`}</div>
              </div>
            </div>
          )
        })}
      </CardContent>
    </Card>
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
  const event = watchlistEvent(stock)
  const tone = TONE[eventTone(event)]
  const href = `/insights/wyckoff?ticker=${encodeURIComponent(stock.ticker)}&timeframe=${activeTimeframe}`

  return (
    <a
      href={href}
      onClick={(mouseEvent) => onSelectTicker(mouseEvent, stock.ticker)}
      className={cn(
        "grid min-h-14 items-center gap-1 border-b border-white/[0.04] px-3 py-2.5 [contain-intrinsic-size:56px] [content-visibility:auto]",
        WATCHLIST_GRID_CLASS,
        isActive ? "border-l-2 border-l-cyan-400 bg-cyan-400/[0.07]" : isPending ? "border-l-2 border-l-cyan-400/50 bg-cyan-400/[0.035]" : "hover:bg-white/[0.025]",
      )}
    >
      <div className="text-[15px] font-extrabold tracking-tight text-white">{stock.ticker}</div>
      <div className="text-right text-xs font-bold text-slate-400" title={stock.phase}>{phaseCompactLabel(stock.phase)}</div>
      <div className="min-w-0 text-right">
        <Badge variant="outline" className={cn("max-w-full justify-center overflow-hidden text-ellipsis whitespace-nowrap px-2 text-xs font-bold", tone.border, tone.soft, tone.text)}>{event}</Badge>
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
  const timeframeTabs = useMemo(() => activeStudies.map((study) => ({ value: study.timeframe, label: study.timeframe })), [activeStudies])
  const latestEvent = latestStudyEvent(current)

  const filteredStocks = useMemo(() => {
    let list = props.stocks
    if (activeTab === "accumulation") list = list.filter((stock) => /Accum|Spring|SOS|LPS|Markup/i.test(`${stock.phase} ${watchlistEvent(stock)}`))
    else if (activeTab === "distribution") list = list.filter((stock) => /Distrib|UT|SOW|LPSY|Markdown/i.test(`${stock.phase} ${watchlistEvent(stock)}`))
    else if (activeTab === "top100") list = list.filter((stock) => stock.rank > 0 && stock.rank <= 100)

    const normalized = deferredQuery.trim().toUpperCase()
    if (!normalized) return list
    return list.filter((stock) => `${stock.ticker} ${stock.phase} ${watchlistEvent(stock)} ${stock.sector}`.toUpperCase().includes(normalized))
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
          const response = await fetch(`/api/insights/wyckoff?ticker=${encodeURIComponent(nextTicker)}`, { signal: controller.signal, headers: { Accept: "application/json" } })
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

  return (
    <div className="min-h-screen bg-[#05080d] font-ticker text-slate-100">
      <TopNav />
      <main className="mx-auto max-w-[2000px] px-3 py-4 sm:px-4 lg:px-5 xl:px-6">
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_350px]">
          <div className="min-w-0 space-y-4">
            <Card className="gap-0 rounded-2xl border border-white/[0.08] bg-[#0a1017] py-0 ring-0">
              <CardContent className="p-4 sm:p-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0">
                    <StockIdentity ticker={activeTicker} companyName={tickerData.companyName} exchange={tickerData.exchange} detail={headerSector} logoSize={44} className="min-w-0" />
                    <div className={cn(TYPE.meta, "mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-slate-500")}>
                      <span>Wyckoff structure lab</span><span>•</span><span>{props.dataSource || "Canonical data"}</span><span>•</span><span>Snapshot {tickerData.generatedAt.slice(0, 10)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 lg:text-right">
                    <div>
                      <div className={cn(TYPE.meta, "text-slate-500")}>Giá</div>
                      <div className="mt-0.5 flex items-baseline gap-2 lg:justify-end">
                        <PriceFlow animate={priceMotion} value={latest?.close ?? selectedStock?.price} digits={2} className="text-2xl font-extrabold tabular-nums text-white" />
                        <PriceFlow animate={priceMotion} value={change} digits={2} suffix="%" showSign className={cn("text-sm font-bold tabular-nums", changeTone(change))} />
                      </div>
                    </div>
                    <a href={`/insights/ai-council?ticker=${encodeURIComponent(activeTicker)}`} className="rounded-xl border border-violet-400/18 bg-violet-400/[0.045] px-3 py-2 text-xs font-bold text-violet-200 hover:border-violet-300/35 hover:text-white">AI Council →</a>
                  </div>
                </div>
              </CardContent>
            </Card>

            {current ? (
              <div className="flex flex-wrap items-center gap-2 rounded-xl border border-cyan-400/12 bg-cyan-400/[0.025] px-4 py-3">
                <span className={cn(TYPE.meta, "uppercase tracking-[0.08em] text-cyan-300")}>Wyckoff snapshot</span>
                <span className="text-slate-700">•</span>
                <strong className={cn(TYPE.body, "text-white")}>{current.phaseGuide.title}</strong>
                <span className="text-slate-700">•</span>
                <Badge variant="outline" className={cn("h-7 px-2.5 text-xs font-bold", TONE[eventTone(latestEvent)].border, TONE[eventTone(latestEvent)].soft, TONE[eventTone(latestEvent)].text)}>{latestEvent}</Badge>
                <span className={cn(TYPE.meta, "text-slate-500")}>Demand {current.analysis?.support || "—"}</span>
                <span className={cn(TYPE.meta, "text-slate-500")}>Supply {current.analysis?.resistance || "—"}</span>
                <span className={cn(TYPE.meta, "text-slate-500")}>RelVol {current.analysis?.technical.relVolume == null ? "—" : `${formatNumber(current.analysis.technical.relVolume, 2)}×`}</span>
                <span className={cn(TYPE.meta, "text-slate-600")}>Confidence {current.analysis?.confidence || "—"}</span>
              </div>
            ) : null}

            {current ? (
              <Card className="gap-0 overflow-hidden rounded-2xl border border-white/[0.08] bg-[#080c12] py-0 ring-0">
                <CardHeader data-wyckoff-chart-toolbar className="border-b border-white/[0.06] px-4 py-4 sm:px-5">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <SectionHeader icon={<BarChart3 className="size-4" />} title="Price × Volume × Wyckoff events" note="Chart là evidence chính; không hiển thị probability hoặc future scenario path" />
                    <AnimatedTabs tabs={timeframeTabs} value={activeTimeframe} onValueChange={chooseTimeframe} ariaLabel="Khung thời gian biểu đồ" variant="segment" tabClassName="min-w-12 text-xs font-extrabold" />
                  </div>
                </CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.05] bg-[#070c12] px-4 py-2.5 sm:px-5">
                  <div className={cn(TYPE.meta, "flex flex-wrap items-center gap-x-3 gap-y-1 tabular-nums text-slate-500")}>
                    <strong className="text-slate-200">{activeTicker} · {activeTimeframe}</strong>
                    {latest ? <><span>O {formatNumber(latest.open)}</span><span className="text-emerald-300">H {formatNumber(latest.high)}</span><span className="text-rose-300">L {formatNumber(latest.low)}</span><span className="text-white">C {formatNumber(latest.close)}</span></> : null}
                  </div>
                  <Badge variant="outline" className="border-white/[0.08] bg-white/[0.025] text-xs font-semibold text-slate-400">{current.provider}</Badge>
                </div>
                <WyckoffLightweightChart ticker={activeTicker} study={current} loading={Boolean(pendingTicker)} showIntelligence={false} showScenarios={false} />
              </Card>
            ) : null}

            {current ? <StructureSummary study={current} /> : null}
            {current ? <div className="grid gap-4 2xl:grid-cols-2"><DecisionZones study={current} /><WyckoffEvents study={current} /></div> : null}
            <MultiTimeframeStructure studies={activeStudies} />

            <div className={cn(TYPE.meta, "flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-slate-500")}>
              <span className="inline-flex items-center gap-2"><ShieldCheck className="size-4 text-cyan-400" />Trang này chỉ đọc cấu trúc Wyckoff, event và price-volume evidence.</span>
              <a href={`/insights/ai-council?ticker=${encodeURIComponent(activeTicker)}`} className="font-bold text-violet-300 hover:text-violet-200">Decision / probability → AI Council</a>
            </div>
          </div>

          <Card className="hidden h-[680px] gap-0 overflow-hidden rounded-2xl border border-white/[0.08] bg-[#090e15] py-0 ring-0 lg:flex xl:sticky xl:top-3.5 xl:h-[calc(100vh-76px)] xl:min-h-[660px]">
            <div className="border-b border-white/[0.07] bg-[#080d14] p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2.5">
                  <div className="grid size-9 place-items-center rounded-xl border border-cyan-400/15 bg-cyan-400/[0.06] text-cyan-300"><Radar className="size-4" /></div>
                  <div><CardTitle className={cn(TYPE.section, "text-white")}>Wyckoff Watchlist</CardTitle><div className={cn(TYPE.meta, "text-slate-500")}>Mã · Phase · Event</div></div>
                </div>
                <Badge variant="outline" className="h-7 border-cyan-400/18 bg-cyan-400/[0.05] px-2.5 text-xs font-bold tabular-nums text-cyan-300">{filteredStocks.length}</Badge>
              </div>

              {switchError ? <div className={cn(TYPE.meta, "mt-3 rounded-lg border border-rose-400/18 bg-rose-400/[0.05] px-3 py-2 text-rose-300")} role="alert">{switchError}</div> : null}

              <div className="relative mt-4">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-600" />
                <Input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm mã, pha, event..." className="h-10 rounded-xl border-white/[0.08] bg-[#05080e] pl-9 pr-9 text-sm font-semibold text-white placeholder:text-slate-600 focus-visible:border-cyan-400/40" />
                {query ? <Button type="button" variant="ghost" size="icon-sm" onClick={() => setQuery("")} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white" aria-label="Xóa tìm kiếm"><X className="size-3.5" /></Button> : null}
              </div>

              <div className="mt-3 grid grid-cols-4 gap-1" role="tablist" aria-label="Lọc watchlist Wyckoff">
                {WATCHLIST_TABS.map((tab) => <Button key={tab.id} type="button" variant="ghost" size="sm" role="tab" aria-selected={activeTab === tab.id} onClick={() => setActiveTab(tab.id)} className={cn("h-8 rounded-lg px-1 text-xs font-bold", activeTab === tab.id ? "bg-cyan-400/[0.1] text-cyan-300" : "text-slate-500")}>{tab.label}</Button>)}
              </div>
            </div>

            <div className={cn("grid items-center gap-1 border-b border-white/[0.05] bg-[#070b10] px-3 py-2.5 text-xs font-bold uppercase tracking-[0.06em] text-slate-600", WATCHLIST_GRID_CLASS)}>
              <div>Mã</div><div className="text-right">Phase</div><div className="text-right">Event</div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              {groupedStocks.map((group) => (
                <section key={group.key} aria-label={group.label}>
                  <div className={cn(TYPE.meta, "flex items-center justify-between border-b border-white/[0.04] bg-[#0a1119] px-3 py-2 uppercase tracking-[0.06em] text-slate-500")}><span>{group.label}</span><span className="tabular-nums text-slate-600">{group.items.length}</span></div>
                  {group.items.map((stock) => <MemoWatchlistRow key={stock.ticker} stock={stock} activeTicker={activeTicker} pendingTicker={pendingTicker} activeTimeframe={activeTimeframe} onSelectTicker={selectTicker} />)}
                </section>
              ))}
              {!filteredStocks.length ? <div className={cn(TYPE.body, "p-8 text-center text-slate-500")}>Không tìm thấy mã phù hợp</div> : null}
            </div>
          </Card>
        </div>
      </main>
    </div>
  )
}
