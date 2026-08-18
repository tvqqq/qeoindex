"use client"

import Link from "next/link"
import { useMemo, useState, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import {
  Activity,
  AlertTriangle,
  Clock,
  Database,
  ExternalLink,
  RefreshCw,
  Search,
  ShieldCheck,
  Target,
  TrendingDown,
  TrendingUp,
} from "lucide-react"

import { TickerResearchLink } from "@/components/ticker-research-link"
import { TopNav } from "@/components/top-nav"
import type {
  AnalysisLog,
  Bias,
  MarketRegime,
  ProbabilitySet,
  ResearchData,
  Thesis,
} from "@/lib/research-types"

type Mode = "overview" | "changes" | "log" | "review" | "ticker"

const SUBNAV: { label: string; href: string; mode: Exclude<Mode, "ticker"> }[] = [
  { label: "Tổng quan", href: "/research", mode: "overview" },
  { label: "Thay đổi luận điểm", href: "/research/changes", mode: "changes" },
  { label: "Nhật ký phân tích", href: "/research/log", mode: "log" },
  { label: "Đánh giá", href: "/research/review", mode: "review" },
]

const SCENARIOS = [
  { key: "bull" as const, label: "Tăng (Bull)", short: "Tăng", cls: "bg-up", stroke: "var(--color-up)" },
  { key: "base" as const, label: "Cơ sở (Base)", short: "Cơ sở", cls: "bg-ref", stroke: "var(--color-ref)" },
  { key: "bear" as const, label: "Giảm (Bear)", short: "Giảm", cls: "bg-down", stroke: "var(--color-down)" },
]

function compactDate(value: string) {
  if (!value) return "—"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: value.includes("T") ? "2-digit" : undefined,
    minute: value.includes("T") ? "2-digit" : undefined,
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(date)
}

function pct(value: number | null) {
  return value == null ? "—" : `${value}%`
}

function delta(current: number | null, previous: number | null) {
  if (current == null || previous == null) return null
  return current - previous
}

function biasLabel(bias: Bias) {
  if (bias === "Bullish") return "Tích cực"
  if (bias === "Bearish") return "Tiêu cực"
  if (bias === "Mixed") return "Hỗn hợp"
  if (bias === "Neutral") return "Trung tính"
  return "—"
}

function regimeLabel(regime: MarketRegime) {
  if (regime === "Risk-On") return "Ưa rủi ro"
  if (regime === "Risk-Off") return "Phòng thủ"
  if (regime === "Neutral") return "Trung tính"
  return "—"
}

function confidenceLabel(value: string) {
  if (value === "HIGH") return "Cao"
  if (value === "MEDIUM") return "Trung bình"
  if (value === "LOW") return "Thấp"
  return "—"
}

function actualScenarioLabel(value: string) {
  if (value === "Bull") return "Tăng"
  if (value === "Base") return "Cơ sở"
  if (value === "Bear") return "Giảm"
  if (value === "Unresolved") return "Chưa xác định"
  return value || "—"
}

function outcomeLabel(value: string) {
  if (value === "Pending") return "Đang theo dõi"
  if (value === "Confirmed") return "Đã xác nhận"
  if (value === "Invalidated") return "Đã vô hiệu"
  if (value === "Mixed") return "Hỗn hợp"
  return value || "—"
}

function biasClasses(bias: Bias) {
  switch (bias) {
    case "Bullish":
      return "border-up/35 bg-up/10 text-up"
    case "Bearish":
      return "border-down/35 bg-down/10 text-down"
    case "Mixed":
      return "border-ref/35 bg-ref/10 text-ref"
    default:
      return "border-border-strong bg-panel-2 text-foreground/80"
  }
}

function regimeClasses(regime: MarketRegime) {
  switch (regime) {
    case "Risk-On":
      return "border-up/35 bg-up/10 text-up"
    case "Risk-Off":
      return "border-down/35 bg-down/10 text-down"
    default:
      return "border-ref/35 bg-ref/10 text-ref"
  }
}

function BiasPill({ label, bias }: { label: string; bias: Bias }) {
  return (
    <span className={`inline-flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm font-medium ${biasClasses(bias)}`}>
      <span className="text-xs font-semibold opacity-75">{label}</span>
      {biasLabel(bias)}
    </span>
  )
}

function RegimePill({ regime }: { regime: MarketRegime }) {
  return (
    <span className={`inline-flex rounded-md border px-2.5 py-1.5 text-sm font-semibold ${regimeClasses(regime)}`}>
      {regimeLabel(regime)}
    </span>
  )
}

function ScenarioBars({ probabilities, compact = false }: { probabilities: ProbabilitySet; compact?: boolean }) {
  return (
    <div className={compact ? "w-[185px] space-y-2" : "space-y-3.5"}>
      {SCENARIOS.map((row) => {
        const value = probabilities[row.key]
        return (
          <div key={row.key}>
            <div className="mb-1.5 flex items-center justify-between text-sm">
              <span className="font-medium text-foreground/80">{compact ? row.short : row.label}</span>
              <span className="font-mono font-semibold text-foreground">{pct(value)}</span>
            </div>
            <div className={`${compact ? "h-1.5" : "h-2"} overflow-hidden rounded-full bg-panel-2`}>
              <div className={`h-full rounded-full ${row.cls}`} style={{ width: `${Math.max(0, Math.min(100, value ?? 0))}%` }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

function MetricCard({ title, value, detail, icon }: { title: string; value: string; detail: string; icon: ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-panel p-5">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-semibold text-foreground/70">{title}</span>
        <span className="text-foreground/55">{icon}</span>
      </div>
      <div className="text-3xl font-semibold text-foreground">{value}</div>
      <p className="mt-2 text-sm leading-6 text-foreground/65">{detail}</p>
    </div>
  )
}

function ResearchHeader({ data, mode }: { data: ResearchData; mode: Mode }) {
  const router = useRouter()
  return (
    <div className="border-b border-border bg-panel/75">
      <div className="mx-auto flex max-w-[1600px] flex-col gap-4 px-4 py-4 lg:px-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-2xl font-semibold text-foreground">Trung tâm Nghiên cứu</h1>
              <span className={["rounded-md border px-2.5 py-1 text-xs font-semibold", data.connection.notionLive ? "border-up/35 bg-up/10 text-up" : "border-ref/35 bg-ref/10 text-ref"].join(" ")}>
                {data.connection.notionLive ? "Notion trực tiếp" : "Dữ liệu snapshot"}
              </span>
            </div>
            <p className="mt-1.5 max-w-4xl text-sm leading-6 text-foreground/65">{data.connection.message}</p>
          </div>
          <button type="button" onClick={() => router.refresh()} className="inline-flex items-center gap-2 rounded-md border border-border-strong bg-panel-2 px-4 py-2.5 text-sm font-medium text-foreground/80 transition-colors hover:text-foreground">
            <RefreshCw className="h-4 w-4" /> Làm mới dữ liệu
          </button>
        </div>
        <div className="flex items-center gap-1.5 overflow-x-auto">
          {SUBNAV.map((item) => {
            const active = mode === item.mode || (mode === "ticker" && item.mode === "overview")
            return (
              <Link key={item.href} href={item.href} className={["whitespace-nowrap rounded-md px-3.5 py-2 text-sm font-medium transition-colors", active ? "bg-brand/15 text-brand" : "text-foreground/65 hover:bg-panel-2 hover:text-foreground"].join(" ")}>
                {item.label}
              </Link>
            )
          })}
          <span className="ml-auto hidden whitespace-nowrap text-xs text-foreground/50 lg:block">Cập nhật {compactDate(data.generatedAt)}</span>
        </div>
      </div>
    </div>
  )
}

function MarketContext({ vnindex }: { vnindex?: Thesis }) {
  if (!vnindex) return null
  return (
    <div className="rounded-xl border border-border bg-panel p-5">
      <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="font-mono text-xl font-bold text-foreground">VNINDEX</span>
            <RegimePill regime={vnindex.marketRegime} />
            <BiasPill label="Kỹ thuật" bias={vnindex.taBias} />
          </div>
          <p className="mt-3 max-w-4xl text-base leading-7 text-foreground/75">{vnindex.baseCase}</p>
        </div>
        <div className="flex flex-wrap items-start gap-7">
          {vnindex.price && (
            <div className="text-right">
              <div className="font-mono text-3xl font-semibold text-foreground">{vnindex.price.value.toLocaleString("en-US", { maximumFractionDigits: 2 })}</div>
              <div className={`mt-1 text-sm font-semibold ${vnindex.price.changePct >= 0 ? "text-up" : "text-down"}`}>{vnindex.price.changePct >= 0 ? "+" : ""}{vnindex.price.changePct.toFixed(2)}%</div>
              <div className="mt-1.5 text-xs text-foreground/50">{vnindex.price.source} · {compactDate(vnindex.price.timestamp)}</div>
            </div>
          )}
          <ScenarioBars probabilities={vnindex.probabilities} compact />
        </div>
      </div>
    </div>
  )
}

function ScenarioComparisonChart({ theses }: { theses: Thesis[] }) {
  return (
    <section className="rounded-xl border border-border bg-panel p-5">
      <div>
        <h2 className="text-lg font-semibold text-foreground">So sánh xác suất các kịch bản</h2>
        <p className="mt-1 text-sm leading-6 text-foreground/60">Mỗi thanh thể hiện tổng 100% xác suất hiện tại của từng thesis.</p>
      </div>
      <div className="mt-5 space-y-4">
        {theses.map((thesis) => (
          <div key={thesis.id} className="grid items-center gap-3 md:grid-cols-[110px_1fr_190px]">
            <TickerResearchLink ticker={thesis.ticker} className="font-mono text-base font-bold text-foreground hover:text-brand">{thesis.ticker}</TickerResearchLink>
            <div className="flex h-7 overflow-hidden rounded-md bg-panel-2">
              {SCENARIOS.map((scenario) => {
                const value = thesis.probabilities[scenario.key] ?? 0
                return <div key={scenario.key} className={`${scenario.cls} h-full opacity-90`} style={{ width: `${Math.max(0, value)}%` }} title={`${scenario.label}: ${value}%`} />
              })}
            </div>
            <div className="flex justify-between text-xs text-foreground/70">
              <span>Tăng {pct(thesis.probabilities.bull)}</span>
              <span>Cơ sở {pct(thesis.probabilities.base)}</span>
              <span>Giảm {pct(thesis.probabilities.bear)}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-5 flex flex-wrap gap-4 border-t border-border/70 pt-4 text-sm text-foreground/70">
        {SCENARIOS.map((scenario) => <span key={scenario.key} className="inline-flex items-center gap-2"><span className={`h-2.5 w-2.5 rounded-sm ${scenario.cls}`} />{scenario.label}</span>)}
      </div>
    </section>
  )
}

function probabilityHistory(thesis: Thesis, logs: AnalysisLog[]) {
  const ordered = logs
    .filter((row) => row.ticker === thesis.ticker)
    .filter((row) => row.probabilities.bull != null || row.probabilities.base != null || row.probabilities.bear != null)
    .sort((a, b) => new Date(a.date || a.updated || 0).getTime() - new Date(b.date || b.updated || 0).getTime())
    .map((row) => ({ label: compactDate(row.date || row.updated), probabilities: row.probabilities }))
  const last = ordered[ordered.length - 1]
  const current = thesis.probabilities
  const same = last && last.probabilities.bull === current.bull && last.probabilities.base === current.base && last.probabilities.bear === current.bear
  if (!same) ordered.push({ label: "Hiện tại", probabilities: current })
  return ordered
}

function ProbabilityHistoryChart({ thesis, logs }: { thesis: Thesis; logs: AnalysisLog[] }) {
  const points = probabilityHistory(thesis, logs)
  const width = 760
  const height = 270
  const left = 46
  const right = 20
  const top = 24
  const bottom = 48
  const chartW = width - left - right
  const chartH = height - top - bottom
  const x = (index: number) => left + (points.length <= 1 ? chartW / 2 : (index / (points.length - 1)) * chartW)
  const y = (value: number | null) => top + (1 - Math.max(0, Math.min(100, value ?? 0)) / 100) * chartH
  const pathFor = (key: keyof ProbabilitySet) => points.map((point, index) => `${index === 0 ? "M" : "L"} ${x(index)} ${y(point.probabilities[key])}`).join(" ")

  return (
    <section className="rounded-xl border border-border bg-panel p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Diễn biến xác suất kịch bản</h2>
          <p className="mt-1 text-sm leading-6 text-foreground/60">Theo dõi cách xác suất Bull/Base/Bear thay đổi qua từng lần phân tích, giúp tránh viết lại lịch sử.</p>
        </div>
        <div className="flex flex-wrap gap-3 text-sm text-foreground/70">
          {SCENARIOS.map((scenario) => <span key={scenario.key} className="inline-flex items-center gap-2"><span className={`h-2.5 w-2.5 rounded-full ${scenario.cls}`} />{scenario.short}</span>)}
        </div>
      </div>
      {points.length === 0 ? (
        <div className="mt-5 rounded-lg border border-border bg-panel-2 p-5 text-sm text-foreground/65">Chưa đủ dữ liệu lịch sử để vẽ biểu đồ.</div>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <svg viewBox={`0 0 ${width} ${height}`} className="min-w-[680px] w-full" role="img" aria-label={`Biểu đồ lịch sử xác suất ${thesis.ticker}`}>
            {[0, 25, 50, 75, 100].map((tick) => (
              <g key={tick}>
                <line x1={left} x2={width - right} y1={y(tick)} y2={y(tick)} stroke="var(--color-border-strong)" strokeDasharray="4 6" opacity="0.7" />
                <text x={left - 10} y={y(tick) + 4} textAnchor="end" fill="currentColor" className="text-[11px] text-foreground/50">{tick}%</text>
              </g>
            ))}
            {SCENARIOS.map((scenario) => (
              <g key={scenario.key}>
                <path d={pathFor(scenario.key)} fill="none" stroke={scenario.stroke} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                {points.map((point, index) => <circle key={`${scenario.key}-${index}`} cx={x(index)} cy={y(point.probabilities[scenario.key])} r="4" fill={scenario.stroke} stroke="var(--color-panel)" strokeWidth="2" />)}
              </g>
            ))}
            {points.map((point, index) => (
              <text key={index} x={x(index)} y={height - 17} textAnchor="middle" fill="currentColor" className="text-[11px] text-foreground/55">{point.label}</text>
            ))}
          </svg>
        </div>
      )}
    </section>
  )
}

function Overview({ data }: { data: ResearchData }) {
  const vnindex = data.theses.find((row) => row.ticker === "VNINDEX")
  const stockTheses = data.theses.filter((row) => row.ticker !== "VNINDEX")
  const pendingReviews = data.logs.filter((row) => !row.actualScenario || row.actualScenario === "Unresolved").length
  const changed = data.theses.filter((row) => row.whatChanged).length
  return (
    <div className="space-y-5">
      <MarketContext vnindex={vnindex} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard title="Trạng thái thị trường" value={regimeLabel(vnindex?.marketRegime || "")} detail="Bối cảnh thị trường lấy từ luận điểm VNINDEX chuẩn hóa." icon={<Activity className="h-5 w-5" />} />
        <MetricCard title="Luận điểm đang theo dõi" value={String(stockTheses.length)} detail="Số cổ phiếu có thesis riêng, không tính VNINDEX." icon={<Database className="h-5 w-5" />} />
        <MetricCard title="Luận điểm có thay đổi" value={String(changed)} detail="Số thesis có ghi nhận nội dung thay đổi mới." icon={<TrendingUp className="h-5 w-5" />} />
        <MetricCard title="Chờ hậu kiểm" value={String(pendingReviews)} detail="Các phân tích chưa có kịch bản thực tế để đánh giá." icon={<Clock className="h-5 w-5" />} />
      </div>
      <ScenarioComparisonChart theses={data.theses} />
      <section className="overflow-hidden rounded-xl border border-border bg-panel">
        <div className="border-b border-border px-5 py-4"><h2 className="text-lg font-semibold text-foreground">Tổng quan luận điểm đầu tư</h2><p className="mt-1 text-sm text-foreground/55">Bảng đọc nhanh thesis chuẩn hóa của VNINDEX và từng cổ phiếu.</p></div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1220px] text-left text-sm">
            <thead className="bg-panel-2 text-xs font-semibold text-foreground/65"><tr><th className="px-5 py-3">Mã</th><th className="px-4 py-3">Định hướng</th><th className="px-4 py-3">Wyckoff / Cấu trúc</th><th className="px-4 py-3">Kịch bản</th><th className="px-4 py-3">Hỗ trợ</th><th className="px-4 py-3">Kháng cự</th><th className="px-4 py-3">Độ tin cậy</th><th className="px-4 py-3">Cập nhật</th></tr></thead>
            <tbody>
              {data.theses.map((thesis) => (
                <tr key={thesis.id} className="border-t border-border/70 align-top transition-colors hover:bg-panel-2/60">
                  <td className="px-5 py-4"><TickerResearchLink ticker={thesis.ticker} className="group inline-flex items-center gap-2"><span className="font-mono text-base font-bold text-foreground group-hover:text-brand">{thesis.ticker}</span>{thesis.price && <span className="font-mono text-sm text-foreground/65">{thesis.price.value.toLocaleString("en-US", { maximumFractionDigits: 2 })}</span>}</TickerResearchLink><div className="mt-1 max-w-[190px] truncate text-sm text-foreground/50">{thesis.company}</div></td>
                  <td className="px-4 py-4"><div className="flex flex-col items-start gap-2"><BiasPill label="Kỹ thuật" bias={thesis.taBias} />{thesis.faBias && <BiasPill label="Cơ bản" bias={thesis.faBias} />}</div></td>
                  <td className="max-w-[330px] px-4 py-4"><p className="line-clamp-4 leading-6 text-foreground/75">{thesis.wyckoffState || "—"}</p></td>
                  <td className="px-4 py-4"><ScenarioBars probabilities={thesis.probabilities} compact /></td>
                  <td className="max-w-[210px] px-4 py-4 leading-6 text-foreground/70">{thesis.support || "—"}</td>
                  <td className="max-w-[230px] px-4 py-4 leading-6 text-foreground/70">{thesis.resistance || "—"}</td>
                  <td className="px-4 py-4"><span className="rounded-md border border-border-strong bg-panel-2 px-2.5 py-1.5 text-sm font-medium text-foreground/80">{confidenceLabel(thesis.confidence)}</span></td>
                  <td className="whitespace-nowrap px-4 py-4 text-sm text-foreground/60">{compactDate(thesis.updated)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="grid gap-4 lg:grid-cols-2">
        {data.theses.filter((row) => row.whatChanged).slice(0, 4).map((thesis) => (
          <TickerResearchLink ticker={thesis.ticker} key={thesis.id} className="rounded-xl border border-border bg-panel p-5 transition-colors hover:border-border-strong hover:bg-panel-2/40">
            <div className="flex items-center justify-between gap-4"><div className="font-mono text-base font-bold text-foreground">{thesis.ticker}</div><span className="text-xs font-semibold text-foreground/55">Điều gì đã thay đổi</span></div>
            <p className="mt-3 text-base leading-7 text-foreground/75">{thesis.whatChanged}</p>
          </TickerResearchLink>
        ))}
      </section>
    </div>
  )
}

function ProbabilityDelta({ label, value }: { label: string; value: number | null }) {
  if (value == null) return <span className="rounded-md border border-border bg-panel-2 px-2.5 py-1.5 text-sm text-foreground/55">{label} —</span>
  const cls = value > 0 ? "text-up" : value < 0 ? "text-down" : "text-foreground/65"
  return <span className={`rounded-md border border-border bg-panel-2 px-2.5 py-1.5 font-mono text-sm font-semibold ${cls}`}>{label} {value > 0 ? "+" : ""}{value}%</span>
}

function ThesisChanges({ data }: { data: ResearchData }) {
  const changes = useMemo(() => data.theses.map((thesis) => {
    const logs = data.logs.filter((row) => row.ticker === thesis.ticker).sort((a, b) => new Date(b.date || b.updated || 0).getTime() - new Date(a.date || a.updated || 0).getTime())
    const latest = logs[0]
    const previous = logs[1]
    return { thesis, latest, previous, deltas: previous ? { bull: delta(latest?.probabilities.bull ?? null, previous.probabilities.bull), base: delta(latest?.probabilities.base ?? null, previous.probabilities.base), bear: delta(latest?.probabilities.bear ?? null, previous.probabilities.bear) } : { bull: null, base: null, bear: null } }
  }), [data])
  return (
    <div className="space-y-4">
      <div className="mb-1"><h2 className="text-xl font-semibold text-foreground">Thay đổi luận điểm</h2><p className="mt-1 text-sm leading-6 text-foreground/60">So sánh trạng thái hiện tại với các lần phân tích trước để nhận diện điều gì thực sự thay đổi.</p></div>
      {changes.map(({ thesis, latest, previous, deltas }) => (
        <article key={thesis.id} className="rounded-xl border border-border bg-panel p-5">
          <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
            <div><div className="flex flex-wrap items-center gap-2.5"><TickerResearchLink ticker={thesis.ticker} className="font-mono text-lg font-bold text-foreground hover:text-brand">{thesis.ticker}</TickerResearchLink><BiasPill label="Kỹ thuật" bias={thesis.taBias} /><RegimePill regime={thesis.marketRegime} /></div><p className="mt-3 max-w-4xl text-base leading-7 text-foreground/75">{thesis.whatChanged || latest?.summary || "Chưa có ghi chú thay đổi."}</p></div>
            <div className="flex shrink-0 flex-wrap gap-2"><ProbabilityDelta label="Tăng" value={deltas.bull} /><ProbabilityDelta label="Cơ sở" value={deltas.base} /><ProbabilityDelta label="Giảm" value={deltas.bear} /></div>
          </div>
          <div className="mt-5 grid gap-4 border-t border-border/70 pt-5 lg:grid-cols-3">
            <div><div className="text-sm font-semibold text-foreground/65">Kịch bản cơ sở hiện tại</div><p className="mt-2 text-sm leading-6 text-foreground/72">{thesis.baseCase}</p></div>
            <div><div className="text-sm font-semibold text-foreground/65">Điều kiện xác nhận</div><p className="mt-2 text-sm leading-6 text-foreground/72">{thesis.confirmation || "—"}</p></div>
            <div><div className="text-sm font-semibold text-foreground/65">Điều kiện vô hiệu</div><p className="mt-2 text-sm leading-6 text-foreground/72">{thesis.invalidation || "—"}</p></div>
          </div>
          <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-xs text-foreground/50">{latest && <span>Mới nhất: {latest.analysis}</span>}{previous && <span>Trước đó: {previous.analysis}</span>}</div>
        </article>
      ))}
    </div>
  )
}

function LogView({ data }: { data: ResearchData }) {
  const [query, setQuery] = useState("")
  const rows = data.logs.filter((row) => `${row.ticker} ${row.analysis} ${row.summary} ${row.type.join(" ")}`.toLowerCase().includes(query.toLowerCase()))
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-panel">
      <div className="flex flex-col gap-4 border-b border-border p-5 sm:flex-row sm:items-center sm:justify-between">
        <div><h2 className="text-xl font-semibold text-foreground">Nhật ký phân tích</h2><p className="mt-1 text-sm leading-6 text-foreground/60">Lưu nguyên lịch sử dự báo để tránh điều chỉnh luận điểm theo kết quả đã xảy ra.</p></div>
        <label className="flex w-full items-center gap-2.5 rounded-md border border-border-strong bg-background px-3.5 py-2.5 sm:w-[340px]"><Search className="h-4 w-4 text-foreground/45" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm mã, TA, FA, nội dung..." className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-foreground/40" /></label>
      </div>
      <div className="divide-y divide-border/70">
        {rows.map((row) => (
          <article key={row.id} className="p-5">
            <div className="flex flex-col justify-between gap-4 lg:flex-row">
              <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="font-mono text-base font-bold text-foreground">{row.ticker || "—"}</span>{row.type.map((type) => <span key={type} className="rounded border border-border-strong bg-panel-2 px-2 py-1 text-xs font-medium text-foreground/65">{type}</span>)}{row.timeframes.map((tf) => <span key={tf} className="text-xs text-foreground/50">{tf}</span>)}</div><a href={row.notionUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1.5 text-base font-medium text-foreground hover:text-brand">{row.analysis}<ExternalLink className="h-3.5 w-3.5" /></a><p className="mt-2.5 max-w-5xl text-sm leading-6 text-foreground/72">{row.summary}</p></div>
              <div className="shrink-0"><ScenarioBars probabilities={row.probabilities} compact /></div>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-foreground/50"><span>{compactDate(row.date)}</span><span>Kết quả: {outcomeLabel(row.outcome)}</span><span>Kịch bản thực tế: {actualScenarioLabel(row.actualScenario)}</span>{row.errorClass && <span>Nhóm sai lệch: {row.errorClass}</span>}</div>
          </article>
        ))}
        {rows.length === 0 && <div className="p-10 text-center text-base text-foreground/60">Không tìm thấy phân tích phù hợp.</div>}
      </div>
    </section>
  )
}

function ReviewView({ data }: { data: ResearchData }) {
  const resolved = data.logs.filter((row) => row.actualScenario && row.actualScenario !== "Unresolved")
  const pending = data.logs.length - resolved.length
  const baseOccurred = resolved.filter((row) => row.actualScenario === "Base").length
  const invalidated = data.logs.filter((row) => row.outcome === "Invalidated").length
  const errors = data.logs.reduce<Record<string, number>>((acc, row) => { if (row.errorClass) acc[row.errorClass] = (acc[row.errorClass] ?? 0) + 1; return acc }, {})
  return (
    <div className="space-y-5">
      <div><h2 className="text-xl font-semibold text-foreground">Hậu kiểm chất lượng phân tích</h2><p className="mt-1 text-sm leading-6 text-foreground/60">Đánh giá kịch bản nào thực sự xảy ra, lỗi nằm ở đâu và bài học nào có thể tái sử dụng.</p></div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard title="Đã đánh giá" value={String(resolved.length)} detail="Số log đã được gắn kịch bản thực tế." icon={<ShieldCheck className="h-5 w-5" />} />
        <MetricCard title="Kịch bản cơ sở xảy ra" value={String(baseOccurred)} detail="Số case thực tế đi theo Base trong nhóm đã review." icon={<Target className="h-5 w-5" />} />
        <MetricCard title="Luận điểm bị vô hiệu" value={String(invalidated)} detail="Số case có outcome được đánh dấu Invalidated." icon={<TrendingDown className="h-5 w-5" />} />
        <MetricCard title="Chưa xác định" value={String(pending)} detail="Chưa đủ dữ liệu kết quả để hậu kiểm." icon={<Clock className="h-5 w-5" />} />
      </div>
      {resolved.length === 0 && <div className="rounded-xl border border-ref/30 bg-ref/5 p-5"><div className="flex items-start gap-3"><AlertTriangle className="mt-0.5 h-5 w-5 text-ref" /><div><h3 className="text-base font-semibold text-foreground">Bộ máy hậu kiểm đã sẵn sàng</h3><p className="mt-1.5 text-sm leading-6 text-foreground/70">Hiện chưa có case nào được gắn kịch bản thực tế, vì vậy StockOS không tự tạo tỷ lệ đúng/sai giả. Khi kết quả đủ rõ, cập nhật Actual Scenario, Outcome, Error Class và Lesson Learned trong Notion; bảng đánh giá sẽ phản ánh trực tiếp.</p></div></div></div>}
      <div className="grid gap-5 lg:grid-cols-2">
        <section className="rounded-xl border border-border bg-panel p-5"><h3 className="text-lg font-semibold text-foreground">Phân loại nguyên nhân sai lệch</h3><p className="mt-1 text-sm text-foreground/55">Chỉ tính các log đã có Error Class.</p><div className="mt-5 space-y-3">{Object.entries(errors).length === 0 ? <div className="rounded-md border border-border bg-panel-2 p-4 text-sm text-foreground/65">Chưa có case được phân loại lỗi.</div> : Object.entries(errors).sort(([, aCount], [, bCount]) => Number(bCount) - Number(aCount)).map(([name, count]) => <div key={name} className="flex items-center justify-between text-sm"><span className="text-foreground/70">{name}</span><span className="font-mono font-semibold text-foreground">{count}</span></div>)}</div></section>
        <section className="rounded-xl border border-border bg-panel p-5"><h3 className="text-lg font-semibold text-foreground">Bài học có thể tái sử dụng</h3><p className="mt-1 text-sm text-foreground/55">Các lesson learned mới nhất từ nhật ký phân tích.</p><div className="mt-5 space-y-4">{data.logs.filter((row) => row.lessonLearned).length === 0 ? <div className="rounded-md border border-border bg-panel-2 p-4 text-sm text-foreground/65">Chưa có bài học được ghi nhận.</div> : data.logs.filter((row) => row.lessonLearned).slice(0, 5).map((row) => <div key={row.id} className="border-l-2 border-brand/50 pl-3"><div className="font-mono text-xs font-semibold text-brand">{row.ticker}</div><p className="mt-1.5 text-sm leading-6 text-foreground/72">{row.lessonLearned}</p></div>)}</div></section>
      </div>
    </div>
  )
}

function InfoBlock({ title, children, tone = "default" }: { title: string; children: ReactNode; tone?: "default" | "positive" | "warning" | "danger" }) {
  const border = tone === "positive" ? "border-up/30" : tone === "warning" ? "border-ref/30" : tone === "danger" ? "border-down/30" : "border-border"
  return <section className={`rounded-xl border ${border} bg-panel p-5`}><h3 className="text-sm font-semibold text-foreground/65">{title}</h3><div className="mt-2.5 text-base leading-7 text-foreground/76">{children}</div></section>
}

function TickerDetail({ data, ticker }: { data: ResearchData; ticker: string }) {
  const thesis = data.theses.find((row) => row.ticker.toLowerCase() === ticker.toLowerCase())
  if (!thesis) return <div className="rounded-xl border border-border bg-panel p-10 text-center"><div className="text-xl font-semibold text-foreground">Mã này chưa có luận điểm chuẩn hóa</div><p className="mt-2 text-base text-foreground/65">Không tìm thấy {ticker.toUpperCase()} trong Stock Thesis.</p><Link href="/research" className="mt-5 inline-block text-base font-medium text-brand">Quay lại Tổng quan nghiên cứu</Link></div>
  const logs = data.logs.filter((row) => row.ticker === thesis.ticker).sort((a, b) => new Date(b.date || b.updated || 0).getTime() - new Date(a.date || a.updated || 0).getTime())
  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-border bg-panel p-6">
        <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-start">
          <div className="min-w-0"><div className="flex flex-wrap items-center gap-2.5"><span className="font-mono text-3xl font-bold text-foreground">{thesis.ticker}</span><span className="text-base text-foreground/65">{thesis.company}</span><RegimePill regime={thesis.marketRegime} /></div><div className="mt-4 flex flex-wrap gap-2.5"><BiasPill label="Kỹ thuật" bias={thesis.taBias} />{thesis.faBias && <BiasPill label="Cơ bản" bias={thesis.faBias} />}<span className="rounded-md border border-border-strong bg-panel-2 px-2.5 py-1.5 text-sm text-foreground/70">Độ tin cậy <span className="font-semibold text-foreground">{confidenceLabel(thesis.confidence)}</span></span><span className="rounded-md border border-border-strong bg-panel-2 px-2.5 py-1.5 text-sm text-foreground/70">{thesis.status || "—"}</span></div>{thesis.price && <div className="mt-6 flex flex-wrap items-baseline gap-3"><span className="font-mono text-4xl font-semibold text-foreground">{thesis.price.value.toLocaleString("en-US", { maximumFractionDigits: 2 })}</span><span className={`font-mono text-base font-semibold ${thesis.price.changePct >= 0 ? "text-up" : "text-down"}`}>{thesis.price.changePct >= 0 ? "+" : ""}{thesis.price.changePct.toFixed(2)}%</span><span className="text-xs text-foreground/50">{thesis.price.source} · {compactDate(thesis.price.timestamp)}</span></div>}</div>
          <div className="w-full lg:w-[330px]"><div className="mb-3 text-sm font-semibold text-foreground/65">Phân bổ xác suất kịch bản</div><ScenarioBars probabilities={thesis.probabilities} /></div>
        </div>
      </section>
      <ProbabilityHistoryChart thesis={thesis} logs={data.logs} />
      <div className="grid gap-5 xl:grid-cols-[1.3fr_0.7fr]">
        <div className="space-y-5"><InfoBlock title="Điều gì đã thay đổi" tone="warning">{thesis.whatChanged || "Chưa có ghi chú thay đổi."}</InfoBlock><InfoBlock title="Kịch bản cơ sở">{thesis.baseCase || "—"}</InfoBlock><InfoBlock title="Wyckoff / Cấu trúc thị trường">{thesis.wyckoffState || "—"}</InfoBlock>
          <section className="rounded-xl border border-border bg-panel"><div className="border-b border-border px-5 py-4"><h3 className="text-lg font-semibold text-foreground">Các lần phân tích gần đây</h3></div><div className="divide-y divide-border/70">{logs.map((row) => <div key={row.id} className="p-5"><div className="flex flex-col justify-between gap-4 md:flex-row"><div className="min-w-0"><a href={row.notionUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-base font-semibold text-foreground hover:text-brand">{row.analysis}<ExternalLink className="h-3.5 w-3.5" /></a><p className="mt-2 text-sm leading-6 text-foreground/72">{row.summary}</p></div><ScenarioBars probabilities={row.probabilities} compact /></div></div>)}{logs.length === 0 && <div className="p-5 text-sm text-foreground/60">Chưa có nhật ký phân tích.</div>}</div></section>
        </div>
        <div className="space-y-5"><InfoBlock title="Vùng hỗ trợ">{thesis.support || "—"}</InfoBlock><InfoBlock title="Vùng kháng cự">{thesis.resistance || "—"}</InfoBlock><InfoBlock title="Điều kiện xác nhận" tone="positive">{thesis.confirmation || "—"}</InfoBlock><InfoBlock title="Điều kiện vô hiệu" tone="danger">{thesis.invalidation || "—"}</InfoBlock>
          <section className="rounded-xl border border-border bg-panel p-5"><h3 className="text-sm font-semibold text-foreground/65">Nguồn dữ liệu</h3><div className="mt-4 flex flex-col gap-2.5"><a href={thesis.notionUrl} target="_blank" rel="noreferrer" className="inline-flex items-center justify-between rounded-md border border-border-strong bg-panel-2 px-3.5 py-2.5 text-sm text-foreground/70 hover:text-foreground">Luận điểm chuẩn trên Notion<ExternalLink className="h-3.5 w-3.5" /></a>{thesis.driveFolder && <a href={thesis.driveFolder} target="_blank" rel="noreferrer" className="inline-flex items-center justify-between rounded-md border border-border-strong bg-panel-2 px-3.5 py-2.5 text-sm text-foreground/70 hover:text-foreground">Tài liệu bằng chứng trên Drive<ExternalLink className="h-3.5 w-3.5" /></a>}</div><div className="mt-4 text-xs leading-5 text-foreground/50">Luận điểm hiện tại cập nhật {compactDate(thesis.updated)}. Giá thị trường có timestamp riêng và không mặc định được xem là realtime.</div></section>
        </div>
      </div>
    </div>
  )
}

export function ResearchApp({ data, mode, ticker = "" }: { data: ResearchData; mode: Mode; ticker?: string }) {
  return (
    <div className="min-h-screen bg-background text-[15px]">
      <TopNav />
      <ResearchHeader data={data} mode={mode} />
      <main className="mx-auto max-w-[1600px] p-4 lg:p-6">
        {mode === "overview" && <Overview data={data} />}
        {mode === "changes" && <ThesisChanges data={data} />}
        {mode === "log" && <LogView data={data} />}
        {mode === "review" && <ReviewView data={data} />}
        {mode === "ticker" && <TickerDetail data={data} ticker={ticker} />}
      </main>
    </div>
  )
}
