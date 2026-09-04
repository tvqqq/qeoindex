import type { ReactNode } from "react"
import Link from "next/link"

import { TopNav } from "@/components/top-nav"
import { FinhayLiveControl } from "@/components/research/finhay-live-control"
import FaScreenAppView from "@/components/research/fa-screen-app-view"
import ResearchAppView from "@/components/research/research-app-view"
import { ResearchHubNav, type ResearchHubView } from "@/components/research/research-hub-nav"
import ScannerAppView from "@/components/research/scanner-app-view"
import SignalsAppView from "@/components/research/signals-app-view"
import {
  getResearchChangesData,
  getResearchLogData,
  getResearchOverviewData,
  getResearchReviewData,
} from "@/modules/research/data"
import { withPendingReviewPlaceholders } from "@/modules/research/view-model"
import { getScannerData } from "@/modules/signals/scanner/data"
import { getSignalUiData } from "@/modules/signals/data"
import { buildRecommendationPerformance } from "@/modules/signals/performance"

export const dynamic = "force-dynamic"
export const revalidate = 0

const VALID_VIEWS = new Set<ResearchHubView>(["overview", "scanner", "signals", "fa", "changes", "log", "review"])

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function researchView(value: string | undefined): ResearchHubView {
  return value && VALID_VIEWS.has(value as ResearchHubView) ? (value as ResearchHubView) : "overview"
}

function Unavailable({ title, detail }: { title: string; detail: string }) {
  return (
    <main className="mx-auto max-w-[1600px] p-4 lg:p-6">
      <section className="rounded-xl border border-amber-400/25 bg-panel p-5">
        <h2 className="text-lg font-semibold text-amber-200">{title}</h2>
        <p className="mt-2 text-sm leading-6 text-foreground/65">{detail}</p>
      </section>
    </main>
  )
}

function EmbeddedResearch({ children, hideResearchHeader = false }: { children: ReactNode; hideResearchHeader?: boolean }) {
  return (
    <div
      className={[
        "[&>div]:min-h-0 [&>div>header]:hidden",
        hideResearchHeader ? "[&>div>div:first-of-type]:hidden" : "",
      ].join(" ")}
    >
      {children}
    </div>
  )
}

export default async function ResearchPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string | string[]; cursor?: string | string[] }>
}) {
  const query = await searchParams
  const view = researchView(first(query.view))
  const cursor = first(query.cursor)
  let content: ReactNode
  let showFinhayControl = false

  if (view === "overview") {
    const data = await getResearchOverviewData()
    showFinhayControl = true
    content = data.connection.notionLive ? (
      <EmbeddedResearch hideResearchHeader>
        <ResearchAppView data={withPendingReviewPlaceholders(data)} mode="overview" />
      </EmbeddedResearch>
    ) : (
      <Unavailable title="Trung tâm Nghiên cứu" detail={data.connection.message} />
    )
  } else if (view === "changes") {
    const data = await getResearchChangesData()
    content = data.connection.notionLive ? (
      <EmbeddedResearch hideResearchHeader>
        <ResearchAppView data={data} mode="changes" />
      </EmbeddedResearch>
    ) : (
      <Unavailable title="Thay đổi luận điểm" detail={data.connection.message} />
    )
  } else if (view === "log") {
    const data = await getResearchLogData(cursor)
    content = data.connection.notionLive ? (
      <>
        <EmbeddedResearch hideResearchHeader>
          <ResearchAppView data={data} mode="log" />
        </EmbeddedResearch>
        {data.pagination?.hasMore && data.pagination.nextCursor ? (
          <div className="mx-auto -mt-4 flex max-w-[1600px] justify-end px-4 pb-8 lg:px-6">
            <Link
              href={`/research?view=log&cursor=${encodeURIComponent(data.pagination.nextCursor)}`}
              prefetch={false}
              className="rounded-md border border-border-strong bg-panel-2 px-4 py-2 text-sm font-medium text-foreground/75 transition-colors hover:text-brand"
            >
              Trang tiếp →
            </Link>
          </div>
        ) : null}
      </>
    ) : (
      <Unavailable title="Nhật ký phân tích" detail={data.connection.message} />
    )
  } else if (view === "review") {
    const data = await getResearchReviewData()
    content = data.connection.notionLive ? (
      <EmbeddedResearch hideResearchHeader>
        <ResearchAppView data={withPendingReviewPlaceholders(data)} mode="review" />
      </EmbeddedResearch>
    ) : (
      <Unavailable title="Hậu kiểm" detail={data.connection.message} />
    )
  } else if (view === "scanner") {
    showFinhayControl = true
    let data: Awaited<ReturnType<typeof getScannerData>> | null = null
    try {
      data = await getScannerData()
    } catch (error) {
      console.error("[QeoIndex research hub] scanner read failed", error)
    }
    content = data ? (
      <EmbeddedResearch>
        <ScannerAppView data={data} />
      </EmbeddedResearch>
    ) : (
      <Unavailable title="Wyckoff Scanner" detail="Không đọc được Universe / Daily Scan từ Notion." />
    )
  } else if (view === "signals") {
    let recommendations = [] as Awaited<ReturnType<typeof getSignalUiData>>["recommendations"]
    let events = [] as Awaited<ReturnType<typeof getSignalUiData>>["events"]
    let readError = ""
    const notionConfigured = Boolean(process.env.NOTION_API_KEY || process.env.NOTION_TOKEN)
    if (!notionConfigured) {
      readError = "Notion chưa được cấu hình cho environment này; không dùng backend dự phòng."
    } else {
      try {
        const data = await getSignalUiData()
        recommendations = data.recommendations
        events = data.events
      } catch (error) {
        readError = error instanceof Error ? error.message : String(error)
        console.error("[QeoIndex research hub] signals read failed", error)
      }
    }
    content = (
      <EmbeddedResearch>
        <SignalsAppView
          recommendations={recommendations}
          events={events}
          performance={buildRecommendationPerformance(recommendations)}
          readError={readError}
          monitorReady={Boolean(process.env.DNSE_API_KEY && process.env.DNSE_API_SECRET)}
          cronSecretReady={Boolean(process.env.CRON_SECRET)}
        />
      </EmbeddedResearch>
    )
  } else {
    content = (
      <EmbeddedResearch>
        <FaScreenAppView />
      </EmbeddedResearch>
    )
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <TopNav />
      <ResearchHubNav active={view} />
      {content}
      {showFinhayControl ? (
        <div className="fixed bottom-4 right-4 z-50 max-w-[min(92vw,620px)] rounded-xl border border-border bg-panel/96 p-3 shadow-2xl">
          <FinhayLiveControl symbols={view === "overview" ? ["MSN"] : undefined} indexes={view === "overview" ? ["VNINDEX"] : undefined} showQuotes={view === "overview"} />
        </div>
      ) : null}
    </div>
  )
}
