"use client"

import { useState } from "react"
import { RefreshCw, Settings2 } from "lucide-react"
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
import { Input } from "@/components/ui/input"
import {
  DEFAULT_RESEARCH_REPORT_SUMMARY_IMAGE_SETTINGS,
  RESEARCH_REPORT_IMAGE_QUALITIES,
  type ResearchReportSummaryImageSettings,
} from "@/modules/research-reports/summary-image-settings"

interface ReportSummaryImageAdminProps {
  reportId: string
  hasImage: boolean
}

export function ReportSummaryImageAdmin({
  reportId,
  hasImage,
}: ReportSummaryImageAdminProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [settings, setSettings] = useState<ResearchReportSummaryImageSettings>({
    ...DEFAULT_RESEARCH_REPORT_SUMMARY_IMAGE_SETTINGS,
  })

  const resetSettings = () => {
    setSettings({ ...DEFAULT_RESEARCH_REPORT_SUMMARY_IMAGE_SETTINGS })
    setError(null)
  }

  const submit = async () => {
    if (submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const response = await fetch(`/api/admin/research-reports/${encodeURIComponent(reportId)}/summary-image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ settings }),
      })
      const payload = await response.json().catch(() => null) as {
        error?: string
        preservedExistingImage?: boolean
      } | null
      if (!response.ok) {
        const rawError = payload?.error || `Không thể tạo ảnh AI (HTTP ${response.status})`
        const providerSecurityFailure = /security check failed|http 403/i.test(rawError)
        const preserved = payload?.preservedExistingImage
          ? " Ảnh hiện tại vẫn được giữ nguyên."
          : ""
        throw new Error(providerSecurityFailure
          ? `Dịch vụ tạo ảnh đang từ chối request bảo mật (HTTP 403). Đây là lỗi upstream, không phải do nội dung params bạn vừa chỉnh.${preserved}`
          : `${rawError}${preserved}`)
      }
      setOpen(false)
      router.refresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không thể tạo lại ảnh AI")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          setError(null)
          setOpen(true)
        }}
        className="border-cyan-300/20 bg-cyan-300/[0.06] text-cyan-100 hover:bg-cyan-300/[0.12]"
      >
        <Settings2 className="size-3.5" aria-hidden="true" />
        {hasImage ? "Tạo lại ảnh AI" : "Tạo ảnh AI"}
      </Button>

      <Dialog open={open} onOpenChange={(nextOpen) => {
        if (!submitting) setOpen(nextOpen)
      }}>
        <DialogContent className="max-h-[92vh] overflow-y-auto border border-white/[0.12] bg-[#0a0f15] p-0 text-slate-100 sm:max-w-2xl">
          <DialogHeader className="border-b border-white/[0.08] px-5 py-4 pr-12">
            <DialogTitle className="text-base font-black text-white">Thiết lập ảnh AI cho báo cáo</DialogTitle>
            <DialogDescription className="text-xs leading-5 text-slate-400">
              Luận điểm, drivers, risks, ticker và broker metadata vẫn lấy từ AI analysis hiện tại.
              Các trường dưới đây chỉ điều chỉnh cách trình bày hình ảnh cho lần generate này.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 px-5 py-1">
            <label className="block space-y-1.5">
              <span className="text-xs font-bold text-slate-300">Visual guidance</span>
              <textarea
                value={settings.visualGuidance}
                onChange={(event) => setSettings((current) => ({
                  ...current,
                  visualGuidance: event.currentTarget.value,
                }))}
                rows={4}
                maxLength={2000}
                placeholder="Ví dụ: ưu tiên hình ảnh nhà máy, chuỗi cung ứng; giảm chart; ticker đặt ở góc phải..."
                className="w-full resize-y rounded-lg border border-white/[0.1] bg-black/25 px-3 py-2 text-sm leading-5 text-slate-100 outline-none placeholder:text-slate-600 focus:border-cyan-300/40"
              />
              <span className="block text-[10px] text-slate-600">Tối đa 2.000 ký tự; được nối thêm vào prompt factual hiện tại.</span>
            </label>

            <label className="block space-y-1.5">
              <span className="text-xs font-bold text-slate-300">Style</span>
              <textarea
                value={settings.style}
                onChange={(event) => setSettings((current) => ({
                  ...current,
                  style: event.currentTarget.value,
                }))}
                rows={4}
                maxLength={1500}
                className="w-full resize-y rounded-lg border border-white/[0.1] bg-black/25 px-3 py-2 text-sm leading-5 text-slate-100 outline-none focus:border-cyan-300/40"
              />
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1.5">
                <span className="text-xs font-bold text-slate-300">Model</span>
                <Input
                  value={settings.model}
                  onChange={(event) => setSettings((current) => ({
                    ...current,
                    model: event.currentTarget.value,
                  }))}
                  maxLength={80}
                  className="border-white/[0.1] bg-black/25 text-slate-100"
                />
              </label>

              <label className="block space-y-1.5">
                <span className="text-xs font-bold text-slate-300">Quality</span>
                <select
                  value={settings.quality}
                  onChange={(event) => setSettings((current) => ({
                    ...current,
                    quality: event.currentTarget.value as ResearchReportSummaryImageSettings["quality"],
                  }))}
                  className="h-8 w-full rounded-lg border border-white/[0.1] bg-[#0c1219] px-2.5 text-sm text-slate-100 outline-none focus:border-cyan-300/40"
                >
                  {RESEARCH_REPORT_IMAGE_QUALITIES.map((quality) => (
                    <option key={quality} value={quality}>{quality}</option>
                  ))}
                </select>
              </label>

              <label className="block space-y-1.5">
                <span className="text-xs font-bold text-slate-300">Width</span>
                <Input
                  type="number"
                  min={512}
                  max={2048}
                  step={1}
                  value={settings.width}
                  onChange={(event) => setSettings((current) => ({
                    ...current,
                    width: Number(event.currentTarget.value),
                  }))}
                  className="border-white/[0.1] bg-black/25 text-slate-100"
                />
              </label>

              <label className="block space-y-1.5">
                <span className="text-xs font-bold text-slate-300">Height</span>
                <Input
                  type="number"
                  min={512}
                  max={2048}
                  step={1}
                  value={settings.height}
                  onChange={(event) => setSettings((current) => ({
                    ...current,
                    height: Number(event.currentTarget.value),
                  }))}
                  className="border-white/[0.1] bg-black/25 text-slate-100"
                />
              </label>
            </div>

            {error ? (
              <div role="alert" className="rounded-lg border border-rose-400/20 bg-rose-400/[0.06] px-3 py-2 text-xs leading-5 text-rose-200">
                {error}
              </div>
            ) : null}
          </div>

          <DialogFooter className="border-white/[0.08] bg-black/20">
            <Button type="button" variant="ghost" onClick={resetSettings} disabled={submitting}>
              Reset mặc định
            </Button>
            <Button
              type="button"
              onClick={submit}
              disabled={submitting}
              className="bg-cyan-500 text-slate-950 hover:bg-cyan-400"
            >
              <RefreshCw className={submitting ? "size-3.5 animate-spin" : "size-3.5"} aria-hidden="true" />
              {submitting ? "Đang generate..." : hasImage ? "Generate lại" : "Generate ảnh"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
