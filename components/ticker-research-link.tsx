"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useCallback, useEffect, useRef, type ComponentProps } from "react"

type TickerResearchLinkProps = Omit<ComponentProps<typeof Link>, "href" | "prefetch"> & {
  ticker: string
  intentDelayMs?: number
}

/**
 * Dense market tables can render ~100 research links at once. Next Link's automatic
 * viewport prefetch is counterproductive there because every ticker route is dynamic.
 * Keep auto-prefetch off and only warm a route after explicit pointer/keyboard intent.
 */
export function TickerResearchLink({
  ticker,
  intentDelayMs = 120,
  onPointerEnter,
  onPointerLeave,
  onFocus,
  onTouchStart,
  ...props
}: TickerResearchLinkProps) {
  const router = useRouter()
  const timerRef = useRef<number | null>(null)
  const href = `/research/${ticker.trim().toLowerCase()}`

  const cancelScheduledPrefetch = useCallback(() => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const prefetch = useCallback(() => {
    cancelScheduledPrefetch()
    router.prefetch(href)
  }, [cancelScheduledPrefetch, href, router])

  const schedulePrefetch = useCallback(() => {
    if (timerRef.current != null) return
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      router.prefetch(href)
    }, intentDelayMs)
  }, [href, intentDelayMs, router])

  useEffect(() => cancelScheduledPrefetch, [cancelScheduledPrefetch])

  return (
    <Link
      {...props}
      href={href}
      prefetch={false}
      onPointerEnter={(event) => {
        onPointerEnter?.(event)
        schedulePrefetch()
      }}
      onPointerLeave={(event) => {
        onPointerLeave?.(event)
        cancelScheduledPrefetch()
      }}
      onFocus={(event) => {
        onFocus?.(event)
        prefetch()
      }}
      onTouchStart={(event) => {
        onTouchStart?.(event)
        prefetch()
      }}
    />
  )
}
