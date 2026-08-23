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
  type ComponentType,
  type MouseEvent,
  type ReactNode,
} from "react"
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  CircleDashed,
  CircleDot,
  Layers3,
  Radar,
  RefreshCw,
  Repeat2,
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
import type { WyckoffChartStudy, WyckoffChartTimeframe, WyckoffEventLabel } from "@/lib/wyckoff-chart-model"
import { cn } from "@/lib/utils"

interface WyckoffTickerApiResponse {
  ok: boolean
  data?: WyckoffTickerPayload
  error?: string
}

type WatchlistFilterTab = "all" | "accumulation" | "distribution"
type TickerSelectHandler = (event: MouseEvent<HTMLAnchorElement>, ticker: string) => void
type Tone = "emerald" | "cyan" | "amber" | "rose" | "slate"
type WatchlistStock = WyckoffListItem & {
  phase1H?: string
  phase1D?: string
  phase1W?: string
}
type PhaseKey =
  | "accumulation"
  | "reaccumulation"
  | "distribution"
  | "redistribution"
  | "markup"
  | "markdown"
  | "unclassified"
type WatchlistColumn = "ticker" | "1H" | "1D" | "1W"

type PhaseMeta = {
  label: string
  shortVi: string
  explanationVi: string
  icon: ComponentType<{ className?: string }>
  chip: string
  iconClass: string
}

const WATCHLIST_TABS: Array<{ id: WatchlistFilterTab; label: string }> = [
  { id: "all", label: "Tất cả" },
  { id: "accumulation", label: "1D Accumulation" },
  { id: "distribution", label: "1D Distribution" },
]

const TICKER_SWITCH_DEBOUNCE_MS = 60
const TICKER_CACHE_LIMIT = 8
const WATCHLIST_GRID_CLASS = "grid-cols-[76px_repeat(3,minmax(0,1fr))]"
const WATCHLIST_COLUMN_BG: Record<WatchlistColumn, string> = {
  ticker: "bg-slate-400/[0.025]",
  "1H": "bg-cyan-400/[0.018]",
  "1D": "bg-sky-400/[0.026]",
  "1W": "bg-violet-400/[0.022]",
}
const WATCHLIST_HEADER_BG: Record<WatchlistColumn, string> = {
  ticker: "bg-slate-400/[0.055]",
  "1H": "bg-cyan-400/[0.045] text-cyan-200",
  "1D": "bg-sky-400/[0.065] text-sky-200",
  "1W": "bg-violet-400/[0.05] text-violet-200",
}

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

const PHASE_META: Record<PhaseKey, PhaseMeta> = {
  accumulation: {
    label: "Accumulation",
    shortVi: "Đang xây nền",
    explanationVi: "Giá đang tạo Trading Range và hấp thụ Supply. Chưa mặc định là sắp tăng; cần nhìn Spring, Test, SOS hoặc cách giá phản ứng quanh Support.",
    icon: Layers3,
    chip: "border-emerald-400/25 bg-emerald-400/[0.08] text-emerald-200 hover:border-emerald-300/45 hover:bg-emerald-400/[0.12]",
    iconClass: "text-emerald-300",
  },
  reaccumulation: {
    label: "Reaccumulation",
    shortVi: "Nghỉ trong xu hướng tăng",
    explanationVi: "Giá đang tích lũy lại sau một nhịp Markup. Cấu trúc tích cực hơn nếu Support giữ được và xuất hiện Test, LPS hoặc SOS với Demand tốt.",
    icon: RefreshCw,
    chip: "border-cyan-400/25 bg-cyan-400/[0.08] text-cyan-100 hover:border-cyan-300/45 hover:bg-cyan-400/[0.12]",
    iconClass: "text-cyan-300",
  },
  distribution: {
    label: "Distribution",
    shortVi: "Đang tạo vùng phân phối",
    explanationVi: "Giá đang tạo Trading Range ở vùng cao. Cần nhìn UT/UTAD, SOW, LPSY và phản ứng quanh Resistance trước khi kết luận Supply đã chiếm ưu thế.",
    icon: CircleDot,
    chip: "border-fuchsia-400/25 bg-fuchsia-400/[0.08] text-fuchsia-100 hover:border-fuchsia-300/45 hover:bg-fuchsia-400/[0.12]",
    iconClass: "text-fuchsia-300",
  },
  redistribution: {
    label: "Redistribution",
    shortVi: "Nghỉ trong xu hướng giảm",
    explanationVi: "Giá đang đi ngang hoặc hồi trong một cấu trúc Markdown. Nếu Demand yếu, không Reclaim được Resistance và có SOW/LPSY, xu hướng giảm có thể tiếp tục.",
    icon: Repeat2,
    chip: "border-amber-400/25 bg-amber-400/[0.08] text-amber-100 hover:border-amber-300/45 hover:bg-amber-400/[0.12]",
    iconClass: "text-amber-300",
  },
  markup: {
    label: "Markup",
    shortVi: "Đang trong nhịp tăng",
    explanationVi: "Giá đang rời Trading Range theo hướng lên. Ưu tiên quan sát các pullback về Support, LPS và khả năng tạo Follow-through.",
    icon: TrendingUp,
    chip: "border-lime-400/25 bg-lime-400/[0.08] text-lime-100 hover:border-lime-300/45 hover:bg-lime-400/[0.12]",
    iconClass: "text-lime-300",
  },
  markdown: {
    label: "Markdown",
    shortVi: "Đang trong nhịp giảm",
    explanationVi: "Giá đang rời Trading Range theo hướng xuống. Các rally chỉ cải thiện cấu trúc khi giá có thể Reclaim và Hold lại những vùng Resistance quan trọng.",
    icon: TrendingDown,
    chip: "border-red-400/25 bg-red-400/[0.08] text-red-100 hover:border-red-300/45 hover:bg-red-400/[0.12]",
    iconClass: "text-red-300",
  },
  unclassified: {
    label: "Unclassified",
    shortVi: "Chưa đủ evidence",
    explanationVi: "Dữ liệu hiện tại chưa đủ rõ để gắn một Wyckoff Phase đáng tin. Tốt hơn là giữ Unclassified thay vì ép nhãn khi Price × Volume còn mâu thuẫn.",
    icon: CircleDashed,
    chip: "border-slate-400/20 bg-slate-400/[0.055] text-slate-300 hover:border-slate-300/35 hover:bg-slate-400/[0.09]",
    iconClass: "text-slate-400",
  },
}

