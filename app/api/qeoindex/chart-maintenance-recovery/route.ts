import { randomUUID } from "node:crypto"
import { NextRequest, NextResponse } from "next/server"
import { start } from "workflow/api"

import { notifyOpsError } from "@/modules/admin/ops-alerts"
import { isMachineRequestAuthorized } from "@/modules/auth/machine"
import { QEO150_RECOVERY_MAX_TICKERS } from "@/modules/market/chart-data/maintenance-recovery-workflow-steps"
import { isQeo150RecoverableCompletedSession } from "@/modules/market/chart-data/maintenance-policy"
import { getCanonicalUniverse } from "@/modules/market/universe/index"
import { getSupabaseServerClient } from "@/modules/shared/supabase/server"
import { chartIntradayMaintenanceRecoveryWorkflow } from "@/workflows/chart-intraday-maintenance-recovery"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

function bearerToken(request: Request) {
  const authorization = request.headers.get("authorization") ?? ""
  if (!authorization.startsWith("Bearer ")) return ""
  return authorization.slice("Bearer ".length).trim()
}

async function isSchedulerAuthorized(request: Request) {
  if (isMachineRequestAuthorized(request, [process.env.CRON_SECRET], { allowUnconfiguredInDevelopment: true })) return true
  const token = bearerToken(request)
  if (!token) return false
  const supabase = getSupabaseServerClient()
  if (!supabase) return false
  const { data, error } = await supabase.rpc("qeo_verify_eod_scheduler_secret", { p_secret: token })
  return !error && data === true
}

function recoveryTickers(value: string | null) {
  if (!value?.trim()) return null
  const tickers = [...new Set(value.split(",").map((ticker) => ticker.trim().toUpperCase()).filter(Boolean))]
  if (!tickers.length || tickers.length > QEO150_RECOVERY_MAX_TICKERS) return null
  if (tickers.some((ticker) => !/^[A-Z0-9]{2,12}$/.test(ticker))) return null
  return tickers
}

export async function POST(request: NextRequest) {
  if (!(await isSchedulerAuthorized(request))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }

  const startedAt = new Date()
  const sessionDate = request.nextUrl.searchParams.get("sessionDate")?.trim() || ""
  if (!isQeo150RecoverableCompletedSession(sessionDate, startedAt)) {
    return NextResponse.json({
      ok: false,
      error: "sessionDate must be a completed Vietnam securities trading session in YYYY-MM-DD format.",
    }, { status: 400 })
  }

  const tickers = recoveryTickers(request.nextUrl.searchParams.get("tickers"))
  if (!tickers) {
    return NextResponse.json({
      ok: false,
      error: `tickers must contain 1-${QEO150_RECOVERY_MAX_TICKERS} comma-separated canonical symbols.`,
    }, { status: 400 })
  }

  try {
    const universe = await getCanonicalUniverse()
    const canonicalTickers = new Set(universe.stocks.map((stock) => stock.ticker.toUpperCase()))
    const outsideCanonical = tickers.filter((ticker) => !canonicalTickers.has(ticker))
    if (outsideCanonical.length) {
      return NextResponse.json({
        ok: false,
        error: `QEO-150 recovery tickers must belong to the canonical universe: ${outsideCanonical.join(", ")}`,
      }, { status: 400 })
    }

    const startedAtIso = startedAt.toISOString()
    const dispatchId = `qeo150-recovery-${randomUUID()}`
    const run = await start(chartIntradayMaintenanceRecoveryWorkflow, [startedAtIso, dispatchId, sessionDate, tickers])
    return NextResponse.json({
      ok: true,
      mode: "chart-maintenance-recovery",
      scope: "canonical_subset",
      sessionDate,
      tickers,
      dispatchId,
      workflowRunId: run.runId,
      startedAt: startedAtIso,
    }, { status: 202 })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await notifyOpsError({
      source: "qeo150-chart-maintenance-recovery",
      message,
      path: request.nextUrl.pathname,
      method: request.method,
      status: 500,
    })
    return NextResponse.json({ ok: false, mode: "chart-maintenance-recovery", sessionDate, tickers, error: message }, { status: 500 })
  }
}
