const BLOCKED_TARGET_SELECTOR = [
  "input",
  "textarea",
  "select",
  "[contenteditable]",
  "[role=\"textbox\"]",
  "dialog",
  "[role=\"dialog\"]",
  "[aria-modal=\"true\"]",
].join(", ")

type ShortcutEventLike = {
  target: unknown
  altKey?: boolean
  ctrlKey?: boolean
  defaultPrevented?: boolean
  isComposing?: boolean
  keyCode?: number
  metaKey?: boolean
  shiftKey?: boolean
}

type ShortcutTarget = {
  closest?: (selectors: string) => unknown
}

export function shouldIgnoreStockDetailShortcut(event: ShortcutEventLike) {
  if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return true
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return true

  if (!event.target || typeof event.target !== "object") return false
  const target = event.target as ShortcutTarget
  if (typeof target.closest !== "function") return false
  return Boolean(target.closest(BLOCKED_TARGET_SELECTOR))
}

export function adjacentWatchlistTicker(
  tickers: readonly string[],
  currentTicker: string,
  direction: "previous" | "next",
) {
  const normalizedTickers = tickers
    .map((ticker) => ticker.trim().toUpperCase())
    .filter(Boolean)
  const currentIndex = normalizedTickers.indexOf(currentTicker.trim().toUpperCase())
  if (currentIndex < 0) return null

  const nextIndex = currentIndex + (direction === "previous" ? -1 : 1)
  return normalizedTickers[nextIndex] ?? null
}
