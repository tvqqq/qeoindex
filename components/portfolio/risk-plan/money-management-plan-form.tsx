"use client"

import { useMemo, useState } from "react"

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
  label,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-300">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 accent-purple-500"
      />
      {label}
    </label>
  )
}

function NumberField({
  value,
  onChange,
  placeholder,
  min,
  max,
  step = "0.1",
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  min?: number
  max?: number
  step?: string
}) {
  return (
    <input
      type="number"
      inputMode="decimal"
      value={value}
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
      holidayRules: dailyHolidayEnabled
        ? {
            daily: {
              enabled: true,
              ...(numeric(dailyLosingTrades) != null ? { consecutiveLosingTrades: numeric(dailyLosingTrades) } : {}),
              ...(numeric(dailyLossPercent) != null ? { lossPercent: numeric(dailyLossPercent) } : {}),
            },
          }
        : {},
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
            <label className="space-y-1.5 text-xs text-slate-400">
              <RiskTermTooltip label="Risk per Trade" help="Tỷ lệ Account Equity tối đa bạn chủ động cho phép rủi ro trên một Trade. 2% trong sách là mức khởi đầu/example, không phải bảo đảm an toàn tuyệt đối." />
              <NumberField value={riskPerTrade} onChange={setRiskPerTrade} min={0.01} max={100} placeholder="Nhập %" />
            </label>
            <label className="space-y-1.5 text-xs text-slate-400">
              <RiskTermTooltip label="Max Active Risk" help="Giới hạn tổng rủi ro đang hoạt động do bạn cấu hình. Đây là product implementation của khái niệm maximum active trading account risk." />
              <NumberField value={maxActiveRisk} onChange={setMaxActiveRisk} min={0.01} max={100} placeholder="Nhập %" />
            </label>
          </div>
          {needsAck && (
            <label className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-200">
              <input type="checkbox" checked={advancedAck} onChange={(event) => setAdvancedAck(event.target.checked)} className="mt-0.5 h-4 w-4 accent-amber-500" />
              Tôi xác nhận Risk per Trade trên 2% là lựa chọn nâng cao do tôi chủ động thiết lập; Risk Profile không tự động cho phép mức này.
            </label>
          )}
        </div>

        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
          <RiskTermTooltip label="Account Drawdown" help="QeoIndex dùng peak-to-current equity drawdown như product operationalization. Các ngưỡng giảm/pause bên dưới chỉ có hiệu lực khi bạn bật và Save." />
          <div className="mt-3 space-y-3">
            <Toggle checked={reduceEnabled} onChange={setReduceEnabled} label="Reduce risk at drawdown threshold" />
            {reduceEnabled && (
              <div className="grid grid-cols-2 gap-2">
                <NumberField value={reduceThreshold} onChange={setReduceThreshold} placeholder="Threshold %" />
                <NumberField value={reductionFactor} onChange={setReductionFactor} placeholder="Factor 0–1" step="0.05" />
              </div>
            )}
            <Toggle checked={pauseEnabled} onChange={setPauseEnabled} label="Pause live trading at drawdown threshold" />
            {pauseEnabled && <NumberField value={pauseThreshold} onChange={setPauseThreshold} placeholder="Pause threshold %" />}
          </div>
        </div>

        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
          <h4 className="font-ticker text-sm font-bold text-slate-100">Stop-Out & Holiday Rules</h4>
          <div className="mt-3 space-y-3">
            <Toggle checked={stopOutEnabled} onChange={setStopOutEnabled} label="Consecutive stop-outs trigger" />
            {stopOutEnabled && <NumberField value={stopOutThreshold} onChange={setStopOutThreshold} placeholder="Stop-out count" step="1" />}
            <Toggle checked={rollingEnabled} onChange={setRollingEnabled} label="Rolling losing-Trade window" />
            {rollingEnabled && <NumberField value={rollingCount} onChange={setRollingCount} placeholder="Trade count" step="1" />}
            <Toggle checked={dailyHolidayEnabled} onChange={setDailyHolidayEnabled} label="Daily trading holiday rule" />
            {dailyHolidayEnabled && (
              <div className="grid grid-cols-2 gap-2">
                <NumberField value={dailyLosingTrades} onChange={setDailyLosingTrades} placeholder="Losing Trades" step="1" />
                <NumberField value={dailyLossPercent} onChange={setDailyLossPercent} placeholder="Loss %" />
              </div>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
          <h4 className="font-ticker text-sm font-bold text-slate-100">Execution Rules</h4>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <Toggle checked={defineInitialStop} onChange={setDefineInitialStop} label="Define Initial Stop-Loss Exit before entry" />
            <Toggle checked={honorStop} onChange={setHonorStop} label="Honor stop when hit" />
            <Toggle checked={systemStops} onChange={setSystemStops} label="Use market/system stop rules" />
            <Toggle checked={trailingStops} onChange={setTrailingStops} label="Use trailing stops when appropriate" />
            <Toggle checked={noEmotionalMove} onChange={setNoEmotionalMove} label="Do not move stop emotionally" />
            <Toggle checked={recalculateScaleIn} onChange={setRecalculateScaleIn} label="Recalculate risk when scaling in" />
            <Toggle checked={dailyRecords} onChange={setDailyRecords} label="Daily record keeping" />
          </div>
        </div>

        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
          <h4 className="font-ticker text-sm font-bold text-slate-100">Scaling</h4>
          <div className="mt-3 space-y-3">
            <Toggle checked={scaleInWinningOnly} onChange={setScaleInWinningOnly} label="Scale in only to a winning position" />
            <Toggle checked={prohibitDoublingDown} onChange={setProhibitDoublingDown} label="Prohibit doubling down" />
            <select value={scaleOutMode} onChange={(event) => setScaleOutMode(event.target.value as typeof scaleOutMode)} className="h-9 w-full rounded-lg border border-[#34394d] bg-[#10151e] px-3 text-sm text-slate-100">
              <option value="none">No scale-out rule</option>
              <option value="thirds">Thirds</option>
              <option value="30_30_40">30 / 30 / 40</option>
              <option value="signal_driven">Signal driven</option>
              <option value="custom">Custom</option>
            </select>
            {scaleOutMode === "custom" && (
              <input value={customScaleOut} onChange={(event) => setCustomScaleOut(event.target.value)} placeholder="Ví dụ: 25,25,50" className="h-9 w-full rounded-lg border border-[#34394d] bg-[#10151e] px-3 text-sm text-slate-100 outline-none" />
            )}
          </div>
        </div>

        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
          <h4 className="font-ticker text-sm font-bold text-slate-100">Diversification & Risk Capital</h4>
          <div className="mt-3 space-y-3">
            <Toggle checked={diversificationEnabled} onChange={setDiversificationEnabled} label="Enable diversification limits" />
            {diversificationEnabled && (
              <div className="grid grid-cols-2 gap-2">
                <NumberField value={maxSectorRisk} onChange={setMaxSectorRisk} placeholder="Max sector risk %" />
                <NumberField value={concentrationWarning} onChange={setConcentrationWarning} placeholder="Concentration %" />
              </div>
            )}
            <select value={riskCapitalMode} onChange={(event) => setRiskCapitalMode(event.target.value as typeof riskCapitalMode)} className="h-9 w-full rounded-lg border border-[#34394d] bg-[#10151e] px-3 text-sm text-slate-100">
              <option value="disabled">Risk capital policy: disabled</option>
              <option value="risk_capital_amount">Risk capital amount</option>
              <option value="net_worth_percent">Net-worth percent</option>
            </select>
            {riskCapitalMode !== "disabled" && <NumberField value={riskCapitalValue} onChange={setRiskCapitalValue} placeholder={riskCapitalMode === "risk_capital_amount" ? "Amount" : "% of net worth"} />}
          </div>
        </div>
      </div>

      <textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Plan notes (optional)" className="mt-4 min-h-20 w-full rounded-xl border border-[#34394d] bg-[#10151e] p-3 text-sm text-slate-100 outline-none focus:border-purple-500" />

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
