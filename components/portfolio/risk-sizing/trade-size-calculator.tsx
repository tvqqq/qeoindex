"use client"

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { AlertTriangle, Calculator, ShieldCheck } from "lucide-react"

import { Input } from "@/components/ui/input"
import {
  calculateTradeSize,
  DEFAULT_REGULAR_LOT_SHARES,
} from "@/modules/portfolio/risk-sizing/calculator"
import { calculateOptimalF } from "@/modules/portfolio/risk-sizing/optimal-f"
import { projectActiveRisk } from "@/modules/portfolio/risk-sizing/projection"
import type { AccountEquityContext, TradeSizeStatus } from "@/modules/portfolio/risk-sizing/types"
import { cn } from "@/modules/shared/ui/cn"
import { RiskMetricTooltip } from "./risk-metric-tooltip"

type RiskSizingApiContext = {
  defaultTradeRiskPercent: number
  riskSource: "money_management_plan" | "onboarding_default"
  maxActiveRiskPercent: number | null
  knownActiveRiskVnd: number
  unknownRiskTradeCount: number
  winRatioPercent: number | null
  payoffRatio: number | null
  evidenceCompleteness: "complete" | "partial" | "insufficient"
}

type RiskSizingResponse = {
  ok: boolean
  context?: RiskSizingApiContext
  error?: string
}

type RiskProvenance = "Money Management Plan" | "Onboarding default" | "Manual override"
type RiskTerm = Parameters<typeof RiskMetricTooltip>[0]["term"]

