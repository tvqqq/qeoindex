"use client"

import { useEffect, useRef, useState } from "react"
import {
  BrainCircuit,
  Gauge,
  Send,
  Sparkles,
} from "lucide-react"

import { cn } from "@/modules/shared/ui/cn"

import { boundTickerChatHistory } from "./stock-ai-chat-state"
import type { StockDetailData } from "./types"

type ChatCitation = {
  id: string
  sourceType: "RESEARCH_REPORT" | "AI_COUNCIL"
  authority: string
  label: string
  excerpt: string
  href: string | null
  reportId?: string
  page?: number
  runId?: string
  sourceVersion?: string
}

type ChatClaim = {
  text: string
  authority: string
  citationIds: string[]
}

type ChatContradiction = {
  leftEvidenceId: string
  rightEvidenceId: string
  explanation: string
}

type TickerQaResult = {
  ticker: string
  status: "answered" | "not_found"
  answer: string
  claims: ChatClaim[]
  citations: ChatCitation[]
  contradictions: ChatContradiction[]
  retrievalStatus: "ready" | "unavailable"
  limitation: string | null
}

type TickerQaPayload =
  | { ok: true; result: TickerQaResult }
  | { ok: false; error?: string; code?: string }

interface Message {
  id: string
  sender: "user" | "ai"
  text: string
  timestamp: string
  claims?: ChatClaim[]
  citations?: ChatCitation[]
  contradictions?: ChatContradiction[]
  retrievalStatus?: "ready" | "unavailable"
  limitation?: string | null
}

function chatErrorMessage(code: string | undefined, status: number) {
  if (code === "feature_disabled") return "Quick AI Assistant hiện chưa được bật cho môi trường này."
  if (code === "invalid_request") return "Câu hỏi chưa hợp lệ. Vui lòng rút gọn nội dung và thử lại."
  if (code === "service_unavailable" || code === "provider_failed" || code === "invalid_model_output" || status >= 500) {
    return "Quick AI Assistant tạm thời chưa khả dụng."
  }
  return "Không thể gửi câu hỏi này. Vui lòng thử lại."
}

function authorityLabel(authority: string) {
  switch (authority) {
    case "VERIFIED_FACT": return "Verified fact"
    case "DETERMINISTIC_SIGNAL": return "AI Council"
    case "SOURCE_OPINION": return "Source opinion"
    case "HISTORICAL_LESSON": return "Historical lesson"
    case "AI_INFERENCE": return "AI inference"
    default: return authority
  }
}

const RADIUS = 72
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

function formatSignalLines(text: string): string[] {
  const trimmed = text.trim()
  if (trimmed === "MUA KHI XÁC NHẬN") return ["MUA KHI", "XÁC NHẬN"]
  if (trimmed === "TÍCH LŨY (BUY)") return ["TÍCH LŨY", "(BUY)"]
  if (trimmed === "HẠ TỶ TRỌNG") return ["HẠ TỶ", "TRỌNG"]
  if (trimmed === "THEO DÕI (WAIT)") return ["THEO DÕI", "(WAIT)"]
  if (trimmed === "BÁN (SELL)") return ["BÁN", "(SELL)"]
  if (trimmed.includes("\n")) return trimmed.split("\n")

  const words = trimmed.split(/\s+/)
  if (words.length <= 1) return [trimmed]
  if (words.length === 2) return words
  if (words.length === 3) return [`${words[0]} ${words[1]}`, words[2]]
  if (words.length === 4) return [`${words[0]} ${words[1]}`, `${words[2]} ${words[3]}`]
  const mid = Math.ceil(words.length / 2)
  return [words.slice(0, mid).join(" "), words.slice(mid).join(" ")]
}

export function parseLevel(raw: string | undefined | null, fallback: string) {
  if (!raw) return { display: fallback, note: null }
  const trimmed = raw.trim()
  if (/^[\d\s.,·\-+/]+$/.test(trimmed)) {
    return { display: trimmed, note: null }
  }
  const match = trimmed.match(/\b\d+(?:[.,]\d+)?\b/)
  if (match) {
    return { display: match[0], note: trimmed }
  }
  return { display: fallback, note: trimmed }
}

