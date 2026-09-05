import {
  acquireResearchReportAnalysisLease,
  findSuccessfulResearchReportAnalysis,
  markResearchReportStatus,
  publishResearchReportAnalysis,
  releaseResearchReportAnalysisLease,
  type ResearchReportAnalysisIdentity,
} from "../repository.ts"
import type { ProcessResearchReportResult } from "../types.ts"
import { chunkResearchReportPages, REPORT_CHUNK_VERSION } from "../pdf/chunk.ts"
import { parseResearchReportPdf } from "../pdf/parse.ts"
import { fetchResearchReportPdf } from "../pdf/secure-fetch.ts"
import type { ResearchReportAiBudget } from "./budget.ts"
import {
  analyzeResearchReportPages,
  getResearchReportAiModelRoute,
  type ResearchReportAiRequestAuditEvent,
} from "./openai.ts"
import { REPORT_ANALYSIS_VERSION, REPORT_PROMPT_VERSION } from "./prompt.ts"
import {
  findLastKnownGoodResearchReportAnalysis,
  type ResearchReportRecoveryLookupClient,
} from "./recovery.ts"

type AnalysisLookupClient = Parameters<typeof findSuccessfulResearchReportAnalysis>[0]
type ReportStatusClient = Parameters<typeof markResearchReportStatus>[0]
type ReportPublishClient = Parameters<typeof publishResearchReportAnalysis>[0]
type ReportLeaseClient = Parameters<typeof acquireResearchReportAnalysisLease>[0]

export interface ResearchReportProcessingClient {
  from(table: string): unknown
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{
    data: unknown
    error: { message?: string } | null
  }>
}

export interface ResearchReportRequestUsageAccumulator {
  attemptedModels: string[]
  aiRequestCount: number
  inputTokens: number
  cachedInputTokens: number
  cacheWriteTokens: number
  outputTokens: number
  reasoningTokens: number
  totalTokens: number
  unknownUsageAttempts: number
  estimatedCostUsd: number
  pricingVersion: string
}

export interface ResearchReportProcessingDependencies {
  fetchPdf?: typeof fetchResearchReportPdf
  parsePdf?: typeof parseResearchReportPdf
  analyzePages?: typeof analyzeResearchReportPages
  runId?: string
  acquireLease?: typeof acquireResearchReportAnalysisLease
  releaseLease?: typeof releaseResearchReportAnalysisLease
  findLastKnownGood?: typeof findLastKnownGoodResearchReportAnalysis
  aiBudget?: ResearchReportAiBudget
  requestUsage?: ResearchReportRequestUsageAccumulator
  onRequestAudit?: (event: ResearchReportAiRequestAuditEvent) => Promise<void> | void
}

interface ResearchReportProcessingInput {
  id: string
  pdfUrl: string
}

type ProcessingStage = "fetch" | "parse" | "analysis" | "publish"

function safeFailureDetail(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error)
  return raw
    .replace(/Bearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]+\b/g, "[REDACTED]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300) || "Research report processing failed"
}

function lookupClient(client: ResearchReportProcessingClient) {
  return client as unknown as AnalysisLookupClient
}

function statusClient(client: ResearchReportProcessingClient) {
  return client as unknown as ReportStatusClient
}

function publishClient(client: ResearchReportProcessingClient) {
  return client as unknown as ReportPublishClient
}

function leaseClient(client: ResearchReportProcessingClient) {
  return client as unknown as ReportLeaseClient
}

function recoveryClient(client: ResearchReportProcessingClient) {
  return client as unknown as ResearchReportRecoveryLookupClient
}

function addRequestUsage(
  target: ResearchReportRequestUsageAccumulator | undefined,
  event: ResearchReportAiRequestAuditEvent,
) {
  if (!target) return
  target.aiRequestCount += 1
  if (!target.attemptedModels.includes(event.model)) target.attemptedModels.push(event.model)
  if (event.outcome === "unknown_usage") target.unknownUsageAttempts += 1
  target.inputTokens += event.inputTokens
  target.cachedInputTokens += event.cachedInputTokens
  target.cacheWriteTokens += event.cacheWriteTokens
  target.outputTokens += event.outputTokens
  target.reasoningTokens += event.reasoningTokens
  target.totalTokens += event.totalTokens
  if (event.estimatedCostUsd !== null) {
    target.estimatedCostUsd = Number((target.estimatedCostUsd + event.estimatedCostUsd).toFixed(12))
  }
  if (event.pricingVersion) target.pricingVersion = event.pricingVersion
}

