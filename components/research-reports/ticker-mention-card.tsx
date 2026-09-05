"use client"

import type { ResearchReportDetailTickerMention } from "@/modules/research-reports/detail/types"

import { ReportCitation } from "./report-citation"

function formatTargetPrice(value: number | null, currency: string | null): string | null {
  if (value === null || !Number.isFinite(value)) return null
  const formatted = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 }).format(value)
  return currency ? `${formatted} ${currency}` : formatted
}

export function TickerMentionCard({
  mention,
  onNavigateCitation,
}: {
  mention: ResearchReportDetailTickerMention
  onNavigateCitation: (page: number) => void
}) {
  const targetPrice = formatTargetPrice(mention.targetPrice, mention.targetCurrency)

  return (
    <article className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-zinc-100">{mention.ticker}</h3>
            <span className="rounded-full border border-white/10 bg-black/20 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-zinc-400">
              {mention.stance}
            </span>
          </div>
          <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-amber-200/80">
            Quan điểm từ báo cáo
          </p>
        </div>

        {(mention.recommendationText || targetPrice) ? (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-right text-xs">
            {mention.recommendationText ? (
              <div>
                <dt className="text-zinc-500">Khuyến nghị nguồn</dt>
                <dd className="mt-0.5 font-medium text-zinc-200">{mention.recommendationText}</dd>
              </div>
            ) : null}
            {targetPrice ? (
              <div>
                <dt className="text-zinc-500">Giá mục tiêu nguồn</dt>
                <dd className="mt-0.5 font-medium text-zinc-200">{targetPrice}</dd>
              </div>
            ) : null}
          </dl>
        ) : null}
      </div>

      {mention.rationale ? (
        <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-zinc-300">{mention.rationale}</p>
      ) : null}

      {mention.evidence.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-2" aria-label={`Nguồn dẫn cho ${mention.ticker}`}>
          {mention.evidence.map((evidence, index) => (
            <ReportCitation
              key={`${evidence.page}-${index}`}
              page={evidence.page}
              excerpt={evidence.snippet}
              onNavigate={onNavigateCitation}
            />
          ))}
        </div>
      ) : null}
    </article>
  )
}
