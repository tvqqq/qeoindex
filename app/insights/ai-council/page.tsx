import type { Metadata } from "next"
import Link from "next/link"
import { BarChart3, Swords } from "lucide-react"

import { LandingLogin } from "@/components/auth/landing-login"
import { AiCouncilDashboard } from "@/components/insights/ai-council-dashboard"
import { getServerAuthContext } from "@/lib/auth/server"
import { getAiCouncilRuntimeData } from "@/lib/ai-council-runtime"

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
  const runtime = await getAiCouncilRuntimeData(auth.supabase)
  return (
    <>
      <AiCouncilDashboard data={runtime.data} initialTicker={initialTicker} />
      <div className="fixed bottom-5 right-5 z-50 flex items-center gap-2">
        <Link
          href="/insights/ai-council/debates"
          className="inline-flex items-center gap-2 rounded-xl border border-cyan-400/25 bg-[#0b1017]/95 px-3.5 py-2.5 text-[10px] font-black text-cyan-200 shadow-2xl backdrop-blur hover:border-cyan-300/45 hover:text-white"
        >
          <Swords className="size-4" />
          LLM Debate Lab
        </Link>
        <Link
          href="/insights/ai-council/performance"
          className="inline-flex items-center gap-2 rounded-xl border border-violet-400/25 bg-[#0b1017]/95 px-3.5 py-2.5 text-[10px] font-black text-violet-200 shadow-2xl backdrop-blur hover:border-violet-300/45 hover:text-white"
        >
          <BarChart3 className="size-4" />
          Performance Lab
        </Link>
      </div>
    </>
  )
}