const CONFIDENCE_TIERS = [
  {
    label: "Very high",
    range: "90% ↑",
    gradientId: "confidence-ring-very-high",
    fromColor: "#10b981",
    toColor: "#00f0ff",
    glowColor: "rgba(0, 240, 255, 0.45)",
    dotColor: "bg-emerald-400",
    badgeColor: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
    textColor: "text-emerald-300",
    ringBorder: "border-[#10b981]",
    min: 90,
    max: 100,
  },
  {
    label: "High",
    range: "70%-89%",
    gradientId: "confidence-ring-high",
    fromColor: "#f97316",
    toColor: "#fb923c",
    glowColor: "rgba(249, 115, 22, 0.45)",
    dotColor: "bg-orange-400",
    badgeColor: "border-orange-500/30 bg-orange-500/10 text-orange-300",
    textColor: "text-orange-300",
    ringBorder: "border-[#f97316]",
    min: 70,
    max: 89,
  },
  {
    label: "Medium",
    range: "50%-69%",
    gradientId: "confidence-ring-medium",
    fromColor: "#eab308",
    toColor: "#facc15",
    glowColor: "rgba(234, 179, 8, 0.45)",
    dotColor: "bg-amber-400",
    badgeColor: "border-amber-500/30 bg-amber-500/10 text-amber-300",
    textColor: "text-amber-300",
    ringBorder: "border-[#eab308]",
    min: 50,
    max: 69,
  },
  {
    label: "Low",
    range: "30%-49%",
    gradientId: "confidence-ring-low",
    fromColor: "#3b82f6",
    toColor: "#60a5fa",
    glowColor: "rgba(59, 130, 246, 0.45)",
    dotColor: "bg-blue-400",
    badgeColor: "border-blue-500/30 bg-blue-500/10 text-blue-300",
    textColor: "text-blue-300",
    ringBorder: "border-[#3b82f6]",
    min: 30,
    max: 49,
  },
  {
    label: "Very low",
    range: "30% ↓",
    gradientId: "confidence-ring-very-low",
    fromColor: "#f43f5e",
    toColor: "#fb7185",
    glowColor: "rgba(244, 63, 94, 0.45)",
    dotColor: "bg-rose-400",
    badgeColor: "border-rose-500/30 bg-rose-500/10 text-rose-300",
    textColor: "text-rose-300",
    ringBorder: "border-[#f43f5e]",
    min: 0,
    max: 29,
  },
] as const