const EVENT_GUIDE: Record<WyckoffEventLabel, { name: string; meaning: string; next: string; tone: Tone }> = {
  SPR: {
    name: "Spring",
    meaning: "Giá chọc xuống dưới Support rồi nhanh chóng quay lại Trading Range. Hiểu đơn giản: bên bán đã thử ép xuống nhưng chưa giữ được mức giá thấp.",
    next: "Chờ Test. Nếu spread hẹp hơn, Volume nhỏ lại và giá vẫn giữ được Support, Spring đáng tin hơn.",
    tone: "emerald",
  },
  TEST: {
    name: "Test",
    meaning: "Giá quay lại kiểm tra vùng vừa xảy ra event để xem Supply còn mạnh hay không. Đây là bước kiểm tra, chưa phải tín hiệu mua tự động.",
    next: "Tốt hơn khi giá không rơi sâu, spread hẹp lại và Volume giảm so với nhịp bán trước.",
    tone: "emerald",
  },
  SOS: {
    name: "SOS — Sign of Strength",
    meaning: "Giá đang cố thoát khỏi Trading Range theo hướng lên với Demand tốt hơn. Một Breakout mạnh chưa đủ để kết luận Phase D đã hoàn chỉnh.",
    next: "Cần Hold phía trên vùng Breakout, sau đó Retest mà Supply co lại và có Follow-through.",
    tone: "emerald",
  },
  LPS: {
    name: "LPS — Last Point of Support",
    meaning: "Sau SOS, giá pullback về Support nhưng chưa cho thấy Supply đủ mạnh để phá cấu trúc tăng.",
    next: "Tốt hơn khi nhịp pullback nhẹ, Volume co lại và giá sau đó tạo Follow-through lên trên đỉnh gần nhất.",
    tone: "emerald",
  },
  UT: {
    name: "UT / UTAD",
    meaning: "Giá vượt Resistance nhưng không Hold được phía trên và bị bán trở lại. Đây là dấu hiệu Supply phản ứng, chưa phải xác nhận Markdown.",
    next: "Chờ nhịp rally sau đó. Nếu Demand yếu, không Reclaim được Resistance và tiếp tục mất Support, tín hiệu xấu rõ hơn.",
    tone: "rose",
  },
  SOW: {
    name: "SOW — Sign of Weakness",
    meaning: "Supply đủ mạnh để đẩy giá xuống dưới Support của Trading Range. Một Breakdown đơn lẻ vẫn có thể là nhiễu.",
    next: "Nếu giá Retest yếu, không Reclaim được Support cũ rồi tiếp tục giảm, cấu trúc yếu đáng tin hơn.",
    tone: "rose",
  },
  LPSY: {
    name: "LPSY — Last Point of Supply",
    meaning: "Sau SOW, giá rally nhưng không Reclaim được Resistance. Hiểu đơn giản: Demand phản ứng nhưng chưa đủ khỏe.",
    next: "Nếu rally có Volume yếu rồi giá lại mất đáy gần nhất, Supply vẫn đang chiếm ưu thế.",
    tone: "rose",
  },
}

function formatNumber(value: number | null | undefined, digits = 2) {
  if (value == null || !Number.isFinite(value)) return "—"
  return value.toLocaleString("vi-VN", { maximumFractionDigits: digits })
}

