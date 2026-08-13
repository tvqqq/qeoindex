import { NextResponse } from "next/server"
import { discoverFinhayOAuth, exchangeFinhayCode } from "@/lib/finhay-live"
import { clearFinhayOAuthAttempt, getFinhayOAuthAttempt, setFinhayTokens } from "@/lib/finhay-session"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const requestUrl = new URL(request.url)
  const destination = new URL("/research", requestUrl.origin)

  try {
    const error = requestUrl.searchParams.get("error")
    if (error) throw new Error(`Finhay OAuth returned ${error}`)

    const code = requestUrl.searchParams.get("code") ?? ""
    const state = requestUrl.searchParams.get("state") ?? ""
    const attempt = await getFinhayOAuthAttempt()
    if (!code || !state || !attempt.state || state !== attempt.state) throw new Error("Invalid Finhay OAuth callback state")
    if (!attempt.verifier || !attempt.clientId) throw new Error("Finhay OAuth attempt cookie is incomplete")

    const metadata = await discoverFinhayOAuth()
    const redirectUri = new URL("/api/finhay/auth/callback", requestUrl.origin).toString()
    const tokens = await exchangeFinhayCode({
      metadata,
      code,
      redirectUri,
      verifier: attempt.verifier,
      clientId: attempt.clientId,
      clientSecret: attempt.clientSecret || undefined,
    })

    await setFinhayTokens(tokens)
    await clearFinhayOAuthAttempt()
    destination.searchParams.set("finhay", "connected")
  } catch (error) {
    console.error("[StockOS Finhay] auth callback failed", error)
    await clearFinhayOAuthAttempt()
    destination.searchParams.set("finhay", "auth-error")
  }

  return NextResponse.redirect(destination)
}
