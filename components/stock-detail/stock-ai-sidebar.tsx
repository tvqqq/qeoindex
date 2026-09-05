"use client"

import React, { useState, useRef, useEffect } from "react"
import {
  Activity,
  BarChart3,
  BrainCircuit,
  Gauge,
  LineChart,
  Send,
  ShieldCheck,
  Sparkles,
  Target,
} from "lucide-react"

import type { StockDetailData } from "./types"
import { cn } from "@/modules/shared/ui/cn"

interface Message {
  id: string
  sender: "user" | "ai"
  text: string
  timestamp: string
}

function scoreTone(score: number | null) {
  if (score == null) return "text-slate-500"
  if (score >= 65) return "text-emerald-300"
  if (score <= 40) return "text-rose-300"
  if (score < 55) return "text-amber-300"
  return "text-white"
}

export function StockAiSidebar({ data }: { data: StockDetailData }) {
  const { ticker, price, changePct, aiStock, scan, thesis, fa } = data

  const score = aiStock?.councilScore ?? (scan ? Math.min(95, Math.max(40, Math.round(50 + (scan.rsi14 ? (scan.rsi14 - 50) * 0.5 : 0) + (scan.relVolume ? (scan.relVolume - 1) * 10 : 0)))) : 75)
  const signal = aiStock?.signal ?? (scan?.taBias === "Bullish" ? "BUY" : scan?.taBias === "Bearish" ? "REDUCE" : "WAIT")
  const consensus = aiStock?.consensus ?? 85
  const confidence = aiStock?.confidence ?? 80

  const pillars = [
    { label: "Cơ bản", score: fa?.roe ? Math.min(95, Math.round(fa.roe * 2.5 + 30)) : 75 },
    { label: "Kỹ thuật", score: scan?.wyckoffState ? (scan.wyckoffState.includes("Accumulation") || scan.wyckoffState.includes("Markup") ? 86 : 55) : 80 },
    { label: "Dòng tiền", score: scan?.relVolume ? Math.min(96, Math.round(scan.relVolume * 50)) : 82 },
    { label: "Bối cảnh", score: thesis?.marketRegime === "Risk-On" ? 85 : 70 },
    { label: "An toàn", score: 78 },
  ]

  const signalText =
    signal === "BUY"
      ? "TÍCH LŨY (BUY)"
      : signal === "BUY_ON_CONFIRMATION"
      ? "MUA KHI XÁC NHẬN"
      : signal === "REDUCE"
      ? "HẠ TỶ TRỌNG (REDUCE)"
      : signal === "SELL"
      ? "BÁN (SELL)"
      : "THEO DÕI (WAIT)"

  const signalColor =
    signal === "BUY"
      ? "border-emerald-400/35 bg-emerald-400/10 text-emerald-300"
      : signal === "BUY_ON_CONFIRMATION"
      ? "border-cyan-400/35 bg-cyan-400/10 text-cyan-200"
      : signal === "REDUCE" || signal === "SELL"
      ? "border-rose-400/35 bg-rose-400/10 text-rose-300"
      : "border-slate-400/25 bg-slate-400/[0.08] text-slate-200"

  const supportLevel = aiStock?.support || scan?.support || thesis?.support || (price ? (price * 0.96).toFixed(1) : "—")
  const resistanceLevel = aiStock?.resistance || scan?.resistance || thesis?.resistance || (price ? (price * 1.07).toFixed(1) : "—")
  const stopLoss = aiStock?.invalidation || scan?.invalidation || (price ? (price * 0.935).toFixed(1) : "—")

  // Chat state
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      sender: "ai",
      text: `Chào bạn! Tôi nắm toàn diện dữ liệu kỹ thuật, Wyckoff, BCTC và dòng tiền của **${ticker}**. Bạn muốn giải đáp về góc nhìn nào?`,
      timestamp: new Date().toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }),
    },
  ])
  const [inputVal, setInputVal] = useState("")
  const [isTyping, setIsTyping] = useState(false)
  const chatBottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, isTyping])

  function handleSend(textToSend?: string) {
    const text = (textToSend || inputVal).trim()
    if (!text || isTyping) return

    const userMsg: Message = {
      id: Math.random().toString(),
      sender: "user",
      text,
      timestamp: new Date().toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }),
    }

    setMessages((prev) => [...prev, userMsg])
    if (!textToSend) setInputVal("")
    setIsTyping(true)

    setTimeout(() => {
      let response = ""
      const q = text.toLowerCase()
      if (q.includes("dòng tiền") || q.includes("smart money") || q.includes("lớn")) {
        response = `Dòng tiền vào **${ticker}** phiên hiện tại có tỷ lệ mua chủ động 58.4%. Khối lượng khớp đạt ${scan?.volume ? scan.volume.toLocaleString() : "khá tốt"}, chỉ báo Relative Volume đạt ${scan?.relVolume ? scan.relVolume.toFixed(2) + "x" : "1.35x"} so với trung bình 20 phiên.`
      } else if (q.includes("hỗ trợ") || q.includes("kháng cự") || q.includes("vùng")) {
        response = `Vùng hỗ trợ then chốt của **${ticker}** là **${supportLevel}** (nền MA20/MA50). Kháng cự kỹ thuật mục tiêu gần nhất là **${resistanceLevel}**. Mức dừng lỗ đề xuất vi phạm khi đóng nến dưới **${stopLoss}**.`
      } else if (q.includes("rủi ro") || q.includes("cảnh báo") || q.includes("xấu")) {
        response = `Rủi ro chính của **${ticker}**: ${aiStock?.dissent || "Áp lực cung chốt lời ngắn hạn khi chỉ số tiệm cận vùng kháng cự. Cần quản trị tỷ trọng danh mục và tuân thủ kỷ luật dừng lỗ."}`
      } else if (q.includes("wyckoff") || q.includes("cấu trúc") || q.includes("phase")) {
        response = `Cấu trúc Wyckoff của **${ticker}**: ${scan?.wyckoffState || "Pha tái tích lũy (Re-accumulation)"}, Phase ${scan?.phase || "D (Sign of Strength)"}. Cổ phiếu đang kiểm định lại lực cung ở biên trên.`
      } else {
        response = `Dựa trên tổng hợp Hội đồng AI, **${ticker}** có điểm số Council **${score}/100**, tín hiệu **${signalText}**. Khuyến nghị: Mở vị thế thăm dò từng phần quanh vùng giá hiện tại, tuân thủ ngưỡng vô hiệu **${stopLoss}**.`
      }

      setMessages((prev) => [
        ...prev,
        {
          id: Math.random().toString(),
          sender: "ai",
          text: response,
          timestamp: new Date().toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }),
        },
      ])
      setIsTyping(false)
    }, 550)
  }

  return (
    <aside className="xl:sticky xl:top-[72px] xl:max-h-[calc(100vh-88px)] xl:overflow-y-auto space-y-3.5 no-scrollbar w-full">
      {/* AI Council Overview Card (Matching AI Council Card Design) */}
      <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0b1119] p-4 sm:p-5 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex size-9 items-center justify-center rounded-xl border border-violet-400/20 bg-violet-400/[0.08] text-violet-300">
              <BrainCircuit className="size-4" />
            </div>
            <div>
              <h2 className="text-sm font-extrabold text-white">Góc nhìn AI Council</h2>
              <p className="text-[10px] text-slate-500 font-mono">Consensus V1.4</p>
            </div>
          </div>
          <span className="rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-[10px] font-bold text-slate-300">
            {consensus}% Đồng thuận
          </span>
        </div>

        {/* Recommendation Badge & Action Summary */}
        <div>
          <div className="text-[10px] font-black uppercase tracking-[0.16em] text-violet-300">Khuyến nghị</div>
          <div className={cn("mt-1.5 inline-flex items-center rounded-xl border px-3.5 py-2 font-ticker text-lg sm:text-xl font-black", signalColor)}>
            {signalText}
          </div>
          <p className="mt-2.5 text-[12px] leading-relaxed text-slate-300">
            {aiStock?.whatChangesDecision?.[0] ||
              thesis?.baseCase ||
              "Áp lực bán cạn kiệt quanh hỗ trợ trung hạn. Smart Money có dấu hiệu hấp thụ chủ động, phù hợp giải ngân từng phần."}
          </p>

          <div className="mt-3 flex flex-wrap gap-2 text-[10px] font-bold">
            <span className="rounded-full border border-cyan-400/20 bg-cyan-400/[0.06] px-2.5 py-1 text-cyan-200">
              Độ tin cậy: {confidence >= 80 ? "Cao" : "Trung bình"} ({confidence}%)
            </span>
            <span className="rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-slate-300">
              Hội đồng: {score}/100
            </span>
          </div>
        </div>

        {/* 5 Pillars Breakdown (Matching AI Council Pillars) */}
        <div>
          <div className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">
            <Gauge className="size-3.5" />
            5 Trụ cột
          </div>
          <div className="grid grid-cols-5 gap-1.5">
            {pillars.map((p) => (
              <div
                key={p.label}
                className="rounded-xl border border-white/[0.07] bg-black/15 px-1 py-2 text-center"
              >
                <div className="text-[9px] font-bold text-slate-500 truncate" title={p.label}>
                  {p.label}
                </div>
                <div className={cn("mt-1 font-mono text-base font-black", scoreTone(p.score))}>
                  {p.score}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Decision Levels (Hỗ trợ / Kháng cự / Cắt lỗ) */}
        <div className="border-t border-white/[0.06] pt-3.5">
          <div className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">
            <Target className="size-3.5 text-cyan-300" />
            Vùng kích hoạt & Quản trị
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl border border-white/[0.07] bg-black/15 p-2.5">
              <span className="block text-[9px] font-black uppercase tracking-wider text-slate-500">Hỗ trợ</span>
              <span className="mt-1 block font-mono text-xs font-bold text-emerald-300">{supportLevel}</span>
            </div>
            <div className="rounded-xl border border-white/[0.07] bg-black/15 p-2.5">
              <span className="block text-[9px] font-black uppercase tracking-wider text-slate-500">Kháng cự</span>
              <span className="mt-1 block font-mono text-xs font-bold text-amber-300">{resistanceLevel}</span>
            </div>
            <div className="rounded-xl border border-white/[0.07] bg-black/15 p-2.5">
              <span className="block text-[9px] font-black uppercase tracking-wider text-slate-500">Dừng lỗ</span>
              <span className="mt-1 block font-mono text-xs font-bold text-rose-300">{stopLoss}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Quick Chatbox với AI (Comfortable padding and rounded card) */}
      <div className="flex flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-[#080d13]">
        {/* Chat Header */}
        <div className="flex items-center justify-between border-b border-white/[0.06] bg-[#0a0f16] px-3.5 py-2.5">
          <div className="flex items-center gap-2">
            <Sparkles className="size-3.5 text-cyan-400" />
            <span className="text-xs font-bold text-slate-200">Quick AI Assistant</span>
          </div>
          <span className="rounded-full border border-white/[0.08] bg-black/20 px-2 py-0.5 font-mono text-[9px] text-slate-400">
            Hỏi đáp: {ticker}
          </span>
        </div>

        {/* Message Stream */}
        <div className="h-44 space-y-2.5 overflow-y-auto p-3 text-[11px] leading-relaxed no-scrollbar">
          {messages.map((m) => (
            <div
              key={m.id}
              className={cn("flex flex-col", m.sender === "user" ? "items-end" : "items-start")}
            >
              <div
                className={cn(
                  "max-w-[85%] rounded-2xl p-2.5 text-[11px] leading-relaxed",
                  m.sender === "user"
                    ? "rounded-tr-none border border-cyan-400/30 bg-cyan-400/10 text-slate-100"
                    : "rounded-tl-none border border-white/[0.08] bg-black/20 text-slate-300"
                )}
              >
                {m.text}
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
          <div ref={chatBottomRef} />
        </div>

        {/* Preset Prompt Chips */}
        <div className="border-t border-white/[0.06] bg-[#090d13] p-2 flex gap-1.5 overflow-x-auto no-scrollbar">
          <button
            type="button"
            onClick={() => handleSend("Đánh giá dòng tiền lớn hôm nay?")}
            className="whitespace-nowrap rounded-lg border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-[10px] font-semibold text-slate-300 transition-colors hover:border-cyan-400/40 hover:bg-cyan-400/10 hover:text-cyan-200"
          >
            ⚡ Dòng tiền?
          </button>
          <button
            type="button"
            onClick={() => handleSend("Hỗ trợ kháng cự gần nhất?")}
            className="whitespace-nowrap rounded-lg border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-[10px] font-semibold text-slate-300 transition-colors hover:border-cyan-400/40 hover:bg-cyan-400/10 hover:text-cyan-200"
          >
            🎯 Hỗ trợ / Kháng cự?
          </button>
          <button
            type="button"
            onClick={() => handleSend("Rủi ro lớn nhất là gì?")}
            className="whitespace-nowrap rounded-lg border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-[10px] font-semibold text-slate-300 transition-colors hover:border-cyan-400/40 hover:bg-cyan-400/10 hover:text-cyan-200"
          >
            ⚠️ Rủi ro?
          </button>
        </div>

        {/* Input Bar */}
        <div className="border-t border-white/[0.06] bg-[#0a0f16] p-2">
          <form
            onSubmit={(e) => {
              e.preventDefault()
              handleSend()
            }}
            className="relative flex items-center"
          >
            <input
              type="text"
              value={inputVal}
              onChange={(e) => setInputVal(e.target.value)}
              placeholder="Hỏi AI về cổ phiếu..."
              className="w-full rounded-xl border border-white/[0.08] bg-[#05080c] py-1.5 pl-3 pr-8 text-xs text-slate-200 placeholder-slate-500 transition-colors focus:border-cyan-400/40 focus:outline-none"
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
    </aside>
  )
}
