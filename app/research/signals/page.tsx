import { SignalsApp } from "@/components/research/signals-app"
import { getRecommendations, getSignalEvents } from "@/lib/signal-data"
import { buildRecommendationPerformance } from "@/lib/signal-performance"
import { getSupabaseSignalLedger, operationalBackend } from "@/lib/repositories/signal-repository"
import { supabaseServerConfigured } from "@/lib/supabase/server"
import { telegramConfigured } from "@/lib/telegram"

export const dynamic = "force-dynamic"
export const revalidate = 0

export default async function SignalsPage() {
  const backend = operationalBackend()
  let recommendations = [] as Awaited<ReturnType<typeof getRecommendations>>
  let events = [] as Awaited<ReturnType<typeof getSignalEvents>>
  let readError = ""
  try {
    if (backend === "supabase") {
      ;({ recommendations, events } = await getSupabaseSignalLedger())
    } else {
      ;[recommendations, events] = await Promise.all([getRecommendations(), getSignalEvents()])
    }
  } catch (error) {
    readError = error instanceof Error ? error.message : String(error)
    console.error(`Signals page ${backend} read failed`, error)
  }

  const performance = buildRecommendationPerformance(recommendations)
  return <SignalsApp
    recommendations={recommendations}
    events={events}
    performance={performance}
    dataSource={backend}
    readError={readError}
    supabaseReady={supabaseServerConfigured()}
    monitorReady={Boolean(process.env.DNSE_API_KEY && process.env.DNSE_API_SECRET)}
    telegramReady={telegramConfigured()}
    cronSecretReady={Boolean(process.env.CRON_SECRET || process.env.SIGNAL_MONITOR_SECRET)}
  />
}
