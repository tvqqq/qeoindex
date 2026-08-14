import { SignalsApp } from "@/components/research/signals-app"
import { getRecommendations, getSignalEvents } from "@/lib/signal-data"
import { buildRecommendationPerformance } from "@/lib/signal-performance"
import { telegramConfigured } from "@/lib/telegram"

export const dynamic = "force-dynamic"
export const revalidate = 0

export default async function SignalsPage() {
  let recommendations = [] as Awaited<ReturnType<typeof getRecommendations>>
  let events = [] as Awaited<ReturnType<typeof getSignalEvents>>
  let readError = ""
  const notionConfigured = Boolean(process.env.NOTION_API_KEY || process.env.NOTION_TOKEN)
  if (!notionConfigured) {
    readError = "Notion chưa được cấu hình cho environment này; không dùng backend dự phòng."
  } else {
    try {
      ;[recommendations, events] = await Promise.all([getRecommendations(), getSignalEvents()])
    } catch (error) {
      readError = error instanceof Error ? error.message : String(error)
      console.error("Signals page Notion read failed", error)
    }
  }
  return <SignalsApp
    recommendations={recommendations}
    events={events}
    performance={buildRecommendationPerformance(recommendations)}
    readError={readError}
    monitorReady={Boolean(process.env.DNSE_API_KEY && process.env.DNSE_API_SECRET)}
    telegramReady={telegramConfigured()}
    cronSecretReady={Boolean(process.env.CRON_SECRET || process.env.SIGNAL_MONITOR_SECRET)}
  />
}
