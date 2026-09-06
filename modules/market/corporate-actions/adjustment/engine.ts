import { computeStepAdjustment, AdjustmentFactorError } from "./formulas.ts"
import { sha256Canonical } from "./lineage.ts"
import type { CanonicalFactorAction, StepAdjustment } from "./types.ts"

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const LINEAGE_CONTRACT_VERSION = "qeo124-factor-lineage-v1"

export type FactorInputAction = Omit<CanonicalFactorAction, "exDate"> & {
  exDate: string | null
}

export type RawDailyReference = {
  sessionDate: string
  close: number
}

export type FactorRunBlockedReason =
  | "MISSING_CANONICAL_EX_DATE"
  | "MISSING_EFFECTIVE_SESSION"
  | "MISSING_REFERENCE_SESSION"
  | "MISSING_REFERENCE_RAW_CLOSE"
  | "INVALID_REFERENCE_RAW_CLOSE"
  | "INVALID_EVENT_SET"

export type FactorTransition = StepAdjustment & {
  ticker: string
  effectiveSession: string
  referenceSession: string
  referenceRawClose: number
  cumulativePriceFactor: number
  cumulativeVolumeFactor: number
  eventLineageHash: string
}

export type FactorRunCandidate = {
  ticker: string
  factorVersion: string
  engineVersion: string
  eventLineageHash: string
  asOfDate: string
  status: "candidate" | "blocked"
  blockedReason: string | null
  transitions: FactorTransition[]
}

export type BuildFactorRunCandidateInput = {
  ticker: string
  sessions: string[]
  rawDailyByDate: Map<string, RawDailyReference>
  actions: FactorInputAction[]
  asOfDate: string
  engineVersion: string
}

