import { NextResponse } from "next/server"
import { getFinhayMarketSession } from "@/lib/finhay-live"
import { getActiveFinhayAccessToken } from "@/lib/finhay-session"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  const accessToken = await getActiveFinhayAccessToken()
  if (!accessToken) {
    return NextResponse.json({
      connected: false,
      state: "AUTH_REQUIRED",
      message: "QeoIndex chưa có phiên OAuth Finhay riêng.",
      connectUrl: "/api/finhay/auth/start",
    })
  }

  try {
    const session: any = await getFinhayMarketSession(accessToken, "HOSE")
    return NextResponse.json({
      connected: true,
      state: "LIVE",
      message: "Finhay MCP đã xác thực cho QeoIndex.",
      exchange: "HOSE",
      session: session.exchange_session ?? session.session ?? "UNKNOWN",
      availableOrderTypes: session.available_order_types ?? [],
      checkedAt: new Date().toISOString(),
    })
  } catch (error) {
    console.error("[QeoIndex Finhay] status probe failed", error)
    return NextResponse.json({
      connected: false,
      state: "ERROR",
      message: "Phiên Finhay tồn tại nhưng probe MCP thất bại; hãy kết nối lại.",
      connectUrl: "/api/finhay/auth/start",
    }, { status: 503 })
  }
}
