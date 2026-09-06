import { NextResponse } from "next/server"

import { validateAdminMutationRequest } from "@/modules/admin/request-security"
import { requireApiRoot } from "@/modules/auth/root"
import {
  runServerCouncilKnowledgeBackfillPage,
  runServerResearchReportKnowledgeBackfillPage,
} from "@/modules/ticker-knowledge/canonical-server"
import {
  normalizeTickerKnowledgeAcceptanceCommand,
} from "@/modules/ticker-knowledge/production-acceptance"
import { probeServerTickerKnowledgeProductionHealth } from "@/modules/ticker-knowledge/production-acceptance-server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 120

const PRIVATE_NO_STORE = "private, no-store, no-cache, max-age=0, must-revalidate"

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": PRIVATE_NO_STORE },
  })
}

export async function GET(request: Request) {
  const auth = await requireApiRoot()
  if (!auth.ok) return auth.response

  try {
    const url = new URL(request.url)
    const ticker = url.searchParams.get("ticker") ?? undefined
    const health = await probeServerTickerKnowledgeProductionHealth({ ticker })
    return json({ ok: true, health })
  } catch {
    return json({ ok: false, error: "Ticker knowledge production health check failed" }, 503)
  }
}

export async function POST(request: Request) {
  const auth = await requireApiRoot()
  if (!auth.ok) return auth.response

  const originValidation = validateAdminMutationRequest(request)
  if (!originValidation.ok) {
    return json({ ok: false, error: originValidation.error }, originValidation.status)
  }

  try {
    const command = normalizeTickerKnowledgeAcceptanceCommand(await request.json())
    const result = command.action === "backfill_reports"
      ? await runServerResearchReportKnowledgeBackfillPage({
          cursor: command.cursor,
          batchSize: command.batchSize,
        })
      : await runServerCouncilKnowledgeBackfillPage({
          cursor: command.cursor,
          batchSize: command.batchSize,
        })

    return json({ ok: true, action: command.action, result })
  } catch {
    return json({ ok: false, error: "Ticker knowledge production acceptance operation failed" }, 400)
  }
}
