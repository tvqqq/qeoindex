import { NextRequest, NextResponse } from "next/server"
import { runScannerUniverse } from "@/lib/scanner-runner"

export const dynamic = "force-dynamic"
export const maxDuration = 300

function authorized(request: NextRequest) {
  const configured = [process.env.SCANNER_RUN_SECRET, process.env.CRON_SECRET].filter(Boolean) as string[]
  if (!configured.length) return process.env.NODE_ENV !== "production"
  const header = request.headers.get("authorization") ?? ""
  return configured.some((secret) => header === `Bearer ${secret}`)
}

async function run(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, error: "Scanner authorization is not configured or invalid." }, { status: 401 })
  }

  const url = new URL(request.url)
  const limit = Math.max(1, Math.min(50, Number(url.searchParams.get("limit") ?? 50)))
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
