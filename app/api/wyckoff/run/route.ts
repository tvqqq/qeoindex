import { NextRequest, NextResponse } from "next/server"

import { isMachineRequestAuthorized } from "@/lib/auth/machine"
import { runUnifiedWyckoff } from "@/lib/wyckoff-unified-runner"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

async function run(request: NextRequest) {
  if (!isMachineRequestAuthorized(request, [process.env.SCANNER_RUN_SECRET, process.env.CRON_SECRET], { allowUnconfiguredInDevelopment: true })) {
    return NextResponse.json({ ok: false, error: "Scanner authorization is not configured or invalid." }, { status: 401 })
  }
  const url = new URL(request.url)
  const limit = Math.max(1, Math.min(10, Number(url.searchParams.get("limit") ?? 10)))
  const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0))
  try {
    const result = await runUnifiedWyckoff({ limit, offset })
    return NextResponse.json(result, { status: result.completed.length ? 200 : 502 })
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  return run(request)
}
