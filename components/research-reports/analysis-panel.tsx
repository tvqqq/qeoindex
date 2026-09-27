"use client"

import type {
  ResearchReportDetailAnalysis,
  ResearchReportDetailStatus,
} from "@/modules/research-reports/detail/types"

import { ReportAnalysisAdmin } from "./report-analysis-admin"
import { ReportSummaryImage } from "./report-summary-image"
import { ReportSummaryImageAdmin } from "./report-summary-image-admin"
import { TickerMentionCard } from "./ticker-mention-card"

function AnalysisState({
  children,
  expanded,
}: {
  children: React.ReactNode
  expanded: boolean
}) {
  return (
    <div
      className={`rounded-xl border border-white/10 bg-white/[0.03] p-5 text-zinc-300 ${expanded ? "text-base leading-7" : "text-sm"}`}
      role="status"
    >
      {children}
    </div>
  )
}

function UnavailableAnalysisState({
  message,
  expanded,
  reportId,
  analysisStatus,
  canManageReportAi,
}: {
  message: string
  expanded: boolean
  reportId: string
  analysisStatus: ResearchReportDetailStatus
  canManageReportAi: boolean
}) {
  return (
    <AnalysisState expanded={expanded}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span>{message}</span>
        {canManageReportAi ? (
          <ReportAnalysisAdmin reportId={reportId} currentStatus={analysisStatus} />
        ) : null}
      </div>
    </AnalysisState>
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
  reportId,
  reportTitle,
  analysisStatus,
  analysis,
  summaryImageUrl,
  summaryImageStatus,
  canManageReportAi = false,
  onNavigateCitation,
  expanded = false,
}: {
  reportId: string
  reportTitle: string
  analysisStatus: ResearchReportDetailStatus
  analysis: ResearchReportDetailAnalysis | null
  summaryImageUrl: string | null
  summaryImageStatus: string
  canManageReportAi?: boolean
  onNavigateCitation: (page: number) => void
  expanded?: boolean
}) {
  if (analysisStatus === "pending") {
    return (
      <UnavailableAnalysisState
        message="Đang xử lý phân tích…"
        expanded={expanded}
        reportId={reportId}
        analysisStatus={analysisStatus}
        canManageReportAi={canManageReportAi}
      />
    )
  }
  if (analysisStatus === "needs_ocr") {
    return (
      <UnavailableAnalysisState
        message="Báo cáo cần OCR trước khi có thể phân tích."
        expanded={expanded}
        reportId={reportId}
        analysisStatus={analysisStatus}
        canManageReportAi={canManageReportAi}
      />
    )
  }
  if (analysisStatus === "unsupported") {
    return (
      <UnavailableAnalysisState
        message="Định dạng PDF hiện chưa được hỗ trợ để phân tích."
        expanded={expanded}
        reportId={reportId}
        analysisStatus={analysisStatus}
        canManageReportAi={canManageReportAi}
      />
    )
  }
  if (analysisStatus === "failed") {
    return (
      <UnavailableAnalysisState
        message="Phân tích AI hiện chưa khả dụng."
        expanded={expanded}
        reportId={reportId}
        analysisStatus={analysisStatus}
        canManageReportAi={canManageReportAi}
      />
    )
  }
  if (!analysis) {
    return (
      <UnavailableAnalysisState
        message="Chưa có phân tích hiện hành cho phiên bản báo cáo này."
        expanded={expanded}
        reportId={reportId}
        analysisStatus={analysisStatus}
        canManageReportAi={canManageReportAi}
      />
    )
  }

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
      <section className="rounded-2xl border border-cyan-300/15 bg-[linear-gradient(145deg,rgba(8,25,32,0.58),rgba(5,12,18,0.76))] p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-cyan-200/70">AI SUMMARY</div>
            <h2 className={`mt-1 ${expanded ? "text-lg" : "text-base"} font-semibold text-zinc-100`}>Tóm tắt AI</h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-zinc-500">Dữ liệu phân tích đã lưu</span>
            {canManageReportAi ? (
              <ReportSummaryImageAdmin reportId={reportId} hasImage={Boolean(summaryImageUrl)} />
            ) : null}
          </div>
        </div>

        <p className={`mt-4 whitespace-pre-wrap text-zinc-300 ${expanded ? "text-base leading-7" : "text-sm leading-6"}`}>
          {executiveSummary}
        </p>

        {summaryImageUrl ? (
          <div className="mt-4 border-t border-white/[0.07] pt-4">
            <ReportSummaryImage
              src={summaryImageUrl}
              alt={`Tóm tắt hình ảnh báo cáo ${reportTitle}`}
              title={reportTitle}
            />
          </div>
        ) : summaryImageStatus === "failed" ? (
          <p className="mt-4 border-t border-white/[0.07] pt-3 text-[11px] font-semibold text-amber-200/70">
            Ảnh AI chưa tạo được. Tóm tắt text phía trên vẫn là dữ liệu phân tích hiện hành.
          </p>
        ) : null}
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
