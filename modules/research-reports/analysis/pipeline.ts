import {
  findSuccessfulResearchReportAnalysis,
  markResearchReportStatus,
  publishResearchReportAnalysis,
  type ResearchReportAnalysisIdentity,
} from "../repository.ts"
import type { ProcessResearchReportResult } from "../types.ts"
import { chunkResearchReportPages, REPORT_CHUNK_VERSION } from "../pdf/chunk.ts"
import { parseResearchReportPdf } from "../pdf/parse.ts"
import { fetchResearchReportPdf } from "../pdf/secure-fetch.ts"
import { analyzeResearchReportPages, getResearchReportAiModelRoute } from "./openai.ts"
import { REPORT_ANALYSIS_VERSION, REPORT_PROMPT_VERSION } from "./prompt.ts"

type AnalysisLookupClient = Parameters<typeof findSuccessfulResearchReportAnalysis>[0]
type ReportStatusClient = Parameters<typeof markResearchReportStatus>[0]
type ReportPublishClient = Parameters<typeof publishResearchReportAnalysis>[0]

export interface ResearchReportProcessingClient {
  from(table: string): unknown
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{
    data: unknown
    error: { message?: string } | null
  }>
}

export interface ResearchReportProcessingDependencies {
  fetchPdf?: typeof fetchResearchReportPdf
  parsePdf?: typeof parseResearchReportPdf
  analyzePages?: typeof analyzeResearchReportPages
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

export async function processResearchReport(
  client: ResearchReportProcessingClient,
  report: ResearchReportProcessingInput,
  deps: ResearchReportProcessingDependencies = {},
): Promise<ProcessResearchReportResult> {
  const fetchPdf = deps.fetchPdf ?? fetchResearchReportPdf
  const parsePdf = deps.parsePdf ?? parseResearchReportPdf
  const analyzePages = deps.analyzePages ?? analyzeResearchReportPages

  let contentHash: string | null = null
  let aiCalled = false
  let stage: ProcessingStage = "fetch"

  try {
    await markResearchReportStatus(statusClient(client), report.id, {
      ingestionStatus: "fetching",
      ingestionError: null,
      analysisError: null,
    })

    const downloaded = await fetchPdf(report.pdfUrl)
    contentHash = downloaded.contentHash

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
      return {
        reportId: report.id,
        status: "skipped_existing",
        contentHash,
        analysisId: existing.id,
        aiCalled: false,
        detail: "Identical successful analysis already exists",
      }
    }

    stage = "analysis"
    await markResearchReportStatus(statusClient(client), report.id, {
      analysisStatus: "processing",
      analysisError: null,
    })

    aiCalled = true
    const analyzed = await analyzePages(parsed.pages)
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
      outputTokens: analyzed.audit.outputTokens,
      reasoningTokens: analyzed.audit.reasoningTokens,
      totalTokens: analyzed.audit.totalTokens,
      latencyMs: analyzed.audit.latencyMs,
      estimatedCostUsd: analyzed.audit.estimatedCostUsd,
      pricingVersion: analyzed.audit.pricingVersion,
      analysis: analyzed.analysis,
      chunks,
    })

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
    const ingestionFailed = stage === "fetch" || stage === "parse"

    await markResearchReportStatus(statusClient(client), report.id, ingestionFailed
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
