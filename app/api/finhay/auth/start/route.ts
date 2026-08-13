import { NextResponse } from "next/server"
import { createPkce, discoverFinhayOAuth, registerFinhayClient } from "@/lib/finhay-live"
import { setFinhayOAuthAttempt } from "@/lib/finhay-session"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  try {
    const requestUrl = new URL(request.url)
    const redirectUri = new URL("/api/finhay/auth/callback", requestUrl.origin).toString()
    const metadata = await discoverFinhayOAuth()
    const client = await registerFinhayClient(metadata, redirectUri)
    const pkce = createPkce()

    await setFinhayOAuthAttempt({
      state: pkce.state,
      verifier: pkce.verifier,
      clientId: client.clientId,
      clientSecret: client.clientSecret,
    })

    const authorize = new URL(metadata.authorizationEndpoint)
    authorize.searchParams.set("response_type", "code")
    authorize.searchParams.set("client_id", client.clientId)
    authorize.searchParams.set("redirect_uri", redirectUri)
    authorize.searchParams.set("code_challenge", pkce.challenge)
    authorize.searchParams.set("code_challenge_method", "S256")
    authorize.searchParams.set("state", pkce.state)
    authorize.searchParams.set("resource", metadata.resource)

    const configuredScope = process.env.FINHAY_OAUTH_SCOPE?.trim()
    const defaultScope = metadata.scopesSupported.includes("read:market") ? "read:market" : ""
    const scope = configuredScope || defaultScope
    if (scope) authorize.searchParams.set("scope", scope)

    return NextResponse.redirect(authorize)
  } catch (error) {
    console.error("[StockOS Finhay] auth start failed", error)
    const url = new URL("/research", request.url)
    url.searchParams.set("finhay", "auth-start-error")
    return NextResponse.redirect(url)
  }
}
