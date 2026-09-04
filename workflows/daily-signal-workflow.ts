import { sleep } from "workflow"

import { runScannerUniverse } from "@/modules/signals/scanner/runner"
import { runSignalMonitor } from "@/modules/signals/monitor"
import {
  failSignalsDailyRunStep,
  finishSignalsDailyRunStep,
  startSignalsDailyRunStep,
  updateSignalsDailyStageStep,
} from "@/modules/signals/daily-telemetry"

async function refreshDailyScannerStep() {
  "use step"
  return runScannerUniverse()
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

export function nextSignalMonitorIntervalMinutes(openCount: number, bullishCandidates: number) {
  return openCount > 0 || bullishCandidates > 0 ? 5 : 15
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
    cursor += nextSignalMonitorIntervalMinutes(openCount, result.bullishCandidates ?? 0)
  }
  return openCount
}

export async function dailySignalWorkflow(startedAtIso: string) {
  "use workflow"

  const runId = await startSignalsDailyRunStep(startedAtIso)

  try {
    const dateKey = vietnamDateKey(startedAtIso)
    const scanner = await refreshDailyScannerStep()
    const scannerSummary = {
      requested: scanner.requested,
      completed: scanner.completed.length,
      skipped: scanner.skipped.length,
      errors: scanner.errors.length,
    }

    // HOSE ATO is 09:00-09:15. Trade ticks are only treated as actionable once
    // the opening print is available, avoiding a fake fill from the previous close.
    const openingWakeAt = atVietnamTime(dateKey, 9, 15, 5)
    await updateSignalsDailyStageStep(runId, "WAIT_OPEN", {
      nextWakeAt: openingWakeAt.toISOString(),
      scanner: scannerSummary,
    })
    await sleep(openingWakeAt)
    await updateSignalsDailyStageStep(runId, "OPENING", { scanner: scannerSummary })
    let opening = await monitorSignalStep()

    // Retry the opening action a few times when the first DNSE snapshot has not
    // produced all opening ticks yet.
    for (const minute of [16, 17, 18]) {
      if ((opening.missingQuotes?.length ?? 0) === 0) break
      await sleep(atVietnamTime(dateKey, 9, minute, 5))
      opening = await monitorSignalStep()
    }

    let openCount = opening.openAfter ?? opening.openBefore ?? 0
    await updateSignalsDailyStageStep(runId, "MORNING", {
      scanner: scannerSummary,
      opening: { openAfter: opening.openAfter },
    })
    openCount = await monitorWindow(dateKey, 9 * 60 + 20, 11 * 60 + 30, openCount)

    const afternoonWakeAt = atVietnamTime(dateKey, 13, 0)
    await updateSignalsDailyStageStep(runId, "LUNCH", {
      nextWakeAt: afternoonWakeAt.toISOString(),
      scanner: scannerSummary,
      opening: { openAfter: opening.openAfter },
      openBeforeLunch: openCount,
    })
    await sleep(afternoonWakeAt)
    await updateSignalsDailyStageStep(runId, "AFTERNOON", {
      scanner: scannerSummary,
      openBeforeAfternoon: openCount,
    })
    const afternoonOpening = await monitorSignalStep()
    openCount = afternoonOpening.openAfter ?? openCount
    const nextAfternoonMinute = 13 * 60 + nextSignalMonitorIntervalMinutes(openCount, afternoonOpening.bullishCandidates ?? 0)
    openCount = await monitorWindow(dateKey, nextAfternoonMinute, 14 * 60 + 30, openCount)

    // Capture the ATC closing print so end-of-day alpha and exits are not based
    // on the last continuous-auction tick.
    const closingWakeAt = atVietnamTime(dateKey, 14, 45, 5)
    await updateSignalsDailyStageStep(runId, "CLOSING", {
      nextWakeAt: closingWakeAt.toISOString(),
      scanner: scannerSummary,
      openBeforeClose: openCount,
    })
    await sleep(closingWakeAt)
    const closing = await monitorSignalStep()
    openCount = closing.openAfter ?? openCount

    const result = {
      dateKey,
      scanner: scannerSummary,
      opening: {
        openAfter: opening.openAfter,
      },
      closing: {
        openAfter: closing.openAfter,
      },
      openAtClose: openCount,
      completedAt: new Date().toISOString(),
    }

    await finishSignalsDailyRunStep(runId, startedAtIso, result)

    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await failSignalsDailyRunStep(runId, startedAtIso, message)
    throw error
  }
}
