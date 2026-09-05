import assert from "node:assert/strict"
import test from "node:test"

import {
  runResearchReportsOrchestrator,
  type ResearchReportsOrchestratorDependencies,
  type ResearchReportWorkflowCandidate,
} from "../../modules/research-reports/daily/orchestrator.ts"

function candidate(id: string): ResearchReportWorkflowCandidate {
  return {
    id,
    provider: "topi",
    externalReportId: id,
    publishDate: "2026-09-05",
    pdfUrl: `https://cdn02.wigroup.vn/${id}.pdf`,
  }
}

test("QEO-85 smoke fixture isolates one failed report and terminalizes the batch partial", async () => {
  const processed: string[] = []
  const deps: ResearchReportsOrchestratorDependencies = {
    async discover() {
      return {
        reports: [],
        pagesFetched: 2,
        stoppedAtKnownBoundary: true,
        boundaryReason: "known_old_page",
        reachedSafetyLimit: false,
      }
    },
    async upsertAndResolve() {
      return {
        discovered: 4,
        newCount: 2,
        changedCount: 0,
        unchangedCount: 2,
        candidates: [candidate("new-1"), candidate("new-2"), candidate("existing-1"), candidate("bad-1")],
      }
    },
    async processReport(report) {
      processed.push(report.id)
      if (report.id === "existing-1") {
        return { reportId: report.id, status: "skipped_existing", contentHash: "a".repeat(64), analysisId: "analysis-existing", aiCalled: false, detail: "existing" }
      }
      if (report.id === "bad-1") {
        return { reportId: report.id, status: "failed", contentHash: null, analysisId: null, aiCalled: false, detail: "bad pdf" }
      }
      return { reportId: report.id, status: "ready", contentHash: "b".repeat(64), analysisId: `analysis-${report.id}`, aiCalled: true, detail: "ready" }
    },
  }

  const result = await runResearchReportsOrchestrator({ mode: "daily", maxReports: 20 }, deps)

  assert.deepEqual(processed, ["new-1", "new-2", "existing-1", "bad-1"])
  assert.equal(result.status, "partial")
  assert.equal(result.discovered, 4)
  assert.equal(result.newCount, 2)
  assert.equal(result.processed, 4)
  assert.equal(result.ready, 2)
  assert.equal(result.skippedExisting, 1)
  assert.equal(result.failed, 1)
  assert.equal(result.aiCalledReports, 2)
  assert.equal(result.deferred, 0)
})

test("QEO-85 identical rerun can complete with zero new AI spend", async () => {
  const deps: ResearchReportsOrchestratorDependencies = {
    async discover() {
      return {
        reports: [], pagesFetched: 1, stoppedAtKnownBoundary: false,
        boundaryReason: "short_page", reachedSafetyLimit: false,
      }
    },
    async upsertAndResolve() {
      return {
        discovered: 3,
        newCount: 0,
        changedCount: 0,
        unchangedCount: 3,
        candidates: [candidate("new-1"), candidate("new-2"), candidate("existing-1")],
      }
    },
    async processReport(report) {
      return { reportId: report.id, status: "skipped_existing", contentHash: "c".repeat(64), analysisId: `analysis-${report.id}`, aiCalled: false, detail: "existing" }
    },
  }

  const result = await runResearchReportsOrchestrator({ mode: "daily" }, deps)

  assert.equal(result.status, "succeeded")
  assert.equal(result.skippedExisting, 3)
  assert.equal(result.aiCalledReports, 0)
  assert.equal(result.failed, 0)
})

test("QEO-85 candidate safety cap defers excess work and produces partial", async () => {
  const candidates = Array.from({ length: 22 }, (_, index) => candidate(`r-${index + 1}`))
  let processed = 0
  const deps: ResearchReportsOrchestratorDependencies = {
    async discover() {
      return {
        reports: [], pagesFetched: 8, stoppedAtKnownBoundary: false,
        boundaryReason: "max_pages", reachedSafetyLimit: true,
      }
    },
    async upsertAndResolve() {
      return { discovered: 22, newCount: 22, changedCount: 0, unchangedCount: 0, candidates }
    },
    async processReport(report) {
      processed += 1
      return { reportId: report.id, status: "ready", contentHash: "d".repeat(64), analysisId: `analysis-${report.id}`, aiCalled: true, detail: "ready" }
    },
  }

  const result = await runResearchReportsOrchestrator({ mode: "daily", maxReports: 20 }, deps)
  assert.equal(processed, 20)
  assert.equal(result.processed, 20)
  assert.equal(result.deferred, 2)
  assert.equal(result.hitDiscoverySafetyLimit, true)
  assert.equal(result.status, "partial")
})
