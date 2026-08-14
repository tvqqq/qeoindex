import { NextResponse } from "next/server"

import { getScannerData } from "@/lib/scanner-data"
import { getOpenRecommendations } from "@/lib/signal-data"
import { marketSessionProgress, SIGNAL_ENGINE_VERSION } from "@/lib/signal-engine"

export const dynamic = "force-dynamic"
export const revalidate = 0

export async function GET() {
  try {
    const [scanner, open] = await Promise.all([getScannerData(), getOpenRecommendations()])
    const bullish = Object.values(scanner.latestScans).filter((row) => row.taBias === "Bullish" && row.status === "Complete")
    return NextResponse.json({
      ok: true,
      engineVersion: SIGNAL_ENGINE_VERSION,
      generatedAt: new Date().toISOString(),
      session: marketSessionProgress(),
      scannerSource: scanner.source,
      bullishCandidates: bullish.length,
      openRecommendations: open.length,
      scheduler: {
        deployed: true,
        trigger: "07:00 Asia/Ho_Chi_Minh, Monday-Friday",
        cronUtc: "0 0 * * 1-5",
        execution: "Vercel Workflow sleeps durably until opening print, then monitors 5m while positions are open / 15m while idle and captures the ATC closing print around 14:45.",
      },
      configuration: {
        dnseServerCredentials: Boolean(process.env.DNSE_API_KEY && process.env.DNSE_API_SECRET),
        cronAuthorization: Boolean(process.env.CRON_SECRET),
      },
      note: "Read-only health endpoint. Trading lifecycle is recommendation/signal execution in Notion; no broker order is submitted by this endpoint.",
    })
  } catch (error) {
    return NextResponse.json({
      ok: false,
      engineVersion: SIGNAL_ENGINE_VERSION,
      error: error instanceof Error ? error.message : String(error),
    }, { status: 503 })
  }
}
