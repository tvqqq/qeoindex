import { NextRequest, NextResponse } from "next/server"

import { isMachineRequestAuthorized } from "@/lib/auth/machine"
import { runScannerUniverse } from "@/lib/scanner-runner"
import { UNIVERSE_SIZE } from "@/lib/wyckoff-universe"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

async function run(request: NextRequest) {
  if (!isMachineRequestAuthorized(
    request,
    [process.env.SCANNER_RUN_SECRET, process.env.CRON_SECRET],
    { allowUnconfiguredInDevelopment: true },
  )) {
    return NextResponse.json({ ok: false, error: "Scanner authorization is not configured or invalid." }, { status: 401 })
  }

  const url = new URL(request.url)
  const limit = Math.max(1, Math.min(UNIVERSE_SIZE, Number(url.searchParams.get("limit") ?? UNIVERSE_SIZE)))
  const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0))
  const result = await runScannerUniverse({ limit, offset })
  return NextResponse.json(result, { status: result.errors.length === result.requested && result.requested > 0 ? 502 : 200 })
}

export async function GET(request: NextRequest) {
  return run(request)
}

export async function POST(request: NextRequest) {
  return run(request)
}
