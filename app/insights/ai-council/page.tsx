import type { Metadata } from "next"

import { LandingLogin } from "@/components/auth/landing-login"
import { AiCouncilDashboard } from "@/components/insights/ai-council-dashboard"
import { getAiCouncilData } from "@/lib/ai-council-data"
import { getServerAuthContext } from "@/lib/auth/server"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "AI Council — QeoIndex",
  description: "Hội đồng AI đa góc nhìn cho Top 100 cổ phiếu: Wyckoff, momentum, fundamental, flow, market context và risk audit.",
  alternates: { canonical: "/insights/ai-council" },
}

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

export default async function AiCouncilPage({
  searchParams,
}: {
  searchParams?: Promise<{ ticker?: string | string[] }>
}) {
  const auth = await getServerAuthContext()
  if (!auth) return <LandingLogin />
  const query = searchParams ? await searchParams : {}
  const initialTicker = (first(query.ticker) || "").trim().toUpperCase()
  const data = await getAiCouncilData(auth.supabase)
  return <AiCouncilDashboard data={data} initialTicker={initialTicker} />
}
