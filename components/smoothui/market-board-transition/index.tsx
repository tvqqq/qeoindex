"use client"

import { LazyMotion, domAnimation, m, useReducedMotion } from "motion/react"
import type { ReactNode } from "react"

export type MarketBoardTransitionProps = {
  children: ReactNode
  className?: string
}

const ENTER_STATE = {
  opacity: 0,
  transform: "translate3d(0, 6px, 0)",
}

const REST_STATE = {
  opacity: 1,
  transform: "translate3d(0, 0, 0)",
}

const ENTER_TRANSITION = {
  duration: 0.22,
  ease: [0.23, 1, 0.32, 1] as const,
}

/**
 * SmoothUI-style board entrance with a single compositor-friendly surface.
 * It intentionally avoids per-row Motion nodes, layout animation, blur, and
 * persistent will-change so the live board stays cheap after the first 220ms.
 */
export default function MarketBoardTransition({ children, className = "" }: MarketBoardTransitionProps) {
  const shouldReduceMotion = useReducedMotion()

  return (
    <LazyMotion features={domAnimation} strict>
      <m.div
        animate={REST_STATE}
        className={className}
        initial={shouldReduceMotion ? false : ENTER_STATE}
        transition={shouldReduceMotion ? { duration: 0 } : ENTER_TRANSITION}
      >
        {children}
      </m.div>
    </LazyMotion>
  )
}