function changeTone(value: number | null | undefined) {
  if ((value ?? 0) > 0) return "text-emerald-300"
  if ((value ?? 0) < 0) return "text-rose-300"
  return "text-amber-200"
}

function phaseKey(phase: string | null | undefined): PhaseKey {
  if (!phase) return "unclassified"
  const normalized = phase.toLowerCase().replace(/[^a-z]/g, "")
  if (normalized.includes("reaccum")) return "reaccumulation"
  if (normalized.includes("redistrib") || normalized.includes("redist")) return "redistribution"
  if (normalized.includes("accum")) return "accumulation"
  if (normalized.includes("distrib") || normalized.includes("dist")) return "distribution"
  if (normalized.includes("markup")) return "markup"
  if (normalized.includes("markdown")) return "markdown"
  return "unclassified"
}

function phaseBrief(phase: string | null | undefined) {
  return PHASE_META[phaseKey(phase)].label
}

function phaseTone(phase: string | null | undefined): Tone {
  const key = phaseKey(phase)
  if (key === "accumulation" || key === "reaccumulation" || key === "markup") return "emerald"
  if (key === "distribution" || key === "redistribution" || key === "markdown") return "rose"
  return "slate"
}

function normalizeEvent(value: string | null | undefined): WyckoffEventLabel | null {
  if (!value) return null
  if (/LPSY/i.test(value)) return "LPSY"
  if (/\bLPS\b/i.test(value)) return "LPS"
  if (/SPR|Spring/i.test(value)) return "SPR"
  if (/UTAD|\bUT\b/i.test(value)) return "UT"
  if (/SOS/i.test(value)) return "SOS"
  if (/SOW/i.test(value)) return "SOW"
  if (/TEST|retest/i.test(value)) return "TEST"
  return null
}

function studyEvents(study: WyckoffChartStudy | null | undefined) {
  if (!study) return []
  const candidates = [
    ...study.markers.map((marker) => marker.label),
    ...(study.analysis?.tags ?? []),
    study.analysis?.phase || "",
  ]
  return [...new Set(candidates.map(normalizeEvent).filter((event): event is WyckoffEventLabel => Boolean(event)))].slice(-4)
}

function latestStudyEvent(study: WyckoffChartStudy | null | undefined) {
  return studyEvents(study).at(-1) ?? null
}

function plainSentence(value: string | null | undefined) {
  if (!value) return "Chưa đủ dữ liệu để kết luận."
  return value
}

function friendlyPhaseGuide(study: WyckoffChartStudy) {
  const phase = study.analysis?.phase ?? "Unclassified"
  if (/Accumulation\/Reaccumulation Phase C/i.test(phase)) {
    return {
      title: "Accumulation / Reaccumulation · Phase C · Spring candidate",
      now: "Giá đang thử chọc xuống dưới Support rồi quay lại Trading Range. Chưa thể gọi là Spring hoàn chỉnh chỉ vì có một cú rút chân.",
      next: "Cần nhìn Test: giá giữ Support, spread hẹp hơn và Volume giảm thì Supply có thể đang co lại.",
      risk: "Nếu giá nằm luôn dưới Support và Supply mở rộng, Spring thesis coi như sai.",
    }
  }
  if (/Distribution\/Redistribution Phase C/i.test(phase)) {
    return {
      title: "Distribution / Redistribution · Phase C · UT candidate",
      now: "Giá đang thử vượt Resistance nhưng chưa Hold được phía trên. Đây là cảnh báo Supply xuất hiện, chưa phải xác nhận Markdown.",
      next: "Quan sát rally kế tiếp. Nếu Demand yếu, không Reclaim được Resistance rồi mất Support, cấu trúc xấu rõ hơn.",
      risk: "Nếu giá Reclaim và Hold trên Resistance với Demand tốt, UT thesis không còn đáng tin.",
    }
  }
  if (/Accumulation\/Reaccumulation Phase D/i.test(phase)) {
    return {
      title: "Accumulation / Reaccumulation · Phase D · SOS candidate",
      now: "Giá đang thử rời Trading Range theo hướng lên. Một Breakout mạnh chưa đủ; quan trọng là giá có Hold được phía trên vùng vừa vượt hay không.",
      next: "Nếu Retest diễn ra với Supply co lại, giá vẫn giữ Support và sau đó có Follow-through, SOS đáng tin hơn.",
      risk: "Nếu giá rơi trở lại sâu vào Trading Range và không Reclaim được vùng Breakout, SOS thesis bị suy yếu.",
    }
  }
  if (/Distribution\/Redistribution Phase D/i.test(phase)) {
    return {
      title: "Distribution / Redistribution · Phase D · SOW candidate",
      now: "Giá đang thử rời Trading Range theo hướng xuống. Cần xem Breakdown có Hold dưới Support hay chỉ thủng rồi Reclaim lại.",
      next: "Nếu Retest yếu, không Reclaim được Support cũ rồi tiếp tục mất đáy, SOW đáng tin hơn.",
      risk: "Nếu giá Reclaim và Hold lại trên Support với Demand tốt, SOW thesis bị suy yếu.",
    }
  }
  if (/Markup|Reaccumulation/i.test(phase)) {
    return {
      title: "Markup / Reaccumulation",
      now: "Xu hướng chính vẫn nghiêng lên, nhưng giá có thể đang nghỉ trong Reaccumulation trước khi quyết định nhịp tiếp theo.",
      next: "Quan sát pullback về Support: tốt hơn khi spread thu hẹp, Volume giảm và sau đó có LPS / SOS.",
      risk: "Nếu mất Support quan trọng kèm Supply mở rộng, Markup thesis cần được đánh giá lại.",
    }
  }
  if (/Markdown|Redistribution/i.test(phase)) {
    return {
      title: "Markdown / Redistribution",
      now: "Xu hướng chính vẫn yếu. Các rally hiện tại chưa đủ cho thấy Demand đã lấy lại quyền chủ động.",
      next: "Nếu rally yếu rồi lại mất Support, Markdown còn hiệu lực. Muốn cải thiện cần Reclaim và Hold trên Resistance quan trọng.",
      risk: "Nếu giá Reclaim Resistance với Demand mở rộng, Markdown thesis bị suy yếu.",
    }
  }
  return {
    title: "Unclassified",
    now: "Price × Volume hiện chưa cho một Wyckoff Phase đủ rõ. Giữ Unclassified tốt hơn là ép nhãn khi evidence còn mâu thuẫn.",
    next: "Chờ hành vi rõ hơn ở biên Trading Range: Spring/Test, UT/UTAD, SOS hoặc SOW.",
    risk: "Không dùng một nhãn đơn lẻ để ra quyết định. Cần nhìn vị trí giá, Volume và phản ứng tiếp theo.",
  }
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
  if (close == null || support == null || resistance == null || resistance <= support) return "Chưa rõ vị trí trong Trading Range"
  if (close > resistance) return "Đang ở trên Resistance"
  if (close < support) return "Đang ở dưới Support"
  const ratio = (close - support) / (resistance - support)
  if (ratio >= 0.66) return "Đang ở nửa trên Trading Range"
  if (ratio <= 0.34) return "Đang ở nửa dưới Trading Range"
  return "Đang ở giữa Trading Range"
}

