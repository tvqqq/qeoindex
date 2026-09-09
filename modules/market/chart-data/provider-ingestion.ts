export const CHART_PROVIDER_SOURCE_KEY = "PRIMARY_PROVIDER" as const

export interface ClosedRangeIngestionInput {
  ticker: string
  sourceKey: string
  from: number
  to: number
  revalidate?: boolean
  maxClaimAttempts?: number
}

export interface ClosedRangeClaimInput extends ClosedRangeIngestionInput {
  revalidate: boolean
}

export type ClosedRangeClaim =
  | { status: "covered" }
  | { status: "busy"; leaseExpiresAt?: string | null }
  | {
      status: "claimed"
      rangeId: string
      leaseOwner: string
      fence: number
      previousContentId: string | null
      previousProvenanceBatchId: string | null
    }

export interface ClosedRangeCompletion {
  provider: string
  rowCount: number
  provenanceBatchId: string | null
  contentId: string
}

export interface ClosedRangeWorkResult<T> {
  value: T
  completion: ClosedRangeCompletion
}

export interface ClosedRangeLeaseIdentity {
  rangeId: string
  leaseOwner: string
  fence: number
}

export interface ClosedRangeCoordinatorDeps {
  claim(input: ClosedRangeClaimInput): Promise<ClosedRangeClaim>
  complete(input: ClosedRangeLeaseIdentity & ClosedRangeCompletion): Promise<{ status: "completed" | "stale" }>
  abandon(input: ClosedRangeLeaseIdentity & { reason: string }): Promise<void>
  wait?(attempt: number): Promise<void>
}

export type ClosedRangeIngestionResult<T> =
  | { status: "reused" }
  | { status: "busy" }
  | { status: "completed"; value: T; claim: Extract<ClosedRangeClaim, { status: "claimed" }> }

function boundedClaimAttempts(value: number | undefined) {
  if (!Number.isFinite(value)) return 3
  return Math.max(1, Math.min(5, Math.trunc(value ?? 3)))
}

function boundedFailureReason(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "unknown")
  return message.replace(/[\r\n\t]+/g, " ").slice(0, 240) || "unknown"
}

async function defaultWait(attempt: number) {
  await new Promise((resolve) => setTimeout(resolve, Math.min(120, 25 * attempt)))
}

/**
 * Coordinates reusable closed-range provider work without holding a database
 * lock across provider/network or canonical persistence I/O. The durable
 * adapter owns the claim transaction; this helper only bounds contention and
 * publishes success after the caller's persistence callback resolves.
 */
export async function runClosedRangeIngestion<T>(
  input: ClosedRangeIngestionInput,
  deps: ClosedRangeCoordinatorDeps,
  work: (claim: Extract<ClosedRangeClaim, { status: "claimed" }>) => Promise<ClosedRangeWorkResult<T>>,
): Promise<ClosedRangeIngestionResult<T>> {
  const maxClaimAttempts = boundedClaimAttempts(input.maxClaimAttempts)
  const revalidate = input.revalidate === true
  let claim: ClosedRangeClaim = { status: "busy" }

  for (let attempt = 1; attempt <= maxClaimAttempts; attempt += 1) {
    claim = await deps.claim({ ...input, revalidate })
    if (claim.status !== "busy") break
    if (attempt < maxClaimAttempts) await (deps.wait ?? defaultWait)(attempt)
  }

  if (claim.status === "covered") return { status: "reused" }
  if (claim.status === "busy") return { status: "busy" }

  const lease = {
    rangeId: claim.rangeId,
    leaseOwner: claim.leaseOwner,
    fence: claim.fence,
  }

  try {
    const persisted = await work(claim)
    const completion = await deps.complete({ ...lease, ...persisted.completion })
    if (completion.status !== "completed") {
      throw new Error("QEO-148 closed-range completion lost its lease fence")
    }
    return { status: "completed", value: persisted.value, claim }
  } catch (error) {
    try {
      await deps.abandon({ ...lease, reason: boundedFailureReason(error) })
    } catch {
      // The lease may already be expired/stolen. Failure to abandon must never
      // convert incomplete persistence into durable success coverage.
    }
    throw error
  }
}
