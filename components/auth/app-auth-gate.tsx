"use client"

import { type ReactNode, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { BRAND } from "@/lib/brand"
import { syncServerSession } from "@/lib/auth/client-session"
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client"
import { LandingLogin } from "@/components/auth/landing-login"

type AuthStatus = "checking" | "authenticated" | "anonymous" | "unconfigured"

function AuthLoadingScreen() {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#05080b]">
      <div className="pointer-events-none absolute h-64 w-64 rounded-full bg-emerald-400/[0.07] blur-3xl" />
      <div className="relative flex flex-col items-center gap-4">
        <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl border border-emerald-300/25 bg-[#0a1117]/90 shadow-[0_0_35px_-10px_rgba(34,201,138,0.8)]">
          <img src="/brand/stockos-mark.svg" alt="" className="h-8 w-8" />
          <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-emerald-300 shadow-[0_0_12px_rgba(110,231,183,0.95)]" />
        </div>
        <div className="text-center">
          <p className="font-ticker text-lg font-extrabold italic tracking-tight text-white">{BRAND.name}</p>
          <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.2em] text-slate-600">Đang xác thực phiên</p>
        </div>
      </div>
    </div>
  )
}

export function AppAuthGate({
  children,
  serverSessionPresent,
}: {
  children: ReactNode
  serverSessionPresent: boolean
}) {
  const router = useRouter()
  const [status, setStatus] = useState<AuthStatus>(() =>
    serverSessionPresent ? "authenticated" : isSupabaseConfigured() ? "checking" : "unconfigured"
  )
  const authenticatedRef = useRef(serverSessionPresent)
  const syncGenerationRef = useRef(0)

  useEffect(() => {
    const supabase = getSupabaseBrowserClient()
    if (!supabase) {
      setStatus("unconfigured")
      return
    }

    let active = true

    async function applySession(session: Parameters<typeof syncServerSession>[0]) {
      const generation = ++syncGenerationRef.current
      const synced = await syncServerSession(session)
      if (!active || generation !== syncGenerationRef.current) return

      if (session) {
        if (synced) {
          authenticatedRef.current = true
          setStatus("authenticated")
          if (!serverSessionPresent) router.refresh()
          return
        }

        // A token-refresh sync can fail transiently while the current server
        // session is still valid. Keep the verified screen mounted instead of
        // flashing the anonymous/login UI; a real SIGNED_OUT/null session still
        // takes the explicit branch below.
        if (authenticatedRef.current || serverSessionPresent) {
          setStatus("authenticated")
          return
        }

        setStatus("anonymous")
        return
      }

      authenticatedRef.current = false
      setStatus("anonymous")
      if (serverSessionPresent) router.refresh()
    }

    void supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return
      if (error) {
        void applySession(null)
        return
      }
      void applySession(data.session)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      void applySession(session)
    })

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [router, serverSessionPresent])

  if (status === "checking") {
    return <AuthLoadingScreen />
  }

  if (status !== "authenticated") {
    return <LandingLogin />
  }

  return children
}
