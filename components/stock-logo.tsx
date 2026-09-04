"use client"

import React, { memo, useEffect, useState } from "react"

import { stockLogoUrl } from "@/modules/market/stock-logo-url"

export interface StockLogoProps {
  symbol: string
  size?: number
  className?: string
  alt?: string
  fallback?: "badge" | "none"
  logoPath?: string | null
}

export const StockLogo = memo(function StockLogo({
  symbol,
  size = 28,
  className = "",
  alt,
  fallback = "badge",
  logoPath,
}: StockLogoProps) {
  const ticker = symbol?.toUpperCase() || ""
  const [error, setError] = useState(false)
  const src = stockLogoUrl(logoPath || ticker)

  useEffect(() => setError(false), [src])

  if (!ticker) return null

  if (error || !src) {
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
      style={{ width: size, height: size }}
      title={alt || `Logo ${ticker}`}
    >
      <img
        src={src}
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
