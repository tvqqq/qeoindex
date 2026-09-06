import { NextResponse } from "next/server"

import { isMachineRequestAuthorized } from "@/modules/auth/machine"
import { getSupabaseServerClient } from "@/modules/shared/supabase/server"
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

function bearerToken(request: Request) {
  const authorization = request.headers.get("authorization") ?? ""
  if (!authorization.startsWith("Bearer ")) return ""
  return authorization.slice("Bearer ".length).trim()
}

async function isAcceptanceRunnerAuthorized(request: Request) {
  if (isMachineRequestAuthorized(
    request,
    [process.env.CRON_SECRET],
    { allowUnconfiguredInDevelopment: true },
  )) return true

  const token = bearerToken(request)
  if (!token) return false

  const supabase = getSupabaseServerClient()
  if (!supabase) return false

  const { data, error } = await supabase.rpc("qeo_verify_eod_scheduler_secret", { p_secret: token })
  return !error && data === true
}

export async function POST(request: Request) {
  if (!(await isAcceptanceRunnerAuthorized(request))) {
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
