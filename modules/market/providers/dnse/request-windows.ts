export interface DnseRequestWindow {
  from: number
  to: number
}

const SECONDS_PER_DAY = 86_400

export function buildDnseRequestWindows(from: number, to: number, maxDays: number): DnseRequestWindow[] {
  const maxSeconds = Math.max(1, Math.floor(maxDays)) * SECONDS_PER_DAY
  const windows: DnseRequestWindow[] = []
  let cursor = from

  while (cursor < to) {
    const windowTo = Math.min(to, cursor + maxSeconds)
    windows.push({ from: cursor, to: windowTo })
    if (windowTo >= to) break
    cursor = windowTo + 1
  }

  return windows
}

export function dnseWindowSpanDays(window: DnseRequestWindow) {
  return Math.max(1, Math.ceil((window.to - window.from + 1) / SECONDS_PER_DAY))
}

export function splitDnseRequestWindow(window: DnseRequestWindow): DnseRequestWindow[] {
  if (window.to <= window.from) return [window]
  const midpoint = Math.floor((window.from + window.to) / 2)
  return [
    { from: window.from, to: midpoint },
    { from: midpoint + 1, to: window.to },
  ]
}

export function isRetryableDnseWindowError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return /aborted|aborterror|timeout|timed out|fetch failed|network|econnreset|econnrefused|etimedout|failed \((?:408|425|429|5\d\d)\)/i.test(message)
}
