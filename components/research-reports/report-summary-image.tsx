"use client"

import { useEffect, useState } from "react"
import { Maximize2, X } from "lucide-react"

export function ReportSummaryImage({
  src,
  alt,
  title,
  compact = false,
}: {
  src: string
  alt: string
  title: string
  compact?: boolean
}) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false)
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [open])

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Phóng to ảnh tóm tắt báo cáo: ${title}`}
        className={[
          "group/image pointer-events-auto relative z-20 block w-full overflow-hidden rounded-2xl border border-white/[0.09] bg-black/20 text-left outline-none transition",
          "hover:border-cyan-300/25 focus-visible:ring-2 focus-visible:ring-cyan-300/45",
          compact ? "shadow-[0_18px_45px_-35px_rgba(0,0,0,0.95)]" : "shadow-[0_24px_70px_-45px_rgba(0,0,0,0.95)]",
        ].join(" ")}
      >
        <img
          src={src}
          alt={alt}
          className="aspect-[297/210] w-full object-cover"
          loading={compact ? "lazy" : "eager"}
        />
        <span className="absolute right-2.5 top-2.5 inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-black/60 px-2.5 py-1.5 text-[10px] font-bold text-white/85 opacity-0 backdrop-blur-sm transition group-hover/image:opacity-100 group-focus-visible/image:opacity-100">
          <Maximize2 className="size-3.5" aria-hidden="true" />
          Phóng to
        </span>
      </button>

      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Ảnh tóm tắt báo cáo: ${title}`}
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/90 p-3 sm:p-6"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false)
          }}
        >
          <div className="relative max-h-full w-full max-w-[1500px]">
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Đóng ảnh phóng to"
              className="absolute -top-1 right-0 z-10 inline-flex size-10 -translate-y-full items-center justify-center rounded-full border border-white/15 bg-black/75 text-white transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
            >
              <X className="size-5" aria-hidden="true" />
            </button>
            <img
              src={src}
              alt={alt}
              className="mx-auto max-h-[88vh] w-auto max-w-full rounded-2xl border border-white/10 bg-[#070b10] object-contain shadow-2xl"
            />
          </div>
        </div>
      ) : null}
    </>
  )
}
