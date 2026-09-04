/**
 * Deno-safe market AI contract.
 *
 * Keep this file deliberately free of Next.js/node imports. The synchronous
 * shape and canonicalization mirror modules/research/market-insight/ai-conclusion.ts; hashing is
 * async here because Edge Runtime exposes Web Crypto instead of node:crypto.
 */

export const MARKET_AI_CONCLUSION_VERSION = "market-ai-conclusion-v2" as const
export const MARKET_AI_POLICY_VERSION = "market-ai-policy-v2" as const
export const MARKET_AI_PROMPT_VERSION = "market-ai-prompt-v9" as const
export const MARKET_AI_POSTURE = ["constructive", "constructive_with_caution", "neutral", "defensive", "insufficient_evidence"] as const
export type MarketAiPosture = typeof MARKET_AI_POSTURE[number]

export interface MarketAiEvidenceFact {
  id: string
  field: string
  value: string | number | null
  unit: string | null
  asOf: string
  source: string
}

export interface MarketAiEvidencePacket {
  packetVersion: typeof MARKET_AI_CONCLUSION_VERSION
  snapshotId: string
  sessionDate: string
  asOf: string
  policyVersion: string
  promptVersion: string
  framework: "canslim_4m_inspired"
  source: string
  qualityStatus: string
  missingFields: string[]
  facts: MarketAiEvidenceFact[]
  observations: Array<{ id: string; title: string; content: string; category: string; sentiment: string; evidenceRefs: string[] }>
  mandatoryDimensions: Record<"index_breadth" | "liquidity_flow" | "ma_health" | "sector_rotation" | "leadership", "complete" | "partial" | "missing">
}

export interface MarketAiCitation {
  factId: string
  claim: "conclusion" | "risk" | "effort_result"
  riskIndex?: number | null
  interpretation: string
}

export interface MarketAiConclusionPayload {
  schemaVersion: typeof MARKET_AI_CONCLUSION_VERSION
  confidence: "low" | "medium" | "high"
  headline: string
  sessionDate: string
  asOf: string
  snapshotId: string
  evidenceHash: string
  policyVersion: string
  promptVersion: string
  framework: "canslim_4m_inspired"
  posture: MarketAiPosture
  conclusion: string
  risks: string[]
  missingEvidence: string[]
  effortResult: { effort: string; effortEvidenceRefs: string[]; result: string; resultEvidenceRefs: string[]; interpretation: string }
  dimensions: Array<{ key: keyof MarketAiEvidencePacket["mandatoryDimensions"]; stance: "supportive" | "mixed" | "adverse" | "unknown"; summary: string; evidenceRefs: string[] }>
  citations: MarketAiCitation[]
}

export interface MarketAiSnapshotInput {
  sessionDate: string
  asOf: string
  qualityStatus: string
  marketInsightProvenance: {
    syncRunId: string
    payloadChecksum: string
    contractVersion: number
    endpointCoverage: Record<string, boolean>
    publishedCounts: Record<string, number>
  }
  daily: {
    sentimentScore: number | null
    riskScore: number | null
    aboveMa20Pct: number | null
    totalTradedValue: number | null
    foreignNetValue: number | null
    proprietaryNetValue: number | null
    missingFields?: string[]
  }
  indexes: Array<{
    indexCode: string
    value: number | null
    changePct: number | null
    advances: number
    unchanged: number
    declines: number
    asOf: string
  }>
  sectors: Array<{
    sectorKey: string
    rotationState: string | null
    effortPct: number | null
    resultPct: number | null
    asOf: string
  }>
  leaders: Array<{
    category: string
    rank: number
    ticker: string
    metricValue: number | null
    metricLabel?: string | null
    price: number | null
    asOf: string
  }>
  observations?: MarketAiEvidencePacket["observations"]
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, canonicalize(child)]))
}

function utf8Hex(buffer: ArrayBuffer) {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

export async function hashMarketAiEvidence(packet: MarketAiEvidencePacket): Promise<string> {
  const stable = {
    ...packet,
    facts: [...packet.facts].sort((a, b) => a.id.localeCompare(b.id)),
    observations: [...packet.observations].sort((a, b) => a.id.localeCompare(b.id)),
    missingFields: [...packet.missingFields].sort(),
  }
  const bytes = new TextEncoder().encode(JSON.stringify(canonicalize(stable)))
  return utf8Hex(await crypto.subtle.digest("SHA-256", bytes))
}

function snapshotIdentity(data: Pick<MarketAiSnapshotInput, "sessionDate" | "asOf" | "marketInsightProvenance">) {
  // This is intentionally the same input tuple as the server-side contract.
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify({ sessionDate: data.sessionDate, asOf: data.asOf, source: "market_insight_published", syncRunId: data.marketInsightProvenance.syncRunId, payloadChecksum: data.marketInsightProvenance.payloadChecksum, contractVersion: data.marketInsightProvenance.contractVersion })))
}

