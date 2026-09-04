import {
  CircleAlert,
  CircleCheckBig,
  Gauge,
  ShieldAlert,
  Sparkles,
  Target,
} from "lucide-react"

import { StockIdentity } from "@/components/stock-identity"
import { buildInvestorCouncilReport } from "@/modules/ai-council/investor-report"
import type { AiCouncilStock, CouncilSignal } from "@/modules/ai-council/model"
import { cn } from "@/modules/shared/ui/cn"

const SIGNAL_TONE: Record<CouncilSignal, string> = {
  BUY: "border-emerald-400/35 bg-emerald-400/10 text-emerald-300",
  BUY_ON_CONFIRMATION: "border-cyan-400/35 bg-cyan-400/10 text-cyan-200",
  WAIT: "border-slate-400/25 bg-slate-400/[0.08] text-slate-200",
  REDUCE: "border-amber-400/35 bg-amber-400/10 text-amber-300",
  SELL: "border-rose-400/35 bg-rose-400/10 text-rose-300",
}

const PILLAR_LABEL_BY_KEY = {
  fundamental: "Cơ bản",
  technical: "Kỹ thuật",
  flow: "Dòng tiền",
  market: "Bối cảnh",
  risk: "An toàn",
} as const

function price(value: number | null) {
  return value == null ? "—" : value.toLocaleString("vi-VN", { minimumFractionDigits: 1, maximumFractionDigits: 2 })
}

function pct(value: number | null) {
  return value == null ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`
}

function scoreTone(score: number | null) {
  if (score == null) return "text-slate-500"
  if (score >= 65) return "text-emerald-300"
  if (score <= 40) return "text-rose-300"
  if (score < 55) return "text-amber-300"
  return "text-white"
}

function QuestionCard({
  icon: Icon,
  title,
  tone,
  children,
}: {
  icon: typeof Sparkles
  title: string
  tone: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-2xl border border-white/[0.08] bg-black/15 p-4">
      <h3 className={cn("flex items-center gap-2 text-[12px] font-extrabold", tone)}>
        <Icon className="size-4" />
        {title}
      </h3>
      <div className="mt-3 text-[12px] leading-5 text-slate-300">{children}</div>
    </section>
  )
}

export function AiCouncilInvestorReport({ stock }: { stock: AiCouncilStock }) {
  const report = buildInvestorCouncilReport(stock)

  return (
    <section className="overflow-hidden rounded-3xl border border-white/[0.09] bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,.10),transparent_32%),radial-gradient(circle_at_top_left,rgba(139,92,246,.10),transparent_28%),linear-gradient(145deg,#0b1119,#070b10)]">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/[0.06] px-5 py-4">
        <StockIdentity
          ticker={stock.ticker}
          companyName={stock.companyName}
          exchange={stock.exchange}
          detail={stock.sector}
          logoSize={40}
          className="min-w-0 flex-1"
        />
        <div className="text-right">
          <div className="font-mono text-2xl font-black">{price(stock.price)}</div>
          <div className={cn("font-mono text-sm font-bold", (stock.changePct ?? 0) >= 0 ? "text-emerald-300" : "text-rose-300")}>{pct(stock.changePct)}</div>
        </div>
      </div>

      <div className="grid gap-5 px-5 py-5 xl:grid-cols-[minmax(0,1.05fr)_minmax(520px,.95fr)]">
        <div className="min-w-0">
          <div className="text-[10px] font-black uppercase tracking-[0.16em] text-violet-300">Khuyến nghị</div>
          <div className={cn("mt-2 inline-flex rounded-2xl border px-4 py-2.5 font-ticker text-xl font-black sm:text-2xl", SIGNAL_TONE[stock.signal])}>
            {report.recommendation}
          </div>
          <p className="mt-3 max-w-2xl text-[13px] leading-6 text-slate-200">{report.actionSummary}</p>
          <div className="mt-4 flex flex-wrap gap-2 text-[10px] font-bold">
            <span className="rounded-full border border-cyan-400/20 bg-cyan-400/[0.06] px-2.5 py-1 text-cyan-200">Độ tin cậy: {report.confidenceLabel}</span>
            <span className="rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-slate-300">Hội đồng {report.councilScore}/100</span>
            <span className="rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-slate-400">Đồng thuận {report.consensus}%</span>
            {stock.confirmationPending ? <span className="rounded-full border border-amber-400/20 bg-amber-400/[0.06] px-2.5 py-1 text-amber-200">Đang chờ xác nhận</span> : null}
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.14em] text-slate-500"><Gauge className="size-3.5" />5 trụ cột</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {report.pillars.map((pillar) => (
              <div key={pillar.key} className="rounded-xl border border-white/[0.07] bg-black/15 px-2.5 py-3 text-center">
                <div className="text-[10px] font-bold text-slate-500">{PILLAR_LABEL_BY_KEY[pillar.key]}</div>
                <div className={cn("mt-1 font-mono text-xl font-black", scoreTone(pillar.score))}>{pillar.score ?? "—"}</div>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[9px] leading-4 text-slate-600">Kỹ thuật = trung bình Wyckoff + Momentum. An toàn = Risk score. Đây là cách trình bày lại các specialist score hiện có, không thay đổi Council signal.</p>
        </div>
      </div>

      <div className="grid gap-3 border-t border-white/[0.06] px-5 py-5 md:grid-cols-2">
        <QuestionCard icon={Sparkles} title="Vì sao đáng chú ý?" tone="text-emerald-300">
          {report.whyInteresting.length ? (
            <div className="space-y-1.5">{report.whyInteresting.map((item) => <p key={item}>• {item}</p>)}</div>
          ) : <p className="text-slate-500">Chưa có bằng chứng tích cực đủ rõ để nâng độ tin cậy.</p>}
        </QuestionCard>
        <QuestionCard icon={ShieldAlert} title="Rủi ro chính" tone="text-amber-300">
          <p>{report.mainRisk}</p>
        </QuestionCard>
        <QuestionCard icon={CircleCheckBig} title="Cần xác nhận gì?" tone="text-cyan-300">
          <p>{report.confirmation || "Chưa có điều kiện xác nhận được cấu trúc hóa."}</p>
        </QuestionCard>
        <QuestionCard icon={CircleAlert} title="Điều gì làm luận điểm sai?" tone="text-rose-300">
          <p>{report.invalidation || "Chưa có điều kiện vô hiệu được cấu trúc hóa."}</p>
        </QuestionCard>
      </div>

      <div className="flex items-center gap-2 border-t border-white/[0.05] px-5 py-3 text-[9px] leading-4 text-slate-600">
        <Target className="size-3.5 shrink-0 text-violet-300" />
        Báo cáo đơn giản hóa cách đọc Council; deterministic policy vẫn là final authority và LLM debate vẫn chỉ là advisory.
      </div>
    </section>
  )
}
