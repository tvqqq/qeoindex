import type { CanonicalChartOhlcvResult, CanonicalOhlcvBar } from "./contract"

export type ChartStorageAuditKind = "cold" | "mixed" | "hot"

export interface ChartStorageAuditRange {
  kind: ChartStorageAuditKind
  from: number
  to: number
}

export interface ChartStorageAuditRanges {
  cold: ChartStorageAuditRange
  mixed: ChartStorageAuditRange
  hot: ChartStorageAuditRange
}

export interface ChartStorageAuditProbe {
  kind: ChartStorageAuditKind
  from: number
  to: number
  passed: boolean
  directRows: number
  canonicalRows: number
  mismatchIndex: number | null
  coverageComplete: boolean
  gapCount: number
  integrityIssueCount: number
  errorCodes: string[]
}

export interface ChartStorageAuditResult {
  ticker: string
  passed: boolean
  probes: ChartStorageAuditProbe[]
}

export interface ChartStorageAuditDeps {
  discoverRanges(ticker: string): Promise<ChartStorageAuditRanges>
  readDirect(range: ChartStorageAuditRange): Promise<CanonicalOhlcvBar[]>
  readCanonical(range: ChartStorageAuditRange): Promise<CanonicalChartOhlcvResult>
}

function exactBar(left: CanonicalOhlcvBar, right: CanonicalOhlcvBar) {
  return left.time === right.time
    && left.open === right.open
    && left.high === right.high
    && left.low === right.low
    && left.close === right.close
    && left.volume === right.volume
}

function firstMismatch(left: CanonicalOhlcvBar[], right: CanonicalOhlcvBar[]) {
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    const leftBar = left[index]
    const rightBar = right[index]
    if (!leftBar || !rightBar || !exactBar(leftBar, rightBar)) return index
  }
  return null
}

export async function runChartStorageAudit(
  input: { ticker: string },
  deps: ChartStorageAuditDeps,
): Promise<ChartStorageAuditResult> {
  const ticker = input.ticker.trim().toUpperCase()
  if (!/^[A-Z0-9]{2,12}$/.test(ticker)) throw new Error("Invalid chart storage audit ticker")

  const ranges = await deps.discoverRanges(ticker)
  const probes: ChartStorageAuditProbe[] = []

  for (const kind of ["cold", "mixed", "hot"] as const) {
    const range = ranges[kind]
    const [direct, canonical] = await Promise.all([
      deps.readDirect(range),
      deps.readCanonical(range),
    ])
    const mismatchIndex = firstMismatch(direct, canonical.bars)
    const errorCodes = canonical.errors.map((error) => error.code)
    const coverageComplete = canonical.coverage.complete && canonical.coverage.state === "COMPLETE"
    const passed = direct.length > 0
      && mismatchIndex == null
      && coverageComplete
      && canonical.gaps.length === 0
      && canonical.integrityIssues.length === 0
      && errorCodes.length === 0

    probes.push({
      kind,
      from: range.from,
      to: range.to,
      passed,
      directRows: direct.length,
      canonicalRows: canonical.bars.length,
      mismatchIndex,
      coverageComplete,
      gapCount: canonical.gaps.length,
      integrityIssueCount: canonical.integrityIssues.length,
      errorCodes,
    })
  }

  return {
    ticker,
    passed: probes.every((probe) => probe.passed),
    probes,
  }
}
