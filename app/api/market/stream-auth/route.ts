import { NextResponse } from "next/server"
import { createDnseStreamAuth } from "@/lib/dnse-stream-auth"
import { getActiveFinhayAccessToken } from "@/lib/finhay-session"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const origin = request.headers.get("origin")
  const expectedOrigin = new URL(request.url).origin
  if (origin && origin !== expectedOrigin) {
    return NextResponse.json({ ok: false, message: "Origin not allowed." }, { status: 403 })
  }

  const finhayAccessToken = await getActiveFinhayAccessToken()
  if (!finhayAccessToken) {
    return NextResponse.json({ ok: false, message: "Finhay authentication required." }, {
      status: 401,
      headers: { "Cache-Control": "no-store, max-age=0" },
    })
  }

  try {
    return NextResponse.json({ ok: true, ...createDnseStreamAuth() }, {
      headers: {
        "Cache-Control": "no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
      },
    })
  } catch (error) {
    return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : String(error) }, { status: 503 })
  }
}
