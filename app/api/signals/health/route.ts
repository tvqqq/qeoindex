import { NextResponse } from "next/server"

import { getScannerData } from "@/lib/scanner-data"
import { getOpenRecommendations } from "@/lib/signal-data"
import { marketSessionProgress, SIGNAL_ENGINE_VERSION } from "@/lib/signal-engine"
import { telegramConfigured } from "@/lib/telegram"

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
        deployed: false,
        recommendedCadence: "1 minute during HOSE trading session",
        reason: "Monitor endpoint is production-ready; high-frequency scheduler remains an infrastructure/plan gate and is not advertised as active until verified.",
      },
      configuration: {
        dnseServerCredentials: Boolean(process.env.DNSE_API_KEY && process.env.DNSE_API_SECRET),
        telegram: telegramConfigured(),
        cronAuthorization: Boolean(process.env.CRON_SECRET || process.env.SIGNAL_MONITOR_SECRET),
      },
      note: "Read-only health endpoint. It does not connect to live DNSE, send Telegram, or mutate Notion.",
    })
  } catch (error) {
    return NextResponse.json({
      ok: false,
      engineVersion: SIGNAL_ENGINE_VERSION,
      error: error instanceof Error ? error.message : String(error),
    }, { status: 503 })
  }
}
