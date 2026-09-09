"use client"

import { useMemo, useState, type ReactNode } from "react"

import { Button } from "@/components/ui/button"
import { RiskTermTooltip, riskPlanLabelVi } from "./risk-term-tooltip"

type CurrentPlan = {
  version: number
  default_trade_risk_percent: number
  max_active_risk_percent: number
  created_at: string
} | null

function numeric(value: string): number | null {
  if (!value.trim()) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function Toggle({
  checked,
  onChange,
  children,
  ariaLabel,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  children: ReactNode
  ariaLabel: string
}) {
  return (
    <div className="flex items-center gap-2 text-xs font-semibold text-slate-300">
      <input
        type="checkbox"
        checked={checked}
        aria-label={ariaLabel}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 shrink-0 accent-purple-500"
      />
      {children}
    </div>
  )
}

function NumberField({
  value,
  onChange,
  placeholder,
  ariaLabel,
  min,
  max,
  step = "0.1",
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  ariaLabel: string
  min?: number
  max?: number
  step?: string
}) {
  return (
    <input
      type="number"
      inputMode="decimal"
      value={value}
      aria-label={ariaLabel}
      min={min}
      max={max}
      step={step}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      className="h-9 w-full rounded-lg border border-[#34394d] bg-[#10151e] px-3 text-sm font-semibold text-slate-100 outline-none placeholder:text-slate-600 focus:border-purple-500"
    />
  )
}

export function MoneyManagementPlanForm({
  portfolioId,
  currentPlan,
  riskProfileAttemptId,
  disciplineProfileAttemptId,
  onSaved,
}: {
  portfolioId: string
  currentPlan: CurrentPlan
  riskProfileAttemptId: string | null
  disciplineProfileAttemptId: string | null
  onSaved: () => void | Promise<void>
}) {
  const [riskPerTrade, setRiskPerTrade] = useState("")
  const [maxActiveRisk, setMaxActiveRisk] = useState("")
  const [advancedAck, setAdvancedAck] = useState(false)

  const [reduceEnabled, setReduceEnabled] = useState(false)
  const [reduceThreshold, setReduceThreshold] = useState("")
  const [reductionFactor, setReductionFactor] = useState("")
  const [pauseEnabled, setPauseEnabled] = useState(false)
  const [pauseThreshold, setPauseThreshold] = useState("")
  const [stopOutEnabled, setStopOutEnabled] = useState(false)
  const [stopOutThreshold, setStopOutThreshold] = useState("")
  const [rollingEnabled, setRollingEnabled] = useState(false)
  const [rollingCount, setRollingCount] = useState("")

  const [dailyHolidayEnabled, setDailyHolidayEnabled] = useState(false)
  const [dailyLosingTrades, setDailyLosingTrades] = useState("")
  const [dailyLossPercent, setDailyLossPercent] = useState("")
  const [weeklyHolidayEnabled, setWeeklyHolidayEnabled] = useState(false)
  const [weeklyLosingTrades, setWeeklyLosingTrades] = useState("")
  const [weeklyLossPercent, setWeeklyLossPercent] = useState("")
  const [monthlyHolidayEnabled, setMonthlyHolidayEnabled] = useState(false)
  const [monthlyLosingTrades, setMonthlyLosingTrades] = useState("")
  const [monthlyLossPercent, setMonthlyLossPercent] = useState("")

  const [defineInitialStop, setDefineInitialStop] = useState(false)
  const [honorStop, setHonorStop] = useState(false)
  const [systemStops, setSystemStops] = useState(false)
  const [trailingStops, setTrailingStops] = useState(false)
  const [noEmotionalMove, setNoEmotionalMove] = useState(false)
  const [recalculateScaleIn, setRecalculateScaleIn] = useState(false)
  const [dailyRecords, setDailyRecords] = useState(false)

  const [scaleInWinningOnly, setScaleInWinningOnly] = useState(false)
  const [prohibitDoublingDown, setProhibitDoublingDown] = useState(false)
  const [scaleOutMode, setScaleOutMode] = useState<"none" | "thirds" | "30_30_40" | "signal_driven" | "custom">("none")
  const [customScaleOut, setCustomScaleOut] = useState("")

  const [diversificationEnabled, setDiversificationEnabled] = useState(false)
  const [maxTickerConcentration, setMaxTickerConcentration] = useState("")
  const [maxSectorRisk, setMaxSectorRisk] = useState("")
  const [concentrationWarning, setConcentrationWarning] = useState("")
  const [maxConcurrentOpenPositions, setMaxConcurrentOpenPositions] = useState("")

  const [riskCapitalMode, setRiskCapitalMode] = useState<"disabled" | "risk_capital_amount" | "net_worth_percent">("disabled")
  const [riskCapitalValue, setRiskCapitalValue] = useState("")
  const [notes, setNotes] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const riskValue = numeric(riskPerTrade)
  const maxActiveValue = numeric(maxActiveRisk)
  const needsAck = riskValue != null && riskValue > 2
  const validBase = riskValue != null && riskValue > 0 && maxActiveValue != null && maxActiveValue >= riskValue
  const canSave = validBase && (!needsAck || advancedAck)

  const customScale = useMemo(() => customScaleOut
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isFinite(value)), [customScaleOut])

  async function submit() {
    if (!canSave || !portfolioId || riskValue == null || maxActiveValue == null) return
    setSaving(true)
    setError(null)

    const riskCapitalPolicy = riskCapitalMode === "disabled"
      ? { mode: "disabled" as const }
      : riskCapitalMode === "risk_capital_amount"
        ? { mode: "risk_capital_amount" as const, amount: numeric(riskCapitalValue) }
        : { mode: "net_worth_percent" as const, percent: numeric(riskCapitalValue) }

    const body = {
      riskProfileAttemptId,
      disciplineProfileAttemptId,
      defaultTradeRiskPercent: riskValue,
      advancedRiskOverrideAcknowledged: advancedAck,
      maxActiveRiskPercent: maxActiveValue,
      drawdownReduce: {
        enabled: reduceEnabled,
        thresholdPercent: reduceEnabled ? numeric(reduceThreshold) : null,
        riskReductionFactor: reduceEnabled ? numeric(reductionFactor) : null,
      },
      drawdownPause: {
        enabled: pauseEnabled,
        thresholdPercent: pauseEnabled ? numeric(pauseThreshold) : null,
      },
      consecutiveStopOuts: {
        enabled: stopOutEnabled,
        threshold: stopOutEnabled ? numeric(stopOutThreshold) : null,
      },
      rollingTradeLoss: {
        enabled: rollingEnabled,
        tradeCount: rollingEnabled ? numeric(rollingCount) : null,
      },
      holidayRules: {
        ...(dailyHolidayEnabled
          ? {
              daily: {
                enabled: true,
                ...(numeric(dailyLosingTrades) != null ? { consecutiveLosingTrades: numeric(dailyLosingTrades) } : {}),
                ...(numeric(dailyLossPercent) != null ? { lossPercent: numeric(dailyLossPercent) } : {}),
              },
            }
          : {}),
        ...(weeklyHolidayEnabled
          ? {
              weekly: {
                enabled: true,
                ...(numeric(weeklyLosingTrades) != null ? { consecutiveLosingTrades: numeric(weeklyLosingTrades) } : {}),
                ...(numeric(weeklyLossPercent) != null ? { lossPercent: numeric(weeklyLossPercent) } : {}),
              },
            }
          : {}),
        ...(monthlyHolidayEnabled
          ? {
              monthly: {
                enabled: true,
                ...(numeric(monthlyLosingTrades) != null ? { consecutiveLosingTrades: numeric(monthlyLosingTrades) } : {}),
                ...(numeric(monthlyLossPercent) != null ? { lossPercent: numeric(monthlyLossPercent) } : {}),
              },
            }
          : {}),
      },
      executionRules: {
        defineInitialStopBeforeEntry: defineInitialStop,
        honorStopWhenHit: honorStop,
        stopUsesMarketOrSystemRules: systemStops,
        trailingStopsWhenAppropriate: trailingStops,
        doNotMoveStopEmotionally: noEmotionalMove,
        recalculateRiskWhenScalingIn: recalculateScaleIn,
        dailyRecordKeeping: dailyRecords,
      },
      scaleRules: {
        scaleInOnlyToWinningPosition: scaleInWinningOnly,
        prohibitDoublingDown,
        scaleOutMode,
        ...(scaleOutMode === "custom" ? { customScaleOutPercentages: customScale } : {}),
      },
      diversificationRules: {
        enabled: diversificationEnabled,
        ...(diversificationEnabled && numeric(maxTickerConcentration) != null ? { maxTickerConcentrationPercent: numeric(maxTickerConcentration) } : {}),
        ...(diversificationEnabled && numeric(maxSectorRisk) != null ? { maxSectorRiskPercent: numeric(maxSectorRisk) } : {}),
        ...(diversificationEnabled && numeric(concentrationWarning) != null ? { concentrationWarningPercent: numeric(concentrationWarning) } : {}),
        ...(diversificationEnabled && numeric(maxConcurrentOpenPositions) != null ? { maxConcurrentOpenPositions: numeric(maxConcurrentOpenPositions) } : {}),
      },
      riskCapitalPolicy,
      notes: notes.trim() || null,
    }

    try {
      const response = await fetch(`/api/portfolio/${portfolioId}/risk-plan/plans`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const payload = await response.json().catch(() => null) as { error?: string } | null
      if (!response.ok) throw new Error(payload?.error || "Không thể lưu Kế hoạch quản trị vốn.")
      setRiskPerTrade("")
      setMaxActiveRisk("")
      setAdvancedAck(false)
      setNotes("")
      await onSaved()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không thể lưu Kế hoạch quản trị vốn.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="rounded-2xl border border-[#2a2e40] bg-[#0b0f16] p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-ticker text-base font-extrabold text-white">Kế hoạch quản trị vốn</h3>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-400">
            Mỗi lần lưu luôn tạo một phiên bản mới; phiên bản cũ không bị sửa. Các mức 2%, 6%, 10%, sụt giảm 10%/15%, 7 lần dừng lỗ hay 25 giao dịch trong sách là ví dụ/tham chiếu, không được tự điền ngầm.
          </p>
        </div>
        {currentPlan && (
          <span className="rounded-full border border-purple-500/30 bg-purple-500/10 px-3 py-1 text-xs font-bold text-purple-300">
            Hiện tại v{currentPlan.version}
          </span>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 text-xs text-slate-400">
              <RiskTermTooltip label="Risk per Trade" help="Tỷ lệ vốn tài khoản tối đa bạn chủ động cho phép rủi ro trên một giao dịch. 2% trong sách là mức khởi đầu/ví dụ, không phải bảo đảm an toàn tuyệt đối." />
              <NumberField ariaLabel={riskPlanLabelVi("Risk per Trade")} value={riskPerTrade} onChange={setRiskPerTrade} min={0.01} max={100} placeholder="Nhập %" />
            </div>
            <div className="space-y-1.5 text-xs text-slate-400">
              <RiskTermTooltip label="Max Active Risk" help="Giới hạn tổng rủi ro đang hoạt động do bạn cấu hình. Đây là cách sản phẩm vận hành hóa khái niệm maximum active trading account risk." />
              <NumberField ariaLabel={riskPlanLabelVi("Max Active Risk")} value={maxActiveRisk} onChange={setMaxActiveRisk} min={0.01} max={100} placeholder="Nhập %" />
            </div>
          </div>
          {needsAck && (
            <div className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-200">
              <div className="flex items-center gap-2">
                <input type="checkbox" aria-label={riskPlanLabelVi("Advanced Risk Acknowledgement")} checked={advancedAck} onChange={(event) => setAdvancedAck(event.target.checked)} className="h-4 w-4 accent-amber-500" />
                <RiskTermTooltip label="Advanced Risk Acknowledgement" help="Xác nhận bắt buộc của sản phẩm khi bạn chủ động cấu hình rủi ro mỗi giao dịch trên 2%. Hồ sơ rủi ro không tự động cấp quyền tăng rủi ro." />
              </div>
              <p className="mt-2">Mức trên 2% là lựa chọn nâng cao do bạn chủ động thiết lập, không phải khuyến nghị mặc định.</p>
            </div>
          )}
        </div>

        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
          <RiskTermTooltip label="Account Drawdown" help="QeoIndex dùng mức sụt giảm từ đỉnh vốn tài khoản tới hiện tại như định nghĩa vận hành của sản phẩm. Các ngưỡng giảm/tạm dừng bên dưới chỉ có hiệu lực khi bạn bật và lưu." />
          <div className="mt-3 space-y-3">
            <Toggle checked={reduceEnabled} onChange={setReduceEnabled} ariaLabel={riskPlanLabelVi("Reduce Risk at Drawdown")}>
              <RiskTermTooltip label="Reduce Risk at Drawdown" help="Quy tắc cho phép giảm rủi ro mỗi giao dịch khi mức sụt giảm tài khoản chạm ngưỡng bạn tự cấu hình." />
            </Toggle>
            {reduceEnabled && (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <RiskTermTooltip label="Drawdown Reduce Threshold" help="Phần trăm sụt giảm tài khoản kích hoạt việc giảm rủi ro. Ngưỡng chỉ được lưu khi quy tắc này được bật." />
                  <NumberField ariaLabel={riskPlanLabelVi("Drawdown Reduce Threshold")} value={reduceThreshold} onChange={setReduceThreshold} placeholder="Ngưỡng %" min={0.01} max={100} />
                </div>
                <div className="space-y-1.5">
                  <RiskTermTooltip label="Risk Reduction Factor" help="Hệ số nhân áp dụng lên mức rủi ro mỗi giao dịch sau khi chạm ngưỡng sụt giảm; phải lớn hơn 0 và nhỏ hơn 1." />
                  <NumberField ariaLabel={riskPlanLabelVi("Risk Reduction Factor")} value={reductionFactor} onChange={setReductionFactor} placeholder="Hệ số 0–1" min={0.01} max={0.99} step="0.05" />
                </div>
              </div>
            )}
            <Toggle checked={pauseEnabled} onChange={setPauseEnabled} ariaLabel={riskPlanLabelVi("Pause Live Trading at Drawdown")}>
              <RiskTermTooltip label="Pause Live Trading at Drawdown" help="Quy tắc tạm dừng giao dịch thật khi mức sụt giảm chạm ngưỡng do bạn tự cấu hình." />
            </Toggle>
            {pauseEnabled && (
              <div className="space-y-1.5">
                <RiskTermTooltip label="Drawdown Pause Threshold" help="Phần trăm sụt giảm tài khoản kích hoạt tạm dừng. Nếu cùng dùng quy tắc giảm rủi ro, ngưỡng tạm dừng không được thấp hơn ngưỡng giảm." />
                <NumberField ariaLabel={riskPlanLabelVi("Drawdown Pause Threshold")} value={pauseThreshold} onChange={setPauseThreshold} placeholder="Ngưỡng tạm dừng %" min={0.01} max={100} />
              </div>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
          <RiskTermTooltip label="Stop-Out & Holiday Rules" help="Các ngưỡng dừng/nghỉ giao dịch là quy tắc có thể cấu hình. Các con số trong sách là ví dụ, không phải mặc định tự động." />
          <div className="mt-3 space-y-3">
            <Toggle checked={stopOutEnabled} onChange={setStopOutEnabled} ariaLabel={riskPlanLabelVi("Consecutive Stop-Outs")}>
              <RiskTermTooltip label="Consecutive Stop-Outs" help="Số lần dừng lỗ liên tiếp dùng làm ngưỡng để rà soát hoặc tạm nghỉ theo kế hoạch của bạn." />
            </Toggle>
            {stopOutEnabled && (
              <div className="space-y-1.5">
                <RiskTermTooltip label="Stop-Out Threshold" help="Số lần dừng lỗ liên tiếp phải đạt trước khi quy tắc được kích hoạt; phải là số nguyên dương." />
                <NumberField ariaLabel={riskPlanLabelVi("Stop-Out Threshold")} value={stopOutThreshold} onChange={setStopOutThreshold} placeholder="Số lần dừng lỗ" step="1" min={1} />
              </div>
            )}
            <Toggle checked={rollingEnabled} onChange={setRollingEnabled} ariaLabel={riskPlanLabelVi("Rolling Trade Loss Window")}>
              <RiskTermTooltip label="Rolling Trade Loss Window" help="Cửa sổ số giao dịch dùng để đánh giá chuỗi thua theo quy tắc bạn cấu hình; không suy diễn từ từng lần khớp lệnh." />
            </Toggle>
            {rollingEnabled && (
              <div className="space-y-1.5">
                <RiskTermTooltip label="Rolling Trade Count" help="Số giao dịch logic trong cửa sổ theo dõi; phải là số nguyên dương." />
                <NumberField ariaLabel={riskPlanLabelVi("Rolling Trade Count")} value={rollingCount} onChange={setRollingCount} placeholder="Số giao dịch" step="1" min={1} />
              </div>
            )}

            <div className="rounded-lg border border-white/[0.05] bg-black/10 p-3">
              <Toggle checked={dailyHolidayEnabled} onChange={setDailyHolidayEnabled} ariaLabel={riskPlanLabelVi("Daily Trading Holiday")}>
                <RiskTermTooltip label="Daily Trading Holiday" help="Quy tắc tạm nghỉ giao dịch trong ngày khi một ngưỡng do bạn chọn xảy ra. QeoIndex không tự điền ngưỡng từ ví dụ trong sách." />
              </Toggle>
              {dailyHolidayEnabled && (
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <RiskTermTooltip label="Daily Losing Trades" help="Số giao dịch thua trong ngày dùng làm ngưỡng nghỉ; nếu nhập phải là số nguyên dương." />
                    <NumberField ariaLabel={riskPlanLabelVi("Daily Losing Trades")} value={dailyLosingTrades} onChange={setDailyLosingTrades} placeholder="Số giao dịch thua" step="1" min={1} />
                  </div>
                  <div className="space-y-1.5">
                    <RiskTermTooltip label="Daily Loss Percent" help="Mức lỗ phần trăm trong ngày dùng làm ngưỡng nghỉ; đây là tham số do bạn tự cấu hình." />
                    <NumberField ariaLabel={riskPlanLabelVi("Daily Loss Percent")} value={dailyLossPercent} onChange={setDailyLossPercent} placeholder="Mức lỗ %" min={0.01} max={100} />
                  </div>
                </div>
              )}
            </div>

            <div className="rounded-lg border border-white/[0.05] bg-black/10 p-3">
              <Toggle checked={weeklyHolidayEnabled} onChange={setWeeklyHolidayEnabled} ariaLabel={riskPlanLabelVi("Weekly Trading Holiday")}>
                <RiskTermTooltip label="Weekly Trading Holiday" help="Quy tắc nghỉ/rà soát theo tuần. Ngưỡng do bạn tự cấu hình; các ví dụ trong sách không được tự lưu thành mặc định." />
              </Toggle>
              {weeklyHolidayEnabled && (
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <RiskTermTooltip label="Weekly Losing Trades" help="Số giao dịch thua trong tuần dùng làm ngưỡng nghỉ/rà soát; nếu nhập phải là số nguyên dương." />
                    <NumberField ariaLabel={riskPlanLabelVi("Weekly Losing Trades")} value={weeklyLosingTrades} onChange={setWeeklyLosingTrades} placeholder="Số giao dịch thua" step="1" min={1} />
                  </div>
                  <div className="space-y-1.5">
                    <RiskTermTooltip label="Weekly Loss Percent" help="Mức lỗ phần trăm trong tuần dùng làm ngưỡng nghỉ/rà soát do bạn tự cấu hình." />
                    <NumberField ariaLabel={riskPlanLabelVi("Weekly Loss Percent")} value={weeklyLossPercent} onChange={setWeeklyLossPercent} placeholder="Mức lỗ %" min={0.01} max={100} />
                  </div>
                </div>
              )}
            </div>

            <div className="rounded-lg border border-white/[0.05] bg-black/10 p-3">
              <Toggle checked={monthlyHolidayEnabled} onChange={setMonthlyHolidayEnabled} ariaLabel={riskPlanLabelVi("Monthly Trading Holiday")}>
                <RiskTermTooltip label="Monthly Trading Holiday" help="Quy tắc nghỉ/rà soát theo tháng. Ngưỡng là cấu hình người dùng, không phải mức phổ quát do hệ thống áp đặt." />
              </Toggle>
              {monthlyHolidayEnabled && (
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <RiskTermTooltip label="Monthly Losing Trades" help="Số giao dịch thua trong tháng dùng làm ngưỡng nghỉ/rà soát; nếu nhập phải là số nguyên dương." />
                    <NumberField ariaLabel={riskPlanLabelVi("Monthly Losing Trades")} value={monthlyLosingTrades} onChange={setMonthlyLosingTrades} placeholder="Số giao dịch thua" step="1" min={1} />
                  </div>
                  <div className="space-y-1.5">
                    <RiskTermTooltip label="Monthly Loss Percent" help="Mức lỗ phần trăm trong tháng dùng làm ngưỡng nghỉ/rà soát do bạn tự cấu hình." />
                    <NumberField ariaLabel={riskPlanLabelVi("Monthly Loss Percent")} value={monthlyLossPercent} onChange={setMonthlyLossPercent} placeholder="Mức lỗ %" min={0.01} max={100} />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
          <RiskTermTooltip label="Execution Rules" help="Các cam kết thực thi kế hoạch. Bật quy tắc chỉ ghi lại lựa chọn của bạn; QEO-138 chưa tự động thực thi lệnh hoặc suy diễn hành vi." />
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <Toggle checked={defineInitialStop} onChange={setDefineInitialStop} ariaLabel={riskPlanLabelVi("Define Initial Stop-Loss Exit")}>
              <RiskTermTooltip label="Define Initial Stop-Loss Exit" help="Xác định mức dừng lỗ ban đầu trước khi vào lệnh để rủi ro ban đầu có thể được tính trước." />
            </Toggle>
            <Toggle checked={honorStop} onChange={setHonorStop} ariaLabel={riskPlanLabelVi("Honor Stop When Hit")}>
              <RiskTermTooltip label="Honor Stop When Hit" help="Cam kết tuân thủ mức dừng lỗ khi điều kiện đã xảy ra, thay vì thay đổi kế hoạch vì cảm xúc." />
            </Toggle>
            <Toggle checked={systemStops} onChange={setSystemStops} ariaLabel={riskPlanLabelVi("Market/System Stop Rules")}>
              <RiskTermTooltip label="Market/System Stop Rules" help="Mức dừng lỗ được đặt theo quy tắc của hệ thống hoặc cấu trúc thị trường đã định nghĩa, không phải do QeoIndex dự đoán." />
            </Toggle>
            <Toggle checked={trailingStops} onChange={setTrailingStops} ariaLabel={riskPlanLabelVi("Trailing Stops")}>
              <RiskTermTooltip label="Trailing Stops" help="Cho phép cập nhật dừng lỗ kéo theo khi phù hợp với kế hoạch. Dừng lỗ kéo theo có thể giảm rủi ro giao dịch nhưng không loại bỏ rủi ro thị trường." />
            </Toggle>
            <Toggle checked={noEmotionalMove} onChange={setNoEmotionalMove} ariaLabel={riskPlanLabelVi("Emotional Stop Movement")}>
              <RiskTermTooltip label="Emotional Stop Movement" help="Cam kết không nới mức dừng lỗ chỉ vì cảm xúc hoặc hy vọng khi giao dịch đi ngược kế hoạch." />
            </Toggle>
            <Toggle checked={recalculateScaleIn} onChange={setRecalculateScaleIn} ariaLabel={riskPlanLabelVi("Recalculate Risk When Scaling In")}>
              <RiskTermTooltip label="Recalculate Risk When Scaling In" help="Mỗi lần gia tăng vị thế cần tính lại rủi ro trên toàn giao dịch với số lượng và mức dừng lỗ hiện hành." />
            </Toggle>
            <Toggle checked={dailyRecords} onChange={setDailyRecords} ariaLabel={riskPlanLabelVi("Daily Record Keeping")}>
              <RiskTermTooltip label="Daily Record Keeping" help="Ghi chép giao dịch và thay đổi kế hoạch hằng ngày để có bằng chứng rà soát thay vì dựa vào hồi tưởng." />
            </Toggle>
          </div>
        </div>

        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
          <RiskTermTooltip label="Scaling" help="Quy tắc tăng/giảm khối lượng giao dịch. McDowell nhấn mạnh không bình quân giá xuống và chỉ gia tăng vị thế đang có lợi thế." />
          <div className="mt-3 space-y-3">
            <Toggle checked={scaleInWinningOnly} onChange={setScaleInWinningOnly} ariaLabel={riskPlanLabelVi("Scale In Only To Winning Position")}>
              <RiskTermTooltip label="Scale In Only To Winning Position" help="Chỉ thêm vị thế khi giao dịch đang thắng/có lợi nhuận theo kế hoạch, đồng thời phải tính lại tổng rủi ro." />
            </Toggle>
            <Toggle checked={prohibitDoublingDown} onChange={setProhibitDoublingDown} ariaLabel={riskPlanLabelVi("Doubling Down")}>
              <RiskTermTooltip label="Doubling Down" help="Không tăng quy mô chỉ để bình quân giá xuống một giao dịch đang thua. Đây là quy tắc kỷ luật quan trọng trong nguồn." />
            </Toggle>
            <div className="space-y-1.5">
              <RiskTermTooltip label="Scale-Out Mode" help="Cách chia phần thoát vị thế. Chia ba phần và 30/30/40 là ví dụ có thể chọn, không phải tỷ lệ bắt buộc." />
              <select aria-label={riskPlanLabelVi("Scale-Out Mode")} value={scaleOutMode} onChange={(event) => setScaleOutMode(event.target.value as typeof scaleOutMode)} className="h-9 w-full rounded-lg border border-[#34394d] bg-[#10151e] px-3 text-sm text-slate-100">
                <option value="none">Không có quy tắc giảm vị thế</option>
                <option value="thirds">Chia ba phần</option>
                <option value="30_30_40">30 / 30 / 40</option>
                <option value="signal_driven">Theo tín hiệu</option>
                <option value="custom">Tùy chỉnh</option>
              </select>
            </div>
            {scaleOutMode === "custom" && (
              <div className="space-y-1.5">
                <RiskTermTooltip label="Custom Scale-Out Percentages" help="Danh sách phần trăm giảm vị thế do bạn nhập; các phần phải dương và cộng lại đúng 100%." />
                <input aria-label={riskPlanLabelVi("Custom Scale-Out Percentages")} value={customScaleOut} onChange={(event) => setCustomScaleOut(event.target.value)} placeholder="Ví dụ: 25,25,50" className="h-9 w-full rounded-lg border border-[#34394d] bg-[#10151e] px-3 text-sm text-slate-100 outline-none" />
              </div>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
          <RiskTermTooltip label="Diversification & Risk Capital" help="Phần mở rộng của sản phẩm để ghi lại giới hạn tập trung và chính sách vốn chịu rủi ro; các giá trị chỉ tồn tại khi bạn chủ động cấu hình." />
          <div className="mt-3 space-y-3">
            <Toggle checked={diversificationEnabled} onChange={setDiversificationEnabled} ariaLabel={riskPlanLabelVi("Diversification Limits")}>
              <RiskTermTooltip label="Diversification Limits" help="Bật giới hạn phân tán/tập trung do bạn tự định nghĩa. Ví dụ ngành trong sách không phải giới hạn mặc định." />
            </Toggle>
            {diversificationEnabled && (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <RiskTermTooltip label="Max Ticker Concentration" help="Giới hạn cứng tùy chọn cho tỷ trọng giá trị thị trường của một mã trên Account Equity hiện tại. Chỉ có hiệu lực khi bạn nhập; QeoIndex không áp một ngưỡng phổ quát." />
                  <NumberField ariaLabel={riskPlanLabelVi("Max Ticker Concentration")} value={maxTickerConcentration} onChange={setMaxTickerConcentration} placeholder="Tỷ trọng mỗi mã tối đa %" min={0.01} max={100} />
                </div>
                <div className="space-y-1.5">
                  <RiskTermTooltip label="Max Sector Risk" help="Giới hạn cứng tùy chọn cho Active Risk của một ngành trên Account Equity hiện tại. Đây là cấu hình của bạn, không phải công thức phổ quát." />
                  <NumberField ariaLabel={riskPlanLabelVi("Max Sector Risk")} value={maxSectorRisk} onChange={setMaxSectorRisk} placeholder="Rủi ro ngành tối đa %" min={0.01} max={100} />
                </div>
                <div className="space-y-1.5">
                  <RiskTermTooltip label="Concentration Warning" help="Ngưỡng tỷ trọng giá trị thị trường dùng cho cảnh báo tư vấn theo mã. Đây chỉ là cảnh báo; nó không tự trở thành một giới hạn vi phạm cứng." />
                  <NumberField ariaLabel={riskPlanLabelVi("Concentration Warning")} value={concentrationWarning} onChange={setConcentrationWarning} placeholder="Mức cảnh báo tập trung %" min={0.01} max={100} />
                </div>
                <div className="space-y-1.5">
                  <RiskTermTooltip label="Max Concurrent Open Positions" help="Giới hạn cứng tùy chọn cho số mã có vị thế mở đồng thời. Không có giá trị mặc định ẩn; nhiều Trade cùng một mã vẫn được hiểu là một vị thế theo quy tắc này." />
                  <NumberField ariaLabel={riskPlanLabelVi("Max Concurrent Open Positions")} value={maxConcurrentOpenPositions} onChange={setMaxConcurrentOpenPositions} placeholder="Số vị thế tối đa" step="1" min={1} />
                </div>
              </div>
            )}
            <div className="space-y-1.5">
              <RiskTermTooltip label="Risk Capital Policy" help="Chính sách tùy chọn giới hạn vốn bạn chấp nhận dành cho giao dịch. Có thể tắt, dùng số tiền vốn chịu rủi ro hoặc tỷ lệ tài sản ròng." />
              <select aria-label={riskPlanLabelVi("Risk Capital Policy")} value={riskCapitalMode} onChange={(event) => setRiskCapitalMode(event.target.value as typeof riskCapitalMode)} className="h-9 w-full rounded-lg border border-[#34394d] bg-[#10151e] px-3 text-sm text-slate-100">
                <option value="disabled">Tắt chính sách vốn chịu rủi ro</option>
                <option value="risk_capital_amount">Số tiền vốn chịu rủi ro</option>
                <option value="net_worth_percent">Tỷ lệ tài sản ròng</option>
              </select>
            </div>
            {riskCapitalMode !== "disabled" && (
              <div className="space-y-1.5">
                <RiskTermTooltip label="Risk Capital Value" help="Giá trị tương ứng với chính sách đã chọn: số tiền vốn chịu rủi ro hoặc phần trăm tài sản ròng. Đây là giá trị bạn tự khai." />
                <NumberField ariaLabel={riskPlanLabelVi("Risk Capital Value")} value={riskCapitalValue} onChange={setRiskCapitalValue} placeholder={riskCapitalMode === "risk_capital_amount" ? "Số tiền" : "% tài sản ròng"} min={0.01} />
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="mt-4 space-y-1.5">
        <RiskTermTooltip label="Plan Notes" help="Ghi chú tự do cho phiên bản Kế hoạch quản trị vốn này. Ghi chú là dữ liệu người dùng nhập, không phải dữ kiện từ sách hay suy luận AI." />
        <textarea aria-label={riskPlanLabelVi("Plan Notes")} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Ghi chú kế hoạch (không bắt buộc)" className="min-h-20 w-full rounded-xl border border-[#34394d] bg-[#10151e] p-3 text-sm text-slate-100 outline-none focus:border-purple-500" />
      </div>

      {currentPlan && (
        <p className="mt-2 text-xs text-slate-500">
          v{currentPlan.version}: Rủi ro mỗi giao dịch {currentPlan.default_trade_risk_percent}% · Rủi ro đang hoạt động tối đa {currentPlan.max_active_risk_percent}% · lưu ngày {currentPlan.created_at.slice(0, 10)}
        </p>
      )}
      {error && <p className="mt-3 text-xs font-semibold text-red-300">{error}</p>}
      <div className="mt-4 flex justify-end">
        <Button type="button" size="sm" disabled={!canSave || saving} onClick={() => void submit()}>
          {saving ? "Đang lưu…" : "Lưu Kế hoạch quản trị vốn"}
        </Button>
      </div>
    </section>
  )
}
