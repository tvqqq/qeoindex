// QEO-122 source-validation probe only.
// This file is intentionally non-production and MUST NOT be imported by app/,
// modules/, workflows/, supabase/functions/, or any other runtime surface.

import { createHash } from "node:crypto"

export type ProbeCorporateActionComponent = {
  actionType: "cash_dividend" | "stock_dividend" | "rights_issue" | "other"
  cashPerShare: number | null
  stockRatio: string | null
  rightsRatio: string | null
  subscriptionPrice: number | null
}

export type ProbeCorporateActionNotice = {
  sourceUrl: string
  sourceEventId: string
  sourceUpdatedAt: string | null
  ticker: string
  isin: string | null
  exchange: "HOSE" | "HNX" | "UPCOM" | "UNKNOWN"
  recordDate: string | null
  components: ProbeCorporateActionComponent[]
  rawTextHash: string
}

export type ProbeCorporateActionAmendment = {
  sourceUrl: string
  sourceEventId: string
  sourceUpdatedAt: string | null
  ticker: string
  referencedNoticeNumber: string
  referencedNoticeDate: string
  amendmentType: "correction"
  rawTextHash: string
}

function decodeHtml(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, decimal: string) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
}

function stripElementBlocks(value: string, tagName: "script" | "style") {
  const lower = value.toLocaleLowerCase("en-US")
  const openNeedle = `<${tagName}`
  const closeNeedle = `</${tagName}`
  const chunks: string[] = []
  let cursor = 0

  while (cursor < value.length) {
    const openStart = lower.indexOf(openNeedle, cursor)
    if (openStart < 0) {
      chunks.push(value.slice(cursor))
      break
    }

    chunks.push(value.slice(cursor, openStart))
    const openEnd = lower.indexOf(">", openStart + openNeedle.length)
    if (openEnd < 0) break

    const closeStart = lower.indexOf(closeNeedle, openEnd + 1)
    if (closeStart < 0) break
    const closeEnd = lower.indexOf(">", closeStart + closeNeedle.length)
    if (closeEnd < 0) break

    chunks.push(" ")
    cursor = closeEnd + 1
  }

  return chunks.join("")
}

function htmlToText(html: string) {
  const withoutScript = stripElementBlocks(html, "script")
  const withoutScriptOrStyle = stripElementBlocks(withoutScript, "style")
  const withBreaks = withoutScriptOrStyle
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:article|section|div|p|h[1-6]|li|tr|td|th)>/gi, "\n")
    .replace(/<(?:article|section|div|p|h[1-6]|li|tr|td|th)\b[^>]*>/gi, "")
    .replace(/<[^>]+>/g, " ")
  return decodeHtml(withBreaks)
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
}

function firstLabelValue(text: string, labels: string[]) {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const match = text.match(new RegExp(`(?:^|\\n)${escaped}\\s*:\\s*([^\\n]+)`, "i"))
    if (match?.[1]) return match[1].trim()
  }
  return null
}

function parseDate(value: string | null) {
  const match = value?.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/)
  if (!match) return null
  return `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`
}

