import { NextResponse } from "next/server"

import { getSlackOpsHealth } from "@/lib/ops-alerts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

export async function GET() {
  try {
    return NextResponse.json(await getSlackOpsHealth())
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }, { status: 503 })
  }
}
