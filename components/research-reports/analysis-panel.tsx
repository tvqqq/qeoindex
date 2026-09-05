"use client"

import type {
  ResearchReportDetailAnalysis,
  ResearchReportDetailStatus,
} from "@/modules/research-reports/detail/types"

import { TickerMentionCard } from "./ticker-mention-card"

function AnalysisState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5 text-sm text-zinc-300" role="status">
      {children}
    </div>
  )
}

function TextSection({ title, text }: { title: string; text: string | null }) {
  if (!text) return null
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold text-zinc-100">{title}</h3>
      <p className="whitespace-pre-wrap text-sm leading-6 text-zinc-300">{text}</p>
    </section>
  )
}

function ListSection({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold text-zinc-100">{title}</h3>
      <ul className="space-y-2 text-sm leading-6 text-zinc-300">
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
}: {
  analysisStatus: ResearchReportDetailStatus
  analysis: ResearchReportDetailAnalysis | null
  onNavigateCitation: (page: number) => void
}) {
  if (analysisStatus === "pending") return <AnalysisState>Đang xử lý phân tích…</AnalysisState>
  if (analysisStatus === "needs_ocr") return <AnalysisState>Báo cáo cần OCR trước khi có thể phân tích.</AnalysisState>
  if (analysisStatus === "unsupported") return <AnalysisState>Định dạng PDF hiện chưa được hỗ trợ để phân tích.</AnalysisState>
  if (analysisStatus === "failed") return <AnalysisState>Phân tích AI hiện chưa khả dụng.</AnalysisState>
  if (!analysis) return <AnalysisState>Chưa có phân tích hiện hành cho phiên bản báo cáo này.</AnalysisState>

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
          <h2 className="text-base font-semibold text-zinc-100">Tóm tắt AI</h2>
          <span className="text-xs text-zinc-500">Dữ liệu phân tích đã lưu</span>
        </div>
        <p className="whitespace-pre-wrap text-sm leading-6 text-zinc-300">{executiveSummary}</p>
      </section>

      <div className="space-y-6 rounded-xl border border-white/10 bg-zinc-950/40 p-5">
        <ListSection title="Điểm chính" items={keyPoints} />
        <TextSection title="Góc nhìn thị trường" text={marketView} />
        <TextSection title="Triển vọng ngành" text={sectorOutlook} />
        <ListSection title="Động lực" items={catalysts} />
        <ListSection title="Rủi ro" items={risks} />
      </div>

      {tickerMentions.length > 0 ? (
        <section className="space-y-3">
          <div>
            <h2 className="text-base font-semibold text-zinc-100">Cổ phiếu được đề cập</h2>
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
