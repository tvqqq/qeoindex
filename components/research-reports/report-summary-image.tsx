"use client"

import { useEffect, useId, useState } from "react"
import { Maximize2, X } from "lucide-react"

export function ReportSummaryImage({
  src,
  alt,
  compact = false,
}: {
  src: string
  alt: string
  compact?: boolean
}) {
  const [open, setOpen] = useState(false)
  const titleId = useId()

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [open])

  return (
    <>
      <button
        type="button"
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          setOpen(true)
        }}
        className="group/image relative block w-full overflow-hidden rounded-2xl border border-white/[0.09] bg-black/20 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/50"
        aria-label={`Phóng to ảnh tóm tắt: ${alt}`}
      >
        <img
          src={src}
          alt={alt}
          loading="lazy"
          className={compact
            ? "aspect-[3/2] w-full object-cover transition-transform duration-200 group-hover/image:scale-[1.01]"
            : "aspect-[3/2] w-full object-contain bg-[#070b10]"}
        />
        <span className="absolute right-2.5 top-2.5 inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-black/65 px-2.5 py-1.5 text-[11px] font-bold text-white/85 opacity-0 transition-opacity group-hover/image:opacity-100 group-focus-visible/image:opacity-100">
          <Maximize2 className="size-3.5" aria-hidden="true" />
          Phóng to
        </span>
      </button>

      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 p-3 sm:p-6"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setOpen(false)
          }}
        >
          <div className="relative max-h-full w-full max-w-[1500px]">
            <h2 id={titleId} className="sr-only">{alt}</h2>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Đóng ảnh tóm tắt"
              className="absolute right-2 top-2 z-10 inline-flex size-10 items-center justify-center rounded-full border border-white/15 bg-black/70 text-white transition-colors hover:bg-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
            >
              <X className="size-5" aria-hidden="true" />
            </button>
            <img
              src={src}
              alt=""
              className="max-h-[calc(100vh-3rem)] w-full rounded-2xl border border-white/10 bg-[#070b10] object-contain shadow-2xl"
            />
          </div>
        </div>
      ) : null}
    </>
  )
}
