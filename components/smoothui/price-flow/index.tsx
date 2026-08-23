"use client"

import { useEffect, useMemo, useRef } from "react"
import { LazyMotion, domAnimation, m, useReducedMotion } from "motion/react"

import { cn } from "@/lib/utils"

export function PriceFlow({
  value,
  digits = 2,
  prefix = "",
  suffix = "",
  showSign = false,
  locale = "en-US",
  className,
}: {
  value: number | null | undefined
  digits?: number
  prefix?: string
  suffix?: string
  showSign?: boolean
  locale?: string
  className?: string
}) {
  const reducedMotion = useReducedMotion() ?? false
  const previousRef = useRef<number | null>(null)
  const finiteValue = value != null && Number.isFinite(value) ? value : null
  const previous = previousRef.current
  const direction = finiteValue == null || previous == null || finiteValue === previous ? 0 : finiteValue > previous ? 1 : -1

  useEffect(() => {
    previousRef.current = finiteValue
  }, [finiteValue])

  const formatted = useMemo(() => {
    if (finiteValue == null) return "—"
    return finiteValue.toLocaleString(locale, { maximumFractionDigits: digits })
  }, [digits, finiteValue, locale])

  const sign = finiteValue != null && showSign && finiteValue > 0 ? "+" : ""
  const label = `${prefix}${sign}${formatted}${suffix}`

  return (
    <LazyMotion features={domAnimation} strict>
      <span className={cn("inline-flex tabular-nums", className)} aria-label={label}>
        <m.span
          key={label}
          initial={reducedMotion || direction === 0 ? false : { opacity: 0.45, y: direction * 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={reducedMotion ? { duration: 0 } : { duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
        >
          {label}
        </m.span>
      </span>
    </LazyMotion>
  )
}
