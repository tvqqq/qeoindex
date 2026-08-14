import { sleep } from "workflow"

import { runScannerUniverse } from "@/lib/scanner-runner"
import { runSignalMonitor } from "@/lib/signal-monitor"

async function refreshDailyScannerStep() {
  "use step"
  return runScannerUniverse({ limit: 50, offset: 0 })
}

async function monitorSignalStep() {
  "use step"
  return runSignalMonitor({ force: true })
}

function vietnamDateKey(iso: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(iso))
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ""
  return `${value("year")}-${value("month")}-${value("day")}`
}

function atVietnamTime(dateKey: string, hour: number, minute: number, second = 0) {
  return new Date(`${dateKey}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}+07:00`)
}

async function monitorWindow(dateKey: string, startMinutes: number, endMinutes: number, initialOpen: number) {
  let cursor = startMinutes
  let openCount = initialOpen
  while (cursor <= endMinutes) {
    const hour = Math.floor(cursor / 60)
    const minute = cursor % 60
    await sleep(atVietnamTime(dateKey, hour, minute))
    const result = await monitorSignalStep()
    openCount = result.openAfter ?? openCount
    cursor += openCount > 0 ? 5 : 15
  }
  return openCount
}

export async function dailySignalWorkflow(startedAtIso: string) {
  "use workflow"

  const dateKey = vietnamDateKey(startedAtIso)
  const scanner = await refreshDailyScannerStep()

  // HOSE ATO is 09:00-09:15. Trade ticks are only treated as actionable once
  // the opening print is available, avoiding a fake fill from the previous close.
  await sleep(atVietnamTime(dateKey, 9, 15, 5))
  let opening = await monitorSignalStep()

  // Retry the opening action a few times when the first DNSE snapshot has not
  // produced all opening ticks yet.
  for (const minute of [16, 17, 18]) {
    if ((opening.missingQuotes?.length ?? 0) === 0) break
    await sleep(atVietnamTime(dateKey, 9, minute, 5))
    opening = await monitorSignalStep()
  }

  let openCount = opening.openAfter ?? opening.openBefore ?? 0
  openCount = await monitorWindow(dateKey, 9 * 60 + 20, 11 * 60 + 30, openCount)
  openCount = await monitorWindow(dateKey, 13 * 60, 14 * 60 + 30, openCount)

  return {
    dateKey,
    scanner,
    opening,
    openAtCloseWindow: openCount,
    completedAt: new Date().toISOString(),
  }
}
