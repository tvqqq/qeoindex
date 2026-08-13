import { NextResponse } from "next/server"
import { dnseProviderHealth, fetchDailyOhlcv, vietnamDateKey } from "@/lib/dnse-history"

export const dynamic = "force-dynamic"

export async function GET() {
  const health = dnseProviderHealth()
  if (!health.configured) {
    return NextResponse.json({ ok: false, provider: health.provider, configured: false, message: health.message }, { status: 503 })
  }

  try {
    const bars = await fetchDailyOhlcv("HPG")
    const latest = bars.at(-1)
    return NextResponse.json({
      ok: bars.length >= 200,
      provider: "DNSE",
      configured: true,
      sample: "HPG",
      completedDailyBars: bars.length,
      latestCompletedDate: latest ? vietnamDateKey(latest.time * 1000) : null,
      sufficientForMA200: bars.length >= 200,
    }, { status: bars.length >= 200 ? 200 : 503 })
  } catch (error) {
    return NextResponse.json({
      ok: false,
      provider: "DNSE",
      configured: true,
      sample: "HPG",
      error: error instanceof Error ? error.message.slice(0, 260) : "Unknown provider error",
    }, { status: 502 })
  }
}
