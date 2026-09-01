"use client"

import { useEffect, useRef } from "react"
import { useRouter } from "next/navigation"

const UNIVERSE_VERSION_POLL_MS = 60_000

export function MarketUniverseVersionRefresh({ universeRunId }: { universeRunId: string }) {
  const router = useRouter()
  const refreshingRef = useRef(false)

  useEffect(() => {
    let disposed = false

    async function checkUniverseVersion() {
      if (disposed || refreshingRef.current || document.visibilityState !== "visible") return
      try {
        const response = await fetch("/api/market-universe/version", {
          cache: "no-store",
          headers: { Accept: "application/json" },
        })
        if (!response.ok) return
        const payload = await response.json() as { runId?: string }
        if (payload.runId && payload.runId !== universeRunId) {
          refreshingRef.current = true
          router.refresh()
        }
      } catch {
        // A transient version-check failure must not disrupt live market data.
      }
    }

    const interval = window.setInterval(checkUniverseVersion, UNIVERSE_VERSION_POLL_MS)
    const handleVisibility = () => { if (document.visibilityState === "visible") void checkUniverseVersion() }
    document.addEventListener("visibilitychange", handleVisibility)
    void checkUniverseVersion()

    return () => {
      disposed = true
      window.clearInterval(interval)
      document.removeEventListener("visibilitychange", handleVisibility)
    }
  }, [router, universeRunId])

  return null
}
