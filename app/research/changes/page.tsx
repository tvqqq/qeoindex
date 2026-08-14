import { NotionUnavailable } from "@/components/notion-unavailable"
import { ResearchApp } from "@/components/research/research-app"
import { getResearchData } from "@/lib/research-data"

export const dynamic = "force-dynamic"

export default async function ResearchChangesPage() {
  const data = await getResearchData()
  if (!data.connection.notionLive) return <NotionUnavailable section="Thay đổi luận điểm" detail={data.connection.message} />
  return <ResearchApp data={data} mode="changes" />
}
