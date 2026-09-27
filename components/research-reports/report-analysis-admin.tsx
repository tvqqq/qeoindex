"use client"

import { useEffect, useState } from "react"
import { AlertTriangle, RefreshCw, Wrench } from "lucide-react"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { ResearchReportDetailStatus } from "@/modules/research-reports/detail/types"

interface AdminDiagnostic {
  analysisStatus: string
  analysisError: string | null
  ingestionStatus: string
  ingestionError: string | null
  retryable: boolean
  retryBlockedReason: string | null
}

interface DiagnosticPayload {
  ok?: boolean
  error?: string
  diagnostic?: AdminDiagnostic
}

function statusLabel(value: string) {
  if (value === "ready") return "Sẵn sàng"
  if (value === "processing") return "Đang phân tích"
  if (value === "pending") return "Chờ xử lý"
  if (value === "failed") return "Lỗi"
  if (value === "needs_ocr") return "Cần OCR"
  if (value === "unsupported") return "Chưa hỗ trợ"
  if (value === "parsed") return "PDF đã đọc"
  if (value === "fetching") return "Đang tải PDF"
  if (value === "discovered") return "Mới phát hiện"
  return value
}

export function ReportAnalysisAdmin({
  reportId,
  currentStatus,
}: {
  reportId: string
  currentStatus: ResearchReportDetailStatus
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [diagnostic, setDiagnostic] = useState<AdminDiagnostic | null>(null)
  const [error, setError] = useState<string | null>(null)

  const loadDiagnostic = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(
        `/api/admin/research-reports/${encodeURIComponent(reportId)}/analysis`,
        { credentials: "same-origin", cache: "no-store" },
      )
      const payload = await response.json().catch(() => null) as DiagnosticPayload | null
      if (!response.ok || !payload?.diagnostic) {
        throw new Error(payload?.error || `Không thể đọc trạng thái phân tích (HTTP ${response.status})`)
      }
      setDiagnostic(payload.diagnostic)
    } catch (reason) {
      setDiagnostic(null)
      setError(reason instanceof Error ? reason.message : "Không thể đọc trạng thái phân tích")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!open) return
    void loadDiagnostic()
  }, [open, reportId])

  const retryAnalysis = async () => {
    if (retrying || !diagnostic?.retryable) return
    setRetrying(true)
    setError(null)
    try {
      const response = await fetch(
        `/api/admin/research-reports/${encodeURIComponent(reportId)}/analysis`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: "{}",
        },
      )
      const payload = await response.json().catch(() => null) as DiagnosticPayload | null
      if (!response.ok) {
        if (payload?.diagnostic) setDiagnostic(payload.diagnostic)
        throw new Error(payload?.error || `Không thể phân tích AI lại (HTTP ${response.status})`)
      }
      setOpen(false)
      router.refresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không thể phân tích AI lại")
      await loadDiagnostic().catch(() => undefined)
    } finally {
      setRetrying(false)
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="border-amber-300/20 bg-amber-300/[0.06] text-amber-100 hover:bg-amber-300/[0.12]"
      >
        <Wrench className="size-3.5" aria-hidden="true" />
        Xem lỗi & phân tích lại
      </Button>

      <Dialog open={open} onOpenChange={(nextOpen) => {
        if (!retrying) setOpen(nextOpen)
      }}>
        <DialogContent className="max-h-[92vh] overflow-y-auto border border-white/[0.12] bg-[#0a0f15] p-0 text-slate-100 sm:max-w-xl">
          <DialogHeader className="border-b border-white/[0.08] px-5 py-4 pr-12">
            <DialogTitle className="flex items-center gap-2 text-base font-black text-white">
              <AlertTriangle className="size-4 text-amber-300" aria-hidden="true" />
              Phân tích AI chưa khả dụng
            </DialogTitle>
            <DialogDescription className="text-xs leading-5 text-slate-400">
              Diagnostic bên dưới chỉ hiển thị cho root admin. Retry sẽ dùng lại pipeline Research Reports hiện tại với budget giới hạn.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 px-5 py-1">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-white/[0.08] bg-black/20 p-3">
                <div className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">Analysis</div>
                <div className="mt-1 text-sm font-bold text-slate-200">
                  {statusLabel(diagnostic?.analysisStatus || currentStatus)}
                </div>
              </div>
              <div className="rounded-xl border border-white/[0.08] bg-black/20 p-3">
                <div className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">Ingestion / PDF</div>
                <div className="mt-1 text-sm font-bold text-slate-200">
                  {loading ? "Đang đọc..." : statusLabel(diagnostic?.ingestionStatus || "unknown")}
                </div>
              </div>
            </div>

            {diagnostic?.analysisError ? (
              <div className="rounded-xl border border-rose-400/20 bg-rose-400/[0.05] p-3">
                <div className="text-[10px] font-black uppercase tracking-[0.14em] text-rose-300/70">Analysis error</div>
                <p className="mt-2 break-words text-xs leading-5 text-rose-100/90">{diagnostic.analysisError}</p>
              </div>
            ) : null}

            {diagnostic?.ingestionError ? (
              <div className="rounded-xl border border-amber-400/20 bg-amber-400/[0.05] p-3">
                <div className="text-[10px] font-black uppercase tracking-[0.14em] text-amber-300/70">PDF / ingestion error</div>
                <p className="mt-2 break-words text-xs leading-5 text-amber-100/90">{diagnostic.ingestionError}</p>
              </div>
            ) : null}

            {!loading && diagnostic && !diagnostic.analysisError && !diagnostic.ingestionError ? (
              <div className="rounded-xl border border-white/[0.08] bg-black/15 p-3 text-xs leading-5 text-slate-400">
                Không có error message đã lưu. Trạng thái hiện tại có thể là pending hoặc thiếu analysis khớp với phiên bản PDF hiện hành.
              </div>
            ) : null}

            {diagnostic?.retryBlockedReason ? (
              <div className="rounded-xl border border-amber-300/20 bg-amber-300/[0.05] p-3 text-xs leading-5 text-amber-100/90">
                {diagnostic.retryBlockedReason}
              </div>
            ) : null}

            {error ? (
              <div role="alert" className="rounded-xl border border-rose-400/20 bg-rose-400/[0.06] p-3 text-xs leading-5 text-rose-200">
                {error}
              </div>
            ) : null}
          </div>

          <DialogFooter className="border-white/[0.08] bg-black/20">
            <Button type="button" variant="ghost" onClick={() => void loadDiagnostic()} disabled={loading || retrying}>
              <RefreshCw className={loading ? "size-3.5 animate-spin" : "size-3.5"} aria-hidden="true" />
              Refresh trạng thái
            </Button>
            <Button
              type="button"
              onClick={retryAnalysis}
              disabled={loading || retrying || !diagnostic?.retryable}
              className="bg-amber-400 text-slate-950 hover:bg-amber-300"
            >
              <RefreshCw className={retrying ? "size-3.5 animate-spin" : "size-3.5"} aria-hidden="true" />
              {retrying ? "Đang phân tích lại..." : "Phân tích AI lại"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
