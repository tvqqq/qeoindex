import { NextResponse } from "next/server"

import { isMachineRequestAuthorized } from "@/modules/auth/machine"
import { getSupabaseServerClient } from "@/modules/shared/supabase/server"
import {
  runServerCouncilKnowledgeBackfillPage,
  runServerResearchReportKnowledgeBackfillPage,
} from "@/modules/ticker-knowledge/canonical-server"
import { normalizeTickerKnowledgeAcceptanceCommand } from "@/modules/ticker-knowledge/production-acceptance"
import {
  resetServerTickerKnowledgeDerivedCollection,
  runServerCouncilKnowledgeCanary,
  runServerReportQaCanary,
  runServerStockQaCanary,
  runServerTickerKnowledgeBenchmark,
  runServerTickerKnowledgeInventory,
} from "@/modules/ticker-knowledge/production-live"

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

async function runCommand(command: ReturnType<typeof normalizeTickerKnowledgeAcceptanceCommand>) {
  switch (command.action) {
    case "backfill_reports":
      return runServerResearchReportKnowledgeBackfillPage({
        cursor: command.cursor,
        batchSize: command.batchSize,
      })
    case "backfill_council":
      return runServerCouncilKnowledgeBackfillPage({
        cursor: command.cursor,
        batchSize: command.batchSize,
      })
    case "inventory":
      return runServerTickerKnowledgeInventory()
    case "benchmark":
      return runServerTickerKnowledgeBenchmark()
    case "canary_report":
      return runServerReportQaCanary()
    case "canary_stock":
      return runServerStockQaCanary()
    case "canary_council":
      return runServerCouncilKnowledgeCanary()
    case "reset_collection":
      return resetServerTickerKnowledgeDerivedCollection(command.confirm)
  }
}

export async function POST(request: Request) {
  if (!(await isAcceptanceRunnerAuthorized(request))) {
    return json({ ok: false, error: "Unauthorized" }, 401)
  }

  try {
    const command = normalizeTickerKnowledgeAcceptanceCommand(await request.json())
    const result = await runCommand(command)
    return json({ ok: true, action: command.action, result })
  } catch {
    return json({ ok: false, error: "Ticker knowledge production acceptance operation failed" }, 400)
  }
}
