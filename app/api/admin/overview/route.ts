import { NextResponse } from "next/server"

import { getAdminEnvironmentInventory } from "@/modules/admin/catalog"
import { loadAdminJobsSnapshot } from "@/modules/admin/job-health"
import { loadAdminSettingsSnapshot, loadRecentAuditLogs } from "@/modules/admin/settings"
import type { AdminSourceHealth, AdminSystemOverview } from "@/modules/admin/types"
import { requireApiRoot } from "@/modules/auth/root"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  const auth = await requireApiRoot()
  if (!auth.ok) return auth.response

  const [settingsSnapshot, jobsSnapshot, audit] = await Promise.all([
    loadAdminSettingsSnapshot(),
    loadAdminJobsSnapshot(),
    loadRecentAuditLogs(20),
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
    actorUserId: auth.context.user.id,
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

  return NextResponse.json(
    { ok: true, data: overview },
    {
      headers: {
        "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate",
      },
    },
  )
}
