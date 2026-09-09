"use client"

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { Calculator, Pencil, Trash2 } from "lucide-react"

import { ProjectedConcentrationPanel } from "@/components/portfolio/concentration/projected-concentration-panel"
import { Input } from "@/components/ui/input"
import { projectTradeConcentration } from "@/modules/portfolio/concentration/project-trade"
import {
  calculateTradeSize,
  DEFAULT_REGULAR_LOT_SHARES,
} from "@/modules/portfolio/risk-sizing/calculator"
import { calculateOptimalF } from "@/modules/portfolio/risk-sizing/optimal-f"
import type {
  AccountEquityContext,
  PlannedTrade,
  TradeSizeStatus,
} from "@/modules/portfolio/risk-sizing/types"
import { cn } from "@/modules/shared/ui/cn"
import { RiskMetricTooltip } from "./risk-metric-tooltip"
import type { RiskSizingClientContext } from "./use-risk-sizing-context"

type RiskProvenance = "Money Management Plan" | "Onboarding default" | "Manual override" | "Planned Trade"
type RiskTerm = Parameters<typeof RiskMetricTooltip>[0]["term"]
type TradeModeSelection = "" | "live" | "paper"

export function TradeSizeAdvisor({
  portfolioId,
  accountEquityContext,
  riskContext,
  loadingRiskContext,
  riskContextError,
  plannedTrades,
  onUpsertPlannedTrade,
  onRemovePlannedTrade,
}: {
  portfolioId: string
  accountEquityContext: AccountEquityContext
  riskContext: RiskSizingClientContext | null
  loadingRiskContext: boolean
  riskContextError: string | null
  plannedTrades: PlannedTrade[]
  onUpsertPlannedTrade: (trade: PlannedTrade) => void
  onRemovePlannedTrade: (ticker: string) => void
}) {
  const [tickerInput, setTickerInput] = useState("")
  const [riskPercentInput, setRiskPercentInput] = useState("2")
  const [riskProvenance, setRiskProvenance] = useState<RiskProvenance>("Onboarding default")
  const [plannedEntryInput, setPlannedEntryInput] = useState("")
  const [initialStopInput, setInitialStopInput] = useState("")
  const [commissionInput, setCommissionInput] = useState("0")
  const [slippageInput, setSlippageInput] = useState("0")
  const [advancedAcknowledged, setAdvancedAcknowledged] = useState(false)
  const [editingTicker, setEditingTicker] = useState<string | null>(null)
  const [selectedMode, setSelectedMode] = useState<TradeModeSelection>("")
  const [overrideReason, setOverrideReason] = useState("")
  const [persistingPlan, setPersistingPlan] = useState(false)
  const [persistenceError, setPersistenceError] = useState<string | null>(null)
  const [persistenceSuccess, setPersistenceSuccess] = useState<string | null>(null)
  const riskTouchedRef = useRef(false)

  useEffect(() => {
    if (!riskContext || riskTouchedRef.current) return
    setRiskPercentInput(String(riskContext.defaultTradeRiskPercent))
    setRiskProvenance(
      riskContext.riskSource === "money_management_plan"
        ? "Money Management Plan"
        : "Onboarding default",
    )
  }, [riskContext])

  const normalizedTicker = tickerInput.trim().toUpperCase()
  const riskPercent = finiteNumber(riskPercentInput, 0)
  const plannedEntryKvnd = nullableFiniteNumber(plannedEntryInput)
  const initialStopKvnd = nullableFiniteNumber(initialStopInput)
  const estimatedCommissionVnd = finiteNumber(commissionInput, 0)
  const slippageAllowanceVnd = finiteNumber(slippageInput, 0)

  const result = useMemo(() => calculateTradeSize({
    side: "long",
    accountEquityVnd: accountEquityContext.valueVnd,
    riskPercent,
    plannedEntryKvnd,
    initialStopKvnd,
    estimatedCommissionVnd,
    slippageAllowanceVnd,
    lotSizeShares: DEFAULT_REGULAR_LOT_SHARES,
    advancedRiskOverrideAcknowledged: advancedAcknowledged,
  }), [
    accountEquityContext.valueVnd,
    riskPercent,
    plannedEntryKvnd,
    initialStopKvnd,
    estimatedCommissionVnd,
    slippageAllowanceVnd,
    advancedAcknowledged,
  ])

  const optimalF = useMemo(
    () => calculateOptimalF(
      riskContext?.winRatioPercent ?? null,
      riskContext?.payoffRatio ?? null,
    ),
    [riskContext?.winRatioPercent, riskContext?.payoffRatio],
  )

  const riskContextUnavailable = !loadingRiskContext && riskContext == null
  const ready = result.status === "ready" && normalizedTicker.length > 0
  const projectedConcentration = useMemo(() => {
    if (
      !riskContext
      || !ready
      || plannedEntryKvnd == null
      || result.totalRiskConsumptionVnd == null
      || result.tradeSizeShares <= 0
    ) return null
    return projectTradeConcentration({
      current: riskContext.concentration,
      accountEquityVnd: riskContext.accountEquityVnd,
      rules: riskContext.concentration.rules,
      trade: {
        ticker: normalizedTicker,
        plannedQty: result.tradeSizeShares,
        plannedEntryKvnd,
        plannedRiskVnd: result.totalRiskConsumptionVnd,
        sector: riskContext?.sectorMetadata.byTicker[normalizedTicker] ?? null,
      },
    })
  }, [normalizedTicker, plannedEntryKvnd, ready, result.totalRiskConsumptionVnd, result.tradeSizeShares, riskContext])
  const requiresConcentrationOverride = projectedConcentration?.overallStatus === "WARNING"
    || projectedConcentration?.overallStatus === "BREACH"

  const resetDraft = () => {
    setTickerInput("")
    setPlannedEntryInput("")
    setInitialStopInput("")
    setCommissionInput("0")
    setSlippageInput("0")
    setAdvancedAcknowledged(false)
    setEditingTicker(null)
    setSelectedMode("")
    setOverrideReason("")
    setPersistenceError(null)
    setPersistenceSuccess(null)
  }

  const buildPlannedTrade = (): PlannedTrade | null => {
    if (
      !ready
      || plannedEntryKvnd == null
      || initialStopKvnd == null
      || result.riskAmountVnd == null
      || result.riskPerShareVnd == null
      || result.positionValueVnd == null
      || result.totalRiskConsumptionVnd == null
    ) return null
    return {
      id: normalizedTicker,
      ticker: normalizedTicker,
      plannedEntryKvnd,
      initialStopKvnd,
      riskPercent,
      estimatedCommissionVnd,
      slippageAllowanceVnd,
      riskAmountVnd: result.riskAmountVnd,
      riskPerShareVnd: result.riskPerShareVnd,
      tradeSizeShares: result.tradeSizeShares,
      positionValueVnd: result.positionValueVnd,
      riskAddedVnd: result.totalRiskConsumptionVnd,
    }
  }

  const addPlannedTrade = () => {
    const next = buildPlannedTrade()
    if (!next) return
    if (editingTicker && editingTicker !== normalizedTicker) {
      onRemovePlannedTrade(editingTicker)
    }
    onUpsertPlannedTrade(next)
    resetDraft()
  }

  const persistPlannedTrade = async () => {
    const next = buildPlannedTrade()
    if (!next || !portfolioId || !selectedMode || !riskContext) return
    if (requiresConcentrationOverride && !overrideReason.trim()) return

    setPersistingPlan(true)
    setPersistenceError(null)
    setPersistenceSuccess(null)
    try {
      const response = await fetch(`/api/portfolio/${portfolioId}/trades`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker: next.ticker,
          mode: selectedMode,
          status: "planned",
          trade_type: null,
          timeframe: null,
          system_tags: [],
          setup_tags: [],
          money_management_plan_id: riskContext?.moneyManagementPlanId ?? null,
          planned_entry: next.plannedEntryKvnd,
          initial_stop_loss_exit: next.initialStopKvnd,
          initial_account_equity: riskContext.accountEquityVnd,
          initial_risk_percent: next.riskPercent,
          initial_risk_amount: next.riskAmountVnd,
          initial_risk_amount_per_share: next.riskPerShareVnd,
          planned_trade_size: next.tradeSizeShares,
          planned_position_value: next.positionValueVnd,
          estimated_commission: next.estimatedCommissionVnd,
          slippage_allowance: next.slippageAllowanceVnd,
          pre_trade_plan: "QEO-159 deterministic concentration/diversification review",
          thesis_summary: null,
        }),
      })
      const payload = await response.json().catch(() => null) as { trade?: { id?: string }; error?: string } | null
      if (!response.ok || !payload?.trade?.id) {
        throw new Error(payload?.error || "Không thể lưu Trade dự kiến.")
      }

      if (requiresConcentrationOverride) {
        const journalResponse = await fetch(`/api/portfolio/${portfolioId}/trades/${payload.trade.id}/journal`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            phase: "before",
            note: "Concentration/diversification override",
            emotion_tags: [],
            behavior_tags: ["concentration_override"],
            adherence_status: "deviated",
            override_reason: overrideReason.trim(),
            occurred_at: new Date().toISOString(),
          }),
        })
        const journalPayload = await journalResponse.json().catch(() => null) as { error?: string } | null
        if (!journalResponse.ok) {
          throw new Error(`Không thể lưu bằng chứng override: ${journalPayload?.error || "journal request failed"}`)
        }
      }

      setPersistenceSuccess(`Đã lưu Trade dự kiến ${next.ticker}${requiresConcentrationOverride ? " cùng lý do override" : ""}.`)
      if (editingTicker && editingTicker !== normalizedTicker) onRemovePlannedTrade(editingTicker)
      onUpsertPlannedTrade(next)
    } catch (cause) {
      setPersistenceError(cause instanceof Error ? cause.message : "Không thể lưu Trade dự kiến.")
    } finally {
      setPersistingPlan(false)
    }
  }

  const editPlannedTrade = (trade: PlannedTrade) => {
    riskTouchedRef.current = true
    setEditingTicker(trade.ticker)
    setTickerInput(trade.ticker)
    setRiskPercentInput(String(trade.riskPercent))
    setRiskProvenance("Planned Trade")
    setPlannedEntryInput(String(trade.plannedEntryKvnd))
    setInitialStopInput(String(trade.initialStopKvnd))
    setCommissionInput(String(trade.estimatedCommissionVnd))
    setSlippageInput(String(trade.slippageAllowanceVnd))
    setAdvancedAcknowledged(trade.riskPercent > 2)
    setPersistenceError(null)
    setPersistenceSuccess(null)
  }

  const removePlannedTrade = (ticker: string) => {
    onRemovePlannedTrade(ticker)
    if (editingTicker === ticker) resetDraft()
  }

  const canPersistPlan = ready
    && Boolean(portfolioId)
    && Boolean(selectedMode)
    && riskContext != null
    && (!requiresConcentrationOverride || Boolean(overrideReason.trim()))

  return (
    <div data-planner-advisor="trade-size" className="space-y-4 font-ticker">
      <div className="rounded-2xl border border-amber-500/15 bg-gradient-to-br from-amber-500/[0.07] to-black/20 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.14em] text-amber-200">
              <Calculator className="h-4 w-4" /> Tính khối lượng từ mức dừng lỗ
            </div>
            <p className="mt-1 text-[10px] leading-relaxed text-slate-400">
              Mã cổ phiếu là định danh của một giao dịch dự kiến. Giá vào lệnh, mức dừng lỗ, phí, trượt giá và khối lượng chỉ thuộc giao dịch của mã đó.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge>{riskProvenanceLabel(riskProvenance)}</Badge>
            <Badge>Lô chẵn {DEFAULT_REGULAR_LOT_SHARES} cổ phiếu</Badge>
          </div>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="space-y-2 rounded-2xl border border-amber-500/20 bg-amber-500/[0.06] p-4 md:col-span-2">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[10px] font-black uppercase tracking-[0.14em] text-amber-200">Mã cổ phiếu</span>
            <span className="text-[9px] font-bold text-slate-500">Mỗi mã chỉ có một dòng kế hoạch</span>
          </div>
          <Input
            value={tickerInput}
            onChange={(event) => setTickerInput(event.target.value.toUpperCase())}
            placeholder="VD: MSN"
            autoCapitalize="characters"
            className="h-11 border-amber-500/20 bg-black/30 font-ticker text-lg font-black uppercase tracking-[0.12em] text-white"
          />
        </label>

        <ReadOnlyMetric term="accountEquity" value={formatVnd(accountEquityContext.valueVnd)} />
        <MetricInput
          term="riskPerTrade"
          value={riskPercentInput}
          onChange={(value) => {
            riskTouchedRef.current = true
            setRiskPercentInput(value)
            setRiskProvenance("Manual override")
            if (finiteNumber(value, 0) <= 2) setAdvancedAcknowledged(false)
          }}
          step="0.1"
          suffix="%"
        />
        <MetricInput term="plannedEntry" value={plannedEntryInput} onChange={setPlannedEntryInput} step="0.1" suffix="k₫" placeholder="VD: 68.0" />
        <MetricInput term="initialStop" value={initialStopInput} onChange={setInitialStopInput} step="0.1" suffix="k₫" placeholder="Xác định từ cấu trúc thị trường/hệ thống" />
        <MetricInput term="estimatedCommission" value={commissionInput} onChange={setCommissionInput} step="1000" suffix="VNĐ" />
        <MetricInput term="slippageAllowance" value={slippageInput} onChange={setSlippageInput} step="1000" suffix="VNĐ" />
      </div>

      {riskPercent > 2 ? (
        <label className="flex items-start gap-2 rounded-2xl border border-amber-500/25 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-100">
          <input
            type="checkbox"
            checked={advancedAcknowledged}
            onChange={(event) => setAdvancedAcknowledged(event.target.checked)}
            className="mt-0.5 h-4 w-4"
          />
          <span>Tôi xác nhận đây là mức rủi ro thủ công nâng cao trên 2%; hệ thống không tự động đề xuất tăng rủi ro vượt ngưỡng này.</span>
        </label>
      ) : null}

      {accountEquityContext.source === "portfolio_partial" ? (
        <div className="rounded-2xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-xs leading-relaxed text-amber-100">
          Vốn tài khoản đang là dữ liệu một phần vì thiếu giá thị trường cho: {accountEquityContext.missingPriceTickers.join(", ") || "một số mã"}. Hãy rà soát dữ liệu hoặc nhập vốn tài khoản thủ công tại mục 1.
        </div>
      ) : null}

      {riskContextError ? (
        <div className="rounded-2xl border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-xs text-rose-200">
          Không thể tải ngữ cảnh rủi ro: {riskContextError}
        </div>
      ) : null}

      <div className="rounded-2xl border border-white/[0.07] bg-black/20 p-4 text-[10px] leading-relaxed text-slate-400">
        <p className="font-black uppercase tracking-wide text-slate-200">Hướng dẫn xác định mức dừng lỗ ban đầu</p>
        <p className="mt-1.5">
          Đặt mức dừng lỗ từ hỗ trợ/kháng cự cấu trúc, biến động hoặc hoạt động giá, hoặc quy tắc của hệ thống giao dịch. Dừng lỗ kéo theo chỉ áp dụng sau khi vào lệnh và giao dịch phát triển. Mức lỗ thực tế có thể vượt mức dự kiến do gap giá, thanh khoản, biến động, chuyển động qua đêm và trượt giá.
        </p>
      </div>

      <div className="rounded-2xl border border-amber-500/15 bg-gradient-to-b from-amber-500/[0.045] to-black/20 p-4">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-[9px] font-black uppercase tracking-[0.18em] text-amber-400/70">Kết quả xác định</p>
            <p className="mt-1 text-xs font-extrabold uppercase tracking-wide text-white">Kết quả khối lượng giao dịch</p>
            <p className="mt-1 text-[10px] text-slate-500">Sẵn sàng khi mã cổ phiếu + giá vào + mức dừng lỗ + ngân sách rủi ro tạo được một khối lượng theo lô chẵn.</p>
          </div>
          {editingTicker ? <Badge>Đang sửa {editingTicker}</Badge> : null}
        </div>

        {result.status === "ready" ? (
          <div className="space-y-2">
            <MetricRow term="riskAmount" value={formatVnd(result.riskAmountVnd)} />
            <MetricRow term="stopDistance" value={`${formatKvnd(result.stopDistanceKvnd)} · ${formatPercent(result.stopDistancePercent)}`} />
            <MetricRow term="riskPerShare" value={formatVnd(result.riskPerShareVnd)} />
            <MetricRow term="availableTradeRiskBudget" value={formatVnd(result.availableRiskBudgetVnd)} />
            <MetricRow term="tradeSize" value={`${result.tradeSizeShares.toLocaleString("vi-VN")} cổ phiếu`} emphasized />
            <MetricRow term="positionValue" value={formatVnd(result.positionValueVnd)} />
            <MetricRow term="riskAddedByPlannedTrade" value={formatVnd(result.totalRiskConsumptionVnd)} />
          </div>
        ) : (
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.07] p-3 text-xs leading-relaxed text-amber-100">
            {statusHelp(result.status)}
          </div>
        )}

        {projectedConcentration ? <ProjectedConcentrationPanel projection={projectedConcentration} /> : null}

        {result.status === "ready" && normalizedTicker.length === 0 ? (
          <p className="mt-3 text-[11px] font-bold text-amber-200">Nhập mã cổ phiếu trước khi thêm giao dịch dự kiến.</p>
        ) : null}

        <button
          type="button"
          onClick={addPlannedTrade}
          disabled={!ready}
          className={cn(
            "mt-4 w-full rounded-xl border px-4 py-3 text-xs font-black uppercase tracking-[0.12em] transition",
            ready
              ? "border-amber-300/35 bg-amber-400 text-[#171006] shadow-[0_8px_30px_rgba(251,191,36,0.16)] hover:bg-amber-300"
              : "cursor-not-allowed border-white/5 bg-white/[0.03] text-slate-600",
          )}
        >
          Thêm giao dịch dự kiến
        </button>

        {ready ? (
          <div className="mt-4 space-y-3 rounded-xl border border-white/[0.07] bg-black/25 p-3">
            <div>
              <p className="text-[9px] font-black uppercase tracking-[0.14em] text-slate-400">Lưu kế hoạch vào nhật ký Trade</p>
              <p className="mt-1 text-[10px] text-slate-500">Chọn rõ Live/Paper. WARNING/BREACH không bị chặn, nhưng cần lý do override để audit.</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {(["live", "paper"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setSelectedMode(mode)}
                  className={cn(
                    "rounded-lg border px-3 py-2 text-[10px] font-black uppercase",
                    selectedMode === mode ? "border-purple-400/35 bg-purple-400/10 text-purple-200" : "border-white/[0.08] text-slate-400",
                  )}
                >
                  {mode === "live" ? "Live" : "Paper"}
                </button>
              ))}
            </div>
            {requiresConcentrationOverride ? (
              <label className="block space-y-1.5">
                <span className="text-[9px] font-black uppercase tracking-wide text-amber-200">Lý do override concentration/diversification</span>
                <textarea
                  value={overrideReason}
                  onChange={(event) => setOverrideReason(event.target.value)}
                  rows={3}
                  placeholder="Giải thích vì sao vẫn chấp nhận giao dịch dù có cảnh báo/vượt giới hạn…"
                  className="w-full resize-y rounded-lg border border-amber-500/20 bg-black/30 px-3 py-2 text-xs text-white outline-none placeholder:text-slate-600 focus:border-amber-400/40"
                />
              </label>
            ) : null}
            {persistenceError ? <p className="text-[10px] font-bold text-rose-300">{persistenceError}</p> : null}
            {persistenceSuccess ? <p className="text-[10px] font-bold text-emerald-300">{persistenceSuccess}</p> : null}
            <button
              type="button"
              onClick={() => void persistPlannedTrade()}
              disabled={!canPersistPlan || persistingPlan}
              className={cn(
                "w-full rounded-lg border px-3 py-2.5 text-[10px] font-black uppercase tracking-wide",
                canPersistPlan && !persistingPlan
                  ? "border-purple-400/30 bg-purple-400/10 text-purple-100 hover:bg-purple-400/15"
                  : "cursor-not-allowed border-white/5 bg-white/[0.02] text-slate-600",
              )}
            >
              {persistingPlan ? "Đang lưu…" : "Lưu Trade dự kiến"}
            </button>
          </div>
        ) : null}
      </div>

      <section className="rounded-2xl border border-white/[0.07] bg-black/20 p-4">
        <div className="flex items-center justify-between gap-3 border-b border-white/5 pb-3">
          <div>
            <h4 className="text-xs font-extrabold uppercase tracking-wide text-white">Các giao dịch dự kiến</h4>
            <p className="mt-1 text-[10px] text-slate-500">Simulation trong phiên lập kế hoạch. Chỉ nút “Lưu Trade dự kiến” ở trên mới ghi vào QEO-137.</p>
          </div>
          <Badge>{plannedTrades.length} mã</Badge>
        </div>

        {plannedTrades.length === 0 ? (
          <div className="mt-3 rounded-xl border border-dashed border-white/[0.07] bg-black/15 py-6 text-center text-[10px] text-slate-500">Chưa có giao dịch dự kiến.</div>
        ) : (
          <div className="mt-3 space-y-3">
            {plannedTrades.map((trade) => (
              <article key={trade.ticker} className="rounded-xl border border-white/[0.07] bg-black/20 p-3 transition-colors hover:border-amber-500/15">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-base font-black tracking-wide text-amber-200">{trade.ticker}</p>
                    <p className="mt-1 text-[10px] text-slate-500">
                      Giá vào dự kiến {formatKvnd(trade.plannedEntryKvnd)} · Dừng lỗ ban đầu {formatKvnd(trade.initialStopKvnd)} · Rủi ro mỗi giao dịch {formatPercent(trade.riskPercent)}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => editPlannedTrade(trade)}
                      className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2.5 py-1.5 text-[10px] font-bold text-slate-200 transition hover:bg-white/5"
                    >
                      <Pencil className="h-3 w-3" /> Sửa
                    </button>
                    <button
                      type="button"
                      onClick={() => removePlannedTrade(trade.ticker)}
                      className="inline-flex items-center gap-1 rounded-lg border border-rose-500/20 px-2.5 py-1.5 text-[10px] font-bold text-rose-200 transition hover:bg-rose-500/10"
                    >
                      <Trash2 className="h-3 w-3" /> Xóa
                    </button>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-[10px] sm:grid-cols-3">
                  <SmallMetric label="Khối lượng giao dịch" value={`${trade.tradeSizeShares.toLocaleString("vi-VN")} cổ phiếu`} />
                  <SmallMetric label="Giá trị vị thế" value={formatVnd(trade.positionValueVnd)} />
                  <SmallMetric label="Rủi ro tăng thêm" value={formatVnd(trade.riskAddedVnd)} />
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <details className="group rounded-2xl border border-white/[0.07] bg-black/20 p-4">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-4">
          <div>
            <h4 className="text-xs font-extrabold uppercase tracking-wide text-white">Bằng chứng nâng cao</h4>
            <p className="mt-1 text-[10px] text-slate-500">Dữ liệu tỷ lệ thắng, tỷ lệ lãi/lỗ và Optimal f để tham khảo.</p>
          </div>
          <Badge>Bằng chứng: {evidenceCompletenessLabel(riskContextUnavailable ? "unavailable" : riskContext?.evidenceCompleteness ?? "insufficient")}</Badge>
        </summary>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <RiskCard
            term="winRatio"
            value={loadingRiskContext
              ? "Đang tải…"
              : riskContextUnavailable
                ? "Không khả dụng"
                : riskContext?.winRatioPercent == null
                  ? "Chưa đủ lịch sử"
                  : formatPercent(riskContext.winRatioPercent)}
          />
          <RiskCard
            term="payoffRatio"
            value={loadingRiskContext
              ? "Đang tải…"
              : riskContextUnavailable
                ? "Không khả dụng"
                : riskContext?.payoffRatio == null
                  ? "Chưa đủ lịch sử"
                  : formatRatio(riskContext.payoffRatio)}
          />
          <RiskCard
            term="optimalF"
            value={loadingRiskContext
              ? "Đang tải…"
              : riskContextUnavailable
                ? "Không khả dụng"
                : optimalF.status === "available" && optimalF.value != null
                  ? formatPercent(optimalF.value * 100)
                  : optimalF.status === "invalid"
                    ? "Bằng chứng không hợp lệ"
                    : "Chưa đủ lịch sử"}
          />
        </div>

        <div className="mt-4 rounded-xl border border-purple-500/20 bg-purple-500/[0.07] p-3 text-xs leading-relaxed text-slate-300">
          <p className="font-bold text-purple-200">Optimal f chỉ dùng để tham khảo.</p>
          <p className="mt-1">
            Optimal f mạnh tay hơn các ví dụ sizing zero-ROR, không được tự động áp vào rủi ro mỗi giao dịch hoặc khối lượng giao dịch, và không bảo đảm Risk of Ruin bằng 0. QeoIndex chỉ hiển thị giá trị xác định khi có đủ bằng chứng về tỷ lệ giao dịch thắng và tỷ lệ lãi/lỗ bình quân.
          </p>
        </div>
      </details>
    </div>
  )
}

function MetricInput({ term, value, onChange, step, suffix, placeholder }: {
  term: RiskTerm
  value: string
  onChange: (value: string) => void
  step: string
  suffix: string
  placeholder?: string
}) {
  return (
    <label className="space-y-2 rounded-xl border border-white/[0.06] bg-black/20 p-3.5">
      <RiskMetricTooltip term={term} />
      <div className="flex items-center gap-2">
        <Input
          type="number"
          inputMode="decimal"
          step={step}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          className="h-10 border-white/[0.08] bg-black/30 font-ticker font-bold text-white"
        />
        <span className="shrink-0 text-[10px] font-bold text-slate-500">{suffix}</span>
      </div>
    </label>
  )
}

function ReadOnlyMetric({ term, value }: { term: RiskTerm; value: string }) {
  return (
    <div className="space-y-2 rounded-xl border border-white/[0.06] bg-black/20 p-3.5">
      <RiskMetricTooltip term={term} />
      <div className="text-sm font-black text-white">{value}</div>
    </div>
  )
}

function MetricRow({ term, value, emphasized = false }: { term: RiskTerm; value: string; emphasized?: boolean }) {
  return (
    <div className={cn(
      "flex items-center justify-between gap-4 border-b border-white/5 py-2 text-xs last:border-b-0",
      emphasized && "my-1 rounded-xl border border-emerald-500/15 bg-emerald-500/[0.07] px-3 py-3",
    )}>
      <RiskMetricTooltip term={term} />
      <span className={cn("text-right font-black text-white", emphasized && "text-xl tracking-tight text-emerald-300")}>{value}</span>
    </div>
  )
}

function RiskCard({ term, value }: { term: RiskTerm; value: string }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-black/20 p-3">
      <div className="text-[10px]"><RiskMetricTooltip term={term} /></div>
      <div className="mt-2 text-xs font-black text-white">{value}</div>
    </div>
  )
}

function SmallMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/5 bg-black/20 px-2.5 py-2">
      <div className="text-[9px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 font-bold text-slate-100">{value}</div>
    </div>
  )
}

