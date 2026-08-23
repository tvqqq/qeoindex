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

const WATCHLIST_TABS: Array<{ id: WatchlistFilterTab; label: string }> = [
  { id: "all", label: "Tất cả" },
  { id: "accumulation", label: "1D Tích lũy" },
  { id: "distribution", label: "1D Phân phối" },
]

const TICKER_SWITCH_DEBOUNCE_MS = 60
const TICKER_CACHE_LIMIT = 8
const WATCHLIST_GRID_CLASS = "grid-cols-[54px_repeat(3,minmax(0,1fr))]"

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

const EVENT_GUIDE: Record<WyckoffEventLabel, { name: string; meaning: string; next: string; tone: Tone }> = {
  SPR: {
    name: "Spring · thủng đáy rồi kéo ngược",
    meaning: "Giá chọc xuống dưới vùng hỗ trợ nhưng không ở dưới đó lâu, sau đó kéo ngược lên. Hiểu đơn giản: bên bán dọa thủng đáy nhưng chưa giữ được giá thấp.",
    next: "Chờ giá quay lại kiểm tra vùng đáy. Nếu nhịp giảm nhẹ hơn và khối lượng nhỏ lại, Spring đáng tin hơn.",
    tone: "emerald",
  },
  TEST: {
    name: "Test · quay lại kiểm tra",
    meaning: "Giá quay lại vùng vừa giữ hoặc vừa vượt để xem bên bán còn mạnh không. Đây là bước kiểm tra, chưa phải tín hiệu mua tự động.",
    next: "Tốt hơn khi giá không rơi sâu, biên độ hẹp lại và khối lượng giảm so với nhịp bán trước.",
    tone: "emerald",
  },
  SOS: {
    name: "SOS · đang thử bứt lên",
    meaning: "Giá đang cố thoát khỏi vùng đi ngang theo hướng lên với lực mua tốt hơn. Một cây tăng mạnh chưa đủ để kết luận đã vào xu hướng tăng.",
    next: "Cần đứng được phía trên vùng vừa vượt, quay lại kiểm tra mà không bị bán mạnh, rồi mới đi tiếp.",
    tone: "emerald",
  },
  LPS: {
    name: "LPS · lùi lại nhưng vẫn giữ nền",
    meaning: "Sau nhịp tăng, giá lùi lại nhưng vẫn giữ được vùng hỗ trợ. Đây là chỗ quan sát xem bên bán còn đủ sức kéo giá xuống hay không.",
    next: "Tốt hơn khi nhịp lùi nhẹ, khối lượng co lại và giá sau đó bật lên khỏi đỉnh gần nhất.",
    tone: "emerald",
  },
  UT: {
    name: "UT / UTAD · vượt đỉnh nhưng không giữ được",
    meaning: "Giá chọc lên trên vùng kháng cự rồi bị đẩy xuống. Hiểu đơn giản: cú vượt đỉnh bị từ chối, cho thấy bên bán đang phản ứng.",
    next: "Chờ nhịp hồi sau đó. Nếu hồi yếu, không lấy lại được vùng cản và tiếp tục mất hỗ trợ thì tín hiệu xấu rõ hơn.",
    tone: "rose",
  },
  SOW: {
    name: "SOW · đang thử rơi khỏi nền",
    meaning: "Giá đang rơi khỏi vùng hỗ trợ với lực bán rõ hơn. Một cú thủng hỗ trợ đơn lẻ vẫn có thể là nhiễu.",
    next: "Nếu giá hồi lên yếu, không lấy lại được hỗ trợ cũ rồi tiếp tục giảm, cấu trúc xấu đáng tin hơn.",
    tone: "rose",
  },
  LPSY: {
    name: "LPSY · hồi yếu dưới vùng cản",
    meaning: "Sau nhịp giảm, giá hồi lên nhưng không lấy lại được vùng kháng cự. Hiểu đơn giản: bên mua cố kéo lên nhưng lực chưa đủ.",
    next: "Nếu nhịp hồi có khối lượng yếu rồi giá lại mất đáy gần nhất, bên bán vẫn đang chiếm ưu thế.",
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

function phaseBrief(phase: string | null | undefined) {
  if (!phase) return "—"
  const normalized = phase.toLowerCase().replaceAll("-", "")
  if (/re\s*accum|reaccum/.test(normalized)) return "Tích lũy lại"
  if (/re\s*distrib|redistrib/.test(normalized)) return "Phân phối lại"
  if (normalized.includes("accum")) return "Tích lũy"
  if (normalized.includes("distrib")) return "Phân phối"
  if (normalized.includes("markup")) return "Tăng"
  if (normalized.includes("markdown")) return "Giảm"
  if (normalized.includes("unclass")) return "Chưa rõ"
  return phase.length > 18 ? `${phase.slice(0, 17)}…` : phase
}

function phaseTone(phase: string | null | undefined): Tone {
  if (/accum|markup|spring|sos|lps/i.test(phase || "")) return "emerald"
  if (/distrib|markdown|utad|sow|lpsy/i.test(phase || "")) return "rose"
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
    .replace(/trading range/gi, "vùng đi ngang")
    .replace(/\brange\b/gi, "vùng đi ngang")
    .replace(/\bdemand\b/gi, "lực mua")
    .replace(/\bsupply\b/gi, "lực bán")
    .replace(/breakout/gi, "cú vượt vùng")
    .replace(/retest/gi, "quay lại kiểm tra")
    .replace(/\btest\b/gi, "kiểm tra lại")
    .replace(/follow-through/gi, "đi tiếp rõ ràng")
    .replace(/\bhold\b/gi, "đứng vững")
    .replace(/reclaim/gi, "lấy lại")
    .replace(/acceptance/gi, "đứng vững")
    .replace(/markup/gi, "nhịp tăng")
    .replace(/markdown/gi, "nhịp giảm")
    .replace(/candidate/gi, "dấu hiệu ban đầu")
}

function friendlyPhaseGuide(study: WyckoffChartStudy) {
  const phase = study.analysis?.phase ?? "Unclassified"
  if (/Accumulation\/Reaccumulation Phase C/i.test(phase)) {
    return {
      title: "Phase C · Đang thử rũ bỏ bên bán (Spring)",
      now: "Giá đang thử chọc xuống dưới đáy vùng đi ngang rồi kéo ngược lên. Chưa thể gọi là Spring hoàn chỉnh chỉ vì có một cú rút chân.",
      next: "Cần xem lần quay lại đáy có nhẹ hơn không. Nếu giá giữ được đáy, khối lượng giảm và sau đó bật lên, tín hiệu mới đáng tin hơn.",
      risk: "Nếu giá nằm luôn dưới đáy cũ và lực bán tăng mạnh, ý tưởng Spring coi như sai.",
    }
  }
  if (/Distribution\/Redistribution Phase C/i.test(phase)) {
    return {
      title: "Phase C · Đang thử vượt đỉnh nhưng bị bán xuống (UT)",
      now: "Giá đang chọc lên trên vùng cản nhưng chưa giữ được phía trên. Đây mới là cảnh báo bên bán xuất hiện, chưa phải xác nhận giảm.",
      next: "Quan sát nhịp hồi kế tiếp. Nếu giá hồi yếu, không lấy lại vùng cản rồi mất hỗ trợ, cấu trúc xấu rõ hơn.",
      risk: "Nếu giá quay lại đứng vững trên vùng cản với lực mua tốt, tín hiệu UT không còn đáng tin.",
    }
  }
  if (/Accumulation\/Reaccumulation Phase D/i.test(phase)) {
    return {
      title: "Phase D · Đang thử bứt lên (SOS)",
      now: "Giá vừa cố thoát khỏi vùng đi ngang theo hướng lên. Một cú vượt mạnh vẫn chưa đủ; quan trọng là giá có đứng được phía trên vùng vừa vượt hay không.",
      next: "Nếu giá quay lại kiểm tra mà không bị bán mạnh, giữ được vùng vừa vượt rồi tiếp tục đi lên, cấu trúc tăng sẽ đáng tin hơn.",
      risk: "Nếu giá rơi trở lại sâu vào vùng đi ngang, cú bứt lên này xem như chưa thành công.",
    }
  }
  if (/Distribution\/Redistribution Phase D/i.test(phase)) {
    return {
      title: "Phase D · Đang thử rơi khỏi nền (SOW)",
      now: "Giá đang cố rời vùng đi ngang theo hướng xuống. Cần xem giá có thật sự nằm dưới hỗ trợ hay chỉ thủng rồi kéo ngược lên.",
      next: "Nếu giá hồi lên yếu, không lấy lại hỗ trợ cũ rồi tiếp tục mất đáy, bên bán vẫn chiếm ưu thế.",
      risk: "Nếu giá lấy lại hỗ trợ cũ và đứng vững phía trên với lực mua tốt, kịch bản giảm bị suy yếu.",
    }
  }
  if (/Markup|Reaccumulation/i.test(phase)) {
    return {
      title: "Đang trong nhịp tăng / tích lũy lại",
      now: "Xu hướng chính vẫn nghiêng lên, nhưng giá có thể đang nghỉ và gom lại trước khi đi tiếp.",
      next: "Quan sát các nhịp lùi: tốt nhất là giá giữ hỗ trợ, giảm nhẹ với khối lượng thấp rồi bật lại.",
      risk: "Nếu mất hỗ trợ quan trọng kèm lực bán tăng mạnh, nhịp tăng hiện tại cần được đánh giá lại.",
    }
  }
  if (/Markdown|Redistribution/i.test(phase)) {
    return {
      title: "Đang trong nhịp giảm / phân phối lại",
      now: "Xu hướng chính vẫn yếu. Các nhịp hồi hiện tại chưa đủ cho thấy bên mua đã lấy lại quyền chủ động.",
      next: "Nếu giá hồi yếu rồi lại mất hỗ trợ, xu hướng giảm còn tiếp diễn. Muốn cải thiện cần lấy lại vùng cản quan trọng.",
      risk: "Nếu giá vượt và đứng vững trên vùng cản với lực mua tăng, cấu trúc giảm hiện tại không còn mạnh như trước.",
    }
  }
  return {
    title: "Đang đi ngang · Chưa đủ dữ liệu để gắn pha",
    now: "Giá đang nằm trong vùng chưa có bên mua hay bên bán thắng rõ. Gắn nhãn Phase lúc này dễ gây hiểu lầm.",
    next: "Chờ một hành vi rõ hơn ở mép vùng giá: thủng đáy rồi kéo lại, vượt đỉnh bị từ chối, hoặc bứt ra và đứng vững.",
    risk: "Không dùng một nhãn đơn lẻ để ra quyết định. Cần nhìn thêm vị trí giá, khối lượng và phản ứng sau đó.",
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
  if (close == null || support == null || resistance == null || resistance <= support) return "Chưa rõ vị trí trong vùng"
  if (close > resistance) return "Đang ở trên vùng cản"
  if (close < support) return "Đang ở dưới vùng đỡ"
  const ratio = (close - support) / (resistance - support)
  if (ratio >= 0.66) return "Đang ở nửa trên vùng đi ngang"
  if (ratio <= 0.34) return "Đang ở nửa dưới vùng đi ngang"
  return "Đang ở giữa vùng đi ngang"
}

function relativeVolumeText(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "Chưa có dữ liệu khối lượng tương đối."
  if (value >= 1.5) return "Khối lượng đang cao hơn khá rõ so với mức bình thường gần đây."
  if (value <= 0.75) return "Khối lượng đang thấp hơn bình thường; lực theo sau chưa mạnh."
  return "Khối lượng đang quanh mức bình thường gần đây."
}

function friendlyReading(study: WyckoffChartStudy) {
  const event = latestStudyEvent(study)
  if (event) return EVENT_GUIDE[event].meaning
  const guide = friendlyPhaseGuide(study)
  return guide.now
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
        <SectionHeader icon={<Target className="size-4" />} title="Vùng giá then chốt" note="Nơi cần nhìn phản ứng giá, không phải điểm mua bán tự động" />
      </CardHeader>
      <CardContent className="space-y-3 p-4 sm:p-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-emerald-400/18 bg-emerald-400/[0.045] p-4">
            <div className={cn(TYPE.meta, "flex items-center gap-2 uppercase tracking-[0.08em] text-emerald-300")}><TrendingUp className="size-4" />Vùng đỡ giá</div>
            <div className={cn(TYPE.value, "mt-2 break-words tabular-nums text-white")}>{analysis?.support || "—"}</div>
            <p className={cn(TYPE.meta, "mt-1 text-slate-500")}>Giá về đây mà bán yếu dần thì vùng đỡ có ý nghĩa hơn.</p>
          </div>
          <div className="rounded-xl border border-rose-400/18 bg-rose-400/[0.045] p-4">
            <div className={cn(TYPE.meta, "flex items-center gap-2 uppercase tracking-[0.08em] text-rose-300")}><TrendingDown className="size-4" />Vùng cản giá</div>
            <div className={cn(TYPE.value, "mt-2 break-words tabular-nums text-white")}>{analysis?.resistance || "—"}</div>
            <p className={cn(TYPE.meta, "mt-1 text-slate-500")}>Vượt vùng cản chưa đủ; cần đứng được phía trên rồi mới tính là bứt phá khỏe.</p>
          </div>
        </div>
        <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
          <div className={cn(TYPE.meta, "text-amber-300")}>Hiểu đơn giản: Phá vùng → Đứng được → Quay lại thử → Đi tiếp</div>
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            <p className={cn(TYPE.body, "text-slate-300")}><strong className="text-emerald-300">Đáng tin hơn khi:</strong> {plainSentence(analysis?.confirmation)}</p>
            <p className={cn(TYPE.body, "text-slate-400")}><strong className="text-rose-300">Coi như sai khi:</strong> {plainSentence(analysis?.invalidation)}</p>
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
        <SectionHeader icon={<Zap className="size-4" />} title="Event Wyckoff — hiểu nhanh" note="Giữ tên chuẩn Wyckoff, nhưng giải thích bằng tiếng Việt đời thường" />
      </CardHeader>
      <CardContent className="space-y-3 p-4 sm:p-5">
        {events.length ? events.map((event) => {
          const guide = EVENT_GUIDE[event]
          const tone = TONE[guide.tone]
          return (
            <div key={event} className={cn("rounded-xl border p-4", tone.border, tone.soft)}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className={cn(TYPE.value, tone.text)}>{event} · {guide.name}</div>
                <Badge variant="outline" className={cn("h-7 px-2.5 text-xs font-bold", tone.border, tone.soft, tone.text)}>{event}</Badge>
              </div>
              <p className={cn(TYPE.body, "mt-2 text-slate-300")}>{guide.meaning}</p>
              <p className={cn(TYPE.meta, "mt-2 text-slate-500")}><strong className="text-slate-300">Nhìn tiếp:</strong> {guide.next}</p>
            </div>
          )
        }) : (
          <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
            <p className={cn(TYPE.body, "text-slate-300")}>Chưa có event Wyckoff đủ rõ để gắn nhãn.</p>
            <p className={cn(TYPE.meta, "mt-1 text-slate-500")}>Điều này không có nghĩa là “không có tín hiệu”; chỉ là dữ liệu hiện tại chưa đủ chuẩn để gọi là Spring, SOS, UT, SOW, Test, LPS hay LPSY.</p>
          </div>
        )}
        <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className={cn(TYPE.meta, "uppercase tracking-[0.08em] text-slate-500")}>Đọc nhanh giá × khối lượng</div>
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
        <SectionHeader icon={<Layers3 className="size-4" />} title="Cấu trúc Wyckoff theo nhiều khung" note="Mỗi ô là một khung riêng; khi mâu thuẫn, ưu tiên 1D và 1W hơn 1H" />
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

function WatchlistPhaseCell({ phase }: { phase: string }) {
  const tone = TONE[phaseTone(phase)]
  return <div className={cn("min-w-0 text-center text-xs font-bold leading-tight", tone.text)} title={phase || "Chưa có snapshot"}>{phaseBrief(phase)}</div>
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
        "grid min-h-16 items-center gap-1 border-b border-white/[0.04] px-3 py-2.5 [contain-intrinsic-size:64px] [content-visibility:auto]",
        WATCHLIST_GRID_CLASS,
        isActive ? "border-l-2 border-l-cyan-400 bg-cyan-400/[0.07]" : isPending ? "border-l-2 border-l-cyan-400/50 bg-cyan-400/[0.035]" : "hover:bg-white/[0.025]",
      )}
    >
      <div className="text-[15px] font-extrabold tracking-tight text-white">{stock.ticker}</div>
      <WatchlistPhaseCell phase={phaseFor(stock, "1H")} />
      <WatchlistPhaseCell phase={phaseFor(stock, "1D")} />
      <WatchlistPhaseCell phase={phaseFor(stock, "1W")} />
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
    if (activeTab === "accumulation") list = list.filter((stock) => /Accum|Reaccum|Markup|Spring|SOS|LPS/i.test(phaseFor(stock, "1D")))
    else if (activeTab === "distribution") list = list.filter((stock) => /Distrib|Redistrib|Markdown|UT|SOW|LPSY/i.test(phaseFor(stock, "1D")))

    const normalized = deferredQuery.trim().toUpperCase()
    if (!normalized) return list
    return list.filter((stock) => `${stock.ticker} ${phaseFor(stock, "1H")} ${phaseFor(stock, "1D")} ${phaseFor(stock, "1W")} ${stock.sector}`.toUpperCase().includes(normalized))
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
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_390px]">
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

            {current && currentGuide ? (
              <div className="flex flex-wrap items-center gap-2 rounded-xl border border-cyan-400/12 bg-cyan-400/[0.025] px-4 py-3">
                <span className={cn(TYPE.meta, "uppercase tracking-[0.08em] text-cyan-300")}>Wyckoff snapshot</span>
                <span className="text-slate-700">•</span>
                <strong className={cn(TYPE.body, "text-white")}>{currentGuide.title}</strong>
                {latestEvent ? <><span className="text-slate-700">•</span><Badge variant="outline" className={cn("h-7 px-2.5 text-xs font-bold", TONE[EVENT_GUIDE[latestEvent].tone].border, TONE[EVENT_GUIDE[latestEvent].tone].soft, TONE[EVENT_GUIDE[latestEvent].tone].text)}>{latestEvent} · {EVENT_GUIDE[latestEvent].name.split(" · ")[1]}</Badge></> : null}
                <span className={cn(TYPE.meta, "text-slate-500")}>Đỡ {current.analysis?.support || "—"}</span>
                <span className={cn(TYPE.meta, "text-slate-500")}>Cản {current.analysis?.resistance || "—"}</span>
                <span className={cn(TYPE.meta, "text-slate-500")}>RelVol {current.analysis?.technical.relVolume == null ? "—" : `${formatNumber(current.analysis.technical.relVolume, 2)}×`}</span>
              </div>
            ) : null}

            {current ? (
              <Card className="gap-0 overflow-hidden rounded-2xl border border-white/[0.08] bg-[#080c12] py-0 ring-0">
                <CardHeader data-wyckoff-chart-toolbar className="border-b border-white/[0.06] px-4 py-4 sm:px-5">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <SectionHeader icon={<BarChart3 className="size-4" />} title="Giá × Khối lượng × Event Wyckoff" note="Chart là dữ liệu chính; không vẽ probability hay đường giá tương lai" />
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
              <span className="inline-flex items-center gap-2"><ShieldCheck className="size-4 text-cyan-400" />Trang này chỉ đọc cấu trúc Wyckoff, event và hành vi giá - khối lượng.</span>
              <a href={`/insights/ai-council?ticker=${encodeURIComponent(activeTicker)}`} className="font-bold text-violet-300 hover:text-violet-200">Quyết định / xác suất → AI Council</a>
            </div>
          </div>

          <Card className="hidden h-[680px] gap-0 overflow-hidden rounded-2xl border border-white/[0.08] bg-[#090e15] py-0 ring-0 lg:flex xl:sticky xl:top-3.5 xl:h-[calc(100vh-76px)] xl:min-h-[660px]">
            <div className="border-b border-white/[0.07] bg-[#080d14] p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2.5">
                  <div className="grid size-9 place-items-center rounded-xl border border-cyan-400/15 bg-cyan-400/[0.06] text-cyan-300"><Radar className="size-4" /></div>
                  <div><CardTitle className={cn(TYPE.section, "text-white")}>Wyckoff Watchlist</CardTitle><div className={cn(TYPE.meta, "text-slate-500")}>Phase riêng cho 1H · 1D · 1W</div></div>
                </div>
                <Badge variant="outline" className="h-7 border-cyan-400/18 bg-cyan-400/[0.05] px-2.5 text-xs font-bold tabular-nums text-cyan-300">{filteredStocks.length}</Badge>
              </div>

              {switchError ? <div className={cn(TYPE.meta, "mt-3 rounded-lg border border-rose-400/18 bg-rose-400/[0.05] px-3 py-2 text-rose-300")} role="alert">{switchError}</div> : null}

              <div className="relative mt-4">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-600" />
                <Input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm mã hoặc phase..." className="h-10 rounded-xl border-white/[0.08] bg-[#05080e] pl-9 pr-9 text-sm font-semibold text-white placeholder:text-slate-600 focus-visible:border-cyan-400/40" />
                {query ? <Button type="button" variant="ghost" size="icon-sm" onClick={() => setQuery("")} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white" aria-label="Xóa tìm kiếm"><X className="size-3.5" /></Button> : null}
              </div>

              <div className="mt-3 grid grid-cols-3 gap-1" role="tablist" aria-label="Lọc watchlist Wyckoff theo phase 1D">
                {WATCHLIST_TABS.map((tab) => <Button key={tab.id} type="button" variant="ghost" size="sm" role="tab" aria-selected={activeTab === tab.id} onClick={() => setActiveTab(tab.id)} className={cn("h-8 rounded-lg px-1 text-xs font-bold", activeTab === tab.id ? "bg-cyan-400/[0.1] text-cyan-300" : "text-slate-500")}>{tab.label}</Button>)}
              </div>
              <p className={cn(TYPE.meta, "mt-2 text-slate-600")}>Bộ lọc Tích lũy / Phân phối dùng Phase 1D để tránh trộn tín hiệu giữa các khung.</p>
            </div>

            <div className={cn("grid items-center gap-1 border-b border-white/[0.05] bg-[#070b10] px-3 py-2.5 text-xs font-bold uppercase tracking-[0.06em] text-slate-600", WATCHLIST_GRID_CLASS)}>
              <div>Mã</div><div className="text-center">1H</div><div className="text-center text-cyan-400">1D</div><div className="text-center">1W</div>
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
