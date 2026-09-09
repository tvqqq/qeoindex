"use client"

import { LazyMotion, domAnimation, m, useReducedMotion } from "motion/react"
import type { ReactNode } from "react"

import { cn } from "@/modules/shared/ui/cn"

export function PortfolioTabMotion({
  children,
  motionKey,
  className,
}: {
  children: ReactNode
  motionKey: string
  className?: string
}) {
  const reduceMotion = useReducedMotion()

  return (
    <LazyMotion features={domAnimation}>
      <m.div
        key={motionKey}
        className={className}
        initial={reduceMotion ? { opacity: 1 } : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={reduceMotion ? { duration: 0 } : { duration: 0.22, ease: "easeOut" }}
      >
        {children}
      </m.div>
    </LazyMotion>
  )
}

export function PortfolioCardMotion({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  const reduceMotion = useReducedMotion()

  return (
    <LazyMotion features={domAnimation}>
      <m.div
        className={cn("h-full", className)}
        initial={reduceMotion ? false : { opacity: 0, y: 6 }}
        animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
        whileHover={reduceMotion ? undefined : { y: -3, scale: 1.005 }}
        transition={reduceMotion ? { duration: 0 } : { duration: 0.18, ease: "easeOut" }}
      >
        {children}
      </m.div>
    </LazyMotion>
  )
}
