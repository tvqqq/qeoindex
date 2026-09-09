import { NextResponse } from "next/server"

import { requireApiUser } from "@/modules/auth/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const NO_STORE = { "Cache-Control": "no-store, max-age=0", "X-Content-Type-Options": "nosniff" }
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const FLOW_TYPES = ["deposit", "withdrawal", "capital_adjustment"] as const
const noteLimit = 500
const MAX_FUTURE_MS = 24 * 60 * 60 * 1000
const SELECT_FIELDS = "id,portfolio_id,user_id,flow_type,signed_amount_vnd,effective_at,note,provenance,created_at"

type FlowType = typeof FLOW_TYPES[number]

function err(msg: string, status = 500) {
  return NextResponse.json({ ok: false, error: msg }, { status, headers: NO_STORE })
}

function validatePortfolioId(id: string) {
  return UUID_RE.test(id) ? id : null
}

async function ownedPortfolio(
  auth: Awaited<ReturnType<typeof requireApiUser>> & { ok: true },
  portfolioId: string,
) {
  const { data, error } = await auth.context.supabase
    .from("portfolios")
    .select("id,funding_history_status")
    .eq("id", portfolioId)
    .eq("user_id", auth.context.user.id)
    .maybeSingle()

  if (error) {
    console.error("[Portfolio Cash Flows] Portfolio lookup failed", error)
    return { response: err("Failed to validate portfolio."), portfolio: null }
  }
  if (!data) return { response: err("Danh mục không tồn tại.", 404), portfolio: null }
  return { response: null, portfolio: data }
}

/** GET /api/portfolio/[id]/cash-flows — append-only external funding history. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiUser()
  if (!auth.ok) return auth.response

  const { id } = await params
  const portfolioId = validatePortfolioId(id)
  if (!portfolioId) return err("Portfolio ID không hợp lệ.", 400)

  const ownership = await ownedPortfolio(auth, portfolioId)
  if (ownership.response) return ownership.response

  const { data, error } = await auth.context.supabase
    .from("portfolio_external_cash_flows")
    .select(SELECT_FIELDS)
    .eq("portfolio_id", portfolioId)
    .eq("user_id", auth.context.user.id)
    .order("effective_at", { ascending: true })
    .order("id", { ascending: true })

  if (error) {
    console.error("[Portfolio Cash Flows] GET failed", error)
    return err("Failed to load external cash flows.")
  }

  return NextResponse.json({
    ok: true,
    funding_history_status: ownership.portfolio!.funding_history_status,
    cash_flows: data ?? [],
  }, { headers: NO_STORE })
}

/** POST /api/portfolio/[id]/cash-flows — append a deposit/withdrawal/capital adjustment. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiUser()
  if (!auth.ok) return auth.response

  const { id } = await params
  const portfolioId = validatePortfolioId(id)
  if (!portfolioId) return err("Portfolio ID không hợp lệ.", 400)

  const ownership = await ownedPortfolio(auth, portfolioId)
  if (ownership.response) return ownership.response

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return err("Request body không hợp lệ.", 400)

  const flowType = String(body.flow_type ?? "") as FlowType
  if (!FLOW_TYPES.includes(flowType)) return err("Loại dòng vốn ngoài không hợp lệ.", 400)

  const amount = Number(body.signed_amount_vnd)
  if (!Number.isFinite(amount)) return err("Số tiền dòng vốn không hợp lệ.", 400)
  if (amount === 0) return err("Số tiền dòng vốn phải khác 0.", 400)
  if (flowType === "deposit" && !(amount > 0)) {
    return err("Nạp vốn phải có số tiền dương.", 400)
  }
  if (flowType === "withdrawal" && !(amount < 0)) {
    return err("Rút vốn phải có số tiền âm.", 400)
  }

  const effectiveAtRaw = String(body.effective_at ?? "")
  const effectiveAt = new Date(effectiveAtRaw)
  if (!effectiveAtRaw || !Number.isFinite(effectiveAt.getTime())) {
    return err("Thời điểm dòng vốn không hợp lệ.", 400)
  }
  if (effectiveAt.getTime() > Date.now() + MAX_FUTURE_MS) {
    return err("Thời điểm dòng vốn không được quá 1 ngày trong tương lai.", 400)
  }

  const note = body.note == null ? null : String(body.note).trim()
  if (note != null && note.length > noteLimit) {
    return err(`Ghi chú dòng vốn tối đa ${noteLimit} ký tự.`, 400)
  }

  const { data, error } = await auth.context.supabase
    .from("portfolio_external_cash_flows")
    .insert({
      portfolio_id: portfolioId,
      user_id: auth.context.user.id,
      flow_type: flowType,
      signed_amount_vnd: amount,
      effective_at: effectiveAt.toISOString(),
      note: note || null,
      provenance: "manual",
    })
    .select(SELECT_FIELDS)
    .single()

  if (error || !data) {
    console.error("[Portfolio Cash Flows] POST failed", error)
    return err("Failed to add external cash flow.")
  }

  return NextResponse.json({ ok: true, cash_flow: data }, { status: 201, headers: NO_STORE })
}
