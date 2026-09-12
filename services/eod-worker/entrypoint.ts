import { runQeoIndexEodOrchestrator } from "@/modules/eod/orchestrator"

async function nativeSleepUntil(until: Date) {
  const delayMs = Math.max(0, until.getTime() - Date.now())
  if (delayMs > 0) await new Promise<void>((resolve) => setTimeout(resolve, delayMs))
}

async function main() {
  const startedAt = new Date().toISOString()
  const result = await runQeoIndexEodOrchestrator(startedAt, { sleepUntil: nativeSleepUntil })
  const summary = result as Record<string, unknown>
  console.log(JSON.stringify({
    event: "qeo_eod_worker_complete",
    startedAt,
    runId: summary.runId ?? null,
    runKey: summary.runKey ?? null,
    scanDate: summary.scanDate ?? null,
    publishStatus: summary.publishStatus ?? null,
    status: summary.status ?? (summary.ok === true ? "ok" : null),
  }))
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(JSON.stringify({ event: "qeo_eod_worker_failed", error: message.slice(0, 1000) }))
  process.exitCode = 1
})
