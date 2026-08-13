export type ScannerHistoryPolicy = { status: "Complete" | "Incomplete"; forceLowConfidence: boolean }

export function scannerHistoryPolicy(barCount: number): ScannerHistoryPolicy {
  if (!Number.isInteger(barCount) || barCount < 60) {
    throw new Error(`Only ${barCount} completed Daily bars; need >=60`)
  }
  return barCount < 200
    ? { status: "Incomplete", forceLowConfidence: true }
    : { status: "Complete", forceLowConfidence: false }
}
