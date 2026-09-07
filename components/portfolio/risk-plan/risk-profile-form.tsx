"use client"

import { useEffect, useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import {
  riskProfilePointsForPayoffRatio,
  riskProfilePointsForWinRatio,
} from "@/modules/portfolio/risk-plan/scoring"
import { RiskTermTooltip } from "./risk-term-tooltip"

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

type PointField =
  | "marketRiskPoints"
  | "activeReturn12mPoints"
  | "winRatioPoints"
  | "personalRiskTolerancePoints"
  | "experiencePoints"
  | "payoffRatioPoints"

type FormState = Record<PointField, "" | 5 | 10 | 15>

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
  label: string
  help: string
}> = [
  {
    field: "marketRiskPoints",
    label: "Market Risk",
    help: "Mức rủi ro thị trường mà bạn chấp nhận theo Risk Profile của McDowell. Đây là tự đánh giá, không phải dự báo thị trường.",
  },
  {
    field: "activeReturn12mPoints",
    label: "12-Month Active Trading Return",
    help: "Tỷ suất giao dịch chủ động 12 tháng. QeoIndex chỉ tự điền khi có lịch sử Account Equity đủ chuẩn; thiếu dữ liệu phải để Insufficient History.",
  },
  {
    field: "winRatioPoints",
    label: "Win Ratio",
    help: "Tỷ lệ Trade thắng trên tổng số logical Trade đã đóng. Không đếm từng Fill thành một Trade riêng.",
  },
  {
    field: "personalRiskTolerancePoints",
    label: "Personal Risk Tolerance",
    help: "Mức chịu rủi ro cá nhân do chính bạn tự đánh giá. Điểm profile không tự động cho phép tăng Risk per Trade.",
  },
  {
    field: "experiencePoints",
    label: "Trading Experience",
    help: "Kinh nghiệm giao dịch theo câu hỏi Risk Profile. Đây là dữ liệu tự khai, không phải đánh giá năng lực tự động.",
  },
  {
    field: "payoffRatioPoints",
    label: "Payoff Ratio",
    help: "Average Winning Trade chia cho giá trị tuyệt đối của Average Losing Trade, tính trên closed logical Trades đủ dữ liệu.",
  },
]

function evidenceText(entry: EvidenceEntry | undefined, suffix = "") {
  if (!entry || entry.value == null || entry.completeness === "insufficient") {
    return "Insufficient History"
  }
  const sample = entry.sampleSize == null ? "" : ` · ${entry.sampleSize} Trades`
  const period = entry.periodStart && entry.periodEnd
    ? ` · ${entry.periodStart.slice(0, 10)} → ${entry.periodEnd.slice(0, 10)}`
    : ""
  return `${entry.value.toFixed(2)}${suffix}${sample}${period} · ${entry.completeness}`
}

export function RiskProfileForm({
  portfolioId,
  evidence,
  onSaved,
}: {
  portfolioId: string
  evidence: RiskProfileEvidence | null
  onSaved: () => void | Promise<void>
}) {
  const [form, setForm] = useState<FormState>(EMPTY)
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
    setForm((current) => ({
      ...current,
      ...(current.winRatioPoints === "" && suggested.winRatioPoints != null
        ? { winRatioPoints: suggested.winRatioPoints }
        : {}),
      ...(current.payoffRatioPoints === "" && suggested.payoffRatioPoints != null
        ? { payoffRatioPoints: suggested.payoffRatioPoints }
        : {}),
    }))
  }, [suggested])

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
      if (!response.ok) throw new Error(payload?.error || "Không thể lưu Risk Profile.")
      setForm(EMPTY)
      await onSaved()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không thể lưu Risk Profile.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="rounded-2xl border border-[#2a2e40] bg-[#0b0f16] p-5">
      <div className="mb-4">
        <h3 className="font-ticker text-base font-extrabold text-white">Risk Profile</h3>
        <p className="mt-1 text-xs leading-relaxed text-slate-400">
          Sáu câu, mỗi câu 5 / 10 / 15 điểm. Product bands: 30–45, 50–65, 70–90; các khoảng này chỉ diễn giải profile và không tự động thay đổi Risk per Trade.
        </p>
      </div>

      <div className="space-y-3">
        {QUESTIONS.map((question) => {
          const metric = question.field === "winRatioPoints"
            ? evidence?.winRatio
            : question.field === "payoffRatioPoints"
              ? evidence?.payoffRatio
              : question.field === "activeReturn12mPoints"
                ? evidence?.activeReturn12m
                : undefined
          const metricSuffix = question.field === "winRatioPoints" || question.field === "activeReturn12mPoints" ? "%" : ""

          return (
            <div key={question.field} className="grid gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 sm:grid-cols-[minmax(0,1fr)_150px] sm:items-center">
              <div>
                <RiskTermTooltip label={question.label} help={question.help} />
                {metric && (
                  <div className={`mt-1 text-xs ${metric.value == null ? "text-amber-300" : "text-slate-400"}`}>
                    {evidenceText(metric, metricSuffix)}
                  </div>
                )}
              </div>
              <select
                aria-label={`${question.label} points`}
                value={form[question.field]}
                onChange={(event) => {
                  const value = event.target.value === "" ? "" : Number(event.target.value) as 5 | 10 | 15
                  setForm((current) => ({ ...current, [question.field]: value }))
                }}
                className="h-9 rounded-lg border border-[#34394d] bg-[#10151e] px-3 text-sm font-semibold text-slate-100 outline-none focus:border-purple-500"
              >
                <option value="">Chọn điểm</option>
                <option value="5">5 points</option>
                <option value="10">10 points</option>
                <option value="15">15 points</option>
              </select>
            </div>
          )
        })}
      </div>

      {error && <p className="mt-3 text-xs font-semibold text-red-300">{error}</p>}
      <div className="mt-4 flex justify-end">
        <Button type="button" size="sm" disabled={!complete || saving} onClick={() => void submit()}>
          {saving ? "Đang lưu…" : "Save Risk Profile"}
        </Button>
      </div>
    </section>
  )
}
