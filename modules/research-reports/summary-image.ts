const REPORT_TABLE = "market_research_reports"
const ANALYSIS_TABLE = "market_research_report_analyses"
const MENTION_TABLE = "market_research_report_ticker_mentions"

const IMAGE_CREATOR_URL = "https://nguyennhatnam.com/tool/image-creator.php"
const DEFAULT_IMAGE_CREATOR_NONCE = "05f3482112"
const IMAGE_MODEL = "gpt-image-2.5-sunburst"
const IMAGE_SIZE = "1536x1024"
const PROMPT_VERSION = "research-summary-landscape-v1"
const MAX_ERROR_CHARS = 500
const MAX_POINTS = 4
const MAX_RISKS = 3
const MAX_TICKERS = 8

type DbError = { message?: string }
type DbResult = { data: unknown; error: DbError | null }

interface Query extends PromiseLike<DbResult> {
  select(columns: string): Query
  eq(column: string, value: unknown): Query
  order(column: string, options?: { ascending?: boolean }): Query
  limit(value: number): Query
  maybeSingle(): PromiseLike<DbResult>
  update(patch: Record<string, unknown>): { eq(column: string, value: unknown): PromiseLike<DbResult> }
}

export interface ResearchReportSummaryImageClient {
  from(table: string): Query
}

export interface ResearchReportSummaryImageInput {
  reportId: string
  analysisId: string
  contentHash: string
}

export interface ResearchReportSummaryImageResult {
  status: "ready" | "skipped" | "failed"
  imageUrl: string | null
  detail: string
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null
  const normalized = value.replace(/\s+/g, " ").trim()
  return normalized || null
}

function list(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return []
  return value.map(text).filter((item): item is string => Boolean(item)).slice(0, limit)
}

function safeError(value: unknown): string {
  return String(value instanceof Error ? value.message : value ?? "unknown error")
    .replace(/Bearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_ERROR_CHARS)
}

function recommendationLine(row: Record<string, unknown>): string | null {
  const ticker = text(row.ticker)?.toUpperCase()
  if (!ticker) return null
  const recommendation = text(row.recommendation_text)
  const stance = text(row.stance)
  return [ticker, recommendation || stance].filter(Boolean).join(" — ")
}

function joinBullets(title: string, values: readonly string[]): string {
  if (values.length === 0) return ""
  return [title, ...values.map((value) => `• ${value}`)].join("\n")
}

export function buildResearchReportSummaryImageFields(input: {
  report: Record<string, unknown>
  analysis: Record<string, unknown>
  mentions: readonly Record<string, unknown>[]
}) {
  const reportTitle = text(input.report.title) ?? "Báo cáo phân tích"
  const sourceName = text(input.report.source_name) ?? "Nguồn báo cáo"
  const publishDate = text(input.report.publish_date) ?? ""
  const sectorName = text(input.report.sector_name)
  const recommendation = text(input.report.recommendation)
  const providerCode = text(input.report.code)?.toUpperCase() ?? null
  const executiveSummary = text(input.analysis.executive_summary) ?? ""
  const keyPoints = list(input.analysis.key_points, MAX_POINTS)
  const catalysts = list(input.analysis.catalysts, MAX_POINTS)
  const risks = list(input.analysis.risks, MAX_RISKS)
  const tickerLines = input.mentions
    .map(recommendationLine)
    .filter((item): item is string => Boolean(item))
    .slice(0, MAX_TICKERS)
  if (tickerLines.length === 0 && providerCode) {
    tickerLines.push([providerCode, recommendation].filter(Boolean).join(" — "))
  }

  const services = [
    "TÓM TẮT BÁO CÁO",
    executiveSummary,
    joinBullets("LUẬN ĐIỂM CHÍNH", keyPoints),
    joinBullets("ĐỘNG LỰC", catalysts),
    tickerLines.length ? ["MÃ CỔ PHIẾU LIÊN QUAN", ...tickerLines].join("\n") : "",
    joinBullets("RỦI RO", risks),
  ].filter(Boolean).join("\n\n")

  const contact = [
    sourceName,
    publishDate,
    recommendation ? `Khuyến nghị: ${recommendation}` : "",
  ].filter(Boolean).join("\n")

  const visuals = [
    "Thiết kế một bản research report A4 ngang chuyên nghiệp, tóm tắt đúng nội dung báo cáo được cung cấp.",
    "Bố cục rõ ràng gồm: tiêu đề, luận điểm chính, động lực, rủi ro và mã cổ phiếu liên quan.",
    tickerLines.length
      ? `Làm nổi bật rõ các mã cổ phiếu: ${tickerLines.map((line) => line.split(" — ")[0]).join(", ")} dưới dạng badge/chip dễ đọc.`
      : "",
    sectorName ? `Dùng minh họa tinh tế, thực tế và liên quan trực tiếp đến ngành/chủ đề: ${sectorName}.` : "",
    "Metadata công ty chứng khoán, ngày báo cáo và khuyến nghị đặt nhỏ ở footer bên trái.",
    "Logo/branding công ty chứng khoán nếu xuất hiện phải nhỏ và thứ yếu.",
    "Không thêm slogan thị trường, thông điệp quảng cáo, số liệu hay luận điểm không có trong nội dung được cung cấp.",
    "Không tạo chart phức tạp. Ưu tiên khả năng đọc nhanh trong 5-10 giây.",
  ].filter(Boolean).join(" ")

  const style = [
    "Premium institutional equity research summary, landscape A4.",
    "Deep navy background, white typography, cyan accents, subtle amber emphasis.",
    "Modern sans-serif, editorial grid, strong visual hierarchy, clean spacing, high readability.",
    "Professional financial-research aesthetic, minimal decoration, no advertising look.",
  ].join(" ")

  return {
    location: "Vietnam Equity Research Report",
    headline: reportTitle.slice(0, 160),
    slogan: (sectorName ?? "").slice(0, 140),
    services: services.slice(0, 5000),
    contact: contact.slice(0, 500),
    visuals: visuals.slice(0, 3500),
    style,
  }
}

function safeImageUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null

  try {
    const url = new URL(value.trim(), IMAGE_CREATOR_URL)
    if (url.protocol !== "https:" && url.protocol !== "http:") return null
    const path = url.pathname.toLowerCase()
    const imagePath = /\.(?:png|jpe?g|webp|gif|avif)(?:$|[?#])/.test(`${path}${url.search}`)
    const imageHint = /(?:image|generated|output|media|upload)/i.test(path)
    return imagePath || imageHint ? url.toString() : null
  } catch {
    return null
  }
}

function findJsonImageUrl(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findJsonImageUrl(item)
      if (found) return found
    }
    return null
  }
  if (!value || typeof value !== "object") return null

  const row = value as Record<string, unknown>
  for (const key of ["image_url", "imageUrl", "output_url", "generated_url", "src"]) {
    const found = safeImageUrl(row[key])
    if (found) return found
  }

  for (const key of ["data", "result", "output", "images"]) {
    if (!(key in row)) continue
    const found = findJsonImageUrl(row[key])
    if (found) return found
  }
  return null
}

function findHtmlImageUrl(body: string): string | null {
  const imgMatches = body.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)
  for (const match of imgMatches) {
    const found = safeImageUrl(match[1])
    if (found) return found
  }

  const explicitUrl = body.match(/https?:\/\/[^\s"'<>]+\.(?:png|jpe?g|webp|gif|avif)(?:\?[^\s"'<>]*)?/i)
  return safeImageUrl(explicitUrl?.[0])
}

async function parseImageUrl(response: Response): Promise<string | null> {
  const contentType = response.headers.get("content-type") ?? ""
  const body = await response.text()
  if (!body.trim()) return null

  if (contentType.includes("json") || /^[\s]*[\[{]/.test(body)) {
    try {
      const parsed = JSON.parse(body)
      const found = findJsonImageUrl(parsed)
      if (found) return found
    } catch {
      // Some deployments return an HTML fragment despite a JSON-ish content type.
    }
  }

  return findHtmlImageUrl(body)
}

async function setSummaryImageState(
  client: ResearchReportSummaryImageClient,
  reportId: string,
  patch: Record<string, unknown>,
) {
  const result = await client.from(REPORT_TABLE).update({
    ...patch,
    updated_at: new Date().toISOString(),
  }).eq("id", reportId)
  if (result.error) throw new Error(`Research report summary image state update failed: ${safeError(result.error.message)}`)
}

async function loadSummaryInputs(client: ResearchReportSummaryImageClient, input: ResearchReportSummaryImageInput) {
  const reportResult = await client.from(REPORT_TABLE)
    .select("id,title,source_name,publish_date,category,sector_name,recommendation,code,content_hash,summary_image_status,summary_image_url,summary_image_content_hash")
    .eq("id", input.reportId)
    .maybeSingle()
  if (reportResult.error) throw new Error(`Research report summary image report lookup failed: ${safeError(reportResult.error.message)}`)
  const report = reportResult.data && typeof reportResult.data === "object" && !Array.isArray(reportResult.data)
    ? reportResult.data as Record<string, unknown>
    : null
  if (!report) throw new Error("Research report summary image report lookup failed: report not found")

  const analysisResult = await client.from(ANALYSIS_TABLE)
    .select("id,report_id,content_hash,executive_summary,key_points,market_view,sector_outlook,catalysts,risks")
    .eq("id", input.analysisId)
    .eq("report_id", input.reportId)
    .eq("content_hash", input.contentHash)
    .maybeSingle()
  if (analysisResult.error) throw new Error(`Research report summary image analysis lookup failed: ${safeError(analysisResult.error.message)}`)
  const analysis = analysisResult.data && typeof analysisResult.data === "object" && !Array.isArray(analysisResult.data)
    ? analysisResult.data as Record<string, unknown>
    : null
  if (!analysis) throw new Error("Research report summary image analysis lookup failed: current analysis not found")

  const mentionResult = await client.from(MENTION_TABLE)
    .select("ticker,stance,recommendation_text,target_price,target_currency,rationale")
    .eq("analysis_id", input.analysisId)
    .order("ticker", { ascending: true })
    .limit(MAX_TICKERS)
  if (mentionResult.error) throw new Error(`Research report summary image mention lookup failed: ${safeError(mentionResult.error.message)}`)
  const mentions = Array.isArray(mentionResult.data)
    ? mentionResult.data.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object")
    : []

  return { report, analysis, mentions }
}

async function generateImageUrl(fields: ReturnType<typeof buildResearchReportSummaryImageFields>): Promise<string> {
  const body = new FormData()
  body.set("wpaiic_action", "generate")
  body.set("wpaiic_nonce", DEFAULT_IMAGE_CREATOR_NONCE)
  body.set("location", fields.location)
  body.set("headline", fields.headline)
  body.set("slogan", fields.slogan)
  body.set("services", fields.services)
  body.set("contact", fields.contact)
  body.set("visuals", fields.visuals)
  body.set("style", fields.style)
  body.set("size_choice", IMAGE_SIZE)
  body.set("quality", "auto")
  body.set("custom_width", "")
  body.set("custom_height", "")
  body.set("model", IMAGE_MODEL)

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 120_000)
  try {
    const response = await fetch(IMAGE_CREATOR_URL, {
      method: "POST",
      headers: {
        Referer: IMAGE_CREATOR_URL,
        Origin: "https://nguyennhatnam.com",
        "User-Agent": "Mozilla/5.0",
      },
      body,
      signal: controller.signal,
      cache: "no-store",
    })

    const imageUrl = await parseImageUrl(response)
    if (!response.ok) {
      throw new Error(`Image creator HTTP ${response.status}${imageUrl ? "" : ": no image URL returned"}`)
    }
    if (!imageUrl) throw new Error("Image creator returned no usable image URL")
    return imageUrl
  } finally {
    clearTimeout(timeout)
  }
}

export async function ensureResearchReportSummaryImage(
  client: ResearchReportSummaryImageClient,
  input: ResearchReportSummaryImageInput,
): Promise<ResearchReportSummaryImageResult> {
  try {
    const loaded = await loadSummaryInputs(client, input)
    const existingUrl = text(loaded.report.summary_image_url)
    const existingHash = text(loaded.report.summary_image_content_hash)
    if (existingUrl && existingHash === input.contentHash) {
      return { status: "skipped", imageUrl: existingUrl, detail: "Current summary image already exists" }
    }

    await setSummaryImageState(client, input.reportId, {
      summary_image_status: "generating",
      summary_image_error: null,
    })

    const fields = buildResearchReportSummaryImageFields(loaded)
    const imageUrl = await generateImageUrl(fields)
    await setSummaryImageState(client, input.reportId, {
      summary_image_status: "ready",
      summary_image_url: imageUrl,
      summary_image_content_hash: input.contentHash,
      summary_image_prompt_version: PROMPT_VERSION,
      summary_image_generated_at: new Date().toISOString(),
      summary_image_error: null,
    })

    return { status: "ready", imageUrl, detail: "Summary image generated" }
  } catch (error) {
    const detail = safeError(error)
    try {
      await setSummaryImageState(client, input.reportId, {
        summary_image_status: "failed",
        summary_image_error: detail,
      })
    } catch {
      // Image generation is secondary; never hide a valid persisted research analysis.
    }
    return { status: "failed", imageUrl: null, detail }
  }
}
