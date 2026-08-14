import { NotionUnavailable } from "@/components/notion-unavailable"
import { FinhayLiveControl } from "@/components/research/finhay-live-control"
import { ScannerApp } from "@/components/research/scanner-app"
import { getScannerData } from "@/lib/scanner-data"

export const dynamic = "force-dynamic"

export default async function ScannerPage() {
  let data: Awaited<ReturnType<typeof getScannerData>>
  try {
    data = await getScannerData()
  } catch (error) {
    console.error("[StockOS scanner] Notion read failed", error)
    return <NotionUnavailable section="Wyckoff Scanner" detail="Không đọc được Universe / Daily Scan từ Notion. Scanner không fallback sang Supabase hoặc snapshot." />
  }
  return (
    <>
      <div className="fixed bottom-4 right-4 z-50 max-w-[min(92vw,520px)] rounded-xl border border-border bg-panel/95 p-3 shadow-2xl backdrop-blur">
        <FinhayLiveControl showQuotes={false} />
      </div>
      <ScannerApp data={data} />
    </>
  )
}
