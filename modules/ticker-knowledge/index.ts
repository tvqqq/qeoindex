export {
  TICKER_KNOWLEDGE_AUTHORITIES,
  TICKER_KNOWLEDGE_COLLECTION,
  TICKER_KNOWLEDGE_PROJECTION_VERSION,
  TICKER_KNOWLEDGE_SCHEMA_VERSION,
  TICKER_KNOWLEDGE_SOURCE_TYPES,
  TICKER_KNOWLEDGE_TYPES,
  TickerKnowledgeUnavailableError,
  createTickerKnowledgeIdentity,
  createTickerKnowledgeItem,
  normalizeTicker,
  queryTickerKnowledgeSafely,
} from "./domain.ts"
export type {
  SafeTickerKnowledgeQueryResult,
  TickerKnowledgeAuthority,
  TickerKnowledgeDerivedVersions,
  TickerKnowledgeEmbeddingProvider,
  TickerKnowledgeIdentity,
  TickerKnowledgeIdentityInput,
  TickerKnowledgeIndex,
  TickerKnowledgeItem,
  TickerKnowledgeProvenance,
  TickerKnowledgeQuery,
  TickerKnowledgeSearchResult,
  TickerKnowledgeSourceType,
  TickerKnowledgeType,
  TickerKnowledgeUnavailableReason,
} from "./domain.ts"
export {
  TICKER_KNOWLEDGE_SPARSE_ENCODER,
  TICKER_KNOWLEDGE_SPARSE_VERSION,
  encodeTickerKnowledgeSparse,
} from "./sparse.ts"
export type { TickerKnowledgeSparseVector } from "./sparse.ts"
export { createQdrantTickerKnowledgeIndex } from "./qdrant.ts"
export type { QdrantTickerKnowledgeIndexOptions } from "./qdrant.ts"
export {
  COLD_EVIDENCE_ARCHIVE_FORMAT,
  COLD_EVIDENCE_FORMAT_VERSION,
  createSupabaseColdEvidenceStore,
} from "./cold-evidence.ts"
export type {
  ArchiveColdEvidenceInput,
  ColdEvidenceDomain,
  ColdEvidenceEnvelope,
  ColdEvidencePointer,
  ColdEvidenceStore,
} from "./cold-evidence.ts"
export {
  COUNCIL_HISTORY_KNOWLEDGE_PROJECTION_VERSION,
  NOTION_THESIS_KNOWLEDGE_PROJECTION_VERSION,
  RESEARCH_REPORT_KNOWLEDGE_PROJECTION_VERSION,
  TICKER_KNOWLEDGE_PROJECTION_FAMILY_VERSION,
  projectCouncilHistoryKnowledge,
  projectCurrentThesisKnowledge,
  projectResearchReportKnowledge,
} from "./projections.ts"
export type {
  CouncilHistoryKnowledgeProjectionInput,
  ResearchReportKnowledgeProjectionInput,
} from "./projections.ts"
export {
  runTickerKnowledgeBackfill,
  syncCouncilHistoryKnowledge,
  syncCurrentThesisKnowledge,
  syncResearchReportKnowledge,
} from "./sync.ts"
export type {
  RunTickerKnowledgeBackfillInput,
  TickerKnowledgeBackfillPage,
  TickerKnowledgeBackfillProgress,
  TickerKnowledgeSyncResult,
} from "./sync.ts"
export {
  MAX_CURRENT_THESIS_REBUILD,
  inspectCurrentThesisProjection,
  rebuildCurrentThesisKnowledge,
} from "./notion-sync.ts"
export type {
  CurrentThesisProjectionState,
  CurrentThesisProjectionStatus,
  CurrentThesisRebuildResult,
  CurrentThesisRebuildRow,
  RebuildCurrentThesisKnowledgeInput,
} from "./notion-sync.ts"
export { buildTickerContext } from "./context.ts"
export type {
  BuildTickerContextInput,
  TickerContext,
  TickerContextConsumer,
  TickerContextTelemetry,
} from "./context.ts"
