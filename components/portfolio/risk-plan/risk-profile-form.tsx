"use client"

import { useEffect, useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import {
  riskProfilePointsForPayoffRatio,
  riskProfilePointsForWinRatio,
} from "@/modules/portfolio/risk-plan/scoring"
import { PointSlider, type ProfilePointValue } from "./point-slider"
import { RiskTermTooltip, riskPlanLabelVi } from "./risk-term-tooltip"

type EvidenceEntry = {
  source: string
  value: number | null
  periodStart: string | null
  periodEnd: string | null
  sampleSize: number | null
  completeness: "complete" | "partial" | "insufficient"
  note?: string
}

export type RiskProfileEvidence = {
  activeReturn12m: EvidenceEntry
  winRatio: EvidenceEntry
  payoffRatio: EvidenceEntry
}

export type RiskProfileAttempt = {
  id: string
  market_risk_points: number
  active_return_12m_points: number
  win_ratio_points: number
  personal_risk_tolerance_points: number
  experience_points: number
  payoff_ratio_points: number
  total_score: number
  score_band: "low" | "middle" | "high"
  created_at: string
}

type PointField =
  | "marketRiskPoints"
  | "activeReturn12mPoints"
  | "winRatioPoints"
  | "personalRiskTolerancePoints"
  | "experiencePoints"
  | "payoffRatioPoints"

type AttemptField =
  | "market_risk_points"
  | "active_return_12m_points"
  | "win_ratio_points"
  | "personal_risk_tolerance_points"
  | "experience_points"
  | "payoff_ratio_points"

type FormState = Record<PointField, "" | ProfilePointValue>

const EMPTY: FormState = {
  marketRiskPoints: "",
  activeReturn12mPoints: "",
  winRatioPoints: "",
  personalRiskTolerancePoints: "",
  experiencePoints: "",
  payoffRatioPoints: "",
}

const QUESTIONS: Array<{
  field: PointField
  attemptField: AttemptField
  label: string
  help: string
}> = [
  {
    field: "marketRiskPoints",
    attemptField: "market_risk_points",
    label: "Market Risk",
    help: "Mức rủi ro thị trường mà bạn chấp nhận theo Risk Profile của McDowell. Đây là tự đánh giá, không phải dự báo thị trường.",
  },
  {
    field: "activeReturn12mPoints",
    attemptField: "active_return_12m_points",
    label: "12-Month Active Trading Return",
    help: "Tỷ suất giao dịch chủ động 12 tháng. QeoIndex chỉ tự điền khi có lịch sử vốn tài khoản đủ chuẩn; thiếu dữ liệu phải giữ trạng thái chưa đủ lịch sử.",
  },
  {
    field: "winRatioPoints",
    attemptField: "win_ratio_points",
    label: "Win Ratio",
    help: "Tỷ lệ giao dịch thắng trên tổng số giao dịch logic đã đóng. Không đếm từng lần khớp lệnh thành một giao dịch riêng.",
  },
  {
    field: "personalRiskTolerancePoints",
    attemptField: "personal_risk_tolerance_points",
    label: "Personal Risk Tolerance",
    help: "Mức chịu rủi ro cá nhân do chính bạn tự đánh giá. Điểm hồ sơ không tự động cho phép tăng rủi ro mỗi giao dịch.",
  },
  {
    field: "experiencePoints",
    attemptField: "experience_points",
    label: "Trading Experience",
    help: "Kinh nghiệm giao dịch theo câu hỏi Risk Profile. Đây là dữ liệu tự khai, không phải đánh giá năng lực tự động.",
  },
  {
    field: "payoffRatioPoints",
    attemptField: "payoff_ratio_points",
    label: "Payoff Ratio",
    help: "Lãi bình quân của giao dịch thắng chia cho trị tuyệt đối của lỗ bình quân của giao dịch thua, tính trên các giao dịch logic đã đóng đủ dữ liệu.",
  },
]

function completenessLabel(value: EvidenceEntry["completeness"]): string {
  if (value === "complete") return "đầy đủ"
  if (value === "partial") return "một phần"
  return "chưa đủ"
}

function scoreBandLabel(value: RiskProfileAttempt["score_band"]): string {
  if (value === "low") return "thấp"
  if (value === "middle") return "trung bình"
  return "cao"
}

function evidenceText(entry: EvidenceEntry | undefined, suffix = "") {
  if (!entry || entry.value == null || entry.completeness === "insufficient") {
    return "Chưa đủ lịch sử"
  }
  const sample = entry.sampleSize == null ? "" : ` · ${entry.sampleSize} giao dịch`
  const period = entry.periodStart && entry.periodEnd
    ? ` · ${entry.periodStart.slice(0, 10)} → ${entry.periodEnd.slice(0, 10)}`
    : ""
  return `${entry.value.toFixed(2)}${suffix}${sample}${period} · ${completenessLabel(entry.completeness)}`
}

function fromAttempt(attempt: RiskProfileAttempt): FormState {
  return {
    marketRiskPoints: attempt.market_risk_points as ProfilePointValue,
    activeReturn12mPoints: attempt.active_return_12m_points as ProfilePointValue,
    winRatioPoints: attempt.win_ratio_points as ProfilePointValue,
    personalRiskTolerancePoints: attempt.personal_risk_tolerance_points as ProfilePointValue,
    experiencePoints: attempt.experience_points as ProfilePointValue,
    payoffRatioPoints: attempt.payoff_ratio_points as ProfilePointValue,
  }
}

function metricForQuestion(question: (typeof QUESTIONS)[number], evidence: RiskProfileEvidence | null) {
  if (question.field === "winRatioPoints") return evidence?.winRatio
  if (question.field === "payoffRatioPoints") return evidence?.payoffRatio
  if (question.field === "activeReturn12mPoints") return evidence?.activeReturn12m
  return undefined
}

export function RiskProfileForm({
  portfolioId,
  evidence,
  latestAttempt,
  onSaved,
}: {
  portfolioId: string
  evidence: RiskProfileEvidence | null
  latestAttempt: RiskProfileAttempt | null
  onSaved: () => void | Promise<void>
}) {
  const [form, setForm] = useState<FormState>(EMPTY)
  const [editing, setEditing] = useState(!latestAttempt)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const suggested = useMemo(() => ({
    winRatioPoints:
      evidence?.winRatio.value != null && evidence.winRatio.completeness !== "insufficient"
        ? riskProfilePointsForWinRatio(evidence.winRatio.value)
        : null,
    payoffRatioPoints:
      evidence?.payoffRatio.value != null && evidence.payoffRatio.completeness !== "insufficient"
        ? riskProfilePointsForPayoffRatio(evidence.payoffRatio.value)
        : null,
  }), [evidence])

  useEffect(() => {
    if (latestAttempt) {
      setForm(fromAttempt(latestAttempt))
      setEditing(false)
    } else {
      setForm(EMPTY)
      setEditing(true)
    }
    setError(null)
  }, [portfolioId, latestAttempt?.id])

  useEffect(() => {
    if (!editing || latestAttempt) return
    setForm((current) => ({
      ...current,
      ...(current.winRatioPoints === "" && suggested.winRatioPoints != null
        ? { winRatioPoints: suggested.winRatioPoints }
        : {}),
      ...(current.payoffRatioPoints === "" && suggested.payoffRatioPoints != null
        ? { payoffRatioPoints: suggested.payoffRatioPoints }
        : {}),
    }))
  }, [editing, latestAttempt, suggested])

  const complete = Object.values(form).every((value) => value !== "")

  async function submit() {
    if (!complete || !portfolioId) return
    setSaving(true)
    setError(null)
    try {
      const response = await fetch(`/api/portfolio/${portfolioId}/risk-plan/risk-profile`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      })
      const payload = await response.json().catch(() => null) as { error?: string } | null
      if (!response.ok) throw new Error(payload?.error || "Không thể lưu Hồ sơ rủi ro.")
      await onSaved()
      setEditing(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không thể lưu Hồ sơ rủi ro.")
    } finally {
      setSaving(false)
    }
  }

  function beginRetake() {
    setForm(latestAttempt ? fromAttempt(latestAttempt) : EMPTY)
    setError(null)
    setEditing(true)
  }

  return (
    <section className="rounded-2xl border border-[#2a2e40] bg-[#0b0f16] p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="font-ticker text-base font-extrabold text-white">Hồ sơ rủi ro</h3>
          <p className="mt-1 text-xs leading-relaxed text-slate-400">
            Sáu câu, mỗi câu 5 / 10 / 15 điểm. Các dải diễn giải của sản phẩm: 30–45, 50–65, 70–90; các khoảng này chỉ diễn giải hồ sơ và không tự động thay đổi rủi ro mỗi giao dịch.
          </p>
        </div>
        {latestAttempt && !editing && (
          <Button type="button" size="sm" variant="outline" onClick={beginRetake}>
            Đánh giá lại / Chỉnh sửa
          </Button>
        )}
      </div>

      {!editing && latestAttempt ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-purple-500/20 bg-purple-500/[0.06] p-3">
            <div>
              <div className="text-xs text-slate-400">Hồ sơ rủi ro được lưu gần nhất</div>
              <div className="mt-1 text-lg font-extrabold text-white">
                {latestAttempt.total_score} điểm <span className="text-sm text-purple-300">· {scoreBandLabel(latestAttempt.score_band)}</span>
              </div>
            </div>
            <div className="text-right text-xs text-slate-500">
              {new Date(latestAttempt.created_at).toLocaleString("vi-VN")}
            </div>
          </div>
          {QUESTIONS.map((question) => {
            const metric = metricForQuestion(question, evidence)
            const metricSuffix = question.field === "winRatioPoints" || question.field === "activeReturn12mPoints" ? "%" : ""
            return (
              <div key={question.field} className="flex items-start justify-between gap-4 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                <div className="min-w-0">
                  <RiskTermTooltip label={question.label} help={question.help} />
                  {metric && <div className="mt-1 text-xs text-slate-500">{evidenceText(metric, metricSuffix)}</div>}
                </div>
                <div className="shrink-0 rounded-lg border border-purple-500/20 bg-purple-500/10 px-3 py-1.5 text-sm font-extrabold text-purple-300">
                  {latestAttempt[question.attemptField]} điểm
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {QUESTIONS.map((question) => {
              const metric = metricForQuestion(question, evidence)
              const metricSuffix = question.field === "winRatioPoints" || question.field === "activeReturn12mPoints" ? "%" : ""
              return (
                <div key={question.field} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                  <div>
                    <RiskTermTooltip label={question.label} help={question.help} />
                    {metric && (
                      <div className={`mt-1 text-xs ${metric.value == null ? "text-amber-300" : "text-slate-400"}`}>
                        {evidenceText(metric, metricSuffix)}
                      </div>
                    )}
                  </div>
                  <div className="mt-3">
                    <PointSlider
                      label={riskPlanLabelVi(question.label)}
                      value={form[question.field]}
                      onChange={(value) => setForm((current) => ({ ...current, [question.field]: value }))}
                    />
                  </div>
                </div>
              )
            })}
          </div>

          {error && <p className="mt-3 text-xs font-semibold text-red-300">{error}</p>}
          <div className="mt-4 flex justify-end gap-2">
            {latestAttempt && (
              <Button type="button" size="sm" variant="outline" disabled={saving} onClick={() => {
                setForm(fromAttempt(latestAttempt))
                setEditing(false)
                setError(null)
              }}>
                Hủy
              </Button>
            )}
            <Button type="button" size="sm" disabled={!complete || saving} onClick={() => void submit()}>
              {saving ? "Đang lưu…" : latestAttempt ? "Lưu lần đánh giá mới" : "Lưu Hồ sơ rủi ro"}
            </Button>
          </div>
        </>
      )}
    </section>
  )
}