function relativeVolumeText(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "Chưa có dữ liệu Relative Volume."
  if (value >= 1.5) return "Volume đang cao hơn khá rõ so với mức trung bình 20 bars trước."
  if (value <= 0.75) return "Volume đang thấp hơn bình thường; cần đọc cùng Price và vị trí trong cấu trúc."
  return "Volume đang quanh mức trung bình 20 bars trước."
}

function friendlyReading(study: WyckoffChartStudy) {
  const event = latestStudyEvent(study)
  if (event) return EVENT_GUIDE[event].meaning
  return friendlyPhaseGuide(study).now
}

function phaseFor(stock: WatchlistStock, timeframe: "1H" | "1D" | "1W") {
  if (timeframe === "1H") return stock.phase1H || ""
  if (timeframe === "1W") return stock.phase1W || ""
  return stock.phase1D || stock.phase || ""
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

function PhaseChip({ phase, selected = false }: { phase: string; selected?: boolean }) {
  const meta = PHASE_META[phaseKey(phase)]
  const Icon = meta.icon
  return (
    <span
      className={cn(
        "group/phase inline-flex min-h-8 w-full min-w-0 items-center justify-center gap-1 rounded-lg border px-1.5 py-1 text-center text-xs font-bold leading-tight",
        "transition-[transform,background-color,border-color,color,box-shadow] duration-200 ease-out hover:-translate-y-px",
        meta.chip,
        selected && "shadow-[0_0_0_1px_rgba(34,211,238,0.18),0_8px_24px_-16px_rgba(34,211,238,0.9)]",
      )}
    >
      <Icon className={cn("size-3.5 shrink-0 transition-transform duration-200 ease-out group-hover/phase:rotate-3", meta.iconClass)} />
      <span className="min-w-0 break-words">{meta.label}</span>
    </span>
  )
}

function StructureSummary({ study }: { study: WyckoffChartStudy }) {
  const guide = friendlyPhaseGuide(study)
  const items = [
    { label: "Hiện tại", value: guide.now, icon: <Radar className="size-4" />, tone: "cyan" as Tone },
    { label: "Cần nhìn tiếp", value: guide.next, icon: <CheckCircle2 className="size-4" />, tone: "emerald" as Tone },
    { label: "Khi nào coi như sai", value: guide.risk, icon: <AlertTriangle className="size-4" />, tone: "rose" as Tone },
  ]
  return (
    <Card className="gap-0 rounded-2xl border border-white/[0.08] bg-[#0a1017] py-0 ring-0">
      <CardHeader className="border-b border-white/[0.06] px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <SectionHeader icon={<Radar className="size-4" />} title="Cấu trúc Wyckoff hiện tại" note={`${study.timeframe} · chỉ dùng nến đã đóng`} />
          <div className="text-right">
            <div className={cn(TYPE.display, "text-cyan-200")}>{guide.title}</div>
            <div className={cn(TYPE.meta, "mt-1 text-slate-500")}>{phaseBrief(study.analysis?.phase)}</div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3 p-4 sm:p-5 lg:grid-cols-3">
        {items.map((item) => {
          const tone = TONE[item.tone]
          return (
            <div key={item.label} className={cn("rounded-xl border p-3.5", tone.border, tone.soft)}>
              <div className={cn(TYPE.meta, "flex items-center gap-2 uppercase tracking-[0.08em]", tone.text)}>{item.icon}{item.label}</div>
              <p className={cn(TYPE.body, "mt-2 text-slate-300")}>{item.value}</p>
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
        <SectionHeader icon={<Target className="size-4" />} title="Key Wyckoff levels" note="Support / Resistance và điều kiện xác nhận cấu trúc" />
      </CardHeader>
      <CardContent className="space-y-3 p-4 sm:p-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-emerald-400/18 bg-emerald-400/[0.045] p-4">
            <div className={cn(TYPE.meta, "flex items-center gap-2 uppercase tracking-[0.08em] text-emerald-300")}><TrendingUp className="size-4" />Support</div>
            <div className={cn(TYPE.value, "mt-2 break-words tabular-nums text-white")}>{analysis?.support || "—"}</div>
            <p className={cn(TYPE.meta, "mt-1 text-slate-500")}>Giá quay về đây mà Supply co lại thì Support có ý nghĩa hơn.</p>
          </div>
          <div className="rounded-xl border border-rose-400/18 bg-rose-400/[0.045] p-4">
            <div className={cn(TYPE.meta, "flex items-center gap-2 uppercase tracking-[0.08em] text-rose-300")}><TrendingDown className="size-4" />Resistance</div>
            <div className={cn(TYPE.value, "mt-2 break-words tabular-nums text-white")}>{analysis?.resistance || "—"}</div>
            <p className={cn(TYPE.meta, "mt-1 text-slate-500")}>Breakout chưa đủ; cần Hold phía trên rồi Retest thành công.</p>
          </div>
        </div>
        <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
          <div className={cn(TYPE.meta, "text-amber-300")}>Breakout → Hold → Retest → Follow-through</div>
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            <p className={cn(TYPE.body, "text-slate-300")}><strong className="text-emerald-300">Confirmation:</strong> {plainSentence(analysis?.confirmation)}</p>
            <p className={cn(TYPE.body, "text-slate-400")}><strong className="text-rose-300">Invalidation:</strong> {plainSentence(analysis?.invalidation)}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function WyckoffEvents({ study }: { study: WyckoffChartStudy }) {
  const events = studyEvents(study)
  const relVolume = study.analysis?.technical.relVolume
  return (
    <Card className="gap-0 rounded-2xl border border-cyan-400/15 bg-[#0a1017] py-0 ring-0">
      <CardHeader className="border-b border-white/[0.06] px-4 py-4 sm:px-5">
        <SectionHeader icon={<Zap className="size-4" />} title="Wyckoff Events" note="Giữ terminology chuẩn; phần diễn giải viết tiếng Việt dễ hiểu" />
      </CardHeader>
      <CardContent className="space-y-3 p-4 sm:p-5">
        {events.length ? events.map((event) => {
          const guide = EVENT_GUIDE[event]
          const tone = TONE[guide.tone]
          return (
            <div key={event} className={cn("rounded-xl border p-4", tone.border, tone.soft)}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className={cn(TYPE.value, tone.text)}>{guide.name}</div>
                <Badge variant="outline" className={cn("h-7 px-2.5 text-xs font-bold", tone.border, tone.soft, tone.text)}>{event}</Badge>
              </div>
              <p className={cn(TYPE.body, "mt-2 text-slate-300")}>{guide.meaning}</p>
              <p className={cn(TYPE.meta, "mt-2 text-slate-500")}><strong className="text-slate-300">Nhìn tiếp:</strong> {guide.next}</p>
            </div>
          )
        }) : (
          <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
            <p className={cn(TYPE.body, "text-slate-300")}>Chưa có Wyckoff Event đủ rõ để gắn nhãn.</p>
            <p className={cn(TYPE.meta, "mt-1 text-slate-500")}>Điều này không có nghĩa là “không có tín hiệu”; evidence hiện tại chưa đủ chuẩn để gọi Spring, SOS, UT/UTAD, SOW, Test, LPS hay LPSY.</p>
          </div>
        )}
        <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className={cn(TYPE.meta, "uppercase tracking-[0.08em] text-slate-500")}>Price × Volume reading</div>
            <Badge variant="outline" className="border-white/[0.08] bg-white/[0.025] text-xs font-semibold text-slate-300">RelVol {relVolume == null ? "—" : `${formatNumber(relVolume, 2)}×`}</Badge>
          </div>
          <p className={cn(TYPE.body, "mt-2 text-slate-300")}>{friendlyReading(study)}</p>
          <p className={cn(TYPE.meta, "mt-2 text-slate-500")}>{relativeVolumeText(relVolume)}</p>
        </div>
      </CardContent>
    </Card>
  )
}

function MultiTimeframeStructure({ studies }: { studies: WyckoffChartStudy[] }) {
  return (
    <Card className="gap-0 rounded-2xl border border-white/[0.08] bg-[#0a1017] py-0 ring-0">
      <CardHeader className="border-b border-white/[0.06] px-4 py-4 sm:px-5">
        <SectionHeader icon={<Layers3 className="size-4" />} title="Multi-timeframe Wyckoff structure" note="Mỗi timeframe là một cấu trúc riêng; khi mâu thuẫn, ưu tiên 1D và 1W hơn 1H" />
      </CardHeader>
      <CardContent className="grid gap-2 p-4 sm:grid-cols-2 sm:p-5 xl:grid-cols-5">
        {studies.map((study) => {
          const event = latestStudyEvent(study)
          const phase = study.analysis?.phase || ""
          const tone = TONE[phaseTone(phase)]
          return (
            <div key={study.timeframe} className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3.5">
              <div className="flex items-center justify-between gap-2">
                <span className={cn(TYPE.value, "text-white")}>{study.timeframe}</span>
                {event ? <Badge variant="outline" className={cn("h-6 px-2 text-xs font-bold", TONE[EVENT_GUIDE[event].tone].border, TONE[EVENT_GUIDE[event].tone].soft, TONE[EVENT_GUIDE[event].tone].text)}>{event}</Badge> : null}
              </div>
              <div className={cn(TYPE.body, "mt-3 text-slate-300")}>{friendlyPhaseGuide(study).title}</div>
              <div className="mt-3 space-y-1">
                <div className={cn(TYPE.meta, tone.text)}>{phaseBrief(phase)}</div>
                <div className={cn(TYPE.meta, "text-slate-500")}>{rangePosition(study)}</div>
                <div className={cn(TYPE.meta, "tabular-nums text-slate-600")}>RelVol {study.analysis?.technical.relVolume == null ? "—" : `${formatNumber(study.analysis.technical.relVolume, 2)}×`}</div>
              </div>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}

function WatchlistPhaseCell({ phase, timeframe, selected = false }: { phase: string; timeframe: "1H" | "1D" | "1W"; selected?: boolean }) {
  return (
    <div className={cn("min-w-0 border-l border-white/[0.065] px-2 py-1.5 transition-colors duration-200", WATCHLIST_COLUMN_BG[timeframe])}>
      <PhaseChip phase={phase} selected={selected} />
    </div>
  )
}

function WatchlistRow({
  stock,
  activeTicker,
  pendingTicker,
  activeTimeframe,
  onSelectTicker,
}: {
  stock: WatchlistStock
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
        "group/row grid min-h-[74px] items-stretch border-b border-white/[0.04] px-0 [contain-intrinsic-size:74px] [content-visibility:auto]",
        "transition-[background-color,border-color,transform,box-shadow] duration-200 ease-out hover:translate-x-0.5 active:scale-[0.995]",
        WATCHLIST_GRID_CLASS,
        isActive
          ? "border-l-2 border-l-cyan-400 bg-cyan-400/[0.08] shadow-[inset_12px_0_34px_-25px_rgba(34,211,238,0.95),0_8px_28px_-24px_rgba(34,211,238,0.8)]"
          : isPending
            ? "border-l-2 border-l-cyan-400/60 bg-cyan-400/[0.045] shadow-[inset_10px_0_28px_-24px_rgba(34,211,238,0.75)]"
            : "hover:bg-white/[0.032] hover:shadow-[inset_8px_0_24px_-24px_rgba(148,163,184,0.8)]",
      )}
      aria-current={isActive ? "page" : undefined}
      aria-busy={isPending || undefined}
    >
      <div className={cn("flex items-center px-3 text-[15px] font-extrabold tracking-tight transition-[background-color,color] duration-200", WATCHLIST_COLUMN_BG.ticker, isActive || isPending ? "text-cyan-200" : "text-white")}>{stock.ticker}</div>
      <WatchlistPhaseCell timeframe="1H" phase={phaseFor(stock, "1H")} selected={isActive} />
      <WatchlistPhaseCell timeframe="1D" phase={phaseFor(stock, "1D")} selected={isActive} />
      <WatchlistPhaseCell timeframe="1W" phase={phaseFor(stock, "1W")} selected={isActive} />
    </a>
  )
}

const MemoWatchlistRow = memo(WatchlistRow)

function WatchlistExplainPanel({ stock }: { stock: WatchlistStock | undefined }) {
  if (!stock) return null
  const cells = (["1H", "1D", "1W"] as const).map((timeframe) => {
    const phase = phaseFor(stock, timeframe)
    const meta = PHASE_META[phaseKey(phase)]
    const Icon = meta.icon
    return { timeframe, meta, Icon }
  })
  return (
    <div key={stock.ticker} className="mt-3 rounded-xl border border-white/[0.07] bg-white/[0.018] p-3 animate-in fade-in-0 slide-in-from-top-1 duration-200">
      <div className="flex items-center justify-between gap-2">
        <div className={cn(TYPE.meta, "text-slate-300")}><strong className="text-white">{stock.ticker}</strong> · đọc nhanh Phase</div>
        <span className="text-xs font-semibold text-slate-600">So sánh 1H → 1D → 1W</span>
      </div>
      <div className="mt-2 grid grid-cols-3 divide-x divide-white/[0.06] overflow-hidden rounded-lg border border-white/[0.055] bg-[#060a10]">
        {cells.map(({ timeframe, meta, Icon }) => (
          <div key={timeframe} className={cn("min-w-0 px-2 py-2.5", WATCHLIST_COLUMN_BG[timeframe])}>
            <div className="flex items-center gap-1.5">
              <Icon className={cn("size-3.5 shrink-0", meta.iconClass)} />
              <span className="text-xs font-extrabold text-white">{timeframe}</span>
            </div>
            <div className={cn(TYPE.meta, "mt-1.5 break-words text-slate-300")}>{meta.label}</div>
            <p className="mt-1 text-xs font-medium leading-4 text-slate-600">{meta.shortVi}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

export function WyckoffInfographicDashboard(props: {
  ticker: string
  companyName?: string
  exchange?: string | null
  studies: WyckoffChartStudy[]
  initialTimeframe: WyckoffChartTimeframe
  stocks: WatchlistStock[]
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
    if (activeTab === "accumulation") {
      list = list.filter((stock) => {
        const key = phaseKey(phaseFor(stock, "1D"))
        return key === "accumulation" || key === "reaccumulation" || key === "markup"
      })
    } else if (activeTab === "distribution") {
      list = list.filter((stock) => {
        const key = phaseKey(phaseFor(stock, "1D"))
        return key === "distribution" || key === "redistribution" || key === "markdown"
      })
    }

    const normalized = deferredQuery.trim().toUpperCase()
    if (!normalized) return list
    return list.filter((stock) => {
      const phaseText = (["1H", "1D", "1W"] as const)
        .map((timeframe) => {
          const phase = phaseFor(stock, timeframe)
          const meta = PHASE_META[phaseKey(phase)]
          return `${phase} ${meta.label} ${meta.shortVi}`
        })
        .join(" ")
      return `${stock.ticker} ${phaseText} ${stock.sector}`.toUpperCase().includes(normalized)
    })
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
  const currentGuide = current ? friendlyPhaseGuide(current) : null

  return (
    <div className="min-h-screen bg-[#05080d] font-ticker text-slate-100">
      <TopNav />
      <main className="mx-auto max-w-[2000px] px-3 py-4 sm:px-4 lg:px-5 xl:px-6">
        <div className="grid gap-4 xl:grid-cols-[540px_minmax(0,1fr)] 2xl:grid-cols-[580px_minmax(0,1fr)]">
          <div className={cn("min-w-0 space-y-4 xl:order-2 transition-opacity duration-200 ease-out", pendingTicker && "opacity-80")}>
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
                    <a href={`/insights/ai-council?ticker=${encodeURIComponent(activeTicker)}`} className="rounded-xl border border-violet-400/18 bg-violet-400/[0.045] px-3 py-2 text-xs font-bold text-violet-200 transition-colors duration-200 hover:border-violet-300/35 hover:text-white">AI Council →</a>
                  </div>
                </div>
              </CardContent>
            </Card>

            {current && currentGuide ? (
              <div className="flex flex-wrap items-center gap-2 rounded-xl border border-cyan-400/12 bg-cyan-400/[0.025] px-4 py-3">
                <span className={cn(TYPE.meta, "uppercase tracking-[0.08em] text-cyan-300")}>Wyckoff snapshot</span>
                <span className="text-slate-700">•</span>
                <strong className={cn(TYPE.body, "text-white")}>{currentGuide.title}</strong>
                {latestEvent ? <><span className="text-slate-700">•</span><Badge variant="outline" className={cn("h-7 px-2.5 text-xs font-bold", TONE[EVENT_GUIDE[latestEvent].tone].border, TONE[EVENT_GUIDE[latestEvent].tone].soft, TONE[EVENT_GUIDE[latestEvent].tone].text)}>{EVENT_GUIDE[latestEvent].name}</Badge></> : null}
                <span className={cn(TYPE.meta, "text-slate-500")}>Support {current.analysis?.support || "—"}</span>
                <span className={cn(TYPE.meta, "text-slate-500")}>Resistance {current.analysis?.resistance || "—"}</span>
                <span className={cn(TYPE.meta, "text-slate-500")}>RelVol {current.analysis?.technical.relVolume == null ? "—" : `${formatNumber(current.analysis.technical.relVolume, 2)}×`}</span>
              </div>
            ) : null}

            {current ? (
              <Card className="gap-0 overflow-hidden rounded-2xl border border-white/[0.08] bg-[#080c12] py-0 ring-0">
                <CardHeader data-wyckoff-chart-toolbar className="border-b border-white/[0.06] px-4 py-4 sm:px-5">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <SectionHeader icon={<BarChart3 className="size-4" />} title="Price × Volume × Wyckoff Events" note="Chart là dữ liệu chính; không vẽ probability hay đường giá tương lai" />
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
              <span className="inline-flex items-center gap-2"><ShieldCheck className="size-4 text-cyan-400" />Trang này chỉ đọc Wyckoff structure, Events và Price × Volume behavior.</span>
              <a href={`/insights/ai-council?ticker=${encodeURIComponent(activeTicker)}`} className="font-bold text-violet-300 transition-colors duration-200 hover:text-violet-200">Quyết định / xác suất → AI Council</a>
            </div>
          </div>

          <Card className="hidden h-[680px] gap-0 overflow-hidden rounded-2xl border border-white/[0.08] bg-[#090e15] py-0 ring-0 xl:order-1 xl:sticky xl:top-3.5 xl:flex xl:h-[calc(100vh-76px)] xl:min-h-[660px]">
            <div className="border-b border-white/[0.07] bg-[#080d14] p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2.5">
                  <div className="grid size-9 place-items-center rounded-xl border border-cyan-400/15 bg-cyan-400/[0.06] text-cyan-300"><Radar className="size-4" /></div>
                  <div><CardTitle className={cn(TYPE.section, "text-white")}>Wyckoff Watchlist</CardTitle><div className={cn(TYPE.meta, "text-slate-500")}>1H · 1D · 1W Phase overview</div></div>
                </div>
                <Badge variant="outline" className="h-7 border-cyan-400/18 bg-cyan-400/[0.05] px-2.5 text-xs font-bold tabular-nums text-cyan-300">{filteredStocks.length}</Badge>
              </div>

              {switchError ? <div className={cn(TYPE.meta, "mt-3 rounded-lg border border-rose-400/18 bg-rose-400/[0.05] px-3 py-2 text-rose-300")} role="alert">{switchError}</div> : null}

              <div className="relative mt-4">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-600" />
                <Input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm mã hoặc Phase..." className="h-10 rounded-xl border-white/[0.08] bg-[#05080e] pl-9 pr-9 text-sm font-semibold text-white placeholder:text-slate-600 focus-visible:border-cyan-400/40" />
                {query ? <Button type="button" variant="ghost" size="icon-sm" onClick={() => setQuery("")} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-500 transition-colors duration-200 hover:text-white" aria-label="Xóa tìm kiếm"><X className="size-3.5" /></Button> : null}
              </div>

              <div className="mt-3 grid grid-cols-3 gap-1" role="tablist" aria-label="Lọc watchlist Wyckoff theo Phase 1D">
                {WATCHLIST_TABS.map((tab) => <Button key={tab.id} type="button" variant="ghost" size="sm" role="tab" aria-selected={activeTab === tab.id} onClick={() => setActiveTab(tab.id)} className={cn("h-9 rounded-lg px-1 text-xs font-bold transition-[background-color,color,transform,box-shadow] duration-200 ease-out active:scale-[0.98]", activeTab === tab.id ? "bg-cyan-400/[0.1] text-cyan-300 shadow-[inset_0_0_0_1px_rgba(34,211,238,0.10)]" : "text-slate-500 hover:bg-white/[0.035] hover:text-slate-300")}>{tab.label}</Button>)}
              </div>
              <p className={cn(TYPE.meta, "mt-2 text-slate-600")}>Filter dùng Phase 1D; 1H và 1W giúp nhìn alignment / conflict giữa các timeframe.</p>

              <WatchlistExplainPanel stock={selectedStock} />
            </div>

            <div className={cn("grid items-center border-b border-white/[0.05] px-0 py-0 text-xs font-bold uppercase tracking-[0.06em] text-slate-500", WATCHLIST_GRID_CLASS)}>
              <div className={cn("px-3 py-3", WATCHLIST_HEADER_BG.ticker)}>Mã</div>
              <div className={cn("border-l border-white/[0.065] px-2 py-3 text-center", WATCHLIST_HEADER_BG["1H"])}>1H</div>
              <div className={cn("border-l border-white/[0.065] px-2 py-3 text-center", WATCHLIST_HEADER_BG["1D"])}>1D</div>
              <div className={cn("border-l border-white/[0.065] px-2 py-3 text-center", WATCHLIST_HEADER_BG["1W"])}>1W</div>
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
