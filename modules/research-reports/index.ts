export {
  discoverTopiReports,
  fetchTopiReportsPage,
  normalizeTopiReportCategory,
  parseTopiReport,
  TOPI_ANALYSIS_REPORT_URL,
} from "./providers/topi.ts"
export { processResearchReport } from "./analysis/pipeline.ts"
export type {
  ResearchReportProcessingClient,
  ResearchReportProcessingDependencies,
} from "./analysis/pipeline.ts"
export { answerResearchReportQuestion, ResearchReportQaError } from "./qa/service.ts"
export type {
  ResearchReportQaCitation,
  ResearchReportQaResult,
} from "./qa/service.ts"
export type {
  ResearchReportQaAudit,
  ResearchReportQaTurn,
} from "./qa/types.ts"
export { getResearchReportDetail } from "./detail/service.ts"
export type {
  ResearchReportDetailAnalysis,
  ResearchReportDetailCitation,
  ResearchReportDetailResolution,
  ResearchReportDetailTickerMention,
  ResearchReportDetailViewModel,
} from "./detail/types.ts"
export {
  selectCouncilReportEvidence,
  selectCouncilMarketReportEvidence,
  selectCouncilTickerReportEvidence,
} from "./council-evidence.ts"
export type {
  CouncilReportEvidenceItem,
  CouncilReportEvidenceRole,
  CouncilReportEvidenceSelection,
  CouncilReportTickerEvidence,
} from "./council-evidence.ts"
export { toResearchReportUpsertRow, upsertResearchReports } from "./repository.ts"
export type {
  ProcessResearchReportResult,
  ResearchReportCategory,
  ResearchReportDiscoveryResult,
  ResearchReportProvider,
  ResearchReportSourceRecord,
  ResearchReportUpsertResult,
} from "./types.ts"
