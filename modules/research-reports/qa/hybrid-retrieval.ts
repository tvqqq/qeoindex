import { buildTickerContext } from "@/modules/ticker-knowledge/context"
import type {
  TickerKnowledgeIndex,
  TickerKnowledgeUnavailableReason,
} from "@/modules/ticker-knowledge/domain"
import { RESEARCH_REPORT_QA_PARTITION } from "@/modules/ticker-knowledge/partitions"

import { hydrateResearchReportQaEvidence } from "./retrieval.ts"
import {
  RESEARCH_REPORT_QA_LIMITS,
  type ResearchReportQaEvidence,
  type ResearchReportQaEvidenceIdentity,
  type ResearchReportQaRetrievalClient,
} from "./types.ts"

export { RESEARCH_REPORT_QA_PARTITION }

export type ResearchReportQaHybridEvidenceResult =
  | {
      status: "ready"
      evidence: ResearchReportQaEvidence[]
      pointIds: string[]
      retrievalMs: number
      hydrationMs: number
    }
  | {
      status: "unavailable"
      evidence: []
      pointIds: []
      reason: TickerKnowledgeUnavailableReason
      retrievalMs: number
      hydrationMs: 0
    }

function sourceVersion(identity: ResearchReportQaEvidenceIdentity) {
  return `${identity.contentHash}:${identity.analysisId}:${identity.chunkVersion}`
}

function nowMs() {
  return typeof performance !== "undefined" ? performance.now() : Date.now()
}

export async function retrieveResearchReportQaHybridEvidence(
  index: TickerKnowledgeIndex,
  client: ResearchReportQaRetrievalClient,
  identity: ResearchReportQaEvidenceIdentity,
  query: string,
): Promise<ResearchReportQaHybridEvidenceResult> {
  const retrievalStarted = nowMs()
  const exactSourceVersion = sourceVersion(identity)
  const context = await buildTickerContext({
    index,
    ticker: RESEARCH_REPORT_QA_PARTITION,
    query,
    consumer: "REPORT_QA",
    knowledgeTypes: ["REPORT_CHUNK"],
    sourceTypes: ["RESEARCH_REPORT"],
    reportId: identity.reportId,
    analysisId: identity.analysisId,
    sourceId: identity.reportId,
    sourceVersion: exactSourceVersion,
    contentHash: identity.contentHash,
    chunkVersion: identity.chunkVersion,
    limit: RESEARCH_REPORT_QA_LIMITS.retrievalChunks,
  })
  const retrievalMs = Math.max(0, nowMs() - retrievalStarted)

  if (context.retrievalStatus === "unavailable") {
    return {
      status: "unavailable",
      evidence: [],
      pointIds: [],
      reason: context.retrievalReason ?? "qdrant_unavailable",
      retrievalMs,
      hydrationMs: 0,
    }
  }

  const candidates = context.items
    .filter((item) => item.knowledgeType === "REPORT_CHUNK" && item.provenance.chunkId)
    .slice(0, RESEARCH_REPORT_QA_LIMITS.retrievalChunks)
    .map((item, index) => ({
      chunkId: item.provenance.chunkId as string,
      rank: Math.max(0.001, 1 - index / RESEARCH_REPORT_QA_LIMITS.retrievalChunks),
    }))

  const hydrationStarted = nowMs()
  const evidence = await hydrateResearchReportQaEvidence(client, identity, candidates)
  const hydrationMs = Math.max(0, nowMs() - hydrationStarted)

  return {
    status: "ready",
    evidence,
    pointIds: context.retrievedPointIds,
    retrievalMs,
    hydrationMs,
  }
}
