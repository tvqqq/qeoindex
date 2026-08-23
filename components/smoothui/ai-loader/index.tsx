"use client"

import { LazyMotion, domAnimation, m, useReducedMotion } from "motion/react"

import { cn } from "@/lib/utils"

export function AiLoader({ label = "Đang xử lý", className }: { label?: string; className?: string }) {
  const reducedMotion = useReducedMotion() ?? false

  return (
    <LazyMotion features={domAnimation} strict>
      <div role="status" aria-live="polite" className={cn("inline-flex items-center gap-2.5 rounded-lg border border-white/[0.08] bg-[#0b1119] px-3 py-2 text-xs font-medium text-slate-400", className)}>
        <span className="inline-flex items-end gap-1" aria-hidden="true">
          {[0, 1, 2].map((index) => (
            <m.span
              key={index}
              className="block size-1.5 rounded-full bg-cyan-300"
              animate={reducedMotion ? { opacity: 0.65, y: 0 } : { opacity: [0.28, 1, 0.28], y: [0, -3, 0] }}
              transition={reducedMotion ? { duration: 0 } : { duration: 0.9, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut", delay: index * 0.12 }}
            />
          ))}
        </span>
        <span>{label}</span>
      </div>
    </LazyMotion>
  )
}
