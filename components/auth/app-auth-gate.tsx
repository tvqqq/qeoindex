"use client"

import { type ReactNode, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { BRAND } from "@/lib/brand"
import { syncServerSession } from "@/lib/auth/client-session"
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client"
import { LandingLogin } from "@/components/auth/landing-login"

type AuthStatus =
  | "checking"
  | "establishing"
  | "loading-board"
  | "authenticated"
  | "anonymous"
  | "unconfigured"

type AuthLoadingStatus = Extract<AuthStatus, "checking" | "establishing" | "loading-board">

const AUTH_LOADING_COPY: Record<AuthLoadingStatus, { label: string; detail: string }> = {
  checking: {
    label: "Đang xác thực phiên",
    detail: "Kiểm tra trạng thái đăng nhập",
  },
  establishing: {
    label: "Đang thiết lập phiên",
    detail: "Đồng bộ quyền truy cập an toàn",
  },
  "loading-board": {
    label: "Đang tải Bảng điện",
    detail: "Chuẩn bị dữ liệu thị trường",
  },
}

function AuthLoadingScreen({ status }: { status: AuthLoadingStatus }) {
  const copy = AUTH_LOADING_COPY[status]

  return (
    <div
      className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#05080b]"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="pointer-events-none absolute h-64 w-64 rounded-full bg-emerald-400/[0.07] blur-3xl" />
      <div className="relative flex flex-col items-center gap-4">
        <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl border border-emerald-300/25 bg-[#0a1117]/90 shadow-[0_0_35px_-10px_rgba(34,201,138,0.8)]">
          <img src="/brand/stockos-mark.svg" alt="" className="h-8 w-8" />
          <span className="absolute -right-1 -top-1 h-2.5 w-2.5 animate-pulse rounded-full bg-emerald-300 shadow-[0_0_12px_rgba(110,231,183,0.95)]" />
        </div>
        <div className="text-center">
          <p className="font-ticker text-lg font-extrabold italic tracking-tight text-white">{BRAND.name}</p>
          <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.2em] text-emerald-200/80">{copy.label}</p>
          <p className="mt-1.5 font-mono text-[9px] tracking-[0.08em] text-slate-600">{copy.detail}</p>
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
    if (!serverSessionPresent) return
    authenticatedRef.current = true
    setStatus("authenticated")
  }, [serverSessionPresent])

  useEffect(() => {
    const supabase = getSupabaseBrowserClient()
    if (!supabase) {
      setStatus("unconfigured")
      return
    }

    let active = true

    async function applySession(session: Parameters<typeof syncServerSession>[0]) {
      const generation = ++syncGenerationRef.current

      if (session && !serverSessionPresent) {
        setStatus("establishing")
      }

      const synced = await syncServerSession(session)
      if (!active || generation !== syncGenerationRef.current) return

      if (session) {
        if (synced) {
          authenticatedRef.current = true

          if (!serverSessionPresent) {
            setStatus("loading-board")
            router.refresh()
            return
          }

          setStatus("authenticated")
          return
        }

        // A token-refresh sync can fail transiently while the current server
        // session is still valid. Preserve a verified shell, but never expose
        // browser-only authenticated state while the server tree is still the
        // anonymous render from before the session handoff.
        if (authenticatedRef.current || serverSessionPresent) {
          if (serverSessionPresent) {
            setStatus("authenticated")
            return
          }

          setStatus("loading-board")
          router.refresh()
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

  if (status === "checking" || status === "establishing" || status === "loading-board") {
    return <AuthLoadingScreen status={status} />
  }

  if (status !== "authenticated") {
    return <LandingLogin />
  }

  return children
}
