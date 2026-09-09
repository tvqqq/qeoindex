import { cn } from "@/modules/shared/ui/cn"

export interface PositionBattleRailProps {
  currentPrice: number
  stopLoss: number | null
  targetPrice: number | null
}

function formatPrice(value: number | null): string {
  return value == null || !Number.isFinite(value) ? "—" : `${value.toFixed(1)} k₫`
}

export function PositionBattleRail({ currentPrice, stopLoss, targetPrice }: PositionBattleRailProps) {
  const hasRange = stopLoss != null && targetPrice != null
  const low = hasRange ? Math.min(stopLoss, targetPrice) : currentPrice
  const high = hasRange ? Math.max(stopLoss, targetPrice) : currentPrice
  const progress = high > low
    ? Math.max(0, Math.min(100, ((currentPrice - low) / (high - low)) * 100))
    : 50

  return (
    <div className="rounded-2xl border border-white/[0.08] bg-black/15 px-4 py-3">
      <div className="grid grid-cols-3 gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
        <div>
          <span className="block">STOP</span>
          <strong className="mt-1 block text-sm tracking-normal text-[var(--color-down)] tabular-nums">{formatPrice(stopLoss)}</strong>
        </div>
        <div className="text-center">
          <span className="block">CURRENT</span>
          <strong className="mt-1 block text-sm tracking-normal text-white tabular-nums">{formatPrice(currentPrice)}</strong>
        </div>
        <div className="text-right">
          <span className="block">TARGET</span>
          <strong className="mt-1 block text-sm tracking-normal text-[var(--color-up)] tabular-nums">{formatPrice(targetPrice)}</strong>
        </div>
      </div>

      <div className="relative mt-3 h-2 rounded-full bg-white/[0.08]" aria-hidden="true">
        <div className="absolute inset-y-0 left-0 right-0 rounded-full bg-gradient-to-r from-[var(--color-down)]/35 via-slate-400/20 to-[var(--color-up)]/35" />
        <span
          className={cn(
            "absolute top-1/2 h-4 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/60 bg-white shadow-[0_0_12px_rgba(255,255,255,0.45)]",
            !hasRange && "opacity-50",
          )}
          style={{ left: `${progress}%` }}
        />
      </div>

      {!hasRange ? (
        <p className="mt-2 text-sm leading-5 text-slate-500">Rail chỉ định vị đầy đủ khi cả stop và target đều có dữ liệu.</p>
      ) : null}
    </div>
  )
}
