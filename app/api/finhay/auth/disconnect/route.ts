import { NextResponse } from "next/server"
import { clearFinhaySession } from "@/lib/finhay-session"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  await clearFinhaySession()
  const url = new URL("/research", request.url)
  url.searchParams.set("finhay", "disconnected")
  return NextResponse.redirect(url, 303)
}
