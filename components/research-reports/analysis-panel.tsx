"use client"

import type {
  ResearchReportDetailAnalysis,
  ResearchReportDetailStatus,
} from "@/modules/research-reports/detail/types"

import { TickerMentionCard } from "./ticker-mention-card"

function AnalysisState({ children, expanded }: { children: React.ReactNode; expanded: boolean }) {
  return (
    <div
      className={`rounded-xl border border-white/10 bg-white/[0.03] p-5 text-zinc-300 ${expanded ? "text-base leading-7" : "text-sm"}`}
      role="status"
    >
      {children}
    </div>
  )
}

function TextSection({ title, text, expanded }: { title: string; text: string | null; expanded: boolean }) {
  if (!text) return null
  return (
    <section className="space-y-2">
      <h3 className={`${expanded ? "text-base" : "text-sm"} font-semibold text-zinc-100`}>{title}</h3>
      <p className={`whitespace-pre-wrap text-zinc-300 ${expanded ? "text-base leading-7" : "text-sm leading-6"}`}>{text}</p>
    </section>
  )
}

function ListSection({ title, items, expanded }: { title: string; items: string[]; expanded: boolean }) {
  if (items.length === 0) return null
  return (
    <section className="space-y-2">
      <h3 className={`${expanded ? "text-base" : "text-sm"} font-semibold text-zinc-100`}>{title}</h3>
      <ul className={`space-y-2 text-zinc-300 ${expanded ? "text-base leading-7" : "text-sm leading-6"}`}>
        {items.map((item, index) => (
          <li key={`${title}-${index}`} className="flex gap-2">
            <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-zinc-500" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

export function AnalysisPanel({
  analysisStatus,
  analysis,
  onNavigateCitation,
  expanded = false,
}: {
  analysisStatus: ResearchReportDetailStatus
  analysis: ResearchReportDetailAnalysis | null
  onNavigateCitation: (page: number) => void
  expanded?: boolean
}) {
  if (analysisStatus === "pending") return <AnalysisState expanded={expanded}>Đang xử lý phân tích…</AnalysisState>
  if (analysisStatus === "needs_ocr") return <AnalysisState expanded={expanded}>Báo cáo cần OCR trước khi có thể phân tích.</AnalysisState>
  if (analysisStatus === "unsupported") return <AnalysisState expanded={expanded}>Định dạng PDF hiện chưa được hỗ trợ để phân tích.</AnalysisState>
  if (analysisStatus === "failed") return <AnalysisState expanded={expanded}>Phân tích AI hiện chưa khả dụng.</AnalysisState>
  if (!analysis) return <AnalysisState expanded={expanded}>Chưa có phân tích hiện hành cho phiên bản báo cáo này.</AnalysisState>

  const {
    executiveSummary,
    keyPoints,
    marketView,
    sectorOutlook,
    catalysts,
    risks,
    tickerMentions,
  } = analysis

  return (
    <div className="space-y-6">
      <section className="space-y-2 rounded-xl border border-white/10 bg-white/[0.03] p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className={`${expanded ? "text-lg" : "text-base"} font-semibold text-zinc-100`}>Tóm tắt AI</h2>
          <span className="text-xs text-zinc-500">Dữ liệu phân tích đã lưu</span>
        </div>
        <p className={`whitespace-pre-wrap text-zinc-300 ${expanded ? "text-base leading-7" : "text-sm leading-6"}`}>{executiveSummary}</p>
      </section>

      <div className="space-y-6 rounded-xl border border-white/10 bg-zinc-950/40 p-5">
        <ListSection title="Điểm chính" items={keyPoints} expanded={expanded} />
        <TextSection title="Góc nhìn thị trường" text={marketView} expanded={expanded} />
        <TextSection title="Triển vọng ngành" text={sectorOutlook} expanded={expanded} />
        <ListSection title="Động lực" items={catalysts} expanded={expanded} />
        <ListSection title="Rủi ro" items={risks} expanded={expanded} />
      </div>

      {tickerMentions.length > 0 ? (
        <section className="space-y-3">
          <div>
            <h2 className={`${expanded ? "text-lg" : "text-base"} font-semibold text-zinc-100`}>Cổ phiếu được đề cập</h2>
            <p className="mt-1 text-xs leading-5 text-zinc-500">
              Khuyến nghị, quan điểm và giá mục tiêu bên dưới phản ánh nội dung nguồn báo cáo, không phải kết luận đã được QeoIndex xác minh.
            </p>
          </div>
          <div className="space-y-3">
            {tickerMentions.map((mention, index) => (
              <TickerMentionCard
                key={`${mention.ticker}-${index}`}
                mention={mention}
                onNavigateCitation={onNavigateCitation}
              />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  )
}
