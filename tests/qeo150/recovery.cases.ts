import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

function source(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8")
}

test("QEO-150 recovery accepts only completed Vietnam trading sessions", async () => {
  const policy = await import("../../modules/market/chart-data/maintenance-policy.ts")
  const recoverable = Reflect.get(policy, "isQeo150RecoverableCompletedSession") as
    | undefined
    | ((sessionDate: string, referenceAt: Date) => boolean)

  assert.equal(typeof recoverable, "function")
  const afterClose = new Date("2026-09-10T12:20:00.000Z") // 19:20 ICT
  assert.equal(recoverable!("2026-09-10", afterClose), true)
  assert.equal(recoverable!("2026-09-09", afterClose), true)
  assert.equal(recoverable!("2026-09-11", afterClose), false)
  assert.equal(recoverable!("2026-09-12", afterClose), false)
})

test("QEO-150 recovery is a machine-only canonical subset flow, not a bootstrap or scheduled-SLA bypass", () => {
  const route = source("app/api/qeoindex/chart-maintenance-recovery/route.ts")
  const steps = source("modules/market/chart-data/maintenance-recovery-workflow-steps.ts")
  const recovery = source("workflows/chart-intraday-maintenance-recovery.ts")
  const scheduled = source("workflows/chart-intraday-maintenance.ts")

  assert.match(route, /isMachineRequestAuthorized/)
  assert.match(route, /qeo_verify_eod_scheduler_secret/)
  assert.match(route, /QEO150_RECOVERY_MAX_TICKERS/)
  assert.match(route, /sessionDate/)
  assert.match(route, /chartIntradayMaintenanceRecoveryWorkflow/)
  assert.match(route, /qeo150-recovery-/)

  assert.match(steps, /startChartIntradayMaintenanceRecoveryStep/)
  assert.match(steps, /outsideCanonical/)
  assert.match(recovery, /runChartIntradayMaintenanceTickerStep/)
  assert.match(recovery, /checkChartIntradayMaintenanceCapacityStep/)
  assert.match(recovery, /QEO150_MAX_RETRYABLE_ATTEMPTS/)
  assert.doesNotMatch(recovery, /checkChartIntradayMaintenanceExecutionGateStep|sla_timeout/)
  assert.doesNotMatch(recovery, /chartIntradayBootstrapWorkflow|bootstrapChartIntradayChunk/)

  // The normal scheduled workflow must keep its original SLA gates unchanged.
  assert.match(scheduled, /checkChartIntradayMaintenanceExecutionGateStep/)
  assert.match(scheduled, /sla_timeout/)
})

test("QEO-150 recovery remains idempotent through the existing positive terminal-proof ticker step", () => {
  const steps = source("modules/market/chart-data/maintenance-workflow-steps.ts")
  const maintenance = source("modules/market/chart-data/maintenance.ts")

  assert.match(steps, /if \(before\.current\)/)
  assert.match(steps, /outcome: "already_fresh"/)
  assert.match(maintenance, /revalidate: true/)
  assert.match(maintenance, /readHotIntradayRange/)
  assert.match(maintenance, /terminalReconciled: true/)
  assert.doesNotMatch(maintenance, /synthetic/i)
})
