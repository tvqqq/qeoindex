export const BOARD_RELOAD_REQUIRED_EVENT = "market-board:reload-required"
export const BOARD_HIDDEN_RELOAD_MS = 10 * 60_000
export const BOARD_EXECUTION_GAP_MS = 10 * 60_000
export const BOARD_WATCHDOG_INTERVAL_MS = 15_000

type ResumeWindow = Pick<Window, "addEventListener" | "removeEventListener" | "setInterval" | "clearInterval" | "location"> & { navigator: Pick<Navigator, "onLine"> }
type ResumeDocument = Pick<Document, "addEventListener" | "removeEventListener" | "visibilityState">

export function attachBoardResumeReload(win: ResumeWindow, doc: ResumeDocument, now: () => number = Date.now) {
  // Keep the clock and one-shot decision at page scope so filter/view remounts cannot reset it.
  let hiddenAt: number | null = doc.visibilityState === "hidden" ? now() : null
  let lastExecutionAt = now()
  let reloadRequired = false
  let reloading = false
  let disposed = false

  const maybeReload = () => {
    // A hidden or offline page defers the same pending reload until it can rebootstrap.
    if (disposed || reloading || !reloadRequired || doc.visibilityState !== "visible" || !win.navigator.onLine) return
    reloading = true
    win.location.reload()
  }
  const requireReload = () => {
    reloadRequired = true
    maybeReload()
  }
  const onVisibility = () => {
    const current = now()
    if (doc.visibilityState === "hidden") {
      hiddenAt ??= current
      lastExecutionAt = current
      return
    }
    if (hiddenAt !== null && current - hiddenAt >= BOARD_HIDDEN_RELOAD_MS) reloadRequired = true
    if (current - lastExecutionAt >= BOARD_EXECUTION_GAP_MS) reloadRequired = true
    hiddenAt = null
    lastExecutionAt = current
    maybeReload()
  }
  const onPageHide = () => { hiddenAt ??= now() }
  const onFreeze = () => { hiddenAt ??= now() }
  const onResume = () => {
    if (doc.visibilityState !== "visible") return
    onVisibility()
  }
  const onOnline = () => { maybeReload() }
  const onRequired = () => { requireReload() }
  const watchdog = win.setInterval(() => {
    // Only a real execution gap triggers recovery; regular 15s heartbeats do not.
    const current = now()
    if (doc.visibilityState === "visible" && current - lastExecutionAt >= BOARD_EXECUTION_GAP_MS) requireReload()
    lastExecutionAt = current
  }, BOARD_WATCHDOG_INTERVAL_MS)

  doc.addEventListener("visibilitychange", onVisibility)
  doc.addEventListener("freeze", onFreeze)
  doc.addEventListener("resume", onResume)
  win.addEventListener("pagehide", onPageHide)
  win.addEventListener("pageshow", onResume)
  win.addEventListener("focus", onResume)
  win.addEventListener("online", onOnline)
  win.addEventListener(BOARD_RELOAD_REQUIRED_EVENT, onRequired)
  return () => {
    disposed = true
    win.clearInterval(watchdog)
    doc.removeEventListener("visibilitychange", onVisibility)
    doc.removeEventListener("freeze", onFreeze)
    doc.removeEventListener("resume", onResume)
    win.removeEventListener("pagehide", onPageHide)
    win.removeEventListener("pageshow", onResume)
    win.removeEventListener("focus", onResume)
    win.removeEventListener("online", onOnline)
    win.removeEventListener(BOARD_RELOAD_REQUIRED_EVENT, onRequired)
  }
}
