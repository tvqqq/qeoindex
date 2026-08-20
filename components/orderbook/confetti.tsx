"use client"

import { useEffect, useRef, useState } from "react"
import { Lottie } from "lottie-react"

export interface WhaleAlertState {
  active: boolean
  side: "BUY" | "SELL" | "REF"
  volume?: number
  price?: number
}

const DURATION_MS = 2800

export function useWhaleConfetti() {
  const [alert, setAlert] = useState<WhaleAlertState>({
    active: false,
    side: "BUY",
  })
  const timerRef = useRef<number | null>(null)

  const fire = (side: "BUY" | "SELL" | "REF" = "BUY", volume?: number, price?: number) => {
    if (timerRef.current) window.clearTimeout(timerRef.current)
    setAlert({
      active: true,
      side: side === "SELL" ? "SELL" : "BUY",
      volume,
      price,
    })
    timerRef.current = window.setTimeout(() => {
      setAlert((prev) => ({ ...prev, active: false }))
      timerRef.current = null
    }, DURATION_MS)
  }

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current)
    }
  }, [])

  return { active: alert.active, side: alert.side, alert, fire }
}

export function ConfettiOverlay({
  active,
  side = "BUY",
  volume,
}: {
  active: boolean
  side?: "BUY" | "SELL" | "REF"
  volume?: number
}) {
  if (!active) return null

  const isSell = side === "SELL"
  const animationSrc = isSell ? "/lottie/whale-sell.json" : "/lottie/whale-buy.json"

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-50 flex flex-col items-center justify-center overflow-hidden rounded-2xl bg-black/40 backdrop-blur-[2px] transition-all duration-300 animate-in fade-in"
    >
      <div className="relative flex flex-col items-center justify-center p-4">
        {/* Lottie Animation container */}
        <div className="relative h-44 w-44 sm:h-52 sm:w-52 drop-shadow-[0_10px_25px_rgba(0,0,0,0.6)]">
          <Lottie
            src={animationSrc}
            loop={false}
            autoplay={true}
            style={{ width: "100%", height: "100%" }}
          />
        </div>

        {/* Whale Badge Alert */}
        <div
          className={`mt-1 flex items-center gap-2 rounded-full border px-4 py-1.5 shadow-2xl backdrop-blur-md animate-bounce font-mono text-xs sm:text-sm font-black tracking-wide uppercase ${
            isSell
              ? "border-red-500/80 bg-red-950/80 text-red-300 shadow-red-500/20"
              : "border-emerald-400/80 bg-emerald-950/80 text-emerald-300 shadow-emerald-400/20"
          }`}
        >
          <span>{isSell ? "🔻" : "🚀"}</span>
          <span>{isSell ? "LỆNH CÁ MẬP XẢ HÀNG" : "LỆNH CÁ MẬP VÀO HÀNG"}</span>
          {volume ? (
            <span className="opacity-90 font-bold">
              ({volume >= 1_000_000 ? `${(volume / 1_000_000).toFixed(1)}M` : `${Math.round(volume / 1000)}K`} cp)
            </span>
          ) : null}
        </div>
      </div>
    </div>
  )
}