function parseSourceUpdatedAt(text: string) {
  const match = text.match(/Cập nhật ngày\s+(\d{1,2})\/(\d{1,2})\/(\d{4})\s*-\s*(\d{1,2}):(\d{2}):(\d{2})/i)
  if (!match) return null
  const [, day, month, year, hour, minute, second] = match
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T${hour.padStart(2, "0")}:${minute}:${second}+07:00`
}

function parseVnd(value: string | null) {
  if (!value) return null
  const digits = value.replace(/[^\d]/g, "")
  if (!digits) return null
  const parsed = Number(digits)
  return Number.isSafeInteger(parsed) ? parsed : null
}

function parseRatioOperand(value: string) {
  const normalized = value.trim()
  if (/^\d{1,3}(?:\.\d{3})+$/.test(normalized)) {
    return Number(normalized.replace(/\./g, ""))
  }
  return Number(normalized.replace(",", "."))
}

function normalizeRatio(left: string, right: string) {
  const a = parseRatioOperand(left)
  const b = parseRatioOperand(right)
  if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b < 0) return null
  const printable = (value: number) => Number.isInteger(value) ? String(value) : String(value).replace(".", ",")
  return `${printable(a)}:${printable(b)}`
}

function explicitRatio(text: string) {
  const match = text.match(/Tỷ lệ thực hiện\s*:\s*(\d+(?:[,.]\d+)?)\s*:\s*(\d+(?:[,.]\d+)?)/i)
  return match ? normalizeRatio(match[1], match[2]) : null
}

function percentRatio(text: string) {
  const match = text.match(/Tỷ lệ thực hiện\s*:\s*(\d+(?:[,.]\d+)?)\s*%/i)
  if (!match) return null
  return normalizeRatio("100", match[1])
}

function cashAmount(text: string) {
  const match = text.match(/(?:được\s+nhận|nhận)\s+([\d.]+)\s*đồng/i)
  return parseVnd(match?.[1] ?? null)
}

function subscriptionPrice(text: string) {
  const match = text.match(/Giá\s+(?:phát hành|thực hiện)\s*:\s*([\d.]+)\s*đồng/i)
  return parseVnd(match?.[1] ?? null)
}

function mainCorporateActionBody(text: string) {
  const normalized = text.toLocaleLowerCase("vi-VN")
  const purposeIndex = normalized.indexOf("lý do mục đích:")
  if (purposeIndex < 0) return text

  const body = text.slice(purposeIndex)
  const normalizedBody = body.toLocaleLowerCase("vi-VN")
  const footerMarkers = [
    "tin cùng tổ chức",
    "tin tức và sự kiện liên quan",
    "tin liên quan",
    "các tin khác",
    "thống kê",
  ]

  let endIndex = body.length
  for (const marker of footerMarkers) {
    const markerIndex = normalizedBody.indexOf(marker)
    if (markerIndex > 0 && markerIndex < endIndex) endIndex = markerIndex
  }
  return body.slice(0, endIndex).trim()
}

function numberedActionSections(text: string) {
  const lines = text.split("\n")
  const starts = lines
    .map((line, index) => /^\d+\.\s+/.test(line) ? index : -1)
    .filter((index) => index >= 0)
  if (!starts.length) return [text]
  return starts.map((start, index) => lines.slice(start, starts[index + 1] ?? lines.length).join("\n"))
}

function parseComponent(section: string): ProbeCorporateActionComponent | null {
  const normalized = section.toLocaleLowerCase("vi-VN")
  if (/quyền mua cổ phiếu|thực hiện quyền mua/.test(normalized)) {
    return {
      actionType: "rights_issue",
      cashPerShare: null,
      stockRatio: null,
      rightsRatio: explicitRatio(section),
      subscriptionPrice: subscriptionPrice(section),
    }
  }
  if (/cổ tức[^\n]*(?:bằng tiền|tiền mặt)|chi trả[^\n]*bằng tiền/.test(normalized)) {
    return {
      actionType: "cash_dividend",
      cashPerShare: cashAmount(section),
      stockRatio: null,
      rightsRatio: null,
      subscriptionPrice: null,
    }
  }
  if (/cổ tức[^\n]*bằng cổ phiếu|chi trả[^\n]*bằng cổ phiếu|cổ phiếu thưởng/.test(normalized)) {
    return {
      actionType: "stock_dividend",
      cashPerShare: null,
      stockRatio: explicitRatio(section) ?? percentRatio(section),
      rightsRatio: null,
      subscriptionPrice: null,
    }
  }
  return null
}

function detectExchange(value: string | null): ProbeCorporateActionNotice["exchange"] {
  const normalized = String(value ?? "").trim().toUpperCase()
  if (normalized.includes("HOSE") || normalized.includes("HSX")) return "HOSE"
  if (normalized.includes("HNX")) return "HNX"
  if (normalized.includes("UPCOM")) return "UPCOM"
  return "UNKNOWN"
}

function sourceEventId(sourceUrl: string) {
  try {
    const segments = new URL(sourceUrl).pathname.split("/").filter(Boolean)
    const candidate = [...segments].reverse().find((segment) => /^\d+$/.test(segment))
    return candidate ?? createHash("sha256").update(sourceUrl).digest("hex").slice(0, 24)
  } catch {
    return createHash("sha256").update(sourceUrl).digest("hex").slice(0, 24)
  }
}

export function parseVsdcCorporateActionHtml(html: string, sourceUrl: string): ProbeCorporateActionNotice {
  const text = htmlToText(html)
  const ticker = firstLabelValue(text, ["Mã chứng khoán"])
  if (!ticker) throw new Error("VSDC probe: missing ticker")

  const actionBody = mainCorporateActionBody(text)
  const sections = numberedActionSections(actionBody)
  const components = sections
    .map(parseComponent)
    .filter((component): component is ProbeCorporateActionComponent => Boolean(component))

  if (!components.length) {
    throw new Error("VSDC probe: no supported corporate-action component")
  }

  return {
    sourceUrl,
    sourceEventId: sourceEventId(sourceUrl),
    sourceUpdatedAt: parseSourceUpdatedAt(text),
    ticker: ticker.trim().toUpperCase(),
    isin: firstLabelValue(text, ["Mã ISIN"]),
    exchange: detectExchange(firstLabelValue(text, ["Sàn giao dịch", "Nơi giao dịch", "Thị trường giao dịch"])),
    recordDate: parseDate(firstLabelValue(text, ["Ngày đăng ký cuối cùng"])),
    components,
    rawTextHash: createHash("sha256").update(html).digest("hex"),
  }
}

export function parseVsdcAmendmentHtml(html: string, sourceUrl: string): ProbeCorporateActionAmendment {
  const text = htmlToText(html)
  const relation = text.match(/Thông báo số\s+([^\n]+?)\s+ngày\s+(\d{1,2}\/\d{1,2}\/\d{4})/i)
  if (!relation) throw new Error("VSDC probe: missing referenced notice")

  const tickerMatch = text.match(/mã chứng khoán\s*:?\s*([A-Z0-9]{2,12})\b/i)
    ?? text.match(/(?:^|\n)([A-Z0-9]{2,12})\s*:\s*Đính chính/i)
  if (!tickerMatch?.[1]) throw new Error("VSDC probe: missing amendment ticker")

  const referencedNoticeDate = parseDate(relation[2])
  if (!referencedNoticeDate) throw new Error("VSDC probe: invalid referenced notice date")

  return {
    sourceUrl,
    sourceEventId: sourceEventId(sourceUrl),
    sourceUpdatedAt: parseSourceUpdatedAt(text),
    ticker: tickerMatch[1].toUpperCase(),
    referencedNoticeNumber: relation[1].trim(),
    referencedNoticeDate,
    amendmentType: "correction",
    rawTextHash: createHash("sha256").update(html).digest("hex"),
  }
}
