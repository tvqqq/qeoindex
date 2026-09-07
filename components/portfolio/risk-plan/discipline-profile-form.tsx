"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"
import { RiskTermTooltip } from "./risk-term-tooltip"

type Field =
  | "punctualityPoints"
  | "dietSelfControlPoints"
  | "recordKeepingPoints"
  | "officeClutterPoints"
  | "billsExpensesPoints"
  | "exerciseRoutinePoints"

type FormState = Record<Field, "" | 5 | 10 | 15>

const EMPTY: FormState = {
  punctualityPoints: "",
  dietSelfControlPoints: "",
  recordKeepingPoints: "",
  officeClutterPoints: "",
  billsExpensesPoints: "",
  exerciseRoutinePoints: "",
}

const QUESTIONS: Array<{ field: Field; label: string; help: string }> = [
  {
    field: "punctualityPoints",
    label: "Punctuality",
    help: "Tự đánh giá mức độ đúng giờ và nhất quán với cam kết. Đây là tự báo cáo, không phải chẩn đoán hành vi.",
  },
  {
    field: "dietSelfControlPoints",
    label: "Diet Self-Control",
    help: "Tự đánh giá khả năng duy trì kỷ luật với thói quen ăn uống theo Discipline Profile của McDowell.",
  },
  {
    field: "recordKeepingPoints",
    label: "Record Keeping",
    help: "Mức độ duy trì ghi chép có hệ thống. Trong trading, record keeping hỗ trợ review quyết định và quản trị rủi ro.",
  },
  {
    field: "officeClutterPoints",
    label: "Office Clutter",
    help: "Tự đánh giá mức độ tổ chức môi trường làm việc. QeoIndex dùng ngôn ngữ trung tính và không suy diễn đặc điểm tâm lý.",
  },
  {
    field: "billsExpensesPoints",
    label: "Bills & Expenses",
    help: "Tự đánh giá tính đều đặn trong quản lý hóa đơn và chi phí cá nhân theo bảng câu hỏi nguồn.",
  },
  {
    field: "exerciseRoutinePoints",
    label: "Exercise Routine",
    help: "Tự đánh giá khả năng duy trì một lịch vận động đều đặn; không phải đánh giá sức khỏe hay y khoa.",
  },
]

export function DisciplineProfileForm({
  portfolioId,
  onSaved,
}: {
  portfolioId: string
  onSaved: () => void | Promise<void>
}) {
  const [form, setForm] = useState<FormState>(EMPTY)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const complete = Object.values(form).every((value) => value !== "")

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
      if (!response.ok) throw new Error(payload?.error || "Không thể lưu Discipline Profile.")
      setForm(EMPTY)
      await onSaved()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không thể lưu Discipline Profile.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="rounded-2xl border border-[#2a2e40] bg-[#0b0f16] p-5">
      <div className="mb-4">
        <h3 className="font-ticker text-base font-extrabold text-white">Discipline Profile</h3>
        <p className="mt-1 text-xs leading-relaxed text-slate-400">
          Sáu câu tự đánh giá 5 / 10 / 15 điểm. Product bands: 30–45, 50–65, 70–90. Kết quả dùng cho self-review, không phải chẩn đoán tính cách.
        </p>
      </div>

      <div className="space-y-3">
        {QUESTIONS.map((question) => (
          <div key={question.field} className="grid gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 sm:grid-cols-[minmax(0,1fr)_150px] sm:items-center">
            <RiskTermTooltip label={question.label} help={question.help} />
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
        ))}
      </div>

      {error && <p className="mt-3 text-xs font-semibold text-red-300">{error}</p>}
      <div className="mt-4 flex justify-end">
        <Button type="button" size="sm" disabled={!complete || saving} onClick={() => void submit()}>
          {saving ? "Đang lưu…" : "Save Discipline Profile"}
        </Button>
      </div>
    </section>
  )
}
