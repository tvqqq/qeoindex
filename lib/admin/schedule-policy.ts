import type { AdminJobDefinition, SchedulePolicy } from "./types.ts"

export const ICT_TIMEZONE = "Asia/Ho_Chi_Minh" as const

const DAILY_FIXED: Record<string, number> = {
  "kfsp.rating_daily": 420,
  "kfsp.ttai_history": 430,
}

export function schedulePolicyForJobKey(key: string): SchedulePolicy | null {
  if (key === "qeoindex.eod_pipeline") return { kind: "fixed_time", timezone: ICT_TIMEZONE, cadence: "weekdays", minuteOfDay: 915, completionDeadlineMinuteOfDay: 1435, graceMinutes: 30 }
  if (key === "signals.daily") return { kind: "fixed_time", timezone: ICT_TIMEZONE, cadence: "weekdays", minuteOfDay: 420, completionDeadlineMinuteOfDay: 840, graceMinutes: 30 }
  if (key === "kfsp.rating_daily" || key === "kfsp.ttai_history") return { kind: "fixed_time", timezone: ICT_TIMEZONE, cadence: "daily", minuteOfDay: DAILY_FIXED[key], graceMinutes: 30 }
  if (key === "market.sync_eod") return { kind: "fixed_time", timezone: ICT_TIMEZONE, cadence: "weekdays", minuteOfDay: 885, completionDeadlineMinuteOfDay: 900, graceMinutes: 15 }
  if (key === "market.sync_5m") return {
    kind: "window", timezone: ICT_TIMEZONE, cadence: "weekdays", graceMinutes: 10,
    windows: [
      { startMinuteOfDay: 540, endMinuteOfDay: 690, cadenceMinutes: 5 },
      { startMinuteOfDay: 780, endMinuteOfDay: 880, cadenceMinutes: 5 },
    ],
  }
  return key.includes(".") ? { kind: "manual", timezone: ICT_TIMEZONE } : null
}

export function withSchedulePolicy(job: AdminJobDefinition): AdminJobDefinition {
  return { ...job, schedulePolicy: job.schedulePolicy ?? schedulePolicyForJobKey(job.key) ?? undefined }
}

export function isValidSchedulePolicy(policy: unknown): policy is SchedulePolicy {
  if (!policy || typeof policy !== "object") return false
  const value = policy as Record<string, unknown>
  if (value.timezone !== ICT_TIMEZONE) return false
  if (value.kind === "manual") return true
  if (value.kind === "fixed_time") {
    return (value.cadence === "daily" || value.cadence === "weekdays")
      && Number.isInteger(value.minuteOfDay) && Number(value.minuteOfDay) >= 0 && Number(value.minuteOfDay) < 1440
      && Number.isInteger(value.graceMinutes) && Number(value.graceMinutes) >= 0
  }
  if (value.kind === "window") {
    return (value.cadence === "daily" || value.cadence === "weekdays")
      && Number.isInteger(value.graceMinutes) && Number(value.graceMinutes) >= 0
      && Array.isArray(value.windows) && value.windows.length > 0
      && value.windows.every((window) => {
        if (!window || typeof window !== "object") return false
        const item = window as Record<string, unknown>
        return Number.isInteger(item.startMinuteOfDay) && Number.isInteger(item.endMinuteOfDay)
          && Number(item.startMinuteOfDay) >= 0 && Number(item.endMinuteOfDay) < 1440
          && Number(item.endMinuteOfDay) >= Number(item.startMinuteOfDay)
          && Number.isInteger(item.cadenceMinutes) && Number(item.cadenceMinutes) > 0
      })
  }
  return false
}
