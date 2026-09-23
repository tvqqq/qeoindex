"use client"

import { type ReactNode, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { syncServerSession } from "@/modules/auth/client-session"
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/modules/shared/supabase/client"
import { LandingLogin } from "@/components/auth/landing-login"
import { BrandLoadingScreen } from "@/components/brand-loading-screen"

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

  return <BrandLoadingScreen label={copy.label} detail={copy.detail} />
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
