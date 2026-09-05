import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  AI_COUNCIL_REPORT_EVIDENCE_VERSION,
  freezeCouncilReportEvidence,
} from "../../modules/ai-council/report-evidence.ts"
import type {
  CouncilReportEvidenceItem,
  CouncilReportEvidenceSelection,
} from "../../modules/research-reports/council-evidence.ts"

const RUN_ID = "11111111-1111-4111-8111-111111111111"
const AS_OF_DATE = "2026-09-05"
const RUN_AT = "2026-09-05T07:05:00Z"
const HASH = "a".repeat(64)

function sampleReport(): CouncilReportEvidenceItem {
  return {
    reportId: "22222222-2222-4222-8222-222222222222",
    analysisId: "33333333-3333-4333-8333-333333333333",
    provider: "topi",
    sourceName: "SSI Research",
    title: "MSN update",
    publishDate: "2026-09-04",
    category: "sector",
    contentHash: HASH,
    analysisVersion: "report-analysis-v1",
    promptVersion: "report-analysis-prompt-v1",
    modelRouteKey: "luna-default",
    processedAt: "2026-09-04T03:00:00Z",
    roles: ["ticker"],
    executiveSummary: "Structured source opinion.",
    marketView: null,
    sectorOutlook: null,
    catalysts: [],
    risks: [],
    tickerMention: {
      ticker: "MSN",
      stance: "positive",
      recommendationText: "BUY",
      targetPrice: 120,
      targetCurrency: "VND",
      rationale: "Broker remains constructive.",
      evidence: [{ page: 7, snippet: "Broker cited evidence" }],
      sourceOpinion: true,
    },
  }
}

function selection(reports = [sampleReport()]): CouncilReportEvidenceSelection {
  return {
    ticker: "MSN",
    asOf: AS_OF_DATE,
    runAt: RUN_AT,
    reports,
    truncated: false,
    promptChars: JSON.stringify(reports).length,
  }
}

type SnapshotRow = Record<string, unknown>

class SnapshotClient {
  row: SnapshotRow | null
  insertError: string | null = null
  reads = 0
  writes = 0

  constructor(row: SnapshotRow | null = null) {
    this.row = row
  }

  from(table: string) {
    assert.equal(table, "ai_council_report_evidence_snapshots")
    const self = this
    return {
      select(_columns: string) {
        return {
          eq(_column: string, _value: unknown) {
            return {
              async limit(_limit: number) {
                self.reads += 1
                return { data: self.row ? [{ ...self.row }] : [], error: null }
              },
            }
          },
        }
      },
      async upsert(payload: SnapshotRow, _options: { onConflict: string; ignoreDuplicates: boolean }) {
        self.writes += 1
        if (self.insertError) return { data: null, error: { message: self.insertError } }
        if (!self.row) self.row = { ...payload, captured_at: "2026-09-05T07:05:01Z" }
        return { data: null, error: null }
      },
    }
  }
}

function persistedRow(status: "ready" | "empty" | "unavailable" = "ready"): SnapshotRow {
  const reports = status === "ready" ? [sampleReport()] : []
  return {
    run_id: RUN_ID,
    ticker: "MSN",
    as_of_date: AS_OF_DATE,
    context_version: AI_COUNCIL_REPORT_EVIDENCE_VERSION,
    context_hash: "b".repeat(64),
    status,
    context_payload: {
      contextVersion: AI_COUNCIL_REPORT_EVIDENCE_VERSION,
      ticker: "MSN",
      asOfDate: AS_OF_DATE,
      status,
      reports,
      limitations: status === "unavailable" ? ["Research Report evidence unavailable at Council freeze time."] : [],
    },
    report_ids: reports.map((row) => row.reportId),
    analysis_ids: reports.map((row) => row.analysisId),
    captured_at: "2026-09-05T07:05:01Z",
  }
}

