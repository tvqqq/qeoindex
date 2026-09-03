"use client"

import { stagger } from "motion"
import { LazyMotion, domAnimation, m, useAnimate, useReducedMotion } from "motion/react"
import { useEffect, useRef, type ReactNode } from "react"

export type MarketBoardTransitionProps = {
  children: ReactNode
  className?: string
}

const EASE_OUT = [0.23, 1, 0.32, 1] as const
const INDEX_CARD_SELECTOR = ":scope > div > div:first-child > div"
const FILTER_SHELL_INDEX_CARD_SELECTOR = `${INDEX_CARD_SELECTOR}:first-child > div`
const SECTOR_PANEL_SELECTOR = "section"

/**
 * Load-only SmoothUI entrance for the market board.
 *
 * The animation is intentionally coarse-grained: four index cards and six
 * sector panels animate once after hydration, then Motion is idle while DNSE
 * realtime updates continue. No ticker row, number, sparkline, or quote update
 * participates in the animation path.
 *
 * MarketBoardFilterShell adds one wrapper between this transition scope and
 * LiveMarketBoardV2. Narrow the legacy board selector to its first child
 * (IndexStrip) before selecting the four index cards, otherwise the selector
 * would animate multiple board-level blocks after the shell was introduced.
 */
export default function MarketBoardTransition({ children, className = "" }: MarketBoardTransitionProps) {
  const shouldReduceMotion = useReducedMotion()
  const [scope, animate] = useAnimate<HTMLDivElement>()
  const hasPlayedRef = useRef(false)

  useEffect(() => {
    if (hasPlayedRef.current) return
    hasPlayedRef.current = true
    if (shouldReduceMotion) return

    void animate(
      FILTER_SHELL_INDEX_CARD_SELECTOR,
      {
        opacity: [0, 1],
        transform: ["translate3d(0, -28px, 0) scale(0.965)", "translate3d(0, 0, 0) scale(1)"],
      },
      {
        delay: stagger(0.065, { startDelay: 0.04 }),
        duration: 0.36,
        ease: EASE_OUT,
      },
    )

    void animate(
      SECTOR_PANEL_SELECTOR,
      {
        opacity: [0, 1],
        transform: ["translate3d(0, 48px, 0) scale(0.975)", "translate3d(0, 0, 0) scale(1)"],
      },
      {
        delay: stagger(0.065, { from: "center", startDelay: 0.16 }),
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
        data-market-board-transition="load-only"
        initial={shouldReduceMotion ? false : { opacity: 0 }}
        transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.14, ease: EASE_OUT }}
      >
        {children}
      </m.div>
    </LazyMotion>
  )
}
