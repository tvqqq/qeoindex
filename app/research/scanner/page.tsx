import { FinhayLiveControl } from "@/components/research/finhay-live-control"
import { ScannerApp } from "@/components/research/scanner-app"
import { getScannerData } from "@/lib/scanner-data"

export const dynamic = "force-dynamic"

export default async function ScannerPage() {
  const data = await getScannerData()
  return (
    <>
      <div className="fixed bottom-4 right-4 z-50 max-w-[min(92vw,520px)] rounded-xl border border-border bg-panel/95 p-3 shadow-2xl backdrop-blur">
        <FinhayLiveControl showQuotes={false} />
      </div>
      <ScannerApp data={data} />
    </>
  )
}