test("QEO-86 pending SQL creates immutable authenticated-read Council report snapshots", () => {
  const sql = readFileSync(
    new URL("../../supabase/pending-migrations/20260905073000_qeo86_ai_council_report_evidence.sql", import.meta.url),
    "utf8",
  )

  assert.match(sql, /create table if not exists public\.ai_council_report_evidence_snapshots/i)
  assert.match(sql, /run_id uuid primary key references public\.ai_council_runs\(id\)/i)
  assert.match(sql, /status text not null check \(status in \('ready','empty','unavailable'\)\)/i)
  assert.match(sql, /context_hash text not null check \(context_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/i)
  assert.match(sql, /context_payload jsonb not null/i)
  assert.match(sql, /report_ids jsonb not null default '\[\]'::jsonb/i)
  assert.match(sql, /analysis_ids jsonb not null default '\[\]'::jsonb/i)
  assert.match(sql, /enable row level security/i)
  assert.match(sql, /revoke all on table public\.ai_council_report_evidence_snapshots from anon/i)
  assert.match(sql, /grant select on table public\.ai_council_report_evidence_snapshots to authenticated/i)
  assert.match(sql, /grant all privileges on table public\.ai_council_report_evidence_snapshots to service_role/i)
  assert.match(sql, /before update on public\.ai_council_report_evidence_snapshots/i)
})

test("same Council run reuses frozen report snapshot without rerunning selector", async () => {
  const client = new SnapshotClient(persistedRow("ready"))
  let selectorCalls = 0

  const frozen = await freezeCouncilReportEvidence(client as never, {
    runId: RUN_ID,
    ticker: "MSN",
    asOfDate: AS_OF_DATE,
    runAt: RUN_AT,
  }, {
    selectEvidence: async () => {
      selectorCalls += 1
      return selection([])
    },
  })

  assert.equal(selectorCalls, 0)
  assert.equal(client.writes, 0)
  assert.equal(frozen.reused, true)
  assert.equal(frozen.persisted, true)
  assert.equal(frozen.canUseInPrompt, true)
  assert.equal(frozen.context.status, "ready")
  assert.equal(frozen.context.reports[0].analysisId, sampleReport().analysisId)
})

test("new eligible evidence is usable only after ready snapshot persists and can be read back", async () => {
  const client = new SnapshotClient()
  const frozen = await freezeCouncilReportEvidence(client as never, {
    runId: RUN_ID,
    ticker: "MSN",
    asOfDate: AS_OF_DATE,
    runAt: RUN_AT,
  }, {
    selectEvidence: async () => selection(),
  })

  assert.equal(client.writes, 1)
  assert.ok(client.reads >= 2)
  assert.equal(frozen.reused, false)
  assert.equal(frozen.persisted, true)
  assert.equal(frozen.canUseInPrompt, true)
  assert.equal(frozen.context.status, "ready")
  assert.deepEqual(frozen.reportIds, [sampleReport().reportId])
  assert.deepEqual(frozen.analysisIds, [sampleReport().analysisId])
  assert.match(frozen.contextHash || "", /^[0-9a-f]{64}$/)
})

test("successful no-match persists an explicit empty snapshot that participates in prompt identity", async () => {
  const client = new SnapshotClient()
  const frozen = await freezeCouncilReportEvidence(client as never, {
    runId: RUN_ID,
    ticker: "FPT",
    asOfDate: AS_OF_DATE,
    runAt: RUN_AT,
  }, {
    selectEvidence: async () => selection([]),
  })

  assert.equal(frozen.context.status, "empty")
  assert.equal(frozen.persisted, true)
  assert.equal(frozen.canUseInPrompt, true)
  assert.deepEqual(frozen.reportIds, [])
  assert.deepEqual(frozen.analysisIds, [])
  assert.match(frozen.contextHash || "", /^[0-9a-f]{64}$/)
})

test("selector failure persists bounded unavailable provenance when storage works and never exposes report prompt evidence", async () => {
  const client = new SnapshotClient()
  const frozen = await freezeCouncilReportEvidence(client as never, {
    runId: RUN_ID,
    ticker: "VIC",
    asOfDate: AS_OF_DATE,
    runAt: RUN_AT,
  }, {
    selectEvidence: async () => { throw new Error("database host detail should not enter frozen payload") },
  })

  assert.equal(frozen.context.status, "unavailable")
  assert.equal(frozen.persisted, true)
  assert.equal(frozen.canUseInPrompt, false)
  assert.deepEqual(frozen.context.reports, [])
  assert.deepEqual(frozen.reportIds, [])
  assert.deepEqual(frozen.analysisIds, [])
  assert.deepEqual(frozen.context.limitations, ["Research Report evidence unavailable at Council freeze time."])
  assert.doesNotMatch(JSON.stringify(frozen.context), /database host detail/)
})

test("snapshot persistence failure fails open but strips selected report evidence from the returned prompt boundary", async () => {
  const client = new SnapshotClient()
  client.insertError = "write failed"

  const frozen = await freezeCouncilReportEvidence(client as never, {
    runId: RUN_ID,
    ticker: "MSN",
    asOfDate: AS_OF_DATE,
    runAt: RUN_AT,
  }, {
    selectEvidence: async () => selection(),
  })

  assert.equal(frozen.persisted, false)
  assert.equal(frozen.reused, false)
  assert.equal(frozen.canUseInPrompt, false)
  assert.equal(frozen.contextHash, null)
  assert.equal(frozen.context.status, "unavailable")
  assert.deepEqual(frozen.context.reports, [])
  assert.deepEqual(frozen.reportIds, [])
  assert.deepEqual(frozen.analysisIds, [])
})

test("snapshot hash is canonical and independent of Council run id or persistence timestamp", async () => {
  const left = new SnapshotClient()
  const right = new SnapshotClient()
  const deps = { selectEvidence: async () => selection() }

  const first = await freezeCouncilReportEvidence(left as never, {
    runId: RUN_ID,
    ticker: "MSN",
    asOfDate: AS_OF_DATE,
    runAt: RUN_AT,
  }, deps)
  const second = await freezeCouncilReportEvidence(right as never, {
    runId: "44444444-4444-4444-8444-444444444444",
    ticker: "MSN",
    asOfDate: AS_OF_DATE,
    runAt: RUN_AT,
  }, deps)

  assert.equal(first.contextHash, second.contextHash)
})
