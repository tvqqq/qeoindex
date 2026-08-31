import { AdminOverviewDashboard } from "@/components/admin/admin-overview-dashboard"
import { getAdminEnvironmentInventory } from "@/lib/admin/catalog"
import { loadAdminJobsSnapshot } from "@/lib/admin/job-health"
import { loadAdminSettingsSnapshot, loadRecentAuditLogs } from "@/lib/admin/settings"
import type { AdminSourceHealth, AdminSystemOverview } from "@/lib/admin/types"
import { requireRootPageContext } from "@/lib/auth/root"

export const dynamic = "force-dynamic"

export default async function AdminOverviewPage() {
  const context = await requireRootPageContext()
  const actorUserId = context.user.id

  const [settingsSnapshot, jobsSnapshot, audit] = await Promise.all([
    loadAdminSettingsSnapshot(),
    loadAdminJobsSnapshot(),
    loadRecentAuditLogs(10),
  ])

  const environment = getAdminEnvironmentInventory()

  const sources: AdminSourceHealth[] = [
    {
      name: "Supabase Database & Auth",
      status: settingsSnapshot.degraded ? "degraded" : "healthy",
      message: settingsSnapshot.error || undefined,
    },
    {
      name: "OpenAI API",
      status: process.env.OPENAI_API_KEY ? "healthy" : "degraded",
      message: process.env.OPENAI_API_KEY ? undefined : "OPENAI_API_KEY chưa được cấu hình",
    },
    {
      name: "Notion Integration",
      status: (process.env.NOTION_API_KEY || process.env.NOTION_TOKEN) ? "healthy" : "degraded",
      message: (process.env.NOTION_API_KEY || process.env.NOTION_TOKEN) ? undefined : "NOTION_API_KEY chưa được cấu hình",
    },
    {
      name: "VPS Market Feed",
      status: "healthy",
      message: "Direct BG API feed endpoint ready",
    },
  ]

  const overview: AdminSystemOverview = {
    actorUserId,
    refreshedAt: new Date().toISOString(),
    build: {
      commitSha: process.env.NEXT_PUBLIC_GIT_COMMIT_SHA || process.env.VERCEL_GIT_COMMIT_SHA || "dev",
      commitDate: process.env.NEXT_PUBLIC_GIT_COMMIT_DATE,
      nodeEnv: process.env.NODE_ENV || "development",
      vercelEnv: process.env.VERCEL_ENV,
    },
    sources,
    jobCounts: jobsSnapshot.counts,
    scheduler: jobsSnapshot.scheduler,
    jobs: jobsSnapshot.jobs,
    settings: settingsSnapshot.settings,
    environment,
    audit,
  }

  return <AdminOverviewDashboard overview={overview} />
}
