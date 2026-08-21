import { NextResponse } from "next/server"
import { requireApiFeature } from "@/lib/auth/server"
import { createDnseStreamAuth } from "@/lib/dnse-stream-auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  "Pragma": "no-cache",
  "X-Content-Type-Options": "nosniff",
}

export async function GET(request: Request) {
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

  try {
    return NextResponse.json({ ok: true, ...createDnseStreamAuth() }, {
      headers: NO_STORE_HEADERS,
    })
  } catch (error) {
    console.error("DNSE stream auth unavailable", error instanceof Error ? error.message : "Unknown error")
    return NextResponse.json({ ok: false, message: "DNSE stream auth is unavailable." }, {
      status: 503,
      headers: NO_STORE_HEADERS,
    })
  }
}
