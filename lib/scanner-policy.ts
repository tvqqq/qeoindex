export type ScannerHistoryStatus = "Complete" | "Incomplete"

export type ScannerHistoryPolicy = {
  status: ScannerHistoryStatus
  forceLowConfidence: boolean
}

export function scannerHistoryPolicy(barCount: number): ScannerHistoryPolicy {
  if (!Number.isInteger(barCount) || barCount < 60) {
    throw new Error(`Only ${barCount} completed Daily bars; need >=60`)
  }
  return barCount < 200
    ? { status: "Incomplete", forceLowConfidence: true }
    : { status: "Complete", forceLowConfidence: false }
}

export function shouldSkipSameDateScan(previousStatus: string | undefined, currentStatus: ScannerHistoryStatus) {
  if (previousStatus === "Complete") return true
  return previousStatus === "Incomplete" && currentStatus === "Incomplete"
}
