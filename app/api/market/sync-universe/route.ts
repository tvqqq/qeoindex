import { NextResponse } from "next/server"

import { isMachineRequestAuthorized } from "@/lib/auth/machine"
import { executeSystemJob } from "@/lib/admin/job-telemetry"
import { runMarketUniverseSync } from "@/lib/market-sync-universe"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

export async function POST(request: Request) {
  if (!isMachineRequestAuthorized(
    request,
    [process.env.MARKET_SYNC_SECRET, process.env.CRON_SECRET],
    { allowUnconfiguredInDevelopment: true },
  )) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }

  try {
    const { result } = await executeSystemJob({
      jobKey: "market.sync_universe",
      trigger: "external",
      telemetry: "required",
      fn: runMarketUniverseSync,
    })
    return NextResponse.json(result)
  } catch (error) {
    console.error("[Market Sync] Sync failed", error)
    return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : "Market sync failed." }, { status: 503 })
  }
}