function Badge({ children }: { children: ReactNode }) {
  return <span className="rounded-full border border-purple-500/20 bg-purple-500/[0.08] px-3 py-1 text-[9px] font-black text-purple-200">{children}</span>
}

function finiteNumber(value: string, fallback: number): number {
  if (value.trim() === "") return fallback
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function nullableFiniteNumber(value: string): number | null {
  if (value.trim() === "") return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function formatVnd(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—"
  return `${Math.round(value).toLocaleString("vi-VN")} VNĐ`
}

function formatKvnd(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—"
  return `${value.toLocaleString("vi-VN", { maximumFractionDigits: 3 })} k₫`
}

function formatPercent(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—"
  return `${value.toLocaleString("vi-VN", { maximumFractionDigits: 2 })}%`
}

function formatRatio(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—"
  return `${value.toLocaleString("vi-VN", { maximumFractionDigits: 2 })}:1`
}

function riskProvenanceLabel(value: RiskProvenance): string {
  switch (value) {
    case "Money Management Plan": return "Từ Kế hoạch quản trị vốn"
    case "Onboarding default": return "Mặc định khởi tạo"
    case "Manual override": return "Điều chỉnh thủ công"
    case "Planned Trade": return "Từ giao dịch dự kiến"
  }
}

function evidenceCompletenessLabel(value: string): string {
  if (value === "complete") return "đầy đủ"
  if (value === "partial") return "một phần"
  if (value === "unavailable") return "không khả dụng"
  return "chưa đủ"
}

function statusHelp(status: TradeSizeStatus): string {
  switch (status) {
    case "incomplete": return "Nhập giá vào lệnh dự kiến và mức dừng lỗ ban đầu trước khi tính khối lượng giao dịch."
    case "invalid_account_equity": return "Vốn tài khoản phải lớn hơn 0."
    case "invalid_risk_percent": return "Rủi ro mỗi giao dịch phải lớn hơn 0 và không vượt 100%."
    case "advanced_override_required": return "Rủi ro mỗi giao dịch trên 2% cần xác nhận nâng cao rõ ràng."
    case "invalid_entry": return "Giá vào lệnh dự kiến phải lớn hơn 0."
    case "invalid_stop_direction": return "Với giao dịch mua, mức dừng lỗ ban đầu phải thấp hơn giá vào lệnh dự kiến."
    case "zero_stop_distance": return "Mức dừng lỗ ban đầu trùng giá vào lệnh dự kiến nên không có khoảng rủi ro hợp lệ."
    case "invalid_cost": return "Phí giao dịch ước tính và phần đệm trượt giá phải là số không âm."
    case "costs_consume_risk_budget": return "Chi phí ước tính đã dùng hết số tiền rủi ro; không còn ngân sách rủi ro để tạo khối lượng giao dịch."
    case "below_regular_lot": return "Không có khối lượng lô chẵn hợp lệ dưới ngân sách rủi ro đã chọn."
    case "ready": return "Sẵn sàng."
  }
}
