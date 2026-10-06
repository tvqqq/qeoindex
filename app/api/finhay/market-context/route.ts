import { NextResponse } from "next/server"

import { requireApiFeature } from "@/modules/auth/server"
import { getFinhayIndexMarketContext } from "@/modules/market/providers/finhay/live"
import { getActiveFinhayAccessToken } from "@/modules/market/providers/finhay/session"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
}

export async function GET() {
  const auth = await requireApiFeature("finhay_live")
  if (!auth.ok) return auth.response

  const accessToken = await getActiveFinhayAccessToken()
  if (!accessToken) {
    return NextResponse.json({
      ok: false,
      state: "AUTH_REQUIRED",
      connectUrl: "/api/finhay/auth/start",
    }, { status: 401, headers: NO_STORE_HEADERS })
  }

  try {
    const sampledAt = new Date().toISOString()
    const { foreign, liquidity, breadth } = await getFinhayIndexMarketContext(accessToken, "VNINDEX")
    return NextResponse.json({
      ok: true,
      provider: "Finhay MCP",
      sampledAt,
      foreign,
      liquidity,
      breadth,
    }, { headers: NO_STORE_HEADERS })
  } catch (error) {
    return NextResponse.json({
      ok: false,
      state: "ERROR",
      message: error instanceof Error ? error.message : "Finhay market context unavailable",
    }, { status: 502, headers: NO_STORE_HEADERS })
  }
}
