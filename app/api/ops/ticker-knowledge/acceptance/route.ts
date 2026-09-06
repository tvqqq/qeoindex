import { NextResponse } from "next/server"

import { isMachineRequestAuthorized } from "@/modules/auth/machine"
import {
  runServerCouncilKnowledgeBackfillPage,
  runServerResearchReportKnowledgeBackfillPage,
} from "@/modules/ticker-knowledge/canonical-server"
import { normalizeTickerKnowledgeAcceptanceCommand } from "@/modules/ticker-knowledge/production-acceptance"

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

export async function POST(request: Request) {
  if (!isMachineRequestAuthorized(
    request,
    [process.env.CRON_SECRET],
    { allowUnconfiguredInDevelopment: true },
  )) {
    return json({ ok: false, error: "Unauthorized" }, 401)
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
