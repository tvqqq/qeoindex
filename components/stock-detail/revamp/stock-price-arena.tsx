import { Crosshair } from "lucide-react"

import { rangePosition } from "./stock-card-metrics"

interface StockPriceArenaProps {
  floorPrice: number
  lowPrice: number
  refPrice: number
  currentPrice: number
  highPrice: number
  ceilingPrice: number
}

function validPrice(value: number) {
  return Number.isFinite(value) && value > 0
}

function formatPrice(value: number) {
  return validPrice(value) ? value.toLocaleString("vi-VN") : "—"
}

export function StockPriceArena({
  floorPrice,
  lowPrice,
  refPrice,
  currentPrice,
  highPrice,
  ceilingPrice,
}: StockPriceArenaProps) {
  const candidates = [floorPrice, lowPrice, refPrice, currentPrice, highPrice, ceilingPrice].filter(validPrice)
  const fallbackFloor = candidates.length ? Math.min(...candidates) : 0
  const fallbackCeiling = candidates.length ? Math.max(...candidates) : 1
  const lower = validPrice(floorPrice) ? floorPrice : fallbackFloor
  const upperCandidate = validPrice(ceilingPrice) ? ceilingPrice : fallbackCeiling
  const upper = upperCandidate > lower ? upperCandidate : lower + Math.max(Math.abs(lower) * 0.01, 1)

  const currentPosition = rangePosition(currentPrice, lower, upper)
  const refPosition = rangePosition(refPrice, lower, upper)
  const lowPosition = rangePosition(lowPrice, lower, upper)
  const highPosition = rangePosition(highPrice, lower, upper)

  return (
    <div className="mt-4 rounded-2xl border border-white/[0.07] bg-[#05080d]/70 p-3 sm:p-3.5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex size-6 items-center justify-center rounded-lg border border-cyan-400/15 bg-cyan-400/[0.06] text-cyan-300">
            <Crosshair className="size-3" />
          </span>
          <span className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-400">PRICE ARENA</span>
        </div>
        <span className="text-[9px] text-slate-600">Vị trí giá trong biên độ sàn → trần</span>
      </div>

      <div className="relative px-1 pt-5">
        <div className="relative h-2 rounded-full border border-white/[0.08] bg-gradient-to-r from-cyan-400/15 via-white/[0.06] to-fuchsia-400/15 shadow-inner">
          <div
            aria-hidden="true"
            className="absolute top-1/2 h-4 w-px -translate-y-1/2 bg-amber-300/60"
            style={{ left: `${refPosition}%` }}
          />
          <div
            aria-hidden="true"
            className="absolute top-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-slate-400"
            style={{ left: `${lowPosition}%` }}
          />
          <div
            aria-hidden="true"
            className="absolute top-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-slate-200"
            style={{ left: `${highPosition}%` }}
          />
          <div
            className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${currentPosition}%` }}
          >
            <span className="absolute bottom-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-lg border border-white/15 bg-[#101723] px-2 py-1 font-mono text-[9px] font-black text-white shadow-[0_5px_18px_rgba(0,0,0,0.45)]">
              {formatPrice(currentPrice)}
            </span>
            <span className="block size-3 rounded-full border-2 border-[#06090e] bg-white shadow-[0_0_14px_rgba(255,255,255,0.35)]" />
          </div>
        </div>

        <div className="mt-2 grid grid-cols-3 gap-2 font-mono text-[9px]">
          <div className="text-left">
            <span className="block text-slate-600">Sàn</span>
            <b className="text-cyan-300">{formatPrice(floorPrice)}</b>
          </div>
          <div className="text-center">
            <span className="block text-slate-600">Tham chiếu</span>
            <b className="text-amber-300">{formatPrice(refPrice)}</b>
          </div>
          <div className="text-right">
            <span className="block text-slate-600">Trần</span>
            <b className="text-fuchsia-300">{formatPrice(ceilingPrice)}</b>
          </div>
        </div>

        <div className="mt-2 flex items-center justify-center gap-3 border-t border-white/[0.05] pt-2 font-mono text-[9px] text-slate-600">
          <span>Low <b className="text-slate-400">{formatPrice(lowPrice)}</b></span>
          <span aria-hidden="true">·</span>
          <span>High <b className="text-slate-300">{formatPrice(highPrice)}</b></span>
        </div>
      </div>
    </div>
  )
}
