import { NextResponse } from "next/server"
import { requireApiFeature } from "@/modules/auth/server"
import { mintMarketRealtimeToken } from "@/modules/market/realtime/relay-token"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  "Pragma": "no-cache",
  "X-Content-Type-Options": "nosniff",
}

export async function POST(request: Request) {
  const auth = await requireApiFeature("market_board")
  if (!auth.ok) return auth.response

  const origin = request.headers.get("origin")
  const expectedOrigin = new URL(request.url).origin
  if (origin && origin !== expectedOrigin) {
    return NextResponse.json({ ok: false, message: "Origin not allowed." }, {
      status: 403,
      headers: NO_STORE_HEADERS,
    })
  }

  const secret = process.env.QEO_MARKET_REALTIME_SIGNING_SECRET?.trim() ?? ""
  if (!secret) {
    return NextResponse.json({ ok: false, message: "Realtime service unavailable." }, {
      status: 503,
      headers: NO_STORE_HEADERS,
    })
  }

  const { token, expiresAt } = mintMarketRealtimeToken(auth.context.user.id, secret)
  return NextResponse.json({ ok: true, token, expiresAt }, { headers: NO_STORE_HEADERS })
}
