"use client"

import { useEffect, useMemo, useState } from "react"
import { Check, LoaderCircle, Save } from "lucide-react"

const NOTE_LIMIT = 20_000

type NotePayload =
  | {
      ok: true
      note: {
        ticker: string
        content: string
        updatedAt: string
      } | null
    }
  | {
      ok: false
      error?: string
    }

function formatUpdatedAt(value: string | null) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export function StockNotesPanel({ ticker }: { ticker: string }) {
  const [content, setContent] = useState("")
  const [savedContent, setSavedContent] = useState("")
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedFlash, setSavedFlash] = useState(false)

  const isDirty = content !== savedContent
  const updatedLabel = useMemo(() => formatUpdatedAt(updatedAt), [updatedAt])

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    setSavedFlash(false)
    setContent("")
    setSavedContent("")
    setUpdatedAt(null)

    void fetch(`/api/insights/${encodeURIComponent(ticker)}/notes`, {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => null) as NotePayload | null
        if (!response.ok || !payload || !payload.ok) {
          if (response.status === 401) throw new Error("Vui lòng đăng nhập để lưu ghi chú.")
          throw new Error(payload && !payload.ok ? payload.error || "Không thể tải ghi chú." : "Không thể tải ghi chú.")
        }

        const next = payload.note?.content ?? ""
        setContent(next)
        setSavedContent(next)
        setUpdatedAt(payload.note?.updatedAt ?? null)
      })
      .catch((loadError: unknown) => {
        if ((loadError as Error)?.name === "AbortError") return
        setError(loadError instanceof Error ? loadError.message : "Không thể tải ghi chú.")
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [ticker])

  async function saveNote() {
    if (saving || !isDirty) return
    setSaving(true)
    setError(null)
    setSavedFlash(false)

    try {
      const response = await fetch(`/api/insights/${encodeURIComponent(ticker)}/notes`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ content }),
      })
      const payload = await response.json().catch(() => null) as NotePayload | null

      if (!response.ok || !payload || !payload.ok) {
        if (response.status === 401) throw new Error("Vui lòng đăng nhập để lưu ghi chú.")
        throw new Error(payload && !payload.ok ? payload.error || "Không thể lưu ghi chú." : "Không thể lưu ghi chú.")
      }

      const next = payload.note?.content ?? ""
      setContent(next)
      setSavedContent(next)
      setUpdatedAt(payload.note?.updatedAt ?? new Date().toISOString())
      setSavedFlash(true)
      window.setTimeout(() => setSavedFlash(false), 1600)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Không thể lưu ghi chú.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-[340px] p-3">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <div>
          <p className="text-[11px] font-bold text-slate-200">Ghi chú riêng về {ticker}</p>
          <p className="mt-0.5 text-[9px] text-slate-500">
            Lưu theo tài khoản, độc lập với watchlist.
          </p>
        </div>
        {updatedLabel ? (
          <span className="shrink-0 font-mono text-[8px] text-slate-600">
            {updatedLabel}
          </span>
        ) : null}
      </div>

      {loading ? (
        <div className="flex h-52 items-center justify-center rounded-xl border border-white/[0.06] bg-black/20 text-[10px] text-slate-500">
          <LoaderCircle className="mr-2 size-3.5 animate-spin text-cyan-400" />
          Đang tải ghi chú...
        </div>
      ) : (
        <>
          <textarea
            value={content}
            onChange={(event) => {
              setContent(event.target.value)
              setSavedFlash(false)
            }}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault()
                void saveNote()
              }
            }}
            maxLength={NOTE_LIMIT}
            placeholder={`Ghi lại thesis cá nhân, vùng giá quan tâm, catalyst, rủi ro... cho ${ticker}`}
            className="h-52 w-full resize-none rounded-xl border border-white/[0.08] bg-[#05080c] p-3 text-[11px] leading-5 text-slate-200 outline-none transition-colors placeholder:text-slate-600 focus:border-cyan-400/35"
          />

          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="font-mono text-[8px] text-slate-600">
              {content.length.toLocaleString("vi-VN")} / {NOTE_LIMIT.toLocaleString("vi-VN")}
            </span>
            <button
              type="button"
              onClick={() => void saveNote()}
              disabled={saving || !isDirty}
              className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-400/25 bg-cyan-400/10 px-2.5 py-1.5 text-[10px] font-bold text-cyan-100 transition-colors hover:bg-cyan-400/15 disabled:cursor-not-allowed disabled:opacity-35"
            >
              {saving ? (
                <LoaderCircle className="size-3 animate-spin" />
              ) : savedFlash ? (
                <Check className="size-3" />
              ) : (
                <Save className="size-3" />
              )}
              {saving ? "Đang lưu" : savedFlash ? "Đã lưu" : "Lưu ghi chú"}
            </button>
          </div>
        </>
      )}

      {error ? (
        <p role="alert" className="mt-2 rounded-lg border border-amber-400/15 bg-amber-400/[0.04] px-2.5 py-2 text-[9px] leading-4 text-amber-100/75">
          {error}
        </p>
      ) : null}
    </div>
  )
}
