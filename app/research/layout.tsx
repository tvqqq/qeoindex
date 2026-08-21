import type { ReactNode } from "react"

import { LandingLogin } from "@/components/auth/landing-login"
import { getServerAuthContext } from "@/lib/auth/server"

export const dynamic = "force-dynamic"

export default async function ResearchLayout({ children }: { children: ReactNode }) {
  const auth = await getServerAuthContext()
  if (!auth) return <LandingLogin />
  return children
}
