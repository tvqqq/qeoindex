import { ScannerApp } from "@/components/research/scanner-app"
import { getScannerData } from "@/lib/scanner-data"

export const dynamic = "force-dynamic"

export default async function ScannerPage() {
  const data = await getScannerData()
  return <ScannerApp data={data} />
}
