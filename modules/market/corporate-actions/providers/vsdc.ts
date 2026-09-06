import { createHash } from "node:crypto"

import type {
  CorporateActionType,
  SourceCorporateActionComponent,
  SourceCorporateActionNotice,
} from "../contract.ts"

const VSDC_ORIGIN = "https://vsdc.vn"
const VSDC_HOSTS = new Set(["vsdc.vn", "www.vsdc.vn"])
const EVENT_ID = /^\d+$/

type VsdcAmendment = {
  source: "vsdc"
  sourceUrl: string
  sourceEventId: string
  sourceUpdatedAt: string | null
  ticker: string
  amendmentType: "correction"
  referencedNoticeNumber: string
  referencedNoticeDate: string
  referencedSourceEventId: null
  rawEvidenceHash: string
}

function decodeHtmlOnce(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, decimal: string) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&")
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

  return decodeHtmlOnce(withBreaks)
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
}

function firstLabelValue(text: string, labels: readonly string[]) {
  const normalizedLabels = new Set(labels.map((label) => label.toLocaleLowerCase("vi-VN")))
  const lines = text.split("\n")

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const colonIndex = line.indexOf(":")
    if (colonIndex < 0) continue

    const key = line.slice(0, colonIndex).trim().toLocaleLowerCase("vi-VN")
    if (!normalizedLabels.has(key)) continue

    const inlineValue = line.slice(colonIndex + 1).trim()
    if (inlineValue) return inlineValue

    const adjacentValue = lines[index + 1]?.trim()
    if (adjacentValue) return adjacentValue
  }
  return null
}

function parseDate(value: string | null) {
  const match = value?.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/)
  if (!match) return null
  const result = `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`
  const parsed = new Date(`${result}T00:00:00Z`)
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== result ? null : result
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
  if (/^\d{1,3}(?:\.\d{3})+$/.test(normalized)) return Number(normalized.replace(/\./g, ""))
  return Number(normalized.replace(",", "."))
}

function normalizeRatio(left: string, right: string) {
  const numerator = parseRatioOperand(left)
  const denominator = parseRatioOperand(right)
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || numerator <= 0 || denominator <= 0) return null
  const printable = (value: number) => Number.isInteger(value) ? String(value) : String(value).replace(".", ",")
  return `${printable(numerator)}:${printable(denominator)}`
}

function explicitRatio(text: string) {
  const match = text.match(/Tỷ lệ thực hiện\s*:\s*(\d+(?:[,.]\d+)?)\s*:\s*(\d+(?:[,.]\d+)?)/i)
  return match ? normalizeRatio(match[1], match[2]) : null
}

