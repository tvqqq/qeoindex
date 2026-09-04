import { NextResponse } from "next/server"
import { requireApiFeature } from "@/modules/auth/server"
import { clearFinhaySession } from "@/modules/market/providers/finhay/session"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  const auth = await requireApiFeature("finhay_live")
  if (!auth.ok) return auth.response

  await clearFinhaySession()
  const url = new URL("/research", request.url)
  url.searchParams.set("finhay", "disconnected")
  return NextResponse.redirect(url, 303)
}
