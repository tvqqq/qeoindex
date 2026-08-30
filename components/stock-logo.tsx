"use client"

import React, { memo, useState } from "react"

export interface StockLogoProps {
  symbol: string
  size?: number
  className?: string
  alt?: string
  fallback?: "badge" | "none"
}

export const StockLogo = memo(function StockLogo({
  symbol,
  size = 28,
  className = "",
  alt,
  fallback = "badge",
}: StockLogoProps) {
  const ticker = symbol?.toUpperCase() || ""
  const [error, setError] = useState(false)

  if (!ticker) return null

  // If image errored, display clean branded fallback badge or return null if fallback is none
  if (error) {
    if (fallback === "none") return null
    const defaultRounded = className.includes("rounded-") ? "" : "rounded-lg"
    return (
      <div
        className={`inline-flex shrink-0 items-center justify-center ${defaultRounded} border border-white/10 bg-white/[0.06] font-mono font-bold text-foreground/80 shadow-sm select-none ${className}`}
        style={{
          width: size,
          height: size,
          fontSize: Math.max(9, Math.round(size * 0.35)),
        }}
        title={alt || ticker}
      >
        {ticker.slice(0, 3)}
      </div>
    )
  }

  const defaultRounded = className.includes("rounded-") ? "" : "rounded-lg"

  return (
    <div
      className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden ${defaultRounded} border border-white/20 bg-[#ffffff] p-1 shadow-[0_2px_8px_rgba(0,0,0,0.2)] transition-transform hover:scale-105 select-none ${className}`}
      style={{
        width: size,
        height: size,
      }}
      title={alt || `Logo ${ticker}`}
    >
      <img
        src={`/logos/${ticker}.png`}
        alt={alt || `Logo ${ticker}`}
        width={size}
        height={size}
        loading="lazy"
        onError={() => setError(true)}
        className="h-full w-full object-contain"
      />
    </div>
  )
})
