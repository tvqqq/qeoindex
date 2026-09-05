"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"

import type { ResearchReportDetailViewModel } from "@/modules/research-reports"

import { AnalysisPanel } from "./analysis-panel"
import { PdfViewer } from "./pdf-viewer"
import {
  nextCitationNavigationState,
  type CitationNavigationState,
  type ResearchReportDetailTab,
} from "./report-detail-navigation"
import { ReportChat } from "./report-chat"

function formatPublishDate(value: string): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return value
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "medium",
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(date)
}

function categoryLabel(category: ResearchReportDetailViewModel["category"]): string {
  switch (category) {
    case "macro": return "Vĩ mô"
    case "strategy": return "Chiến lược"
    case "sector": return "Ngành"
    case "other": return "Khác"
  }
}

function analysisStatusLabel(status: ResearchReportDetailViewModel["analysisStatus"]): string {
  switch (status) {
    case "ready": return "Phân tích sẵn sàng"
    case "pending": return "Đang xử lý"
    case "needs_ocr": return "Cần OCR"
    case "unsupported": return "Chưa hỗ trợ"
    case "failed": return "Phân tích lỗi"
  }
}

export function ReportDetailShell({ report }: { report: ResearchReportDetailViewModel }) {
  const router = useRouter()
  const [navigation, setNavigation] = useState<CitationNavigationState>({
    activeTab: "pdf",
    requestedPage: null,
  })
  const viewerRegionRef = useRef<HTMLElement | null>(null)

  const navigateToCitation = (page: number) => {
    setNavigation((current) => nextCitationNavigationState(current, page))
  }

  const selectTab = (activeTab: ResearchReportDetailTab) => {
    setNavigation((current) => ({ ...current, activeTab }))
  }

  const goBack = () => {
    if (window.history.length > 1) {
      router.back()
      return
    }
    router.push("/insights/reports")
  }

  useEffect(() => {
    if (navigation.activeTab !== "pdf" || navigation.requestedPage === null) return
    viewerRegionRef.current?.focus({ preventScroll: false })
  }, [navigation.activeTab, navigation.requestedPage])

  return (
    <main className="mx-auto max-w-[1800px] space-y-5 p-4 lg:p-6">
      <header className="rounded-xl border border-white/10 bg-white/[0.03] p-5 lg:p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={goBack}
            className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm font-medium text-zinc-300 transition hover:bg-white/[0.08] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
          >
            <span aria-hidden="true">←</span>
            Quay lại
          </button>

          <div className="flex flex-wrap items-center gap-2">
            {report.originalPdfUrl ? (
              <a
                href={report.originalPdfUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="rounded-lg border border-cyan-400/20 bg-cyan-400/[0.06] px-3 py-2 text-sm font-medium text-cyan-100 transition hover:bg-cyan-400/[0.12] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/40"
              >
                Mở PDF gốc ↗
              </a>
            ) : null}
            {report.originalSourceLink ? (
              <a
                href={report.originalSourceLink}
                target="_blank"
                rel="noreferrer noopener"
                className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-medium text-zinc-200 hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
              >
                Mở nguồn gốc ↗
              </a>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 max-w-5xl">
            <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
              <span>{report.sourceName}</span>
              <span aria-hidden="true">•</span>
              <time dateTime={report.publishDate}>{formatPublishDate(report.publishDate)}</time>
              <span aria-hidden="true">•</span>
              <span>{categoryLabel(report.category)}</span>
              {report.sectorName ? (
                <>
                  <span aria-hidden="true">•</span>
                  <span>{report.sectorName}</span>
                </>
              ) : null}
            </div>
            <h1 className="mt-2 text-xl font-semibold leading-tight text-zinc-100 sm:text-2xl">{report.title}</h1>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-full border border-white/10 bg-black/20 px-2.5 py-1 text-zinc-300">
                {analysisStatusLabel(report.analysisStatus)}
              </span>
              {report.parsedPageCount > 0 ? (
                <span className="text-zinc-500">{report.parsedPageCount} trang đã nhận diện</span>
              ) : null}
            </div>
          </div>
        </div>
      </header>

      <div className="lg:hidden" role="tablist" aria-label="Nội dung báo cáo">
        <div className="grid grid-cols-3 gap-1 rounded-xl border border-white/10 bg-black/20 p-1">
          <button
            id="report-tab-pdf"
            type="button"
            role="tab"
            aria-selected={navigation.activeTab === "pdf"}
            aria-controls="report-panel-pdf"
            onClick={() => selectTab("pdf")}
            className={navigation.activeTab === "pdf" ? "rounded-lg bg-white/10 px-2 py-2 text-sm font-medium text-zinc-100" : "rounded-lg px-2 py-2 text-sm text-zinc-500"}
          >PDF</button>
          <button
            id="report-tab-analysis"
            type="button"
            role="tab"
            aria-selected={navigation.activeTab === "analysis"}
            aria-controls="report-panel-analysis"
            onClick={() => selectTab("analysis")}
            className={navigation.activeTab === "analysis" ? "rounded-lg bg-white/10 px-2 py-2 text-sm font-medium text-zinc-100" : "rounded-lg px-2 py-2 text-sm text-zinc-500"}
          >Phân tích</button>
          <button
            id="report-tab-chat"
            type="button"
            role="tab"
            aria-selected={navigation.activeTab === "chat"}
            aria-controls="report-panel-chat"
            onClick={() => selectTab("chat")}
            className={navigation.activeTab === "chat" ? "rounded-lg bg-white/10 px-2 py-2 text-sm font-medium text-zinc-100" : "rounded-lg px-2 py-2 text-sm text-zinc-500"}
          >Hỏi báo cáo</button>
        </div>
      </div>

      <div className="lg:grid lg:grid-cols-[minmax(0,3fr)_minmax(320px,2fr)] lg:items-start lg:gap-5">
        <section
          id="report-panel-pdf"
          data-report-panel="pdf"
          role="tabpanel"
          aria-labelledby="report-tab-pdf"
          ref={viewerRegionRef}
          tabIndex={-1}
          className={`${navigation.activeTab === "pdf" ? "block" : "hidden"} outline-none lg:block`}
        >
          <PdfViewer
            reportId={report.id}
            title={report.title}
            requestedPage={navigation.requestedPage}
            originalSourceLink={report.originalSourceLink}
            originalPdfUrl={report.originalPdfUrl}
            onPageResolved={(page) => {
              setNavigation((current) => current.requestedPage === page
                ? { ...current, requestedPage: null }
                : current)
            }}
          />
        </section>

        <div className="space-y-5 lg:block">
          <section
            id="report-panel-analysis"
            data-report-panel="analysis"
            role="tabpanel"
            aria-labelledby="report-tab-analysis"
            className={`${navigation.activeTab === "analysis" ? "block" : "hidden"} lg:block`}
          >
            <AnalysisPanel
              analysisStatus={report.analysisStatus}
              analysis={report.analysis}
              onNavigateCitation={navigateToCitation}
            />
          </section>

          <section
            id="report-panel-chat"
            data-report-panel="chat"
            role="tabpanel"
            aria-labelledby="report-tab-chat"
            className={`${navigation.activeTab === "chat" ? "block" : "hidden"} lg:block`}
          >
            <ReportChat
              reportId={report.id}
              analysisStatus={report.analysisStatus}
              onNavigateCitation={navigateToCitation}
            />
          </section>
        </div>
      </div>
    </main>
  )
}
