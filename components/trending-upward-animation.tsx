"use client"

import { useEffect, useState } from "react"
import { Lottie } from "lottie-react"
import moneyGrowthData from "@/public/brand/money-growth.json"

export function MoneyGrowthLottie({ className = "h-7 w-7" }: { className?: string }) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  return (
    <div className={`relative flex items-center justify-center shrink-0 ${className}`}>
      {mounted ? (
        <Lottie
          src={moneyGrowthData}
          loop
          autoplay
          style={{ width: "100%", height: "100%" }}
          className="w-full h-full object-contain drop-shadow-[0_0_10px_rgba(34,201,138,0.75)]"
        />
      ) : (
        <img
          src="/brand/money-growth.gif"
          alt="Money growth animation"
          className="w-full h-full object-contain drop-shadow-[0_0_10px_rgba(34,201,138,0.75)]"
        />
      )}
    </div>
  )
}

// Alias for backwards compatibility
export const TrendingUpwardLottie = MoneyGrowthLottie
