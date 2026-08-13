import { SignalsApp } from "@/components/research/signals-app"
import { getRecommendations, getSignalEvents } from "@/lib/signal-data"
import { buildRecommendationPerformance } from "@/lib/signal-performance"
import { telegramConfigured } from "@/lib/telegram"

export const dynamic = "force-dynamic"
export const revalidate = 0

export default async function SignalsPage() {
  let recommendations = [] as Awaited<ReturnType<typeof getRecommendations>>
  let events = [] as Awaited<ReturnType<typeof getSignalEvents>>
  try {
    ;[recommendations, events] = await Promise.all([getRecommendations(), getSignalEvents()])
  } catch (error) {
    console.error("Signals page Notion read failed", error)
  }

  const performance = buildRecommendationPerformance(recommendations)
  return <SignalsApp
    recommendations={recommendations}
    events={events}
    performance={performance}
    monitorReady={Boolean(process.env.DNSE_API_KEY && process.env.DNSE_API_SECRET)}
    telegramReady={telegramConfigured()}
    cronSecretReady={Boolean(process.env.CRON_SECRET || process.env.SIGNAL_MONITOR_SECRET)}
  />
}
