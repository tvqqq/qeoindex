import { NextResponse } from "next/server"

import { requireApiUser } from "@/modules/auth/server"
import {
  CorporateActionRequestError,
  CorporateActionUnavailableError,
  readCorporateActions,
} from "@/modules/market/corporate-actions/read-model"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const NO_STORE = { "Cache-Control": "no-store" }

export async function GET(request: Request) {
  const auth = await requireApiUser()
  if (!auth.ok) return auth.response

  const url = new URL(request.url)
  const ticker = url.searchParams.get("ticker") ?? ""
  const from = url.searchParams.get("from")
  const to = url.searchParams.get("to")

  try {
    const actions = await readCorporateActions(auth.context.supabase, { ticker, from, to })
    return NextResponse.json(
      {
        ok: true,
        ticker: ticker.trim().toUpperCase(),
        actions,
        generatedAt: new Date().toISOString(),
      },
      { headers: NO_STORE },
    )
  } catch (error) {
    if (error instanceof CorporateActionRequestError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400, headers: NO_STORE })
    }
    if (error instanceof CorporateActionUnavailableError) {
      return NextResponse.json({ ok: false, error: "Corporate action data unavailable." }, { status: 503, headers: NO_STORE })
    }
    return NextResponse.json({ ok: false, error: "Unable to load corporate actions." }, { status: 503, headers: NO_STORE })
  }
}
