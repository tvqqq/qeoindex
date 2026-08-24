import { ADMIN_JOB_CATALOG } from "./catalog.ts"
import type { AdminJobDefinition } from "./types.ts"

const AI_COUNCIL_EOD_JOB: AdminJobDefinition = {
  key: "ai_council.eod",
  provider: "vercel_cron_workflow",
  label: "AI Council EOD Pipeline",
  description:
    "Pipeline phụ thuộc cuối ngày: kiểm tra market EOD -> refresh Wyckoff Top100 -> deterministic Council -> evidence/research freeze -> LLM debate chọn lọc.",
  group: "ai_council",
  scheduleUtc: "0 10 * * 1-5",
  scheduleIct: "17:00 T2-T6",
  manualPolicy: "disabled",
  freshnessMinutes: 26 * 60,
  maxDurationMinutes: 60,
}

/**
 * Operational Admin Jobs catalog.
 *
 * The base catalog predates the dependency-driven AI Council EOD workflow and
 * still contains the three former independent schedules. Keep this adapter
 * explicit until the broader Admin catalog is consolidated, so /admin/jobs
 * always reflects the production schedule rather than legacy endpoint labels.
 */
export const EFFECTIVE_ADMIN_JOB_CATALOG: AdminJobDefinition[] = ADMIN_JOB_CATALOG.flatMap((job) => {
  if (job.key === "ai_council.daily") {
    return [AI_COUNCIL_EOD_JOB]
  }

  if (job.key === "ai_council.debate_daily") {
    return []
  }

  if (job.key === "wyckoff.ingest") {
    return [{
      ...job,
      provider: "machine",
      description:
        "Manual fallback để ingest snapshot Wyckoff từ Notion staging. Production AI Council EOD dùng server-side Wyckoff refresh trong unified workflow.",
      scheduleUtc: undefined,
      scheduleIct: undefined,
    }]
  }

  return [job]
})

export function getEffectiveAdminJobDefinition(key: string): AdminJobDefinition | undefined {
  return EFFECTIVE_ADMIN_JOB_CATALOG.find((job) => job.key === key)
}
