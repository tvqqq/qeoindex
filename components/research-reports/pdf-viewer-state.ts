export function clampPdfPage(page: number, pageCount: number): number {
  const safeCount = Number.isInteger(pageCount) && pageCount > 0 ? pageCount : 1
  const finitePage = Number.isFinite(page) ? page : 1
  const roundedPage = Math.round(finitePage)
  return Math.min(safeCount, Math.max(1, roundedPage))
}

export function clampPdfZoom(zoom: number): number {
  const finiteZoom = Number.isFinite(zoom) ? zoom : 1
  return Math.min(2.5, Math.max(0.5, finiteZoom))
}
