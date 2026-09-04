"use client"

import { useMemo } from "react"
import { LazyMotion, domAnimation, m, useReducedMotion } from "motion/react"

import { cn } from "@/modules/shared/ui/cn"

export function PriceFlow({
  value,
  digits = 2,
  prefix = "",
  suffix = "",
  showSign = false,
  locale = "en-US",
  animate = true,
  className,
}: {
  value: number | null | undefined
  digits?: number
  prefix?: string
  suffix?: string
  showSign?: boolean
  locale?: string
  animate?: boolean
  className?: string
}) {
  const reducedMotion = useReducedMotion() ?? false
  const finiteValue = value != null && Number.isFinite(value) ? value : null

  const formatted = useMemo(() => {
    if (finiteValue == null) return "—"
    return finiteValue.toLocaleString(locale, { maximumFractionDigits: digits })
  }, [digits, finiteValue, locale])

  const sign = finiteValue != null && showSign && finiteValue > 0 ? "+" : ""
  const label = `${prefix}${sign}${formatted}${suffix}`
  const shouldAnimate = animate && !reducedMotion

  return (
    <LazyMotion features={domAnimation} strict>
      <span className={cn("inline-flex overflow-hidden tabular-nums", className)} aria-label={label}>
        <m.span
          key={label}
          initial={shouldAnimate ? { opacity: 0.45, y: 4 } : false}
          animate={{ opacity: 1, y: 0 }}
          transition={shouldAnimate ? { duration: 0.16, ease: [0.22, 1, 0.36, 1] } : { duration: 0 }}
        >
          {label}
        </m.span>
      </span>
    </LazyMotion>
  )
}
