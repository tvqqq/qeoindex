from pathlib import Path

data_path = Path("modules/research/market-insight/data.ts")
dashboard_path = Path("components/insights/market-close-dashboard.tsx")
data = data_path.read_text()
dashboard = dashboard_path.read_text()

old_history = '''      .select("session_date,market_regime,sentiment_score,risk_score,above_ma10_pct,above_ma20_pct,above_ma50_pct,above_ma200_pct,foreign_net_value,proprietary_net_value,total_traded_value")
      .lte("session_date", targetDate)
      .order("session_date", { ascending: false })
      .limit(20),'''
new_history = '''      .select("session_date,market_regime,sentiment_score,risk_score,above_ma10_pct,above_ma20_pct,above_ma50_pct,above_ma200_pct,foreign_net_value,proprietary_net_value,total_traded_value")
      .lte("session_date", targetDate)
      .order("session_date", { ascending: false })
      .limit(61),'''
if old_history not in data:
    raise SystemExit("missing history query anchor")
data = data.replace(old_history, new_history, 1)

old_import = '''import { buildMarketSessionChanges, type MarketSessionChanges } from "@/modules/research/market-insight/session-changes"
import { MarketWidgetChildHeader } from "@/components/insights/market-widget-child-header"'''
new_import = '''import { buildMarketSessionChanges, type MarketSessionChanges } from "@/modules/research/market-insight/session-changes"
import { buildLiquidityContext, type LiquidityContext } from "@/modules/research/market-insight/liquidity-context"
import { MarketWidgetChildHeader } from "@/components/insights/market-widget-child-header"'''
if old_import not in dashboard:
    raise SystemExit("missing dashboard import anchor")
dashboard = dashboard.replace(old_import, new_import, 1)

old_derivation = '''  const distributionGuidance = getDistributionDayGuidance(dailySummary.distributionCount)
  const sessionChanges = buildMarketSessionChanges(data)'''
new_derivation = '''  const distributionGuidance = getDistributionDayGuidance(dailySummary.distributionCount)
  const sessionChanges = buildMarketSessionChanges(data)
  const liquidityContext = buildLiquidityContext({
    sessionDate: data.sessionDate,
    currentValue: dailySummary.totalTradedValue,
    history,
  })'''
if old_derivation not in dashboard:
    raise SystemExit("missing derivation anchor")
dashboard = dashboard.replace(old_derivation, new_derivation, 1)

old_render = '''          <div data-market-session-changes><MarketSessionChangesStrip changes={sessionChanges} /></div>'''
new_render = '''          <div data-market-session-changes><MarketSessionChangesStrip changes={sessionChanges} liquidityContext={liquidityContext} /></div>'''
if old_render not in dashboard:
    raise SystemExit("missing render anchor")
dashboard = dashboard.replace(old_render, new_render, 1)

old_signature = '''function MarketSessionChangesStrip({ changes }: { changes: MarketSessionChanges }) {'''
new_signature = '''function MarketSessionChangesStrip({ changes, liquidityContext }: { changes: MarketSessionChanges; liquidityContext: LiquidityContext }) {'''
if old_signature not in dashboard:
    raise SystemExit("missing strip signature anchor")
dashboard = dashboard.replace(old_signature, new_signature, 1)

old_liquidity = '''        <SessionChangeMetric
          label="Thanh khoản"
          value={formatNumber(changes.liquidity.current, 0)}
          detail={changes.liquidity.deltaPct == null ? "Chưa đủ dữ liệu" : `${formatSigned(changes.liquidity.deltaPct, 1, "%")} vs phiên trước`}
        />'''
new_liquidity = '''        <LiquidityContextMetric context={liquidityContext} />'''
if old_liquidity not in dashboard:
    raise SystemExit("missing liquidity tile anchor")
dashboard = dashboard.replace(old_liquidity, new_liquidity, 1)

marker = '''function formatSessionDelta(delta: number | null, decimals: number, suffix = "") {'''
component = '''function LiquidityContextMetric({ context }: { context: LiquidityContext }) {
  const hasMinimumHistory = context.current != null && context.historyCount >= 20
  const stateLabel = context.state === "confirmed"
    ? "Xác nhận"
    : context.state === "weak"
      ? "Yếu"
      : hasMinimumHistory
        ? "Trung tính"
        : "Chưa đủ dữ liệu"
  const stateTone = context.state === "confirmed" ? "up" : context.state === "weak" ? "down" : undefined

  return (
    <div data-market-liquidity-context className="min-w-0 rounded-xl border border-white/[0.06] bg-[#07131d]/70 px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold text-slate-400">Thanh khoản</span>
        <span className={cn(
          "shrink-0 rounded-full border border-white/[0.08] px-1.5 py-0.5 text-[9px] font-bold text-slate-400",
          stateTone === "up" && "border-emerald-300/20 bg-emerald-300/[0.08] text-emerald-300",
          stateTone === "down" && "border-rose-300/20 bg-rose-300/[0.08] text-rose-300",
        )}>Tín hiệu · {stateLabel}</span>
      </div>
      <strong className="mt-0.5 block truncate font-mono text-sm font-black text-white">{formatNumber(context.current, 0)}</strong>
      <span className="mt-0.5 block truncate text-[10px] font-semibold text-slate-400">
        {context.vsMa20Pct == null ? "MA20 thanh khoản: chưa đủ dữ liệu" : `${formatSigned(context.vsMa20Pct, 1, "%")} vs MA20 thanh khoản`}
      </span>
      <span className="mt-0.5 block truncate text-[10px] font-semibold text-slate-500">
        {context.percentile60 == null
          ? `Percentile 60 phiên: chưa đủ dữ liệu (${context.historyCount}/20 tối thiểu)`
          : `Percentile 60 phiên: P${formatNumber(context.percentile60, 0)}`}
      </span>
    </div>
  )
}

'''
if marker not in dashboard:
    raise SystemExit("missing component insertion anchor")
dashboard = dashboard.replace(marker, component + marker, 1)

data_path.write_text(data)
dashboard_path.write_text(dashboard)
