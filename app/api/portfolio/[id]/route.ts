import { NextResponse } from "next/server"

import { requireApiUser } from "@/modules/auth/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const NO_STORE = { "Cache-Control": "no-store, max-age=0", "X-Content-Type-Options": "nosniff" }

function err(msg: string, status = 500) {
  return NextResponse.json({ ok: false, error: msg }, { status, headers: NO_STORE })
}

function getPortfolioId(params: Record<string, string>) {
  const id = params.id ?? ""
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) return null
  return id
}

/** PATCH /api/portfolio/[id] — rename, update description or initial_capital */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiUser()
  if (!auth.ok) return auth.response

  const { id } = await params
  const portfolioId = getPortfolioId({ id })
  if (!portfolioId) return err("Portfolio ID không hợp lệ.", 400)

  const body = (await request.json().catch(() => null)) as {
    name?: unknown
    description?: unknown
    initial_capital?: unknown
  } | null
  const updates: Record<string, unknown> = {}

  if (body?.name !== undefined) {
    const name = String(body.name).trim()
    if (!name || name.length > 80) return err("Tên danh mục không hợp lệ (1-80 ký tự).", 400)
    updates.name = name
  }

  if (body?.description !== undefined) {
    updates.description = body.description ? String(body.description).slice(0, 500) : null
  }

  if (body?.initial_capital !== undefined) {
    const cap = Number(body.initial_capital)
    if (!Number.isFinite(cap) || cap < 0) return err("Vốn ban đầu không hợp lệ.", 400)

    const { data: currentPortfolio, error: portfolioError } = await auth.context.supabase
      .from("portfolios")
      .select("id,initial_capital")
      .eq("id", portfolioId)
      .eq("user_id", auth.context.user.id)
      .maybeSingle()

    if (portfolioError) {
      console.error("[Portfolio] Opening capital lookup failed", portfolioError)
      return err("Failed to validate opening capital.")
    }
    if (!currentPortfolio) return err("Danh mục không tồn tại.", 404)

    const currentCap = Number(currentPortfolio.initial_capital ?? 0)
    if (currentCap !== cap) {
      const [transactionsActivity, cashFlowActivity] = await Promise.all([
        auth.context.supabase
          .from("portfolio_transactions")
          .select("*", { count: "exact", head: true })
          .eq("portfolio_id", portfolioId)
          .eq("user_id", auth.context.user.id),
        auth.context.supabase
          .from("portfolio_external_cash_flows")
          .select("*", { count: "exact", head: true })
          .eq("portfolio_id", portfolioId)
          .eq("user_id", auth.context.user.id),
      ])

      if (transactionsActivity.error || cashFlowActivity.error) {
        console.error(
          "[Portfolio] Opening capital activity check failed",
          transactionsActivity.error ?? cashFlowActivity.error,
        )
        return err("Failed to validate portfolio activity.")
      }

      if ((transactionsActivity.count ?? 0) > 0 || (cashFlowActivity.count ?? 0) > 0) {
        return err(
          "Không thể sửa Vốn ban đầu sau khi danh mục đã có hoạt động. Hãy ghi nhận thay đổi qua Dòng vốn ngoài.",
          409,
        )
      }

      updates.initial_capital = cap
    }
  }

  if (Object.keys(updates).length === 0) {
    return err("Không có thông tin cần cập nhật.", 400)
  }

  const { data, error } = await auth.context.supabase
    .from("portfolios")
    .update(updates)
    .eq("id", portfolioId)
    .eq("user_id", auth.context.user.id)
    .select("id,user_id,name,description,initial_capital,funding_history_status,is_default,sort_order,created_at,updated_at")
    .single()

  if (error || !data) {
    console.error("[Portfolio] PATCH failed", error)
    return err("Failed to update portfolio.")
  }

  return NextResponse.json({ ok: true, portfolio: data }, { headers: NO_STORE })
}

/** DELETE /api/portfolio/[id] — delete a portfolio and all its transactions */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiUser()
  if (!auth.ok) return auth.response

  const { id } = await params
  const portfolioId = getPortfolioId({ id })
  if (!portfolioId) return err("Portfolio ID không hợp lệ.", 400)

  // Prevent deleting the last/only portfolio
  const { count } = await auth.context.supabase
    .from("portfolios")
    .select("*", { count: "exact", head: true })
    .eq("user_id", auth.context.user.id)

  if ((count ?? 0) <= 1) {
    return err("Không thể xóa danh mục duy nhất.", 400)
  }

  const { error } = await auth.context.supabase
    .from("portfolios")
    .delete()
    .eq("id", portfolioId)
    .eq("user_id", auth.context.user.id)

  if (error) {
    console.error("[Portfolio] DELETE failed", error)
    return err("Failed to delete portfolio.")
  }

  return NextResponse.json({ ok: true, id: portfolioId }, { headers: NO_STORE })
}
