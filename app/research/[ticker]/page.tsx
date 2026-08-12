import { ResearchApp } from "@/components/research/research-app"
import { getResearchData } from "@/lib/research-data"

export const dynamic = "force-dynamic"

export default async function ResearchTickerPage({
  params,
}: {
  params: Promise<{ ticker: string }>
}) {
  const { ticker } = await params
  const data = await getResearchData()
  return <ResearchApp data={data} mode="ticker" ticker={decodeURIComponent(ticker)} />
}