function validIsoDate(value: string | null | undefined): value is string {
  if (!value || !ISO_DATE.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function canonicalAction(action: FactorInputAction) {
  return {
    id: action.id,
    ticker: action.ticker,
    actionType: action.actionType,
    exDate: action.exDate,
    cashPerShare: action.cashPerShare,
    stockRatioNumerator: action.stockRatioNumerator,
    stockRatioDenominator: action.stockRatioDenominator,
    rightsRatioNumerator: action.rightsRatioNumerator,
    rightsRatioDenominator: action.rightsRatioDenominator,
    subscriptionPrice: action.subscriptionPrice,
    normalizationVersion: action.normalizationVersion,
    rawEvidenceHash: action.rawEvidenceHash,
    source: action.source,
    lineageRootSourceEventId: action.lineageRootSourceEventId,
    sourceComponentKey: action.sourceComponentKey,
  }
}

function runIdentity(input: {
  ticker: string
  engineVersion: string
  asOfDate: string
  transitions: Array<{
    effectiveSession: string
    referenceSession: string
    referenceRawClose: number
    eventLineageHash: string
  }>
}) {
  return sha256Canonical({
    contractVersion: LINEAGE_CONTRACT_VERSION,
    ticker: input.ticker,
    engineVersion: input.engineVersion,
    asOfDate: input.asOfDate,
    transitions: input.transitions.map((transition) => ({
      effectiveSession: transition.effectiveSession,
      referenceSession: transition.referenceSession,
      referenceRawClose: transition.referenceRawClose,
      eventLineageHash: transition.eventLineageHash,
    })),
  })
}

function blockedCandidate(
  input: BuildFactorRunCandidateInput,
  blockedReason: string,
  lineageEvidence: unknown,
): FactorRunCandidate {
  const eventLineageHash = sha256Canonical({
    contractVersion: LINEAGE_CONTRACT_VERSION,
    ticker: input.ticker,
    engineVersion: input.engineVersion,
    asOfDate: input.asOfDate,
    status: "blocked",
    blockedReason,
    evidence: lineageEvidence,
  })
  return {
    ticker: input.ticker,
    factorVersion: `${input.engineVersion}:${eventLineageHash}`,
    engineVersion: input.engineVersion,
    eventLineageHash,
    asOfDate: input.asOfDate,
    status: "blocked",
    blockedReason,
    transitions: [],
  }
}

function sortedUniqueSessions(sessions: string[]) {
  return [...new Set(sessions.filter(validIsoDate))].sort()
}

function findReferenceSession(sessions: string[], effectiveSession: string) {
  let reference: string | null = null
  for (const session of sessions) {
    if (session >= effectiveSession) break
    reference = session
  }
  return reference
}

export function buildFactorRunCandidate(input: BuildFactorRunCandidateInput): FactorRunCandidate {
  const orderedActions = [...input.actions].sort((left, right) => left.id.localeCompare(right.id))
  const missingExDate = orderedActions.find((action) => !validIsoDate(action.exDate))
  if (missingExDate) {
    return blockedCandidate(input, "MISSING_CANONICAL_EX_DATE", {
      action: canonicalAction(missingExDate),
    })
  }

  const effectiveActions = orderedActions.filter((action) => (action.exDate as string) <= input.asOfDate)
  const sessions = sortedUniqueSessions(input.sessions)
  const actionsByDate = new Map<string, FactorInputAction[]>()
  for (const action of effectiveActions) {
    const exDate = action.exDate as string
    const existing = actionsByDate.get(exDate) ?? []
    existing.push(action)
    actionsByDate.set(exDate, existing)
  }

  const baseTransitions: FactorTransition[] = []
  for (const effectiveSession of [...actionsByDate.keys()].sort()) {
    if (!sessions.includes(effectiveSession)) {
      return blockedCandidate(input, "MISSING_EFFECTIVE_SESSION", {
        effectiveSession,
        actions: (actionsByDate.get(effectiveSession) ?? []).map(canonicalAction),
      })
    }

    const referenceSession = findReferenceSession(sessions, effectiveSession)
    if (!referenceSession) {
      return blockedCandidate(input, "MISSING_REFERENCE_SESSION", {
        effectiveSession,
        actions: (actionsByDate.get(effectiveSession) ?? []).map(canonicalAction),
      })
    }

    const rawReference = input.rawDailyByDate.get(referenceSession)
    if (!rawReference) {
      return blockedCandidate(input, "MISSING_REFERENCE_RAW_CLOSE", {
        effectiveSession,
        referenceSession,
        actions: (actionsByDate.get(effectiveSession) ?? []).map(canonicalAction),
      })
    }
    if (
      rawReference.sessionDate !== referenceSession
      || !Number.isFinite(rawReference.close)
      || rawReference.close <= 0
    ) {
      return blockedCandidate(input, "INVALID_REFERENCE_RAW_CLOSE", {
        effectiveSession,
        referenceSession,
        rawReference,
        actions: (actionsByDate.get(effectiveSession) ?? []).map(canonicalAction),
      })
    }

    const eventActions = actionsByDate.get(effectiveSession) ?? []
    let step: StepAdjustment
    try {
      step = computeStepAdjustment({
        ticker: input.ticker,
        exDate: effectiveSession,
        previousRawClose: rawReference.close,
        events: eventActions as CanonicalFactorAction[],
      })
    } catch (error) {
      const detail = error instanceof AdjustmentFactorError ? error.code : "UNKNOWN"
      return blockedCandidate(input, `INVALID_EVENT_SET:${detail}`, {
        effectiveSession,
        referenceSession,
        referenceRawClose: rawReference.close,
        actions: eventActions.map(canonicalAction),
      })
    }

    const eventLineageHash = sha256Canonical({
      contractVersion: LINEAGE_CONTRACT_VERSION,
      ticker: input.ticker,
      engineVersion: input.engineVersion,
      effectiveSession,
      referenceSession,
      referenceRawClose: rawReference.close,
      actions: eventActions.map(canonicalAction),
      formulaInputs: step.formulaInputs,
    })

    baseTransitions.push({
      ...step,
      ticker: input.ticker,
      effectiveSession,
      referenceSession,
      referenceRawClose: rawReference.close,
      cumulativePriceFactor: 1,
      cumulativeVolumeFactor: 1,
      eventLineageHash,
    })
  }

  let cumulativePriceFactor = 1
  let cumulativeVolumeFactor = 1
  for (let index = baseTransitions.length - 1; index >= 0; index -= 1) {
    const transition = baseTransitions[index]
    cumulativePriceFactor *= transition.stepPriceFactor
    cumulativeVolumeFactor *= transition.stepVolumeFactor
    transition.cumulativePriceFactor = cumulativePriceFactor
    transition.cumulativeVolumeFactor = cumulativeVolumeFactor
  }

  const eventLineageHash = runIdentity({
    ticker: input.ticker,
    engineVersion: input.engineVersion,
    asOfDate: input.asOfDate,
    transitions: baseTransitions,
  })

  return {
    ticker: input.ticker,
    factorVersion: `${input.engineVersion}:${eventLineageHash}`,
    engineVersion: input.engineVersion,
    eventLineageHash,
    asOfDate: input.asOfDate,
    status: "candidate",
    blockedReason: null,
    transitions: baseTransitions,
  }
}
