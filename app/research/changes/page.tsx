import { ResearchApp } from "@/components/research/research-app"
import { getResearchData } from "@/lib/research-data"

export const dynamic = "force-dynamic"

export default async function ResearchChangesPage() {
  const data = await getResearchData()
  return <ResearchApp data={data} mode="changes" />
}
