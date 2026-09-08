"use client"

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { Calculator, Pencil, Trash2 } from "lucide-react"

import { Input } from "@/components/ui/input"
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

export function TradeSizeAdvisor({
  accountEquityContext,
  riskContext,
  loadingRiskContext,
  riskContextError,
  plannedTrades,
  onUpsertPlannedTrade,
  onRemovePlannedTrade,
}: {
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

  const resetDraft = () => {
    setTickerInput("")
    setPlannedEntryInput("")
    setInitialStopInput("")
    setCommissionInput("0")
    setSlippageInput("0")
    setAdvancedAcknowledged(false)
    setEditingTicker(null)
  }

  const addPlannedTrade = () => {
    if (
      !ready
      || plannedEntryKvnd == null
      || initialStopKvnd == null
      || result.riskAmountVnd == null
      || result.riskPerShareVnd == null
      || result.positionValueVnd == null
      || result.totalRiskConsumptionVnd == null
    ) return

    const next: PlannedTrade = {
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

    if (editingTicker && editingTicker !== normalizedTicker) {
      onRemovePlannedTrade(editingTicker)
    }
    onUpsertPlannedTrade(next)
    resetDraft()
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
  }

  const removePlannedTrade = (ticker: string) => {
    onRemovePlannedTrade(ticker)
    if (editingTicker === ticker) resetDraft()
  }

  return (
    <div data-planner-advisor="trade-size" className="space-y-4 font-ticker">
      <div className="rounded-2xl border border-amber-500/15 bg-gradient-to-br from-amber-500/[0.07] to-black/20 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.14em] text-amber-200">
              <Calculator className="h-4 w-4" /> Stop-first sizing
            </div>
            <p className="mt-1 text-[10px] leading-relaxed text-slate-400">
              Ticker là identity của một planned Trade. Entry, Stop, Commission, Slippage và Trade Size chỉ thuộc ticker đó.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge>{riskProvenance}</Badge>
            <Badge>{DEFAULT_REGULAR_LOT_SHARES}-share regular lot</Badge>
          </div>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="space-y-2 rounded-2xl border border-amber-500/20 bg-amber-500/[0.06] p-4 md:col-span-2">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[10px] font-black uppercase tracking-[0.14em] text-amber-200">Ticker</span>
            <span className="text-[9px] font-bold text-slate-500">One row per ticker</span>
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
        <MetricInput term="initialStop" value={initialStopInput} onChange={setInitialStopInput} step="0.1" suffix="k₫" placeholder="Xác định từ market/system logic" />
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
          <span>Tôi xác nhận đây là advanced manual override trên mức 2%; hệ thống không tự động đề xuất tăng risk vượt ngưỡng này.</span>
        </label>
      ) : null}

      {accountEquityContext.source === "portfolio_partial" ? (
        <div className="rounded-2xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-xs leading-relaxed text-amber-100">
          Account Equity đang partial vì thiếu market price cho: {accountEquityContext.missingPriceTickers.join(", ") || "một số ticker"}. Review dữ liệu hoặc dùng manual Account Equity tại Panel 1.
        </div>
      ) : null}

      {riskContextError ? (
        <div className="rounded-2xl border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-xs text-rose-200">
          Risk context unavailable: {riskContextError}
        </div>
      ) : null}

      <div className="rounded-2xl border border-white/[0.07] bg-black/20 p-4 text-[10px] leading-relaxed text-slate-400">
        <p className="font-black uppercase tracking-wide text-slate-200">Initial Stop guidance</p>
        <p className="mt-1.5">
          Đặt stop từ structural support/resistance, volatility hoặc price activity, hay trading-system rule. Trailing stop chỉ áp dụng sau entry khi Trade phát triển. Actual loss có thể vượt planned stop do gap, liquidity, volatility, overnight moves và slippage.
        </p>
      </div>

      <div className="rounded-2xl border border-amber-500/15 bg-gradient-to-b from-amber-500/[0.045] to-black/20 p-4">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-[9px] font-black uppercase tracking-[0.18em] text-amber-400/70">Deterministic output</p>
            <p className="mt-1 text-xs font-extrabold uppercase tracking-wide text-white">Trade Size Result</p>
            <p className="mt-1 text-[10px] text-slate-500">Ready khi Ticker + Entry + Stop + risk budget tạo được regular-lot Trade Size.</p>
          </div>
          {editingTicker ? <Badge>Editing {editingTicker}</Badge> : null}
        </div>

        {result.status === "ready" ? (
          <div className="space-y-2">
            <MetricRow term="riskAmount" value={formatVnd(result.riskAmountVnd)} />
            <MetricRow term="stopDistance" value={`${formatKvnd(result.stopDistanceKvnd)} · ${formatPercent(result.stopDistancePercent)}`} />
            <MetricRow term="riskPerShare" value={formatVnd(result.riskPerShareVnd)} />
            <MetricRow term="availableTradeRiskBudget" value={formatVnd(result.availableRiskBudgetVnd)} />
            <MetricRow term="tradeSize" value={`${result.tradeSizeShares.toLocaleString("vi-VN")} shares`} emphasized />
            <MetricRow term="positionValue" value={formatVnd(result.positionValueVnd)} />
            <MetricRow term="riskAddedByPlannedTrade" value={formatVnd(result.totalRiskConsumptionVnd)} />
          </div>
        ) : (
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.07] p-3 text-xs leading-relaxed text-amber-100">
            {statusHelp(result.status)}
          </div>
        )}

        {result.status === "ready" && normalizedTicker.length === 0 ? (
          <p className="mt-3 text-[11px] font-bold text-amber-200">Nhập Ticker trước khi thêm planned Trade.</p>
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
          Add Planned Trade
        </button>
      </div>

      <section className="rounded-2xl border border-white/[0.07] bg-black/20 p-4">
        <div className="flex items-center justify-between gap-3 border-b border-white/5 pb-3">
          <div>
            <h4 className="text-xs font-extrabold uppercase tracking-wide text-white">Planned Trades</h4>
            <p className="mt-1 text-[10px] text-slate-500">Planning workspace only · ephemeral client state · not saved.</p>
          </div>
          <Badge>{plannedTrades.length} ticker{plannedTrades.length === 1 ? "" : "s"}</Badge>
        </div>

        {plannedTrades.length === 0 ? (
          <div className="mt-3 rounded-xl border border-dashed border-white/[0.07] bg-black/15 py-6 text-center text-[10px] text-slate-500">Chưa có planned Trade.</div>
        ) : (
          <div className="mt-3 space-y-3">
            {plannedTrades.map((trade) => (
              <article key={trade.ticker} className="rounded-xl border border-white/[0.07] bg-black/20 p-3 transition-colors hover:border-amber-500/15">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-base font-black tracking-wide text-amber-200">{trade.ticker}</p>
                    <p className="mt-1 text-[10px] text-slate-500">
                      Planned Entry {formatKvnd(trade.plannedEntryKvnd)} · Initial Stop {formatKvnd(trade.initialStopKvnd)} · Risk per Trade {formatPercent(trade.riskPercent)}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => editPlannedTrade(trade)}
                      className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2.5 py-1.5 text-[10px] font-bold text-slate-200 transition hover:bg-white/5"
                    >
                      <Pencil className="h-3 w-3" /> Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => removePlannedTrade(trade.ticker)}
                      className="inline-flex items-center gap-1 rounded-lg border border-rose-500/20 px-2.5 py-1.5 text-[10px] font-bold text-rose-200 transition hover:bg-rose-500/10"
                    >
                      <Trash2 className="h-3 w-3" /> Remove
                    </button>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-[10px] sm:grid-cols-3">
                  <SmallMetric label="Trade Size" value={`${trade.tradeSizeShares.toLocaleString("vi-VN")} shares`} />
                  <SmallMetric label="Position Value" value={formatVnd(trade.positionValueVnd)} />
                  <SmallMetric label="Risk Added" value={formatVnd(trade.riskAddedVnd)} />
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <details className="group rounded-2xl border border-white/[0.07] bg-black/20 p-4">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-4">
          <div>
            <h4 className="text-xs font-extrabold uppercase tracking-wide text-white">Advanced Evidence</h4>
            <p className="mt-1 text-[10px] text-slate-500">Win/Payoff evidence and informational Optimal f.</p>
          </div>
          <Badge>Evidence: {riskContextUnavailable ? "Unavailable" : riskContext?.evidenceCompleteness ?? "insufficient"}</Badge>
        </summary>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <RiskCard
            term="winRatio"
            value={loadingRiskContext
              ? "Loading…"
              : riskContextUnavailable
                ? "Unavailable"
                : riskContext?.winRatioPercent == null
                  ? "Insufficient History"
                  : formatPercent(riskContext.winRatioPercent)}
          />
          <RiskCard
            term="payoffRatio"
            value={loadingRiskContext
              ? "Loading…"
              : riskContextUnavailable
                ? "Unavailable"
                : riskContext?.payoffRatio == null
                  ? "Insufficient History"
                  : formatRatio(riskContext.payoffRatio)}
          />
          <RiskCard
            term="optimalF"
            value={loadingRiskContext
              ? "Loading…"
              : riskContextUnavailable
                ? "Unavailable"
                : optimalF.status === "available" && optimalF.value != null
                  ? formatPercent(optimalF.value * 100)
                  : optimalF.status === "invalid"
                    ? "Invalid Evidence"
                    : "Insufficient History"}
          />
        </div>

        <div className="mt-4 rounded-xl border border-purple-500/20 bg-purple-500/[0.07] p-3 text-xs leading-relaxed text-slate-300">
          <p className="font-bold text-purple-200">Optimal f is informational only.</p>
          <p className="mt-1">
            It is more aggressive than the zero-ROR sizing examples, is not auto-applied to Risk per Trade or Trade Size, and is not a zero-ROR guarantee. QeoIndex only shows the deterministic value when Win Ratio and Payoff Ratio evidence are available.
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

function statusHelp(status: TradeSizeStatus): string {
  switch (status) {
    case "incomplete": return "Nhập Planned Entry và Initial Stop trước khi tính Trade Size."
    case "invalid_account_equity": return "Account Equity phải lớn hơn 0."
    case "invalid_risk_percent": return "Risk per Trade phải lớn hơn 0 và không vượt 100%."
    case "advanced_override_required": return "Risk per Trade trên 2% cần advanced acknowledgement rõ ràng."
    case "invalid_entry": return "Planned Entry phải lớn hơn 0."
    case "invalid_stop_direction": return "Với long Trade, Initial Stop phải thấp hơn Planned Entry."
    case "zero_stop_distance": return "Initial Stop trùng Planned Entry nên không có khoảng risk hợp lệ."
    case "invalid_cost": return "Estimated Commission và Slippage Allowance phải là số không âm."
    case "costs_consume_risk_budget": return "Estimated costs đã dùng hết Risk Amount; không còn risk budget cho Trade Size."
    case "below_regular_lot": return "Không có valid regular-lot Trade Size dưới risk budget đã chọn."
    case "ready": return "Ready."
  }
}