async function snapshotIdentityHex(data: Pick<MarketAiSnapshotInput, "sessionDate" | "asOf" | "marketInsightProvenance">) {
  return utf8Hex(await snapshotIdentity(data))
}

function makeFact(id: string, field: string, value: string | number | null, unit: string | null, asOf: string): MarketAiEvidenceFact {
  return { id, field, value, unit, asOf, source: "market_insight_published" }
}

export async function buildMarketAiEvidencePacket(data: MarketAiSnapshotInput): Promise<MarketAiEvidencePacket> {
  if (!data.sessionDate || !data.asOf || !data.qualityStatus) throw new Error("Market AI evidence requires session, asOf and quality")
  if (!data.marketInsightProvenance?.syncRunId || !/^[0-9a-f]{64}$/.test(data.marketInsightProvenance.payloadChecksum) || !Number.isInteger(data.marketInsightProvenance.contractVersion)) throw new Error("Market AI evidence requires published snapshot provenance")
  const vnindex = data.indexes.find((item) => item.indexCode === "VNINDEX")
  if (!vnindex || vnindex.asOf !== data.asOf) throw new Error("Market AI evidence requires one asOf-aligned VNINDEX")

  const facts = [
    makeFact("vnindex_close", "vnindex_close", vnindex.value, "points", data.asOf),
    makeFact("vnindex_change_pct", "vnindex_change_pct", vnindex.changePct, "%", data.asOf),
    makeFact("advances", "advances", vnindex.advances, "stocks", data.asOf),
    makeFact("unchanged", "unchanged", vnindex.unchanged, "stocks", data.asOf),
    makeFact("declines", "declines", vnindex.declines, "stocks", data.asOf),
    makeFact("sentiment_score", "sentiment_score", data.daily.sentimentScore, "score_0_100", data.asOf),
    makeFact("risk_score", "risk_score", data.daily.riskScore, "score_0_1", data.asOf),
    makeFact("above_ma20_pct", "above_ma20_pct", data.daily.aboveMa20Pct, "%", data.asOf),
    makeFact("total_traded_value", "total_traded_value", data.daily.totalTradedValue, "provider_unit_unverified", data.asOf),
    makeFact("foreign_net_value", "foreign_net_value", data.daily.foreignNetValue, "provider_unit_unverified", data.asOf),
    makeFact("proprietary_net_value", "proprietary_net_value", data.daily.proprietaryNetValue, "provider_unit_unverified", data.asOf),
    ...data.sectors.filter((sector) => sector.asOf === data.asOf).sort((a, b) =>
      Math.max(Math.abs(b.effortPct ?? 0), Math.abs(b.resultPct ?? 0)) - Math.max(Math.abs(a.effortPct ?? 0), Math.abs(a.resultPct ?? 0))
      || a.sectorKey.localeCompare(b.sectorKey),
    ).slice(0, 12).sort((a, b) => a.sectorKey.localeCompare(b.sectorKey)).flatMap((sector) => [
      makeFact(`sector:${sector.sectorKey}:effort`, "sector_effort_pct", sector.effortPct, "%", data.asOf),
      makeFact(`sector:${sector.sectorKey}:result`, "sector_result_pct", sector.resultPct, "%", data.asOf),
      makeFact(`sector:${sector.sectorKey}:rotation`, "sector_rotation_state", sector.rotationState, "state", data.asOf),
    ]),
    ...data.leaders.sort((a, b) => a.category.localeCompare(b.category) || a.rank - b.rank || a.ticker.localeCompare(b.ticker)).slice(0, 20).map((leader) => makeFact(`leader:${leader.category}:${leader.rank}:${leader.ticker}`, leader.metricLabel || leader.category, leader.metricValue, null, data.asOf)),
  ].sort((a, b) => a.id.localeCompare(b.id))

  const missingFields = facts.filter((item) => item.value == null).map((item) => item.field)
  const mandatoryDimensions = {
    index_breadth: ["vnindex_close", "vnindex_change_pct", "advances", "declines"].every((id) => facts.some((item) => item.id === id && item.value != null)) ? "complete" : "missing",
    liquidity_flow: facts.some((item) => item.id === "total_traded_value" && item.value != null) && facts.some((item) => ["foreign_net_value", "proprietary_net_value"].includes(item.id) && item.value != null) ? "complete" : "missing",
    ma_health: facts.some((item) => item.id === "above_ma20_pct" && item.value != null) ? "complete" : "missing",
    sector_rotation: data.sectors.length ? (data.sectors.every((sector) => Boolean(sector.rotationState) && sector.effortPct != null && sector.resultPct != null) ? "complete" : "partial") : "missing",
    leadership: data.leaders.some((leader) => leader.ticker && (leader.metricValue != null || leader.price != null)) ? "complete" : "missing",
  } as const

  const observations: MarketAiEvidencePacket["observations"] = []

  return {
    packetVersion: MARKET_AI_CONCLUSION_VERSION,
    snapshotId: await snapshotIdentityHex(data),
    sessionDate: data.sessionDate,
    asOf: data.asOf,
    policyVersion: MARKET_AI_POLICY_VERSION,
    promptVersion: MARKET_AI_PROMPT_VERSION,
    framework: "canslim_4m_inspired",
    source: "market_insight_published",
    qualityStatus: data.qualityStatus,
    missingFields: [...new Set([...(data.daily.missingFields || []), ...missingFields])].sort(),
    facts,
    observations,
    mandatoryDimensions,
  }
}

