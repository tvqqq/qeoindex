"use client"

import { useMemo, useState, type ReactNode } from "react"

import { Button } from "@/components/ui/button"
import { RiskTermTooltip } from "./risk-term-tooltip"

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
  const [maxSectorRisk, setMaxSectorRisk] = useState("")
  const [concentrationWarning, setConcentrationWarning] = useState("")

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
        ...(diversificationEnabled && numeric(maxSectorRisk) != null ? { maxSectorRiskPercent: numeric(maxSectorRisk) } : {}),
        ...(diversificationEnabled && numeric(concentrationWarning) != null ? { concentrationWarningPercent: numeric(concentrationWarning) } : {}),
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
      if (!response.ok) throw new Error(payload?.error || "Không thể lưu Money Management Plan.")
      setRiskPerTrade("")
      setMaxActiveRisk("")
      setAdvancedAck(false)
      setNotes("")
      await onSaved()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không thể lưu Money Management Plan.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="rounded-2xl border border-[#2a2e40] bg-[#0b0f16] p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-ticker text-base font-extrabold text-white">Money Management Plan</h3>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-400">
            Save luôn tạo một version mới; version cũ không bị sửa. Các mức 2%, 6%, 10%, drawdown 10%/15%, 7 stop-outs hay 25 Trades trong sách là examples/presets, không được tự điền ngầm.
          </p>
        </div>
        {currentPlan && (
          <span className="rounded-full border border-purple-500/30 bg-purple-500/10 px-3 py-1 text-xs font-bold text-purple-300">
            Current v{currentPlan.version}
          </span>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 text-xs text-slate-400">
              <RiskTermTooltip label="Risk per Trade" help="Tỷ lệ Account Equity tối đa bạn chủ động cho phép rủi ro trên một Trade. 2% trong sách là mức khởi đầu/example, không phải bảo đảm an toàn tuyệt đối." />
              <NumberField ariaLabel="Risk per Trade" value={riskPerTrade} onChange={setRiskPerTrade} min={0.01} max={100} placeholder="Nhập %" />
            </div>
            <div className="space-y-1.5 text-xs text-slate-400">
              <RiskTermTooltip label="Max Active Risk" help="Giới hạn tổng rủi ro đang hoạt động do bạn cấu hình. Đây là product implementation của khái niệm maximum active trading account risk." />
              <NumberField ariaLabel="Max Active Risk" value={maxActiveRisk} onChange={setMaxActiveRisk} min={0.01} max={100} placeholder="Nhập %" />
            </div>
          </div>
          {needsAck && (
            <div className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-200">
              <div className="flex items-center gap-2">
                <input type="checkbox" aria-label="Advanced Risk Acknowledgement" checked={advancedAck} onChange={(event) => setAdvancedAck(event.target.checked)} className="h-4 w-4 accent-amber-500" />
                <RiskTermTooltip label="Advanced Risk Acknowledgement" help="Xác nhận bắt buộc của sản phẩm khi bạn chủ động cấu hình Risk per Trade trên 2%. Risk Profile không tự động cấp quyền tăng rủi ro." />
              </div>
              <p className="mt-2">Mức trên 2% là lựa chọn nâng cao do bạn chủ động thiết lập, không phải khuyến nghị mặc định.</p>
            </div>
          )}
        </div>

        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
          <RiskTermTooltip label="Account Drawdown" help="QeoIndex dùng peak-to-current equity drawdown như product operationalization. Các ngưỡng giảm/pause bên dưới chỉ có hiệu lực khi bạn bật và Save." />
          <div className="mt-3 space-y-3">
            <Toggle checked={reduceEnabled} onChange={setReduceEnabled} ariaLabel="Reduce Risk at Drawdown">
              <RiskTermTooltip label="Reduce Risk at Drawdown" help="Quy tắc product cho phép giảm Risk per Trade khi Account Drawdown chạm ngưỡng bạn tự cấu hình." />
            </Toggle>
            {reduceEnabled && (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <RiskTermTooltip label="Drawdown Reduce Threshold" help="Phần trăm Account Drawdown kích hoạt việc giảm rủi ro. Ngưỡng chỉ được lưu khi rule này được bật." />
                  <NumberField ariaLabel="Drawdown Reduce Threshold" value={reduceThreshold} onChange={setReduceThreshold} placeholder="Threshold %" min={0.01} max={100} />
                </div>
                <div className="space-y-1.5">
                  <RiskTermTooltip label="Risk Reduction Factor" help="Hệ số nhân áp dụng lên mức Risk per Trade sau khi chạm ngưỡng drawdown; phải lớn hơn 0 và nhỏ hơn 1." />
                  <NumberField ariaLabel="Risk Reduction Factor" value={reductionFactor} onChange={setReductionFactor} placeholder="Factor 0–1" min={0.01} max={0.99} step="0.05" />
                </div>
              </div>
            )}
            <Toggle checked={pauseEnabled} onChange={setPauseEnabled} ariaLabel="Pause Live Trading at Drawdown">
              <RiskTermTooltip label="Pause Live Trading at Drawdown" help="Quy tắc product để tạm dừng live trading khi drawdown chạm ngưỡng do bạn tự cấu hình." />
            </Toggle>
            {pauseEnabled && (
              <div className="space-y-1.5">
                <RiskTermTooltip label="Drawdown Pause Threshold" help="Phần trăm Account Drawdown kích hoạt pause. Nếu cùng dùng reduce-risk rule, ngưỡng pause không được thấp hơn ngưỡng reduce." />
                <NumberField ariaLabel="Drawdown Pause Threshold" value={pauseThreshold} onChange={setPauseThreshold} placeholder="Pause threshold %" min={0.01} max={100} />
              </div>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
          <RiskTermTooltip label="Stop-Out & Holiday Rules" help="Các trigger dừng/nghỉ giao dịch là rule có thể cấu hình. Các con số trong sách là examples, không phải mặc định tự động." />
          <div className="mt-3 space-y-3">
            <Toggle checked={stopOutEnabled} onChange={setStopOutEnabled} ariaLabel="Consecutive Stop-Outs">
              <RiskTermTooltip label="Consecutive Stop-Outs" help="Số lần stop-out liên tiếp dùng làm trigger để review hoặc tạm nghỉ theo plan của bạn." />
            </Toggle>
            {stopOutEnabled && (
              <div className="space-y-1.5">
                <RiskTermTooltip label="Stop-Out Threshold" help="Số stop-out liên tiếp phải đạt trước khi rule được kích hoạt; phải là số nguyên dương." />
                <NumberField ariaLabel="Stop-Out Threshold" value={stopOutThreshold} onChange={setStopOutThreshold} placeholder="Stop-out count" step="1" min={1} />
              </div>
            )}
            <Toggle checked={rollingEnabled} onChange={setRollingEnabled} ariaLabel="Rolling Trade Loss Window">
              <RiskTermTooltip label="Rolling Trade Loss Window" help="Cửa sổ số Trade dùng để đánh giá chuỗi thua theo rule do bạn cấu hình; không phải thống kê được tự suy diễn từ Fill." />
            </Toggle>
            {rollingEnabled && (
              <div className="space-y-1.5">
                <RiskTermTooltip label="Rolling Trade Count" help="Số logical Trade trong cửa sổ rolling; phải là số nguyên dương." />
                <NumberField ariaLabel="Rolling Trade Count" value={rollingCount} onChange={setRollingCount} placeholder="Trade count" step="1" min={1} />
              </div>
            )}

            <div className="rounded-lg border border-white/[0.05] bg-black/10 p-3">
              <Toggle checked={dailyHolidayEnabled} onChange={setDailyHolidayEnabled} ariaLabel="Daily Trading Holiday">
                <RiskTermTooltip label="Daily Trading Holiday" help="Rule tạm nghỉ giao dịch trong ngày khi một trigger do bạn chọn xảy ra. QeoIndex không tự điền ngưỡng từ ví dụ trong sách." />
              </Toggle>
              {dailyHolidayEnabled && (
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <RiskTermTooltip label="Daily Losing Trades" help="Số Trade thua trong ngày dùng làm trigger nghỉ; nếu nhập phải là số nguyên dương." />
                    <NumberField ariaLabel="Daily Losing Trades" value={dailyLosingTrades} onChange={setDailyLosingTrades} placeholder="Losing Trades" step="1" min={1} />
                  </div>
                  <div className="space-y-1.5">
                    <RiskTermTooltip label="Daily Loss Percent" help="Mức lỗ phần trăm trong ngày dùng làm trigger nghỉ; đây là tham số do bạn tự cấu hình." />
                    <NumberField ariaLabel="Daily Loss Percent" value={dailyLossPercent} onChange={setDailyLossPercent} placeholder="Loss %" min={0.01} max={100} />
                  </div>
                </div>
              )}
            </div>

            <div className="rounded-lg border border-white/[0.05] bg-black/10 p-3">
              <Toggle checked={weeklyHolidayEnabled} onChange={setWeeklyHolidayEnabled} ariaLabel="Weekly Trading Holiday">
                <RiskTermTooltip label="Weekly Trading Holiday" help="Rule nghỉ/review cho phạm vi một tuần. Trigger được bạn tự cấu hình; các ví dụ trong sách không được tự lưu thành mặc định." />
              </Toggle>
              {weeklyHolidayEnabled && (
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <RiskTermTooltip label="Weekly Losing Trades" help="Số Trade thua trong tuần dùng làm trigger nghỉ/review; nếu nhập phải là số nguyên dương." />
                    <NumberField ariaLabel="Weekly Losing Trades" value={weeklyLosingTrades} onChange={setWeeklyLosingTrades} placeholder="Losing Trades" step="1" min={1} />
                  </div>
                  <div className="space-y-1.5">
                    <RiskTermTooltip label="Weekly Loss Percent" help="Mức lỗ phần trăm trong tuần dùng làm trigger nghỉ/review do bạn tự cấu hình." />
                    <NumberField ariaLabel="Weekly Loss Percent" value={weeklyLossPercent} onChange={setWeeklyLossPercent} placeholder="Loss %" min={0.01} max={100} />
                  </div>
                </div>
              )}
            </div>

            <div className="rounded-lg border border-white/[0.05] bg-black/10 p-3">
              <Toggle checked={monthlyHolidayEnabled} onChange={setMonthlyHolidayEnabled} ariaLabel="Monthly Trading Holiday">
                <RiskTermTooltip label="Monthly Trading Holiday" help="Rule nghỉ/review cho phạm vi một tháng. Trigger là cấu hình người dùng, không phải mức universal do hệ thống áp đặt." />
              </Toggle>
              {monthlyHolidayEnabled && (
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <RiskTermTooltip label="Monthly Losing Trades" help="Số Trade thua trong tháng dùng làm trigger nghỉ/review; nếu nhập phải là số nguyên dương." />
                    <NumberField ariaLabel="Monthly Losing Trades" value={monthlyLosingTrades} onChange={setMonthlyLosingTrades} placeholder="Losing Trades" step="1" min={1} />
                  </div>
                  <div className="space-y-1.5">
                    <RiskTermTooltip label="Monthly Loss Percent" help="Mức lỗ phần trăm trong tháng dùng làm trigger nghỉ/review do bạn tự cấu hình." />
                    <NumberField ariaLabel="Monthly Loss Percent" value={monthlyLossPercent} onChange={setMonthlyLossPercent} placeholder="Loss %" min={0.01} max={100} />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
          <RiskTermTooltip label="Execution Rules" help="Các cam kết thực thi plan. Bật rule chỉ ghi lại quy tắc bạn chọn; QEO-138 chưa tự động thực thi lệnh hoặc suy diễn hành vi." />
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <Toggle checked={defineInitialStop} onChange={setDefineInitialStop} ariaLabel="Define Initial Stop-Loss Exit">
              <RiskTermTooltip label="Define Initial Stop-Loss Exit" help="Xác định Initial Stop-Loss Exit trước khi vào lệnh để rủi ro ban đầu có thể được tính trước." />
            </Toggle>
            <Toggle checked={honorStop} onChange={setHonorStop} ariaLabel="Honor Stop When Hit">
              <RiskTermTooltip label="Honor Stop When Hit" help="Cam kết tuân thủ stop khi điều kiện stop đã xảy ra, thay vì thay đổi plan vì cảm xúc." />
            </Toggle>
            <Toggle checked={systemStops} onChange={setSystemStops} ariaLabel="Market/System Stop Rules">
              <RiskTermTooltip label="Market/System Stop Rules" help="Stop được đặt theo quy tắc của hệ thống hoặc cấu trúc thị trường đã định nghĩa, không phải do QeoIndex dự đoán." />
            </Toggle>
            <Toggle checked={trailingStops} onChange={setTrailingStops} ariaLabel="Trailing Stops">
              <RiskTermTooltip label="Trailing Stops" help="Cho phép cập nhật trailing stop khi phù hợp với plan. Trailing stop có thể giảm Trade Risk nhưng không loại bỏ Market Risk." />
            </Toggle>
            <Toggle checked={noEmotionalMove} onChange={setNoEmotionalMove} ariaLabel="Emotional Stop Movement">
              <RiskTermTooltip label="Emotional Stop Movement" help="Cam kết không nới stop chỉ vì cảm xúc hoặc hy vọng khi Trade đi ngược kế hoạch." />
            </Toggle>
            <Toggle checked={recalculateScaleIn} onChange={setRecalculateScaleIn} ariaLabel="Recalculate Risk When Scaling In">
              <RiskTermTooltip label="Recalculate Risk When Scaling In" help="Mỗi lần scale in cần tính lại rủi ro trên toàn Trade với quantity và stop hiện hành." />
            </Toggle>
            <Toggle checked={dailyRecords} onChange={setDailyRecords} ariaLabel="Daily Record Keeping">
              <RiskTermTooltip label="Daily Record Keeping" help="Ghi chép giao dịch và thay đổi plan hằng ngày để có bằng chứng review thay vì dựa vào hồi tưởng." />
            </Toggle>
          </div>
        </div>

        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
          <RiskTermTooltip label="Scaling" help="Quy tắc tăng/giảm Trade Size. McDowell nhấn mạnh không double down và chỉ scale in vào vị thế đang có lợi thế." />
          <div className="mt-3 space-y-3">
            <Toggle checked={scaleInWinningOnly} onChange={setScaleInWinningOnly} ariaLabel="Scale In Only To Winning Position">
              <RiskTermTooltip label="Scale In Only To Winning Position" help="Chỉ thêm vị thế khi Trade đang thắng/có lợi nhuận theo plan, đồng thời phải tính lại tổng rủi ro." />
            </Toggle>
            <Toggle checked={prohibitDoublingDown} onChange={setProhibitDoublingDown} ariaLabel="Doubling Down">
              <RiskTermTooltip label="Doubling Down" help="Không tăng quy mô chỉ để bình quân giá xuống một Trade đang thua. Đây là rule kỷ luật quan trọng trong nguồn." />
            </Toggle>
            <div className="space-y-1.5">
              <RiskTermTooltip label="Scale-Out Mode" help="Cách chia phần thoát vị thế. Thirds và 30/30/40 là ví dụ có thể chọn, không phải tỷ lệ bắt buộc." />
              <select aria-label="Scale-Out Mode" value={scaleOutMode} onChange={(event) => setScaleOutMode(event.target.value as typeof scaleOutMode)} className="h-9 w-full rounded-lg border border-[#34394d] bg-[#10151e] px-3 text-sm text-slate-100">
                <option value="none">No scale-out rule</option>
                <option value="thirds">Thirds</option>
                <option value="30_30_40">30 / 30 / 40</option>
                <option value="signal_driven">Signal driven</option>
                <option value="custom">Custom</option>
              </select>
            </div>
            {scaleOutMode === "custom" && (
              <div className="space-y-1.5">
                <RiskTermTooltip label="Custom Scale-Out Percentages" help="Danh sách phần trăm scale-out do bạn nhập; các phần phải dương và cộng lại đúng 100%." />
                <input aria-label="Custom Scale-Out Percentages" value={customScaleOut} onChange={(event) => setCustomScaleOut(event.target.value)} placeholder="Ví dụ: 25,25,50" className="h-9 w-full rounded-lg border border-[#34394d] bg-[#10151e] px-3 text-sm text-slate-100 outline-none" />
              </div>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
          <RiskTermTooltip label="Diversification & Risk Capital" help="Product extension để ghi lại giới hạn concentration và chính sách vốn chịu rủi ro; các giá trị chỉ tồn tại khi bạn chủ động cấu hình." />
          <div className="mt-3 space-y-3">
            <Toggle checked={diversificationEnabled} onChange={setDiversificationEnabled} ariaLabel="Diversification Limits">
              <RiskTermTooltip label="Diversification Limits" help="Bật giới hạn phân tán/concentration do bạn tự định nghĩa. Ví dụ sector trong sách không phải giới hạn mặc định." />
            </Toggle>
            {diversificationEnabled && (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <RiskTermTooltip label="Max Sector Risk" help="Giới hạn rủi ro tối đa cho một sector do bạn cấu hình; đây là product field, không phải công thức phổ quát trong sách." />
                  <NumberField ariaLabel="Max Sector Risk" value={maxSectorRisk} onChange={setMaxSectorRisk} placeholder="Max sector risk %" min={0.01} max={100} />
                </div>
                <div className="space-y-1.5">
                  <RiskTermTooltip label="Concentration Warning" help="Ngưỡng phần trăm concentration dùng để cảnh báo ở các feature sau; QEO-138 chỉ lưu cấu hình." />
                  <NumberField ariaLabel="Concentration Warning" value={concentrationWarning} onChange={setConcentrationWarning} placeholder="Concentration %" min={0.01} max={100} />
                </div>
              </div>
            )}
            <div className="space-y-1.5">
              <RiskTermTooltip label="Risk Capital Policy" help="Chính sách tùy chọn giới hạn vốn bạn chấp nhận dành cho trading. Có thể tắt, dùng số tiền Risk Capital, hoặc tỷ lệ Net Worth." />
              <select aria-label="Risk Capital Policy" value={riskCapitalMode} onChange={(event) => setRiskCapitalMode(event.target.value as typeof riskCapitalMode)} className="h-9 w-full rounded-lg border border-[#34394d] bg-[#10151e] px-3 text-sm text-slate-100">
                <option value="disabled">Risk capital policy: disabled</option>
                <option value="risk_capital_amount">Risk capital amount</option>
                <option value="net_worth_percent">Net-worth percent</option>
              </select>
            </div>
            {riskCapitalMode !== "disabled" && (
              <div className="space-y-1.5">
                <RiskTermTooltip label="Risk Capital Value" help="Giá trị tương ứng với policy đã chọn: số tiền Risk Capital hoặc phần trăm Net Worth. Đây là giá trị bạn tự khai." />
                <NumberField ariaLabel="Risk Capital Value" value={riskCapitalValue} onChange={setRiskCapitalValue} placeholder={riskCapitalMode === "risk_capital_amount" ? "Amount" : "% of net worth"} min={0.01} />
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="mt-4 space-y-1.5">
        <RiskTermTooltip label="Plan Notes" help="Ghi chú tự do cho version Money Management Plan này. Notes là dữ liệu người dùng nhập, không phải book fact hay AI inference." />
        <textarea aria-label="Plan Notes" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Plan notes (optional)" className="min-h-20 w-full rounded-xl border border-[#34394d] bg-[#10151e] p-3 text-sm text-slate-100 outline-none focus:border-purple-500" />
      </div>

      {currentPlan && (
        <p className="mt-2 text-xs text-slate-500">
          v{currentPlan.version}: Risk per Trade {currentPlan.default_trade_risk_percent}% · Max Active Risk {currentPlan.max_active_risk_percent}% · saved {currentPlan.created_at.slice(0, 10)}
        </p>
      )}
      {error && <p className="mt-3 text-xs font-semibold text-red-300">{error}</p>}
      <div className="mt-4 flex justify-end">
        <Button type="button" size="sm" disabled={!canSave || saving} onClick={() => void submit()}>
          {saving ? "Đang lưu…" : "Save Money Management Plan"}
        </Button>
      </div>
    </section>
  )
}
