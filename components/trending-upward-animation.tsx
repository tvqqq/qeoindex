"use client"

import { useEffect, useState } from "react"
import { Lottie } from "lottie-react"
import trendingAnimationData from "@/public/brand/trending-upward.json"

export function TrendingUpwardLottie({ className = "h-5 w-5" }: { className?: string }) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return <div className={`shrink-0 ${className}`} />
  }

  return (
    <div className={`relative flex items-center justify-center shrink-0 overflow-hidden ${className}`}>
      <Lottie
        src={trendingAnimationData}
        loop
        autoplay
        className="h-full w-full object-contain drop-shadow-[0_0_8px_rgba(34,201,138,0.7)]"
      />
    </div>
  )
}