export function expectedMissingEvidence(packet: MarketAiEvidencePacket) {
  return [...new Set([...Object.entries(packet.mandatoryDimensions).filter(([, value]) => value !== "complete").map(([key]) => key), ...packet.missingFields])].sort()
}

export function normalizeMarketAiConclusionReferences(payload: MarketAiConclusionPayload, packet: MarketAiEvidencePacket): MarketAiConclusionPayload {
  const known = new Set(packet.facts.map((item) => item.id))
  const owners: Record<MarketAiConclusionPayload["dimensions"][number]["key"], (id: string) => boolean> = {
    index_breadth: (id) => ["vnindex_close", "vnindex_change_pct", "advances", "unchanged", "declines"].includes(id),
    liquidity_flow: (id) => ["total_traded_value", "foreign_net_value", "proprietary_net_value"].includes(id),
    ma_health: (id) => id === "above_ma20_pct",
    sector_rotation: (id) => id.startsWith("sector:"),
    leadership: (id) => id.startsWith("leader:"),
  }
  const dimensions = payload.dimensions.map((dimension) => {
    const owned = dimension.evidenceRefs.filter((id) => known.has(id) && owners[dimension.key](id)).slice(0, 3)
    const fallback = packet.facts.find((fact) => owners[dimension.key](fact.id) && fact.value != null)?.id
    return { ...dimension, evidenceRefs: owned.length ? owned : fallback ? [fallback] : [] }
  })
  const citations = [...payload.citations]
  if (!citations.some((citation) => citation.claim === "effort_result")) {
    const effortFact = [...payload.effortResult.effortEvidenceRefs, ...payload.effortResult.resultEvidenceRefs]
      .find((id) => known.has(id) && (id === "total_traded_value" || id === "foreign_net_value" || id === "proprietary_net_value" || id === "vnindex_change_pct" || id.startsWith("sector:")))
    if (effortFact) citations.push({ factId: effortFact, claim: "effort_result", riskIndex: null, interpretation: payload.effortResult.interpretation })
  }
  return { ...payload, dimensions, citations }
}