export function TradeSizeCalculator({
  portfolioId,
  accountEquityContext,
}: {
  portfolioId: string
  accountEquityContext: AccountEquityContext
}) {
  const [riskContext, setRiskContext] = useState<RiskSizingApiContext | null>(null)
  const [contextError, setContextError] = useState<string | null>(null)
  const [loadingContext, setLoadingContext] = useState(true)
  const [accountEquityInput, setAccountEquityInput] = useState(() => String(Math.round(accountEquityContext.valueVnd)))
  const [equitySource, setEquitySource] = useState<"portfolio" | "manual">("portfolio")
  const [riskPercentInput, setRiskPercentInput] = useState("2")
  const [riskProvenance, setRiskProvenance] = useState<RiskProvenance>("Onboarding default")
  const [plannedEntryInput, setPlannedEntryInput] = useState("")
  const [initialStopInput, setInitialStopInput] = useState("")
  const [commissionInput, setCommissionInput] = useState("0")
  const [slippageInput, setSlippageInput] = useState("0")
  const [advancedAcknowledged, setAdvancedAcknowledged] = useState(false)
  const riskTouchedRef = useRef(false)

  useEffect(() => {
    if (equitySource === "portfolio") {
      setAccountEquityInput(String(Math.round(accountEquityContext.valueVnd)))
    }
  }, [accountEquityContext.valueVnd, equitySource])

  useEffect(() => {
    const controller = new AbortController()
    setLoadingContext(true)
    setContextError(null)

    void fetch(`/api/portfolio/${portfolioId}/risk-sizing`, {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = (await response.json()) as RiskSizingResponse
        if (!response.ok || !body.ok || !body.context) {
          throw new Error(body.error ?? "Không thể tải risk-sizing context.")
        }
        return body.context
      })
      .then((context) => {
        setRiskContext(context)
        if (!riskTouchedRef.current) {
          setRiskPercentInput(String(context.defaultTradeRiskPercent))
          setRiskProvenance(
            context.riskSource === "money_management_plan"
              ? "Money Management Plan"
              : "Onboarding default",
          )
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setContextError(error instanceof Error ? error.message : "Không thể tải risk-sizing context.")
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingContext(false)
      })

    return () => controller.abort()
  }, [portfolioId])

  const accountEquityVnd = finiteNumber(accountEquityInput, 0)
  const riskPercent = finiteNumber(riskPercentInput, 0)
  const plannedEntryKvnd = nullableFiniteNumber(plannedEntryInput)
  const initialStopKvnd = nullableFiniteNumber(initialStopInput)
  const estimatedCommissionVnd = finiteNumber(commissionInput, 0)
  const slippageAllowanceVnd = finiteNumber(slippageInput, 0)

  const result = useMemo(() => calculateTradeSize({
    side: "long",
    accountEquityVnd,
    riskPercent,
    plannedEntryKvnd,
    initialStopKvnd,
    estimatedCommissionVnd,
    slippageAllowanceVnd,
    lotSizeShares: DEFAULT_REGULAR_LOT_SHARES,
    advancedRiskOverrideAcknowledged: advancedAcknowledged,
  }), [
    accountEquityVnd,
    riskPercent,
    plannedEntryKvnd,
    initialStopKvnd,
    estimatedCommissionVnd,
    slippageAllowanceVnd,
    advancedAcknowledged,
  ])

  const plannedTradeRiskVnd = result.status === "ready" ? (result.totalRiskConsumptionVnd ?? 0) : 0
  const projectedRisk = useMemo(() => projectActiveRisk({
    knownActiveRiskVnd: riskContext?.knownActiveRiskVnd ?? 0,
    accountEquityVnd,
    maxActiveRiskPercent: riskContext?.maxActiveRiskPercent ?? null,
    unknownRiskTradeCount: riskContext?.unknownRiskTradeCount ?? 0,
  }, plannedTradeRiskVnd), [
    accountEquityVnd,
    plannedTradeRiskVnd,
    riskContext?.knownActiveRiskVnd,
    riskContext?.maxActiveRiskPercent,
    riskContext?.unknownRiskTradeCount,
  ])
  const optimalF = useMemo(
    () => calculateOptimalF(
      riskContext?.winRatioPercent ?? null,
      riskContext?.payoffRatio ?? null,
    ),
    [riskContext?.winRatioPercent, riskContext?.payoffRatio],
  )

  const hasUnknownRisk = (riskContext?.unknownRiskTradeCount ?? 0) > 0
  const riskContextUnavailable = !loadingContext && riskContext == null
  const ready = result.status === "ready"

  return (
    <div className="space-y-6 font-ticker">
      <section className="rounded-3xl border border-[#2a2e40] bg-gradient-to-br from-[#121522] via-[#0d1017] to-[#0d1017] p-6 shadow-md">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-purple-400">
              <ShieldCheck className="h-4 w-4" />
              Stop-first risk sizing
            </div>
            <h2 className="text-xl font-extrabold tracking-tight text-white sm:text-2xl">Trade Size Calculator</h2>
            <p className="mt-2 max-w-3xl text-xs leading-relaxed text-[var(--color-muted-2)] sm:text-sm">
              Xác định Initial Stop trước Planned Entry, sau đó tính Trade Size từ Risk Amount và khoảng Entry–Stop. Mức 2% là điểm khởi đầu/trần ví dụ trong McDowell, không phải cam kết về kết quả giao dịch.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge>{riskProvenance}</Badge>
            <Badge>{DEFAULT_REGULAR_LOT_SHARES}-share regular lot</Badge>
          </div>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.65fr)]">
        <section className="rounded-3xl border border-[#2a2e40] bg-[#0c1017] p-6 shadow-sm">
          <div className="mb-5 flex items-center gap-2 border-b border-[var(--color-border)] pb-4">
            <Calculator className="h-4 w-4 text-purple-400" />
            <h3 className="text-sm font-extrabold uppercase tracking-wide text-white">Plan the Trade</h3>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <MetricInput
              term="accountEquity"
              value={accountEquityInput}
              onChange={(value) => {
                setAccountEquityInput(value)
                setEquitySource("manual")
              }}
              step="1000000"
              suffix="VNĐ"
            />
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
            <MetricInput term="plannedEntry" value={plannedEntryInput} onChange={setPlannedEntryInput} step="0.1" suffix="k₫" placeholder="VD: 25.0" />
            <MetricInput term="initialStop" value={initialStopInput} onChange={setInitialStopInput} step="0.1" suffix="k₫" placeholder="Xác định trước entry" />
            <MetricInput term="estimatedCommission" value={commissionInput} onChange={setCommissionInput} step="1000" suffix="VNĐ" />
            <MetricInput term="slippageAllowance" value={slippageInput} onChange={setSlippageInput} step="1000" suffix="VNĐ" />
          </div>

          {riskPercent > 2 ? (
            <label className="mt-4 flex items-start gap-2 rounded-2xl border border-amber-500/25 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-100">
              <input
                type="checkbox"
                checked={advancedAcknowledged}
                onChange={(event) => setAdvancedAcknowledged(event.target.checked)}
                className="mt-0.5 h-4 w-4"
              />
              <span>Tôi xác nhận đây là advanced manual override trên mức 2%; profile/plan không tự động cho phép tăng risk chỉ vì điểm số thấp.</span>
            </label>
          ) : null}

          {equitySource === "portfolio" && accountEquityContext.source === "portfolio_partial" ? (
            <div className="mt-4 rounded-2xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-xs text-amber-100">
              Account Equity đang partial vì thiếu market price cho: {accountEquityContext.missingPriceTickers.join(", ") || "một số mã"}. Có thể nhập Account Equity thủ công để tiếp tục với dữ liệu đã xác nhận.
            </div>
          ) : null}

          <div className="mt-5 rounded-2xl border border-[#2a2e40] bg-black/20 p-4 text-xs leading-relaxed text-slate-300">
            <p className="font-bold text-slate-100">Initial Stop guidance</p>
            <p className="mt-1">
              Đặt stop từ structural support/resistance, volatility hoặc price activity, hay trading-system rule. Trailing stop chỉ áp dụng sau entry khi Trade phát triển. Actual loss có thể vượt planned stop do gap, liquidity, volatility, overnight moves và slippage.
            </p>
          </div>
        </section>

        <section className="rounded-3xl border border-[#2a2e40] bg-[#0c1017] p-6 shadow-sm">
          <div className="mb-4 border-b border-[var(--color-border)] pb-4">
            <h3 className="text-sm font-extrabold uppercase tracking-wide text-purple-300">Deterministic Result</h3>
            <p className="mt-1 text-[11px] text-[var(--color-muted-2)]">Không tạo số 0 giả khi input chưa đủ hoặc stop không hợp lệ.</p>
          </div>

          {ready ? (
            <div className="space-y-3">
              <MetricRow term="riskAmount" value={formatVnd(result.riskAmountVnd)} />
              <MetricRow term="stopDistance" value={`${formatKvnd(result.stopDistanceKvnd)} · ${formatPercent(result.stopDistancePercent)}`} />
              <MetricRow term="riskPerShare" value={formatVnd(result.riskPerShareVnd)} />
              <MetricRow term="availableTradeRiskBudget" value={formatVnd(result.availableRiskBudgetVnd)} />
              <MetricRow term="tradeSize" value={`${result.tradeSizeShares.toLocaleString("vi-VN")} shares`} emphasized />
              <MetricRow term="positionValue" value={formatVnd(result.positionValueVnd)} />
              <MetricRow term="riskAddedByPlannedTrade" value={formatVnd(result.totalRiskConsumptionVnd)} />
            </div>
          ) : (
            <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4 text-xs leading-relaxed text-amber-100">
              {statusHelp(result.status)}
            </div>
          )}
        </section>
      </div>

      <section className="rounded-3xl border border-[#2a2e40] bg-[#0c1017] p-6 shadow-sm">
        <div className="flex flex-col gap-3 border-b border-[var(--color-border)] pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-sm font-extrabold uppercase tracking-wide text-white">Portfolio Risk Projection</h3>
            <p className="mt-1 text-[11px] text-[var(--color-muted-2)]">Known open-Trade downside risk + planned Trade risk.</p>
          </div>
          {hasUnknownRisk ? (
            <div className="inline-flex items-center gap-2 rounded-full border border-amber-500/35 bg-amber-500/10 px-3 py-1 text-xs font-bold text-amber-200">
              <AlertTriangle className="h-3.5 w-3.5" /> Risk Unknown
            </div>
          ) : null}
        </div>

        {contextError ? (
          <div className="mt-4 rounded-2xl border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-xs text-rose-200">Risk context unavailable: {contextError}</div>
        ) : null}

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <RiskCard term="activeRisk" value={loadingContext ? "Loading…" : riskContextUnavailable ? "Unavailable" : formatVnd(projectedRisk.knownActiveRiskVnd)} />
          <RiskCard term="maxActiveRisk" value={loadingContext ? "Loading…" : riskContextUnavailable ? "Unavailable" : projectedRisk.maxActiveRiskVnd == null ? "Not configured" : formatVnd(projectedRisk.maxActiveRiskVnd)} />
          <RiskCard term="remainingRiskBudget" value={loadingContext ? "Loading…" : riskContextUnavailable ? "Unavailable" : projectedRisk.remainingRiskBudgetVnd == null ? "Not configured" : formatVnd(projectedRisk.remainingRiskBudgetVnd)} />
          <RiskCard term="riskAddedByPlannedTrade" value={ready ? formatVnd(projectedRisk.plannedTradeRiskVnd) : "—"} />
          <RiskCard term="projectedActiveRisk" value={loadingContext ? "Loading…" : riskContextUnavailable ? "Unavailable" : ready ? formatVnd(projectedRisk.projectedKnownActiveRiskVnd) : "—"} />
        </div>

        {!loadingContext && hasUnknownRisk ? (
          <p className="mt-4 text-xs leading-relaxed text-amber-200">
            {riskContext?.unknownRiskTradeCount} open Trade(s) thiếu stop/fill evidence đầy đủ. Known Active Risk không được diễn giải là tổng risk toàn portfolio và hệ thống không gắn nhãn within plan.
          </p>
        ) : null}
        {!loadingContext && ready && !hasUnknownRisk && projectedRisk.status === "exceeds_plan" ? (
          <p className="mt-4 text-xs font-bold text-rose-300">Projected Active Risk vượt Max Active Risk của Money Management Plan.</p>
        ) : null}
        {!loadingContext && ready && !hasUnknownRisk && projectedRisk.status === "within_plan" ? (
          <p className="mt-4 text-xs font-bold text-emerald-300">Projected known Active Risk nằm trong configured Max Active Risk.</p>
        ) : null}
      </section>

      <details className="group rounded-3xl border border-[#2a2e40] bg-[#0c1017] p-6 shadow-sm">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-extrabold uppercase tracking-wide text-white">Advanced Evidence</h3>
            <p className="mt-1 text-[11px] text-[var(--color-muted-2)]">Win/Payoff evidence and informational Optimal f.</p>
          </div>
          <Badge>Evidence: {riskContextUnavailable ? "Unavailable" : riskContext?.evidenceCompleteness ?? "insufficient"}</Badge>
        </summary>

        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <RiskCard
            term="winRatio"
            value={loadingContext
              ? "Loading…"
              : riskContextUnavailable
                ? "Unavailable"
                : riskContext?.winRatioPercent == null
                ? "Insufficient History"
                : formatPercent(riskContext.winRatioPercent)}
          />
          <RiskCard
            term="payoffRatio"
            value={loadingContext
              ? "Loading…"
              : riskContextUnavailable
                ? "Unavailable"
                : riskContext?.payoffRatio == null
                ? "Insufficient History"
                : formatRatio(riskContext.payoffRatio)}
          />
          <RiskCard
            term="optimalF"
            value={loadingContext
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

        <div className="mt-4 rounded-2xl border border-purple-500/20 bg-purple-500/[0.07] p-4 text-xs leading-relaxed text-slate-300">
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
    <label className="space-y-2 rounded-2xl border border-white/[0.06] bg-black/20 p-4">
      <RiskMetricTooltip term={term} />
      <div className="flex items-center gap-2">
        <Input
          type="number"
          inputMode="decimal"
          step={step}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          className="h-10 border-[#2a2e40] bg-black/30 font-ticker font-bold text-white"
        />
        <span className="shrink-0 text-[11px] font-bold text-slate-500">{suffix}</span>
      </div>
    </label>
  )
}

function MetricRow({ term, value, emphasized = false }: { term: RiskTerm; value: string; emphasized?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-white/5 pb-3 text-xs">
      <RiskMetricTooltip term={term} />
      <span className={cn("text-right font-bold text-white", emphasized && "text-base text-emerald-300")}>{value}</span>
    </div>
  )
}

function RiskCard({ term, value }: { term: RiskTerm; value: string }) {
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-black/20 p-4">
      <div className="text-[11px]"><RiskMetricTooltip term={term} /></div>
      <div className="mt-2 text-sm font-black text-white">{value}</div>
    </div>
  )
}

function Badge({ children }: { children: ReactNode }) {
  return <span className="rounded-full border border-purple-500/25 bg-purple-500/10 px-3 py-1 text-[11px] font-bold text-purple-200">{children}</span>
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