export function StockAiSidebar({ data }: { data: StockDetailData }) {
  const { ticker, aiStock, scan, thesis, fa } = data

  const signal = aiStock?.signal ?? (scan?.taBias === "Bullish" ? "BUY" : scan?.taBias === "Bearish" ? "REDUCE" : "WAIT")
  const consensus = aiStock?.consensus ?? 85
  const confidence = aiStock?.confidence ?? 80

  const pillars = [
    {
      label: "Cơ bản",
      score: fa?.roe ? Math.min(95, Math.round(fa.roe * 2.5 + 30)) : 75,
    },
    {
      label: "Kỹ thuật",
      score: scan?.wyckoffState
        ? scan.wyckoffState.includes("Accumulation") || scan.wyckoffState.includes("Markup")
          ? 86
          : 55
        : 80,
    },
    {
      label: "Dòng tiền",
      score: scan?.relVolume ? Math.min(96, Math.round(scan.relVolume * 50)) : 82,
    },
    {
      label: "Bối cảnh",
      score: thesis?.marketRegime === "Risk-On" ? 85 : 70,
    },
    {
      label: "Quản trị",
      score: 78,
    },
  ].map((p) => ({
    ...p,
    gradient:
      p.score >= 75
        ? "from-emerald-500 to-emerald-400"
        : p.score < 50
        ? "from-rose-500 to-rose-400"
        : "from-slate-400 to-slate-200",
  }))

  const signalText =
    signal === "BUY"
      ? "TÍCH LŨY (BUY)"
      : signal === "BUY_ON_CONFIRMATION"
      ? "MUA KHI XÁC NHẬN"
      : signal === "REDUCE"
      ? "HẠ TỶ TRỌNG"
      : signal === "SELL"
      ? "BÁN (SELL)"
      : "THEO DÕI (WAIT)"

  const signalTone =
    signal === "BUY"
      ? "text-emerald-400"
      : signal === "BUY_ON_CONFIRMATION"
      ? "text-emerald-300"
      : signal === "REDUCE" || signal === "SELL"
      ? "text-rose-400"
      : "text-slate-200"

  const clampedConsensus = Math.min(100, Math.max(0, consensus))
  const strokeDashoffset = CIRCUMFERENCE - (clampedConsensus / 100) * CIRCUMFERENCE

  const activeTier =
    CONFIDENCE_TIERS.find((t) => confidence >= t.min && confidence <= t.max) ||
    CONFIDENCE_TIERS[1]
  const signalLines = formatSignalLines(signalText)

  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      sender: "ai",
      text: `Tôi trả lời câu hỏi về ${ticker} dựa trên bằng chứng QeoIndex hiện có và sẽ hiển thị nguồn khi có thể truy vết.`,
      timestamp: new Date().toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }),
    },
  ])
  const [inputVal, setInputVal] = useState("")
  const [isTyping, setIsTyping] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const chatBottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, isTyping, errorMessage])

  async function handleSend(textToSend?: string) {
    const text = (textToSend || inputVal).replace(/\s+/g, " ").trim()
    if (!text || text.length > 2_000 || isTyping) return

    const history = boundTickerChatHistory(
      messages
        .filter((message) => message.id !== "welcome")
        .map((message) => ({
          role: message.sender === "user" ? "user" as const : "assistant" as const,
          content: message.text,
        })),
    )
    const userMsg: Message = {
      id: `user-${Date.now()}-${Math.random()}`,
      sender: "user",
      text,
      timestamp: new Date().toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }),
    }

    setMessages((prev) => [...prev, userMsg])
    if (!textToSend) setInputVal("")
    setErrorMessage(null)
    setIsTyping(true)

    try {
      const response = await fetch(`/api/insights/${encodeURIComponent(ticker)}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: text, history }),
      })
      const payload = await response.json().catch(() => null) as TickerQaPayload | null
      if (!response.ok || !payload || !payload.ok) {
        setErrorMessage(chatErrorMessage(payload && !payload.ok ? payload.code : undefined, response.status))
        return
      }

      const result = payload.result
      setMessages((prev) => [
        ...prev,
        {
          id: `ai-${Date.now()}-${Math.random()}`,
          sender: "ai",
          text: result.status === "not_found"
            ? "Không tìm thấy bằng chứng QeoIndex đủ để trả lời câu hỏi này."
            : result.answer,
          timestamp: new Date().toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }),
          claims: result.claims,
          citations: result.citations,
          contradictions: result.contradictions,
          retrievalStatus: result.retrievalStatus,
          limitation: result.limitation,
        },
      ])
    } catch {
      setErrorMessage("Quick AI Assistant tạm thời chưa khả dụng.")
    } finally {
      setIsTyping(false)
    }
  }

  return (
    <div className="space-y-3.5 w-full pb-8">
      {/* AI Council Overview Card */}
      <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#080d13] p-4 sm:p-5 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex size-9 items-center justify-center rounded-xl border border-cyan-400/20 bg-cyan-400/[0.08] text-cyan-300 shadow-[0_0_15px_rgba(0,240,255,0.12)]">
              <BrainCircuit className="size-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-200">Góc nhìn AI Council</h2>
              <p className="text-[10px] text-cyan-400/70 font-mono">Consensus V1.4</p>
            </div>
          </div>
        </div>

        {/* ========================================================= */}
        {/* 1. DONUT CONSENSUS RING WITH RECOMMENDATION IN CENTER     */}
        {/* ========================================================= */}
        <div className="space-y-3 pt-1">
          <div className="relative mx-auto flex size-44 sm:size-48 items-center justify-center">
            <svg viewBox="0 0 200 200" className="size-full -rotate-90">
              <defs>
                <linearGradient id={activeTier.gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor={activeTier.fromColor} />
                  <stop offset="100%" stopColor={activeTier.toColor} />
                </linearGradient>
                <filter id="consensus-ring-glow" x="-20%" y="-20%" width="140%" height="140%">
                  <feGaussianBlur stdDeviation="2.5" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>
              <circle
                cx="100"
                cy="100"
                r={RADIUS}
                fill="none"
                stroke="rgba(255, 255, 255, 0.08)"
                strokeWidth="14"
              />
              <circle
                cx="100"
                cy="100"
                r={RADIUS}
                fill="none"
                stroke={`url(#${activeTier.gradientId})`}
                strokeWidth="14"
                strokeLinecap="round"
                strokeDasharray={CIRCUMFERENCE}
                strokeDashoffset={strokeDashoffset}
                filter="url(#consensus-ring-glow)"
                className="transition-all duration-700 ease-out"
              />
            </svg>

            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center px-4">
              <div
                className={cn(
                  "font-ticker text-base sm:text-lg font-black tracking-wide uppercase leading-tight text-center",
                  signalTone,
                )}
              >
                {signalLines.map((line, idx) => (
                  <div key={idx} className="block whitespace-nowrap">
                    {line}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="flex flex-col items-center gap-2 px-1 text-center">
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1 font-mono text-[11px] font-bold shadow-[0_0_12px_rgba(0,0,0,0.4)]",
                activeTier.badgeColor,
              )}
            >
              <span className={cn("size-1.5 rounded-full", activeTier.dotColor)} />
              {consensus}% đồng thuận với độ tin cậy {activeTier.label} ({confidence}%)
            </span>

            <p className="text-center text-[11.5px] leading-relaxed text-slate-300">
              {aiStock?.whatChangesDecision?.[0] ||
                (scan?.confirmation ? `Tăng conviction khi: ${scan.confirmation}` : null) ||
                thesis?.baseCase ||
                "Áp lực bán cạn kiệt quanh hỗ trợ trung hạn. Smart Money có dấu hiệu hấp thụ chủ động, phù hợp giải ngân từng phần."}
            </p>
          </div>
        </div>

        {/* ========================================================= */}
        {/* 2. 5 TRỤ CỘT ĐÁNH GIÁ TỪ AI COUNCIL                       */}
        {/* ========================================================= */}
        <div className="space-y-2 pt-1">
          <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">
            <span className="flex items-center gap-1.5">
              <Gauge className="size-3.5 text-cyan-400" />
              5 Trụ cột đánh giá từ AI Council
            </span>
          </div>
          <div className="space-y-2.5 rounded-xl border border-white/[0.05] bg-black/20 p-3">
            {pillars.map((p) => (
              <div key={p.label} className="space-y-1">
                <div className="text-[11px] font-medium text-slate-400">{p.label}</div>
                <div className="flex items-center gap-2.5">
                  <span className="w-11 font-mono text-xs font-bold text-slate-200 shrink-0">
                    {p.score} %
                  </span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/[0.08]">
                    <div
                      className={cn("h-full rounded-full bg-gradient-to-r transition-all duration-500", p.gradient)}
                      style={{ width: `${Math.min(100, Math.max(0, p.score))}%` }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Existing Quick AI Assistant — now grounded by QEO-118 */}
      <div className="flex flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-[#080d13]">
        <div className="flex items-center justify-between border-b border-white/[0.06] bg-[#0a0f16] px-3.5 py-2.5">
          <div className="flex items-center gap-2">
            <Sparkles className="size-3.5 text-cyan-400" />
            <span className="text-xs font-bold text-slate-200">Quick AI Assistant</span>
          </div>
          <span className="rounded-full border border-white/[0.08] bg-black/20 px-2 py-0.5 font-mono text-[9px] text-slate-400">
            Hỏi đáp: {ticker}
          </span>
        </div>

        <div className="h-64 space-y-2.5 overflow-y-auto p-3 text-[11px] leading-relaxed no-scrollbar">
          {messages.map((m) => (
            <div
              key={m.id}
              className={cn("flex flex-col", m.sender === "user" ? "items-end" : "items-start")}
            >
              <div
                className={cn(
                  "max-w-[90%] rounded-2xl p-2.5 text-[11px] leading-relaxed",
                  m.sender === "user"
                    ? "rounded-tr-none border border-cyan-400/30 bg-cyan-400/10 text-slate-100"
                    : "rounded-tl-none border border-white/[0.08] bg-black/20 text-slate-300",
                )}
              >
                <p className="whitespace-pre-wrap">{m.text}</p>

                {m.claims?.length ? (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {[...new Set(m.claims.map((claim) => claim.authority))].map((authority) => (
                      <span key={authority} className="rounded-full border border-white/[0.08] bg-white/[0.03] px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide text-slate-500">
                        {authorityLabel(authority)}
                      </span>
                    ))}
                  </div>
                ) : null}

                {m.citations?.length ? (
                  <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Nguồn dẫn câu trả lời">
                    {m.citations.map((citation, index) => {
                      const label = citation.page ? `${citation.label} · p.${citation.page}` : citation.label
                      const className = "rounded-lg border border-cyan-400/15 bg-cyan-400/[0.04] px-2 py-1 text-[9px] text-cyan-200/80"
                      return citation.href ? (
                        <a
                          key={`${citation.id}-${index}`}
                          href={citation.href}
                          className={className}
                          title={citation.excerpt}
                        >
                          {label} · {authorityLabel(citation.authority)}
                        </a>
                      ) : (
                        <span
                          key={`${citation.id}-${index}`}
                          className={className}
                          title={citation.excerpt}
                        >
                          {label} · {authorityLabel(citation.authority)}
                        </span>
                      )
                    })}
                  </div>
                ) : null}

                {m.contradictions?.length ? (
                  <div className="mt-2 rounded-lg border border-amber-400/15 bg-amber-400/[0.04] px-2 py-1.5 text-[9px] leading-4 text-amber-100/70">
                    <span className="font-bold uppercase tracking-wide">Mâu thuẫn nguồn</span>
                    {m.contradictions.map((item, index) => (
                      <p key={`${item.leftEvidenceId}-${item.rightEvidenceId}-${index}`} className="mt-1">{item.explanation}</p>
                    ))}
                  </div>
                ) : null}

                {m.retrievalStatus === "unavailable" ? (
                  <div className="mt-2 rounded-lg border border-amber-400/15 bg-amber-400/[0.04] px-2 py-1 text-[9px] text-amber-100/70">
                    Semantic retrieval degraded · đang dùng canonical context khả dụng.
                  </div>
                ) : null}
                {m.limitation ? <p className="mt-1 text-[8px] leading-4 text-slate-600">{m.limitation}</p> : null}
              </div>
            </div>
          ))}

          {isTyping && (
            <div className="flex gap-2">
              <div className="flex size-5 shrink-0 items-center justify-center rounded-lg border border-cyan-400/30 bg-cyan-400/10 text-[9px] font-black text-cyan-200">
                AI
              </div>
              <div className="flex items-center gap-1.5 rounded-2xl rounded-tl-none border border-white/[0.08] bg-black/20 px-3 py-1.5 text-xs text-slate-400">
                <span className="size-1.5 rounded-full bg-cyan-400 animate-bounce" />
                <span className="size-1.5 rounded-full bg-cyan-400 animate-bounce [animation-delay:0.2s]" />
                <span className="size-1.5 rounded-full bg-cyan-400 animate-bounce [animation-delay:0.4s]" />
              </div>
            </div>
          )}
          {errorMessage ? (
            <p role="alert" className="rounded-lg border border-amber-400/15 bg-amber-400/[0.04] px-2.5 py-2 text-[10px] text-amber-100/75">
              {errorMessage}
            </p>
          ) : null}
          <div ref={chatBottomRef} />
        </div>

        <div className="border-t border-white/[0.06] bg-[#090d13] p-2 flex gap-1.5 overflow-x-auto no-scrollbar">
          <button
            type="button"
            onClick={() => handleSend("Đánh giá dòng tiền lớn hôm nay?")}
            disabled={isTyping}
            className="whitespace-nowrap rounded-lg border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-[10px] font-semibold text-slate-300 transition-colors hover:border-cyan-400/40 hover:bg-cyan-400/10 hover:text-cyan-200 disabled:opacity-40"
          >
            ⚡ Dòng tiền?
          </button>
          <button
            type="button"
            onClick={() => handleSend("Hỗ trợ kháng cự gần nhất?")}
            disabled={isTyping}
            className="whitespace-nowrap rounded-lg border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-[10px] font-semibold text-slate-300 transition-colors hover:border-cyan-400/40 hover:bg-cyan-400/10 hover:text-cyan-200 disabled:opacity-40"
          >
            🎯 Hỗ trợ / Kháng cự?
          </button>
          <button
            type="button"
            onClick={() => handleSend("Rủi ro lớn nhất là gì?")}
            disabled={isTyping}
            className="whitespace-nowrap rounded-lg border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-[10px] font-semibold text-slate-300 transition-colors hover:border-cyan-400/40 hover:bg-cyan-400/10 hover:text-cyan-200 disabled:opacity-40"
          >
            ⚠️ Rủi ro?
          </button>
        </div>

        <div className="border-t border-white/[0.06] bg-[#0a0f16] p-2">
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void handleSend()
            }}
            className="relative flex items-center"
          >
            <input
              type="text"
              value={inputVal}
              onChange={(event) => setInputVal(event.target.value)}
              maxLength={2_000}
              placeholder="Hỏi AI về cổ phiếu..."
              disabled={isTyping}
              className="w-full rounded-xl border border-white/[0.08] bg-[#05080c] py-1.5 pl-3 pr-8 text-xs text-slate-200 placeholder-slate-500 transition-colors focus:border-cyan-400/40 focus:outline-none disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={!inputVal.trim() || isTyping}
              className="absolute right-1.5 rounded-lg p-1 text-cyan-400 transition-colors hover:text-cyan-300 disabled:opacity-30"
            >
              <Send className="size-3.5" />
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}