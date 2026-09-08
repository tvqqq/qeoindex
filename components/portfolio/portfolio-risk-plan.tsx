"use client"

import { useCallback, useEffect, useState } from "react"
import { ShieldCheck } from "lucide-react"

import { DisciplineProfileForm, type DisciplineProfileAttempt } from "./risk-plan/discipline-profile-form"
import { MoneyManagementPlanForm } from "./risk-plan/money-management-plan-form"
import {
  RiskProfileForm,
  type RiskProfileAttempt,
  type RiskProfileEvidence,
} from "./risk-plan/risk-profile-form"

type ProfileAttemptSummary = {
  id: string
  total_score: number
  score_band: "low" | "middle" | "high"
  created_at: string
}

type Plan = {
  id: string
  version: number
  default_trade_risk_percent: number
  max_active_risk_percent: number
  created_at: string
}

type Overview = {
  latestRiskProfileAttempt: RiskProfileAttempt | null
  latestDisciplineProfileAttempt: DisciplineProfileAttempt | null
  currentMoneyManagementPlan: Plan | null
  riskProfileAttemptCount: number
  disciplineProfileAttemptCount: number
  moneyManagementPlanVersionCount: number
  evidence: RiskProfileEvidence
}

function profileBandLabel(value: ProfileAttemptSummary["score_band"]): string {
  if (value === "low") return "thấp"
  if (value === "middle") return "trung bình"
  return "cao"
}

function ProfileBadge({ attempt }: { attempt: ProfileAttemptSummary | null }) {
  if (!attempt) return <span className="text-xs font-semibold text-slate-500">Chưa có lần đánh giá</span>
  return (
    <span className="rounded-full border border-purple-500/30 bg-purple-500/10 px-2.5 py-1 text-xs font-bold text-purple-300">
      {attempt.total_score} · {profileBandLabel(attempt.score_band)}
    </span>
  )
}

export function PortfolioRiskPlan({ portfolioId }: { portfolioId: string }) {
  const [overview, setOverview] = useState<Overview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!portfolioId) {
      setOverview(null)
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/portfolio/${portfolioId}/risk-plan`, {
        cache: "no-store",
        credentials: "same-origin",
      })
      const payload = await response.json().catch(() => null) as { ok?: boolean; overview?: Overview; error?: string } | null
      if (!response.ok || !payload?.ok || !payload.overview) {
        throw new Error(payload?.error || "Không thể tải kế hoạch quản trị rủi ro.")
      }
      setOverview(payload.overview)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không thể tải kế hoạch quản trị rủi ro.")
    } finally {
      setLoading(false)
    }
  }, [portfolioId])

  useEffect(() => {
    void load()
  }, [load])

  if (!portfolioId) return null

  return (
    <div className="space-y-5 rounded-3xl border border-[#2a2e40] bg-[#0c1017] p-5 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-white/[0.07] pb-4">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-purple-400" />
            <h2 className="font-ticker text-base font-extrabold uppercase tracking-wide text-white">
              Hồ sơ rủi ro · Hồ sơ kỷ luật · Kế hoạch quản trị vốn
            </h2>
          </div>
          <p className="mt-1 max-w-4xl text-xs leading-relaxed text-slate-400">
            Theo khung McDowell của QeoIndex: hồ sơ và kế hoạch được lưu riêng theo từng danh mục; mỗi lần đánh giá và mỗi phiên bản đều là lịch sử bất biến. Dữ kiện từ sách, phép tính xác định và phần mở rộng của sản phẩm được tách biệt; QEO-138 không suy diễn bằng AI.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] px-3 py-2">
            <span className="mr-2 text-slate-500">Hồ sơ rủi ro</span>
            <ProfileBadge attempt={overview?.latestRiskProfileAttempt ?? null} />
          </div>
          <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] px-3 py-2">
            <span className="mr-2 text-slate-500">Hồ sơ kỷ luật</span>
            <ProfileBadge attempt={overview?.latestDisciplineProfileAttempt ?? null} />
          </div>
        </div>
      </div>

      {loading && !overview && (
        <div className="h-32 animate-pulse rounded-2xl border border-white/[0.05] bg-white/[0.02]" />
      )}
      {error && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-xs font-semibold text-red-300">
          {error}
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-2">
        <RiskProfileForm
          portfolioId={portfolioId}
          evidence={overview?.evidence ?? null}
          latestAttempt={overview?.latestRiskProfileAttempt ?? null}
          onSaved={load}
        />
        <DisciplineProfileForm
          portfolioId={portfolioId}
          latestAttempt={overview?.latestDisciplineProfileAttempt ?? null}
          onSaved={load}
        />
      </div>

      <MoneyManagementPlanForm
        portfolioId={portfolioId}
        currentPlan={overview?.currentMoneyManagementPlan ?? null}
        riskProfileAttemptId={overview?.latestRiskProfileAttempt?.id ?? null}
        disciplineProfileAttemptId={overview?.latestDisciplineProfileAttempt?.id ?? null}
        onSaved={load}
      />
    </div>
  )
}