function percentRatio(text: string) {
  const match = text.match(/Tỷ lệ thực hiện\s*:\s*(\d+(?:[,.]\d+)?)\s*%/i)
  return match ? normalizeRatio("100", match[1]) : null
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

function sectionLines(section: string) {
  return section.split("\n").map((line) => line.toLocaleLowerCase("vi-VN"))
}

function stockLikeComponent(actionType: Extract<CorporateActionType, "stock_dividend" | "bonus_issue" | "stock_split">, section: string): SourceCorporateActionComponent {
  return {
    actionType,
    cashPerShare: null,
    stockRatio: explicitRatio(section) ?? percentRatio(section),
    rightsRatio: null,
    subscriptionPrice: null,
  }
}

function parseComponent(section: string): SourceCorporateActionComponent | null {
  const lines = sectionLines(section)
  const normalized = lines.join("\n")

  if (normalized.includes("quyền mua cổ phiếu") || normalized.includes("thực hiện quyền mua")) {
    return {
      actionType: "rights_issue",
      cashPerShare: null,
      stockRatio: null,
      rightsRatio: explicitRatio(section),
      subscriptionPrice: subscriptionPrice(section),
    }
  }

  if (normalized.includes("tách cổ phiếu") || normalized.includes("gộp cổ phiếu")) {
    return stockLikeComponent("stock_split", section)
  }

  if (normalized.includes("cổ phiếu thưởng") || normalized.includes("phát hành cổ phiếu thưởng")) {
    return stockLikeComponent("bonus_issue", section)
  }

  const isCashDividend = lines.some((line) => (
    (line.includes("cổ tức") && (line.includes("bằng tiền") || line.includes("tiền mặt")))
    || (line.includes("chi trả") && line.includes("bằng tiền"))
  ))
  if (isCashDividend) {
    return {
      actionType: "cash_dividend",
      cashPerShare: cashAmount(section),
      stockRatio: null,
      rightsRatio: null,
      subscriptionPrice: null,
    }
  }

  const isStockDividend = lines.some((line) => (
    (line.includes("cổ tức") && line.includes("bằng cổ phiếu"))
    || (line.includes("chi trả") && line.includes("bằng cổ phiếu"))
  ))
  if (isStockDividend) return stockLikeComponent("stock_dividend", section)
  return null
}

function detectExchange(value: string | null): SourceCorporateActionNotice["exchange"] {
  const normalized = String(value ?? "").trim().toUpperCase()
  if (normalized.includes("HOSE") || normalized.includes("HSX")) return "HOSE"
  if (normalized.includes("HNX")) return "HNX"
  if (normalized.includes("UPCOM")) return "UPCOM"
  throw new Error("Unsupported or missing VSDC exchange")
}

function parseVsdcSourceUrl(sourceUrl: string) {
  let parsed: URL
  try {
    parsed = new URL(sourceUrl)
  } catch {
    throw new Error("Invalid VSDC source URL")
  }
  if (parsed.protocol !== "https:" || !VSDC_HOSTS.has(parsed.hostname.toLowerCase()) || parsed.username || parsed.password) {
    throw new Error("Invalid VSDC source URL")
  }
  const segments = parsed.pathname.split("/").filter(Boolean)
  const id = [...segments].reverse().find((segment) => EVENT_ID.test(segment))
  if (!id) throw new Error("Invalid VSDC source event id")
  return { sourceEventId: id }
}

function parseReferencedNotice(text: string) {
  const prefix = "thông báo số "
  const dateMarker = " ngày "

  for (const line of text.split("\n")) {
    const normalized = line.toLocaleLowerCase("vi-VN")
    const prefixIndex = normalized.indexOf(prefix)
    if (prefixIndex < 0) continue
    const numberStart = prefixIndex + prefix.length
    const dateMarkerIndex = normalized.indexOf(dateMarker, numberStart)
    if (dateMarkerIndex < 0) continue
    const noticeNumber = line.slice(numberStart, dateMarkerIndex).trim()
    const noticeDate = parseDate(line.slice(dateMarkerIndex + dateMarker.length))
    if (noticeNumber && noticeDate) return { noticeNumber, noticeDate }
  }
  return null
}

export function vsdcEventUrl(sourceEventId: string, path: "ad" | "ad1") {
  if (!EVENT_ID.test(sourceEventId)) throw new Error("Invalid VSDC event id")
  return `${VSDC_ORIGIN}/vi/${path}/${sourceEventId}`
}

export function parseVsdcCorporateActionHtml(html: string, sourceUrl: string): SourceCorporateActionNotice {
  const { sourceEventId } = parseVsdcSourceUrl(sourceUrl)
  const text = htmlToText(html)
  const ticker = firstLabelValue(text, ["Mã chứng khoán"])
  if (!ticker) throw new Error("VSDC: missing ticker")

  const actionBody = mainCorporateActionBody(text)
  const components = numberedActionSections(actionBody)
    .map(parseComponent)
    .filter((component): component is SourceCorporateActionComponent => Boolean(component))
  if (!components.length) throw new Error("VSDC: no supported corporate-action component")

  return {
    source: "vsdc",
    sourceUrl,
    sourceEventId,
    sourceUpdatedAt: parseSourceUpdatedAt(text),
    ticker: ticker.trim().toUpperCase(),
    isin: firstLabelValue(text, ["Mã ISIN"]),
    exchange: detectExchange(firstLabelValue(text, ["Sàn giao dịch", "Nơi giao dịch", "Thị trường giao dịch"])),
    recordDate: parseDate(firstLabelValue(text, ["Ngày đăng ký cuối cùng"])),
    rawEvidenceHash: createHash("sha256").update(html).digest("hex"),
    components,
  }
}

export function parseVsdcAmendmentHtml(html: string, sourceUrl: string): VsdcAmendment {
  const { sourceEventId } = parseVsdcSourceUrl(sourceUrl)
  const text = htmlToText(html)
  const relation = parseReferencedNotice(text)
  if (!relation) throw new Error("VSDC: missing referenced notice")

  const tickerMatch = text.match(/mã chứng khoán\s*:?\s*([A-Z0-9]{2,12})\b/i)
    ?? text.match(/(?:^|\n)([A-Z0-9]{2,12})\s*:\s*Đính chính/i)
  if (!tickerMatch?.[1]) throw new Error("VSDC: missing amendment ticker")

  return {
    source: "vsdc",
    sourceUrl,
    sourceEventId,
    sourceUpdatedAt: parseSourceUpdatedAt(text),
    ticker: tickerMatch[1].toUpperCase(),
    referencedNoticeNumber: relation.noticeNumber,
    referencedNoticeDate: relation.noticeDate,
    referencedSourceEventId: null,
    amendmentType: "correction",
    rawEvidenceHash: createHash("sha256").update(html).digest("hex"),
  }
}
