"use client"

import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { PointSlider, type ProfilePointValue } from "./point-slider"
import { RiskTermTooltip, riskPlanLabelVi } from "./risk-term-tooltip"

export type DisciplineProfileAttempt = {
  id: string
  punctuality_points: number
  diet_self_control_points: number
  record_keeping_points: number
  office_clutter_points: number
  bills_expenses_points: number
  exercise_routine_points: number
  total_score: number
  score_band: "low" | "middle" | "high"
  created_at: string
}

type Field =
  | "punctualityPoints"
  | "dietSelfControlPoints"
  | "recordKeepingPoints"
  | "officeClutterPoints"
  | "billsExpensesPoints"
  | "exerciseRoutinePoints"

type AttemptField =
  | "punctuality_points"
  | "diet_self_control_points"
  | "record_keeping_points"
  | "office_clutter_points"
  | "bills_expenses_points"
  | "exercise_routine_points"

type FormState = Record<Field, "" | ProfilePointValue>

const EMPTY: FormState = {
  punctualityPoints: "",
  dietSelfControlPoints: "",
  recordKeepingPoints: "",
  officeClutterPoints: "",
  billsExpensesPoints: "",
  exerciseRoutinePoints: "",
}

const QUESTIONS: Array<{ field: Field; attemptField: AttemptField; label: string; help: string }> = [
  {
    field: "punctualityPoints",
    attemptField: "punctuality_points",
    label: "Punctuality",
    help: "Tự đánh giá mức độ đúng giờ và nhất quán với cam kết. Đây là tự báo cáo, không phải chẩn đoán hành vi.",
  },
  {
    field: "dietSelfControlPoints",
    attemptField: "diet_self_control_points",
    label: "Diet Self-Control",
    help: "Tự đánh giá khả năng duy trì kỷ luật với thói quen ăn uống theo Discipline Profile của McDowell.",
  },
  {
    field: "recordKeepingPoints",
    attemptField: "record_keeping_points",
    label: "Record Keeping",
    help: "Mức độ duy trì ghi chép có hệ thống. Trong giao dịch, ghi chép hỗ trợ rà soát quyết định và quản trị rủi ro.",
  },
  {
    field: "officeClutterPoints",
    attemptField: "office_clutter_points",
    label: "Office Clutter",
    help: "Tự đánh giá mức độ tổ chức môi trường làm việc. QeoIndex dùng ngôn ngữ trung tính và không suy diễn đặc điểm tâm lý.",
  },
  {
    field: "billsExpensesPoints",
    attemptField: "bills_expenses_points",
    label: "Bills & Expenses",
    help: "Tự đánh giá tính đều đặn trong quản lý hóa đơn và chi phí cá nhân theo bảng câu hỏi nguồn.",
  },
  {
    field: "exerciseRoutinePoints",
    attemptField: "exercise_routine_points",
    label: "Exercise Routine",
    help: "Tự đánh giá khả năng duy trì một lịch vận động đều đặn; không phải đánh giá sức khỏe hay y khoa.",
  },
]

function fromAttempt(attempt: DisciplineProfileAttempt): FormState {
  return {
    punctualityPoints: attempt.punctuality_points as ProfilePointValue,
    dietSelfControlPoints: attempt.diet_self_control_points as ProfilePointValue,
    recordKeepingPoints: attempt.record_keeping_points as ProfilePointValue,
    officeClutterPoints: attempt.office_clutter_points as ProfilePointValue,
    billsExpensesPoints: attempt.bills_expenses_points as ProfilePointValue,
    exerciseRoutinePoints: attempt.exercise_routine_points as ProfilePointValue,
  }
}

function scoreBandLabel(value: DisciplineProfileAttempt["score_band"]): string {
  if (value === "low") return "thấp"
  if (value === "middle") return "trung bình"
  return "cao"
}

export function DisciplineProfileForm({
  portfolioId,
  latestAttempt,
  onSaved,
}: {
  portfolioId: string
  latestAttempt: DisciplineProfileAttempt | null
  onSaved: () => void | Promise<void>
}) {
  const [form, setForm] = useState<FormState>(EMPTY)
  const [editing, setEditing] = useState(!latestAttempt)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const complete = Object.values(form).every((value) => value !== "")

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

  async function submit() {
    if (!complete || !portfolioId) return
    setSaving(true)
    setError(null)
    try {
      const response = await fetch(`/api/portfolio/${portfolioId}/risk-plan/discipline-profile`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      })
      const payload = await response.json().catch(() => null) as { error?: string } | null
      if (!response.ok) throw new Error(payload?.error || "Không thể lưu Hồ sơ kỷ luật.")
      await onSaved()
      setEditing(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không thể lưu Hồ sơ kỷ luật.")
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
          <h3 className="font-ticker text-base font-extrabold text-white">Hồ sơ kỷ luật</h3>
          <p className="mt-1 text-xs leading-relaxed text-slate-400">
            Sáu câu tự đánh giá 5 / 10 / 15 điểm. Các dải diễn giải của sản phẩm: 30–45, 50–65, 70–90. Kết quả dùng cho tự rà soát, không phải chẩn đoán tính cách.
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
              <div className="text-xs text-slate-400">Hồ sơ kỷ luật được lưu gần nhất</div>
              <div className="mt-1 text-lg font-extrabold text-white">
                {latestAttempt.total_score} điểm <span className="text-sm text-purple-300">· {scoreBandLabel(latestAttempt.score_band)}</span>
              </div>
            </div>
            <div className="text-right text-xs text-slate-500">
              {new Date(latestAttempt.created_at).toLocaleString("vi-VN")}
            </div>
          </div>
          {QUESTIONS.map((question) => (
            <div key={question.field} className="flex items-start justify-between gap-4 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
              <RiskTermTooltip label={question.label} help={question.help} />
              <div className="shrink-0 rounded-lg border border-purple-500/20 bg-purple-500/10 px-3 py-1.5 text-sm font-extrabold text-purple-300">
                {latestAttempt[question.attemptField]} điểm
              </div>
            </div>
          ))}
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {QUESTIONS.map((question) => (
              <div key={question.field} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                <RiskTermTooltip label={question.label} help={question.help} />
                <div className="mt-3">
                  <PointSlider
                    label={riskPlanLabelVi(question.label)}
                    value={form[question.field]}
                    onChange={(value) => setForm((current) => ({ ...current, [question.field]: value }))}
                  />
                </div>
              </div>
            ))}
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
              {saving ? "Đang lưu…" : latestAttempt ? "Lưu lần đánh giá mới" : "Lưu Hồ sơ kỷ luật"}
            </Button>
          </div>
        </>
      )}
    </section>
  )
}
