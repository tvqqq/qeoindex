import { NextResponse } from "next/server"
import { start } from "workflow/api"

import { validateAdminMutationRequest } from "@/modules/admin/request-security"
import { requireApiRoot } from "@/modules/auth/root"
import { qeoindexEodRetry } from "@/workflows/qeoindex-eod-retry"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 120

const NO_STORE = { "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate" }
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function normalizeTickers(value: unknown) {
  if (value == null) return undefined
  if (!Array.isArray(value)) throw new Error("tickers must be an array when provided")
  if (value.length > 200) throw new Error("tickers supports at most 200 symbols")
  const tickers = [...new Set(value.map((item) => String(item || "").trim().toUpperCase()).filter(Boolean))]
  for (const ticker of tickers) {
    if (!/^[A-Z0-9]{2,12}$/.test(ticker)) throw new Error(`Invalid ticker: ${ticker}`)
  }
  return tickers
}

export async function POST(request: Request) {
  const auth = await requireApiRoot()
  if (!auth.ok) return auth.response

  const originValidation = validateAdminMutationRequest(request)
  if (!originValidation.ok) {
    return NextResponse.json(
      { ok: false, error: originValidation.error },
      { status: originValidation.status, headers: NO_STORE },
    )
  }

  try {
    const body = await request.json() as Record<string, unknown>
    const runId = String(body.runId || "").trim()
    if (!UUID_RE.test(runId)) {
      return NextResponse.json({ ok: false, error: "runId must be a valid UUID" }, { status: 400, headers: NO_STORE })
    }
    const tickers = normalizeTickers(body.tickers)
    const run = await start(qeoindexEodRetry, [{ runId, tickers }])
    return NextResponse.json({
      ok: true,
      originalRunId: runId,
      workflowRunId: run.runId,
      retryTickers: tickers ?? null,
      actorUserId: auth.context.user.id,
    }, { status: 202, headers: NO_STORE })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Malformed retry request" },
      { status: 400, headers: NO_STORE },
    )
  }
}
