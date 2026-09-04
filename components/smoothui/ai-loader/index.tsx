"use client"

import { LazyMotion, domAnimation, m, useReducedMotion } from "motion/react"

import { cn } from "@/modules/shared/ui/cn"

export function AiLoader({
  label = "Đang xử lý",
  className,
  compact = false,
  showLabel = true,
  compositorSafe = false,
}: {
  label?: string
  className?: string
  compact?: boolean
  showLabel?: boolean
  compositorSafe?: boolean
}) {
  const reducedMotion = useReducedMotion() ?? false

  return (
    <LazyMotion features={domAnimation} strict>
      <div
        role="status"
        aria-label={label}
        aria-live="polite"
        className={cn(
          "inline-flex items-center rounded-lg border border-white/[0.08] bg-[#0b1119] font-medium text-slate-400",
          compact ? "gap-1.5 px-2 py-1 text-[10px]" : "gap-2.5 px-3 py-2 text-xs",
          className,
        )}
      >
        <span className="inline-flex items-end gap-1" aria-hidden="true">
          {[0, 1, 2].map((index) => (
            <m.span
              key={index}
              className={cn("block rounded-full bg-cyan-300", compact ? "size-1" : "size-1.5")}
              animate={
                reducedMotion
                  ? { opacity: 0.65, y: 0 }
                  : compositorSafe
                    ? { opacity: [0.25, 1, 0.25], y: 0 }
                    : { opacity: [0.28, 1, 0.28], y: compact ? [0, -2, 0] : [0, -3, 0] }
              }
              transition={reducedMotion ? { duration: 0 } : { duration: 0.9, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut", delay: index * 0.12 }}
            />
          ))}
        </span>
        {showLabel ? <span>{label}</span> : null}
      </div>
    </LazyMotion>
  )
}
