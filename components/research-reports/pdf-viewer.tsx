"use client"

import { useEffect, useRef, useState } from "react"

import { clampPdfPage, clampPdfZoom } from "./pdf-viewer-state"

export { clampPdfPage, clampPdfZoom } from "./pdf-viewer-state"

type PdfJsModule = typeof import("pdfjs-dist")
type PdfLoadingTask = ReturnType<PdfJsModule["getDocument"]>
type PdfDocument = Awaited<PdfLoadingTask["promise"]>
type PdfPage = Awaited<ReturnType<PdfDocument["getPage"]>>
type PdfRenderTask = ReturnType<PdfPage["render"]>
type ViewerStatus = "loading" | "ready" | "error"

let pdfJsPromise: Promise<PdfJsModule> | null = null

function loadPdfJs(): Promise<PdfJsModule> {
  if (!pdfJsPromise) {
    pdfJsPromise = import("pdfjs-dist").then((pdfjsLib) => {
      pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url,
      ).toString()
      return pdfjsLib
    })
  }
  return pdfJsPromise
}

function isRenderingCancelled(error: unknown): boolean {
  return error instanceof Error && error.name === "RenderingCancelledException"
}

export function PdfViewer({
  reportId,
  title,
  originalSourceLink,
  originalPdfUrl,
  requestedPage,
  onPageResolved,
}: {
  reportId: string
  title: string
  originalSourceLink: string | null
  originalPdfUrl: string | null
  requestedPage: number | null
  onPageResolved?: (page: number) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const renderTaskRef = useRef<PdfRenderTask | null>(null)
  const documentGenerationRef = useRef(0)
  const renderGenerationRef = useRef(0)
  const [pdfDocument, setPdfDocument] = useState<PdfDocument | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [pageCount, setPageCount] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [status, setStatus] = useState<ViewerStatus>("loading")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    const generation = ++documentGenerationRef.current
    let disposed = false
    let loadingTask: PdfLoadingTask | null = null

    renderTaskRef.current?.cancel()
    renderTaskRef.current = null
    setPdfDocument(null)
    setCurrentPage(1)
    setPageCount(0)
    setZoom(1)
    setStatus("loading")
    setErrorMessage(null)

    const proxyUrl = `/api/research-reports/${encodeURIComponent(reportId)}/pdf`
    const candidateUrls = originalPdfUrl ? [originalPdfUrl, proxyUrl] : [proxyUrl]

    const openDocument = async () => {
      const pdfjsLib = await loadPdfJs()
      let lastError: unknown = null

      for (const url of candidateUrls) {
        if (disposed || generation !== documentGenerationRef.current) {
          throw new Error("PDF viewer load cancelled")
        }

        const task = pdfjsLib.getDocument({ url })
        loadingTask = task
        try {
          return await task.promise
        } catch (error) {
          lastError = error
          try {
            await task.destroy()
          } catch {
            // The next source is independent; cleanup failure must not block fallback.
          }
          if (loadingTask === task) loadingTask = null
        }
      }

      throw lastError instanceof Error ? lastError : new Error("Unable to load research report PDF")
    }

    void openDocument()
      .then((document) => {
        if (disposed || generation !== documentGenerationRef.current) {
          void document.destroy()
          return
        }
        setPdfDocument(document)
        setPageCount(document.numPages)
        setStatus("ready")
      })
      .catch(() => {
        if (disposed || generation !== documentGenerationRef.current) return
        setStatus("error")
        setErrorMessage("Không thể tải PDF báo cáo.")
      })

    return () => {
      disposed = true
      documentGenerationRef.current += 1
      renderTaskRef.current?.cancel()
      renderTaskRef.current = null
      if (loadingTask) void loadingTask.destroy()
    }
  }, [originalPdfUrl, reportId])

  useEffect(() => {
    if (!pdfDocument || status !== "ready" || pageCount < 1) return

    const generation = ++renderGenerationRef.current
    let disposed = false
    renderTaskRef.current?.cancel()
    renderTaskRef.current = null

    void pdfDocument
      .getPage(currentPage)
      .then((page) => {
        if (disposed || generation !== renderGenerationRef.current) return null
        const canvas = canvasRef.current
        if (!canvas) return null
        const context = canvas.getContext("2d")
        if (!context) throw new Error("Canvas 2D context unavailable")

        const viewport = page.getViewport({ scale: zoom })
        canvas.width = Math.max(1, Math.ceil(viewport.width))
        canvas.height = Math.max(1, Math.ceil(viewport.height))
        canvas.style.width = `${Math.ceil(viewport.width)}px`
        canvas.style.height = `${Math.ceil(viewport.height)}px`

        const renderTask = page.render({ canvas, canvasContext: context, viewport })
        renderTaskRef.current = renderTask
        return renderTask.promise
      })
      .then(() => {
        if (!disposed && generation === renderGenerationRef.current) setErrorMessage(null)
      })
      .catch((error: unknown) => {
        if (disposed || generation !== renderGenerationRef.current || isRenderingCancelled(error)) return
        setErrorMessage("Không thể hiển thị trang PDF này.")
      })

    return () => {
      disposed = true
      renderGenerationRef.current += 1
      renderTaskRef.current?.cancel()
      renderTaskRef.current = null
    }
  }, [currentPage, pageCount, pdfDocument, status, zoom])

  useEffect(() => {
    if (requestedPage === null || pageCount < 1) return
    const next = clampPdfPage(requestedPage, pageCount)
    setCurrentPage(next)
    onPageResolved?.(next)
  }, [onPageResolved, pageCount, requestedPage])

  const movePage = (page: number) => {
    if (pageCount < 1) return
    setCurrentPage(clampPdfPage(page, pageCount))
  }

  const moveZoom = (value: number) => {
    setZoom(clampPdfZoom(value))
  }

  return (
    <section
      aria-label={`Trình đọc PDF ${title}`}
      className="flex min-h-[520px] flex-col overflow-hidden rounded-xl border border-white/10 bg-zinc-950/70"
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-white/10 px-3 py-2">
        <button
          type="button"
          aria-label="Trang trước"
          onClick={() => movePage(currentPage - 1)}
          disabled={status !== "ready" || currentPage <= 1}
          className="rounded-md border border-white/10 px-2.5 py-1.5 text-sm text-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Trước
        </button>
        <label className="flex items-center gap-2 text-sm text-zinc-400">
          <span>Trang</span>
          <input
            type="number"
            aria-label="Số trang"
            min={1}
            max={Math.max(1, pageCount)}
            value={currentPage}
            disabled={status !== "ready"}
            onChange={(event) => movePage(Number(event.currentTarget.value))}
            className="h-8 w-16 rounded-md border border-white/10 bg-black/30 px-2 text-center text-zinc-100 outline-none focus-visible:ring-2 focus-visible:ring-white/40"
          />
          <span>/ {pageCount || "—"}</span>
        </label>
        <button
          type="button"
          aria-label="Trang sau"
          onClick={() => movePage(currentPage + 1)}
          disabled={status !== "ready" || currentPage >= pageCount}
          className="rounded-md border border-white/10 px-2.5 py-1.5 text-sm text-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Sau
        </button>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button
            type="button"
            aria-label="Zoom out"
            onClick={() => moveZoom(zoom - 0.25)}
            disabled={status !== "ready" || zoom <= 0.5}
            className="rounded-md border border-white/10 px-2.5 py-1.5 text-sm text-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"
          >
            −
          </button>
          <span className="min-w-12 text-center text-xs text-zinc-400">{Math.round(zoom * 100)}%</span>
          <button
            type="button"
            aria-label="Zoom in"
            onClick={() => moveZoom(zoom + 0.25)}
            disabled={status !== "ready" || zoom >= 2.5}
            className="rounded-md border border-white/10 px-2.5 py-1.5 text-sm text-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"
          >
            +
          </button>
          <button
            type="button"
            aria-label="Reset zoom"
            onClick={() => moveZoom(1)}
            disabled={status !== "ready" || zoom === 1}
            className="rounded-md border border-white/10 px-2.5 py-1.5 text-xs text-zinc-300 disabled:cursor-not-allowed disabled:opacity-40"
          >
            100%
          </button>
          {originalPdfUrl ? (
            <a
              href={originalPdfUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="rounded-md border border-cyan-400/20 bg-cyan-400/[0.06] px-2.5 py-1.5 text-xs font-medium text-cyan-100 hover:bg-cyan-400/[0.12] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/40"
            >
              PDF gốc ↗
            </a>
          ) : null}
          {originalSourceLink ? (
            <a
              href={originalSourceLink}
              target="_blank"
              rel="noreferrer noopener"
              className="rounded-md border border-white/10 px-2.5 py-1.5 text-xs font-medium text-zinc-200 hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
            >
              Nguồn ↗
            </a>
          ) : null}
        </div>
      </div>

      <div
        tabIndex={-1}
        className="relative flex min-h-[460px] flex-1 items-start justify-center overflow-auto bg-black/20 p-4 focus:outline-none"
      >
        {status === "loading" ? (
          <p className="mt-12 text-sm text-zinc-400" role="status">Đang tải PDF…</p>
        ) : null}
        {status === "error" ? (
          <div className="mt-12 max-w-md text-center">
            <p className="text-sm font-medium text-amber-200">Không thể tải PDF.</p>
            <p className="mt-2 text-xs text-zinc-400">Bạn vẫn có thể đọc phần phân tích hoặc mở file PDF gốc.</p>
            {originalPdfUrl ? (
              <a
                href={originalPdfUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="mt-4 inline-flex rounded-lg border border-cyan-400/20 bg-cyan-400/[0.06] px-3 py-2 text-sm font-medium text-cyan-100 hover:bg-cyan-400/[0.12]"
              >
                Mở PDF gốc ↗
              </a>
            ) : null}
          </div>
        ) : null}
        <canvas
          ref={canvasRef}
          aria-label={`Trang PDF ${currentPage}`}
          className={status === "ready" ? "max-w-none bg-white shadow-xl" : "hidden"}
        />
      </div>

      {errorMessage && status === "ready" ? (
        <p role="status" className="border-t border-white/10 px-3 py-2 text-xs text-amber-200">
          {errorMessage}
        </p>
      ) : null}
    </section>
  )
}
