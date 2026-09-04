import { NextResponse } from "next/server"

import {
  AUTH_COOKIE_NAME,
  getServerAuthContext,
  isServerAuthConfigured,
  verifySupabaseAccessToken,
} from "@/modules/auth/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  "X-Content-Type-Options": "nosniff",
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin")
  return !origin || origin === new URL(request.url).origin
}

function cookieMaxAge(accessToken: string) {
  try {
    const payload = accessToken.split(".")[1]
    if (!payload) return 3600
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { exp?: unknown }
    const exp = Number(decoded.exp)
    if (!Number.isFinite(exp)) return 3600
    return Math.max(30, Math.min(604800, Math.floor(exp - Date.now() / 1000)))
  } catch {
    return 3600
  }
}

export async function GET() {
  const context = await getServerAuthContext()
  if (!context) {
    return NextResponse.json({ authenticated: false }, { status: 401, headers: NO_STORE_HEADERS })
  }

  return NextResponse.json({
    authenticated: true,
    user: { id: context.user.id, email: context.user.email ?? null },
  }, { headers: NO_STORE_HEADERS })
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) {
    return NextResponse.json({ ok: false, error: "Origin not allowed." }, { status: 403, headers: NO_STORE_HEADERS })
  }
  if (!isServerAuthConfigured()) {
    return NextResponse.json({ ok: false, error: "Supabase Auth is not configured." }, { status: 503, headers: NO_STORE_HEADERS })
  }

  const body = await request.json().catch(() => null) as { accessToken?: unknown } | null
  const accessToken = typeof body?.accessToken === "string" ? body.accessToken.trim() : ""
  if (!accessToken) {
    return NextResponse.json({ ok: false, error: "Missing access token." }, { status: 400, headers: NO_STORE_HEADERS })
  }

  const context = await verifySupabaseAccessToken(accessToken)
  if (!context) {
    return NextResponse.json({ ok: false, error: "Invalid session." }, { status: 401, headers: NO_STORE_HEADERS })
  }

  const response = NextResponse.json({
    ok: true,
    user: { id: context.user.id, email: context.user.email ?? null },
  }, { headers: NO_STORE_HEADERS })

  response.cookies.set(AUTH_COOKIE_NAME, accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: cookieMaxAge(accessToken),
  })
  return response
}

export async function DELETE(request: Request) {
  if (!sameOrigin(request)) {
    return NextResponse.json({ ok: false, error: "Origin not allowed." }, { status: 403, headers: NO_STORE_HEADERS })
  }

  const response = NextResponse.json({ ok: true }, { headers: NO_STORE_HEADERS })
  response.cookies.set(AUTH_COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  })
  return response
}