export async function processResearchReport(
  client: ResearchReportProcessingClient,
  report: ResearchReportProcessingInput,
  deps: ResearchReportProcessingDependencies = {},
): Promise<ProcessResearchReportResult> {
  const fetchPdf = deps.fetchPdf ?? fetchResearchReportPdf
  const parsePdf = deps.parsePdf ?? parseResearchReportPdf
  const analyzePages = deps.analyzePages ?? analyzeResearchReportPages
  const acquireLease = deps.acquireLease ?? acquireResearchReportAnalysisLease
  const releaseLease = deps.releaseLease ?? releaseResearchReportAnalysisLease
  const findLastKnownGood = deps.findLastKnownGood ?? findLastKnownGoodResearchReportAnalysis

  let contentHash: string | null = null
  let aiCalled = false
  let stage: ProcessingStage = "fetch"
  let ownedLeaseToken: string | null = null

  try {
    await markResearchReportStatus(statusClient(client), report.id, {
      ingestionStatus: "fetching",
      ingestionError: null,
      analysisError: null,
    })

    const downloaded = await fetchPdf(report.pdfUrl)
    contentHash = downloaded.contentHash

    const route = getResearchReportAiModelRoute()
    const identity: ResearchReportAnalysisIdentity = {
      reportId: report.id,
      contentHash,
      analysisVersion: REPORT_ANALYSIS_VERSION,
      promptVersion: REPORT_PROMPT_VERSION,
      modelRouteKey: route.modelRouteKey,
    }

    const existing = await findSuccessfulResearchReportAnalysis(lookupClient(client), identity)
    if (existing) {
      await markResearchReportStatus(statusClient(client), report.id, {
        contentHash,
        ingestionStatus: "parsed",
        ingestionError: null,
        analysisStatus: "ready",
        analysisError: null,
      })
      return {
        reportId: report.id,
        status: "skipped_existing",
        contentHash,
        analysisId: existing.id,
        aiCalled: false,
        detail: "Identical successful analysis already exists",
      }
    }

    stage = "parse"
    const parsed = await parsePdf(downloaded.bytes)

    if (parsed.status === "needs_ocr") {
      await markResearchReportStatus(statusClient(client), report.id, {
        contentHash,
        parsedPageCount: parsed.pageCount,
        ingestionStatus: "needs_ocr",
        ingestionError: null,
        analysisStatus: "needs_ocr",
        analysisError: null,
      })
      return {
        reportId: report.id,
        status: "needs_ocr",
        contentHash,
        analysisId: null,
        aiCalled: false,
        detail: "PDF contains insufficient text and requires OCR",
      }
    }

    if (parsed.status === "unsupported") {
      await markResearchReportStatus(statusClient(client), report.id, {
        contentHash,
        parsedPageCount: parsed.pageCount,
        ingestionStatus: "unsupported",
        ingestionError: null,
        analysisStatus: "unsupported",
        analysisError: null,
      })
      return {
        reportId: report.id,
        status: "unsupported",
        contentHash,
        analysisId: null,
        aiCalled: false,
        detail: "PDF format cannot be processed by text extraction",
      }
    }

    await markResearchReportStatus(statusClient(client), report.id, {
      contentHash,
      parsedPageCount: parsed.pageCount,
      ingestionStatus: "parsed",
      ingestionError: null,
    })

    const chunks = chunkResearchReportPages(parsed.pages)
    if (parsed.pages.length === 0 || chunks.length === 0) {
      throw new Error("Parsed research report produced no page-local text chunks")
    }

    if (deps.runId) {
      const lease = await acquireLease(leaseClient(client), {
        ...identity,
        runId: deps.runId,
        ttlSeconds: 900,
      })
      if (lease.outcome === "existing_success") {
        return {
          reportId: report.id,
          status: "skipped_existing",
          contentHash,
          analysisId: lease.analysisId,
          aiCalled: false,
          detail: "Identical successful analysis completed before lease acquisition",
        }
      }
      if (lease.outcome === "busy") {
        return {
          reportId: report.id,
          status: "skipped_concurrent",
          contentHash,
          analysisId: null,
          aiCalled: false,
          detail: "Identical analysis is already owned by another active workflow",
        }
      }
      ownedLeaseToken = lease.leaseToken
    }

    stage = "analysis"
    await markResearchReportStatus(statusClient(client), report.id, {
      analysisStatus: "processing",
      analysisError: null,
    })

    aiCalled = true
    const analyzed = await analyzePages(parsed.pages, {
      budget: deps.aiBudget,
      onRequestAudit: async (event) => {
        addRequestUsage(deps.requestUsage, event)
        await deps.onRequestAudit?.(event)
      },
    })
    if (analyzed.route.modelRouteKey !== identity.modelRouteKey) {
      throw new Error("Research report AI route changed during processing")
    }

    stage = "publish"
    const published = await publishResearchReportAnalysis(publishClient(client), {
      identity,
      reasoningEffort: analyzed.route.reasoningEffort,
      chunkVersion: REPORT_CHUNK_VERSION,
      parsedPageCount: parsed.pageCount,
      modelRequested: analyzed.audit.requestedModel,
      modelActual: analyzed.audit.responseModel,
      responseId: analyzed.audit.responseId,
      inputTokens: analyzed.audit.inputTokens,
      cachedInputTokens: analyzed.audit.cachedInputTokens,
      cacheWriteTokens: analyzed.audit.cacheWriteTokens,
      outputTokens: analyzed.audit.outputTokens,
      reasoningTokens: analyzed.audit.reasoningTokens,
      totalTokens: analyzed.audit.totalTokens,
      latencyMs: analyzed.audit.latencyMs,
      estimatedCostUsd: analyzed.audit.estimatedCostUsd,
      pricingVersion: analyzed.audit.pricingVersion,
      analysis: analyzed.analysis,
      chunks,
    })

    if (ownedLeaseToken) {
      await releaseLease(leaseClient(client), {
        leaseToken: ownedLeaseToken,
        terminalOutcome: "ready",
      })
      ownedLeaseToken = null
    }

    return {
      reportId: report.id,
      status: "ready",
      contentHash,
      analysisId: published.analysisId,
      aiCalled: true,
      detail: "Research report analysis published atomically",
    }
  } catch (error) {
    const detail = safeFailureDetail(error)
    const fetchFailedBeforeIdentity = stage === "fetch" && contentHash === null
    const ingestionFailed = stage === "fetch" || stage === "parse"

    if (ownedLeaseToken) {
      try {
        await releaseLease(leaseClient(client), {
          leaseToken: ownedLeaseToken,
          terminalOutcome: "failed",
        })
      } catch {
        // Lease expiry/takeover provides recovery; preserve the original report failure.
      }
      ownedLeaseToken = null
    }

    let lastKnownGood = null
    if (fetchFailedBeforeIdentity) {
      try {
        lastKnownGood = await findLastKnownGood(recoveryClient(client), report.id)
      } catch {
        // Recovery is best-effort. The run-item must still preserve the original fetch failure.
      }
    }

    await markResearchReportStatus(statusClient(client), report.id, fetchFailedBeforeIdentity && lastKnownGood
      ? {
          contentHash: lastKnownGood.contentHash,
          ingestionStatus: "parsed",
          ingestionError: detail,
          analysisStatus: "ready",
          analysisError: null,
        }
      : fetchFailedBeforeIdentity
        ? {
            ingestionStatus: "failed",
            ingestionError: detail,
          }
        : ingestionFailed
          ? {
              contentHash,
              ingestionStatus: "failed",
              ingestionError: detail,
              analysisStatus: "failed",
              analysisError: detail,
            }
          : {
              contentHash,
              analysisStatus: "failed",
              analysisError: detail,
            })

    return {
      reportId: report.id,
      status: "failed",
      contentHash,
      analysisId: null,
      aiCalled,
      detail,
    }
  }
}
