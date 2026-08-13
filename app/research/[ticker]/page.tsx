import { FinhayLiveControl } from "@/components/research/finhay-live-control"
import { ResearchApp } from "@/components/research/research-app"
import { getResearchData } from "@/lib/research-data"

export const dynamic = "force-dynamic"

export default async function ResearchTickerPage({
  params,
}: {
  params: Promise<{ ticker: string }>
}) {
  const { ticker } = await params
  const decoded = decodeURIComponent(ticker).toUpperCase()
  const isIndex = decoded === "VNINDEX"
  const data = await getResearchData()
  return (
    <>
      <div className="fixed bottom-4 right-4 z-50 max-w-[min(92vw,720px)] rounded-xl border border-border bg-panel/95 p-3 shadow-2xl backdrop-blur">
        <FinhayLiveControl symbols={isIndex ? [] : [decoded]} indexes={isIndex ? [decoded] : []} />
      </div>
      <ResearchApp data={data} mode="ticker" ticker={decoded} />
    </>
  )
}
