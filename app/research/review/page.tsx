import { NotionUnavailable } from "@/components/notion-unavailable"
import { ResearchApp } from "@/components/research/research-app"
import { getResearchReviewData } from "@/lib/research-data"
import { withPendingReviewPlaceholders } from "@/lib/research-view-model"

export const dynamic = "force-dynamic"

export default async function ResearchReviewPage() {
  const data = await getResearchReviewData()
  if (!data.connection.notionLive) return <NotionUnavailable section="Hậu kiểm" detail={data.connection.message} />
  return <ResearchApp data={withPendingReviewPlaceholders(data)} mode="review" />
}
