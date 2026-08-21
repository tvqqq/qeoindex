"use client"

import { type ReactNode, useEffect, useState } from "react"
import { BRAND } from "@/lib/brand"
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

export function AppAuthGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>(() =>
    isSupabaseConfigured() ? "checking" : "unconfigured"
  )

  useEffect(() => {
    const supabase = getSupabaseBrowserClient()
    if (!supabase) {
      setStatus("unconfigured")
      return
    }

    let active = true

    void supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return
      if (error) {
        setStatus("anonymous")
        return
      }
      setStatus(data.session ? "authenticated" : "anonymous")
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return
      setStatus(session ? "authenticated" : "anonymous")
    })

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])

  if (status === "checking") {
    return <AuthLoadingScreen />
  }

  if (status !== "authenticated") {
    return <LandingLogin />
  }

  return children
}
