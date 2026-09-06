import { NextRequest, NextResponse } from "next/server"

import { isMachineRequestAuthorized } from "@/modules/auth/machine"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 30

const DAILY_DEEP_COLD_RETIRED = "DAILY_DEEP_COLD_RETIRED"

export async function POST(request: NextRequest) {
  if (!isMachineRequestAuthorized(request, [process.env.CRON_SECRET], { allowUnconfiguredInDevelopment: true })) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }

  return NextResponse.json({
    ok: false,
    code: DAILY_DEEP_COLD_RETIRED,
    error: "Daily deep-cold history is retired. market_ohlcv_history uses a bounded ~8Y bootstrap followed by incremental EOD refresh.",
  }, { status: 410 })
}
