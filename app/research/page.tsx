import { NotionUnavailable } from "@/components/notion-unavailable"
import { FinhayLiveControl } from "@/components/research/finhay-live-control"
import { ResearchApp } from "@/components/research/research-app"
import { getResearchOverviewData } from "@/lib/research-data"
import { withPendingReviewPlaceholders } from "@/lib/research-view-model"

export const dynamic = "force-dynamic"

export default async function ResearchPage() {
  const data = await getResearchOverviewData()
  if (!data.connection.notionLive) return <NotionUnavailable section="Trung tâm Nghiên cứu" detail={data.connection.message} />
  return (
    <>
      <div className="fixed bottom-4 right-4 z-50 max-w-[min(92vw,720px)] rounded-xl border border-border bg-panel/95 p-3 shadow-2xl backdrop-blur">
        <FinhayLiveControl symbols={["MSN"]} indexes={["VNINDEX"]} />
      </div>
      <ResearchApp data={withPendingReviewPlaceholders(data)} mode="overview" />
    </>
  )
}
