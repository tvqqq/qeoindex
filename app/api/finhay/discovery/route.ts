import { NextResponse } from "next/server"
import { discoverFinhayOAuth } from "@/lib/finhay-live"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const metadata = await discoverFinhayOAuth()
    return NextResponse.json({
      ok: true,
      resource: metadata.resource,
      authorizationServer: metadata.authorizationServer,
      authorizationEndpoint: metadata.authorizationEndpoint,
      tokenEndpoint: metadata.tokenEndpoint,
      registrationEndpoint: metadata.registrationEndpoint ?? null,
      scopesSupported: metadata.scopesSupported,
    })
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }, { status: 502 })
  }
}
