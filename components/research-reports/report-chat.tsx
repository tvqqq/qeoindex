"use client"

import { type FormEvent, useMemo, useState } from "react"

import type { ResearchReportDetailStatus } from "@/modules/research-reports/detail/types"

import { ReportCitation } from "./report-citation"
import { boundChatHistory, type ReportChatTurn } from "./report-chat-state"

export { boundChatHistory } from "./report-chat-state"

type ChatCitation = {
  page: number
  chunkId: string
  excerpt: string
}

type ChatMessage = ReportChatTurn & {
  citations: ChatCitation[]
}

type QaResult = {
  status: "answered" | "not_found"
  answer: string
  citations: ChatCitation[]
}

type QaPayload =
  | { ok: true; result: QaResult }
  | { ok: false; error?: string; code?: string }

const NOT_FOUND_ANSWER = "Không tìm thấy thông tin này trong báo cáo."

function errorMessageForQa(code: string | undefined, status: number): string {
  if (code === "report_not_ready") return "Báo cáo chưa sẵn sàng để hỏi đáp."
  if (
    code === "provider_failed"
    || code === "retrieval_failed"
    || code === "invalid_model_output"
    || code === "service_unavailable"
    || status >= 500
  ) {
    return "Hỏi đáp báo cáo tạm thời chưa khả dụng."
  }
  if (code === "report_not_found") return "Không tìm thấy báo cáo để hỏi đáp."
  return "Không thể gửi câu hỏi này. Vui lòng kiểm tra nội dung và thử lại."
}

function readinessMessage(status: ResearchReportDetailStatus): string | null {
  switch (status) {
    case "ready":
      return null
    case "pending":
      return "Báo cáo chưa sẵn sàng để hỏi đáp vì phân tích vẫn đang xử lý."
    case "needs_ocr":
      return "Báo cáo cần OCR trước khi có thể hỏi đáp."
    case "unsupported":
      return "Định dạng báo cáo hiện chưa hỗ trợ hỏi đáp."
    case "failed":
      return "Hỏi đáp báo cáo tạm thời chưa khả dụng."
  }
}

export function ReportChat({
  reportId,
  analysisStatus,
  onNavigateCitation,
}: {
  reportId: string
  analysisStatus: ResearchReportDetailStatus
  onNavigateCitation: (page: number) => void
}) {
  const [draft, setDraft] = useState("")
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const history = useMemo<ReportChatTurn[]>(
    () => messages.map(({ role, content }) => ({ role, content })),
    [messages],
  )
  const readiness = readinessMessage(analysisStatus)

  async function submitQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const question = draft.replace(/\s+/g, " ").trim()
    if (!question || question.length > 2_000 || isSubmitting || analysisStatus !== "ready") return

    setIsSubmitting(true)
    setErrorMessage(null)

    try {
      const response = await fetch(`/api/research-reports/${encodeURIComponent(reportId)}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, history: boundChatHistory(history) }),
      })
      const payload = await response.json().catch(() => null) as QaPayload | null

      if (!response.ok || !payload || !payload.ok) {
        setErrorMessage(errorMessageForQa(payload && !payload.ok ? payload.code : undefined, response.status))
        return
      }

      const result = payload.result
      const userMessage: ChatMessage = { role: "user", content: question, citations: [] }
      const assistantMessage: ChatMessage = result.status === "not_found"
        ? { role: "assistant", content: NOT_FOUND_ANSWER, citations: [] }
        : { role: "assistant", content: result.answer, citations: result.citations }

      setMessages((current) => [...current, userMessage, assistantMessage])
      setDraft("")
    } catch {
      setErrorMessage("Hỏi đáp báo cáo tạm thời chưa khả dụng.")
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <section aria-labelledby="report-chat-heading" className="rounded-xl border border-white/10 bg-zinc-950/40 p-4">
      <div>
        <h2 id="report-chat-heading" className="text-base font-semibold text-zinc-100">Hỏi báo cáo</h2>
        <p className="mt-1 text-xs leading-5 text-zinc-500">
          Câu trả lời chỉ dựa trên bằng chứng đã trích xuất từ báo cáo hiện tại và không được lưu thành lịch sử lâu dài.
        </p>
      </div>

      <div className="mt-4 space-y-3" aria-live="polite">
        {messages.length === 0 ? (
          <p className="rounded-lg border border-dashed border-white/10 px-3 py-4 text-sm text-zinc-500">
            Đặt câu hỏi về số liệu, nhận định, rủi ro hoặc cổ phiếu được đề cập trong báo cáo.
          </p>
        ) : messages.map((message, index) => (
          <article
            key={`${message.role}-${index}`}
            className={message.role === "user"
              ? "ml-8 rounded-xl bg-white/[0.06] p-3 text-sm text-zinc-200"
              : "mr-8 rounded-xl border border-white/10 bg-black/20 p-3 text-sm text-zinc-300"}
          >
            <p className="whitespace-pre-wrap leading-6">{message.content}</p>
            {message.citations.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-2" aria-label="Nguồn dẫn câu trả lời">
                {message.citations.map((citation, citationIndex) => (
                  <ReportCitation
                    key={`${citation.chunkId}-${citation.page}-${citationIndex}`}
                    page={citation.page}
                    excerpt={citation.excerpt}
                    onNavigate={onNavigateCitation}
                  />
                ))}
              </div>
            ) : null}
          </article>
        ))}
      </div>

      {readiness ? (
        <p role="status" className="mt-4 rounded-lg border border-amber-300/15 bg-amber-300/[0.04] px-3 py-2 text-xs text-amber-100/80">
          {readiness}
        </p>
      ) : null}
      {errorMessage ? (
        <p role="alert" className="mt-4 rounded-lg border border-amber-300/15 bg-amber-300/[0.04] px-3 py-2 text-xs text-amber-100/80">
          {errorMessage}
        </p>
      ) : null}

      <form onSubmit={submitQuestion} className="mt-4 space-y-2">
        <label htmlFor="research-report-question" className="sr-only">Câu hỏi về báo cáo</label>
        <textarea
          id="research-report-question"
          value={draft}
          onChange={(event) => setDraft(event.currentTarget.value)}
          maxLength={2_000}
          rows={3}
          disabled={isSubmitting || analysisStatus !== "ready"}
          placeholder="Ví dụ: Báo cáo nói gì về triển vọng lợi nhuận của MSN?"
          className="w-full resize-y rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm leading-6 text-zinc-100 outline-none placeholder:text-zinc-600 focus-visible:ring-2 focus-visible:ring-white/30 disabled:cursor-not-allowed disabled:opacity-50"
        />
        <div className="flex items-center justify-between gap-3">
          <span className="text-[11px] text-zinc-600">{draft.length}/2000</span>
          <button
            type="submit"
            disabled={isSubmitting || analysisStatus !== "ready" || draft.trim().length === 0}
            className="rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2 text-sm font-medium text-zinc-100 hover:bg-white/[0.1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isSubmitting ? "Đang hỏi…" : "Gửi câu hỏi"}
          </button>
        </div>
      </form>
    </section>
  )
}