export function validateMarketAiConclusion(input: { payload: unknown; packet: MarketAiEvidencePacket; evidenceHash: string; packetHash?: string }): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  const payload = input.payload as Partial<MarketAiConclusionPayload> | null
  if (!payload || payload.schemaVersion !== MARKET_AI_CONCLUSION_VERSION || payload.sessionDate !== input.packet.sessionDate || payload.asOf !== input.packet.asOf || payload.snapshotId !== input.packet.snapshotId || payload.evidenceHash !== input.evidenceHash || payload.policyVersion !== input.packet.policyVersion || payload.promptVersion !== input.packet.promptVersion || payload.framework !== input.packet.framework || !MARKET_AI_POSTURE.includes(payload.posture as MarketAiPosture)) errors.push("invalid identity, schema or posture")
  if (!payload || !["low", "medium", "high"].includes(payload.confidence || "") || typeof payload.headline !== "string" || payload.headline.length > 240) errors.push("invalid confidence or headline")
  if (typeof payload?.conclusion !== "string" || payload.conclusion.length < 1 || payload.conclusion.length > 1600) errors.push("invalid conclusion")
  if (!Array.isArray(payload?.risks) || payload.risks.length > 6 || payload.risks.some((item) => typeof item !== "string" || item.length > 400)) errors.push("invalid risks")
  const known = new Set(input.packet.facts.map((item) => item.id))
  const refsValid = (refs: unknown, owner: (id: string) => boolean) => Array.isArray(refs) && refs.length > 0 && refs.every((id) => typeof id === "string" && known.has(id) && owner(id))
  const flowOrSector = (id: string) => id === "total_traded_value" || id === "foreign_net_value" || id === "proprietary_net_value" || id === "vnindex_change_pct" || id.startsWith("sector:")
  if (!payload?.effortResult || typeof payload.effortResult.effort !== "string" || payload.effortResult.effort.length < 1 || payload.effortResult.effort.length > 240 || typeof payload.effortResult.result !== "string" || payload.effortResult.result.length < 1 || payload.effortResult.result.length > 240 || !refsValid(payload.effortResult.effortEvidenceRefs, flowOrSector) || !refsValid(payload.effortResult.resultEvidenceRefs, flowOrSector) || typeof payload.effortResult.interpretation !== "string" || payload.effortResult.interpretation.length < 1 || payload.effortResult.interpretation.length > 400) errors.push("invalid effort-result")
  const dimensionKeys = ["index_breadth", "liquidity_flow", "ma_health", "sector_rotation", "leadership"] as const
  const owners: Record<typeof dimensionKeys[number], (id: string) => boolean> = {
    index_breadth: (id) => ["vnindex_close", "vnindex_change_pct", "advances", "unchanged", "declines"].includes(id),
    liquidity_flow: (id) => ["total_traded_value", "foreign_net_value", "proprietary_net_value"].includes(id),
    ma_health: (id) => id === "above_ma20_pct",
    sector_rotation: (id) => id.startsWith("sector:"),
    leadership: (id) => id.startsWith("leader:"),
  }
  const dimensionRefsValid = (item: { key: keyof MarketAiEvidencePacket["mandatoryDimensions"]; stance: string; evidenceRefs?: unknown }) => item.stance === "unknown" && input.packet.mandatoryDimensions[item.key] !== "complete" ? Array.isArray(item.evidenceRefs) && item.evidenceRefs.every((id) => typeof id === "string" && known.has(id) && owners[item.key](id)) : refsValid(item.evidenceRefs, owners[item.key])
  if (!Array.isArray(payload?.dimensions) || payload.dimensions.length !== dimensionKeys.length || new Set(payload.dimensions.map((item) => item.key)).size !== dimensionKeys.length || dimensionKeys.some((key) => !payload?.dimensions?.some((item) => item.key === key)) || payload.dimensions.some((item) => !dimensionKeys.includes(item.key) || !["supportive", "mixed", "adverse", "unknown"].includes(item.stance) || typeof item.summary !== "string" || item.summary.length < 1 || item.summary.length > 400 || !dimensionRefsValid(item))) errors.push("all mandatory dimensions required with owned evidence refs")
  const expectedMissing = expectedMissingEvidence(input.packet)
  const actualMissing = Array.isArray(payload?.missingEvidence) && payload.missingEvidence.every((item) => typeof item === "string") ? [...payload.missingEvidence].sort() : []
  if (JSON.stringify(actualMissing) !== JSON.stringify(expectedMissing)) errors.push("missing evidence mismatch")
  if (JSON.stringify(payload).length > 24_000) errors.push("payload too large")
  const refs = Array.isArray(payload?.citations) ? payload.citations : []
  if (!refs.length) errors.push("at least one citation required")
  for (const ref of refs) {
    if (!ref || typeof ref.factId !== "string" || !known.has(ref.factId)) errors.push(`unknown citation: ${String(ref?.factId)}`)
    if (typeof ref?.claim !== "string" || !["conclusion", "risk", "effort_result"].includes(ref.claim)) errors.push("invalid citation claim")
    if (typeof ref?.interpretation !== "string" || ref.interpretation.length < 1 || ref.interpretation.length > 400) errors.push("invalid citation interpretation")
    if (ref?.claim === "effort_result" && !flowOrSector(String(ref.factId))) errors.push("effort-result citation has wrong owner")
    if (ref?.claim === "risk" && (!Number.isInteger(ref.riskIndex) || Number(ref.riskIndex) < 0 || Number(ref.riskIndex) >= (payload?.risks?.length || 0))) errors.push("risk citation index invalid")
    if (ref?.claim !== "risk" && ref?.riskIndex != null) errors.push("riskIndex only allowed for risks")
  }
  if (!refs.some((ref) => ref?.claim === "conclusion")) errors.push("conclusion must be cited")
  for (let index = 0; index < (Array.isArray(payload?.risks) ? payload.risks.length : 0); index += 1) {
    if (!refs.some((ref) => ref?.claim === "risk" && ref?.riskIndex === index)) errors.push(`risk ${index} must be cited`)
  }
  if (!refs.some((ref) => ref?.claim === "effort_result")) errors.push("effort-result must be cited")
  if (input.packetHash != null && input.evidenceHash !== input.packetHash) errors.push("evidence hash mismatch")
  if (input.packet.missingFields.length > 80) errors.push("missing evidence list too large")
  if (Object.values(input.packet.mandatoryDimensions).some((value) => value !== "complete") && payload?.posture !== "insufficient_evidence") errors.push("incomplete mandatory evidence requires insufficient_evidence")
  return { valid: errors.length === 0, errors }
}
