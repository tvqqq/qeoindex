"use client"

import { stagger } from "motion"
import { LazyMotion, domAnimation, m, useAnimate, useReducedMotion } from "motion/react"
import { useEffect, useRef, type ReactNode } from "react"

export type InsightsTransitionProps = {
  children: ReactNode
  className?: string
}

const EASE_OUT = [0.23, 1, 0.32, 1] as const
const HERO_SELECTOR = ":scope > div > div:first-child"
const METRIC_CARDS_SELECTOR = "[data-insights-metrics] > div"
const TABLE_CONTAINER_SELECTOR = "[data-insights-table]"

/**
 * Load-only SmoothUI entrance for the insights dashboard.
 *
 * Smooth stagger on hero, metrics, and table on initial page mount,
 * strictly using opacity & translate3d for GPU acceleration without filter blur.
 */
export default function InsightsTransition({ children, className = "" }: InsightsTransitionProps) {
  const shouldReduceMotion = useReducedMotion()
  const [scope, animate] = useAnimate<HTMLDivElement>()
  const hasPlayedRef = useRef(false)

  useEffect(() => {
    if (hasPlayedRef.current) return
    hasPlayedRef.current = true
    if (shouldReduceMotion) return

    void animate(
      HERO_SELECTOR,
      {
        opacity: [0, 1],
        transform: ["translate3d(0, -16px, 0)", "translate3d(0, 0, 0)"],
      },
      {
        duration: 0.32,
        ease: EASE_OUT,
      },
    )

    void animate(
      METRIC_CARDS_SELECTOR,
      {
        opacity: [0, 1],
        transform: ["translate3d(0, 20px, 0)", "translate3d(0, 0, 0)"],
      },
      {
        delay: stagger(0.05, { startDelay: 0.08 }),
        duration: 0.36,
        ease: EASE_OUT,
      },
    )

    void animate(
      TABLE_CONTAINER_SELECTOR,
      {
        opacity: [0, 1],
        transform: ["translate3d(0, 28px, 0)", "translate3d(0, 0, 0)"],
      },
      {
        delay: 0.18,
        duration: 0.4,
        ease: EASE_OUT,
      },
    )
  }, [animate, shouldReduceMotion])

  return (
    <LazyMotion features={domAnimation} strict>
      <m.div
        ref={scope}
        animate={{ opacity: 1 }}
        className={className}
        data-insights-transition="load-only"
        initial={shouldReduceMotion ? false : { opacity: 0 }}
        transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.14, ease: EASE_OUT }}
      >
        {children}
      </m.div>
    </LazyMotion>
  )
}
