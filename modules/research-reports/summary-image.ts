import { Buffer } from "node:buffer"

const REPORT_TABLE = "market_research_reports"
const ANALYSIS_TABLE = "market_research_report_analyses"
const MENTION_TABLE = "market_research_report_ticker_mentions"
const IMAGE_BUCKET = "research-report-images"
const IMAGE_CREATOR_URL = "https://nguyennhatnam.com/tool/image-creator.php"
const IMAGE_CREATOR_ORIGIN = "https://nguyennhatnam.com"
const DEFAULT_IMAGE_CREATOR_NONCE = "05f3482112"
const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const MAX_BASE64_IMAGE_CHARS = Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 8
const IMAGE_CREATOR_GENERATION_TIMEOUT_MS = 180_000
const MAX_ERROR_CHARS = 500

type DbError = { message?: string } | null
type DbResult = { data: unknown; error: DbError }

interface SummaryImageQuery extends PromiseLike<DbResult> {
  select(columns: string): SummaryImageQuery
  eq(column: string, value: unknown): SummaryImageQuery
  order(column: string, options?: { ascending?: boolean }): SummaryImageQuery
  update(patch: Record<string, unknown>): SummaryImageQuery
  maybeSingle(): PromiseLike<{ data: Record<string, unknown> | null; error: DbError }>
}

interface SummaryImageStorageBucket {
  upload(
    path: string,
    body: ArrayBuffer | Uint8Array,
    options: { upsert: boolean; contentType: string; cacheControl: string },
  ): PromiseLike<{ data: unknown; error: DbError }>
}

export interface ResearchReportSummaryImageClient {
  from(table: string): SummaryImageQuery
  storage: {
    from(bucket: string): SummaryImageStorageBucket
  }
}

export interface ResearchReportSummaryImageResult {
  status: "ready" | "skipped_existing" | "failed"
  path: string | null
  detail: string
}

interface GeneratedImage {
  bytes: Uint8Array
  contentType: "image/png" | "image/jpeg" | "image/webp"
  extension: "png" | "jpg" | "webp"
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null
  const normalized = value.replace(/\s+/g, " ").trim()
  return normalized || null
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map(nonEmptyString).filter((value): value is string => value !== null)
}

function positiveNumber(value: unknown): number | null {
  const numeric = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim()
      ? Number(value)
      : Number.NaN
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null
}

function sanitizeError(value: unknown): string {
  return String(value instanceof Error ? value.message : value ?? "unknown error")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_ERROR_CHARS)
}

function categoryLabel(value: unknown): string {
  if (value === "macro") return "Vĩ mô tiền tệ"
  if (value === "strategy") return "Chiến lược"
  if (value === "sector") return "Ngành"
  return "Research"
}

function compactLines(values: readonly string[], limit: number): string[] {
  return values
    .map((value) => value.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, limit)
}

function tickerLabel(row: Record<string, unknown>): string | null {
  const ticker = nonEmptyString(row.ticker)?.toUpperCase()
  if (!ticker || !/^[A-Z0-9]{2,12}$/.test(ticker)) return null

  const recommendation = nonEmptyString(row.recommendation_text)
  const targetPrice = positiveNumber(row.target_price)
  const targetCurrency = nonEmptyString(row.target_currency)?.toUpperCase() || "VND"
  const parts = [ticker]
  if (recommendation) parts.push(recommendation)
  if (targetPrice !== null) {
    parts.push(`Mục tiêu ${new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(targetPrice)} ${targetCurrency}`)
  }
  return parts.join(" • ")
}

export function buildResearchReportSummaryImageFields(input: {
  report: Record<string, unknown>
  analysis: Record<string, unknown>
  mentions: readonly Record<string, unknown>[]
}): Record<string, string> {
  const title = nonEmptyString(input.report.title) || "Báo cáo nghiên cứu"
  const sourceName = nonEmptyString(input.report.source_name) || "Nguồn báo cáo"
  const publishDate = nonEmptyString(input.report.publish_date) || ""
  const sectorName = nonEmptyString(input.report.sector_name)
  const recommendation = nonEmptyString(input.report.recommendation)
  const executiveSummary = nonEmptyString(input.analysis.executive_summary)
  const keyPoints = compactLines(stringArray(input.analysis.key_points), 4)
  const catalysts = compactLines(stringArray(input.analysis.catalysts), 3)
  const risks = compactLines(stringArray(input.analysis.risks), 3)
  const recommendedMentions = input.mentions.filter((row) =>
    Boolean(nonEmptyString(row.recommendation_text)) || positiveNumber(row.target_price) !== null)
  const otherMentions = input.mentions.filter((row) => !recommendedMentions.includes(row))
  const tickers = [...recommendedMentions, ...otherMentions]
    .map(tickerLabel)
    .filter((value): value is string => value !== null)

  const providerCode = nonEmptyString(input.report.code)?.toUpperCase() ?? ""
  if (/^[A-Z0-9]{2,12}$/.test(providerCode) && !tickers.some((item) => item.startsWith(`${providerCode} •`) || item === providerCode)) {
    const providerRecommendation = nonEmptyString(input.report.recommendation)
    const providerTarget = positiveNumber(input.report.target_price)
    const providerParts = [providerCode]
    if (providerRecommendation) providerParts.push(providerRecommendation)
    if (providerTarget !== null) {
      providerParts.push(`Mục tiêu ${new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(providerTarget)} VND`)
    }
    tickers.unshift(providerParts.join(" • "))
  }
  tickers.splice(8)

  const services = [
    "TÓM TẮT BÁO CÁO",
    executiveSummary || keyPoints[0] || title,
    ...keyPoints.map((item) => `• ${item}`),
    catalysts.length ? "" : null,
    catalysts.length ? "ĐỘNG LỰC / CATALYSTS" : null,
    ...catalysts.map((item) => `• ${item}`),
    tickers.length ? "" : null,
    tickers.length ? "MÃ CỔ PHIẾU KHUYẾN NGHỊ / LIÊN QUAN" : null,
    ...tickers,
    risks.length ? "" : null,
    risks.length ? "RỦI RO" : null,
    ...risks.map((item) => `• ${item}`),
  ].filter((value): value is string => Boolean(value)).join("\n")

  const contact = [
    sourceName,
    publishDate,
    recommendation ? `Khuyến nghị: ${recommendation}` : null,
  ].filter((value): value is string => Boolean(value)).join("\n")

  const visualEvidence = compactLines([
    executiveSummary || "",
    ...keyPoints,
    ...catalysts,
    ...risks,
  ], 10).join(" | ")

  const visuals = [
    "Thiết kế một trang research report A4 ngang, phong cách tổ chức tài chính chuyên nghiệp.",
    `Chủ đề báo cáo: ${title}.`,
    sectorName ? `Ngành/chủ đề: ${sectorName}.` : "",
    "Bố cục rõ ràng gồm: Luận điểm chính, Động lực/Catalysts, Rủi ro, Mã cổ phiếu liên quan.",
    tickers.length ? `Hiển thị thật rõ các mã cổ phiếu: ${tickers.map((item) => item.split(" • ")[0]).join(", ")} dưới dạng badge lớn, dễ đọc; ưu tiên visual hierarchy cho mã có khuyến nghị hoặc giá mục tiêu.` : "",
    "Tăng chi tiết hình ảnh minh họa gắn trực tiếp với ngành, sản phẩm, tài sản, chuỗi giá trị hoặc bối cảnh được nêu trong báo cáo.",
    "Chỉ dùng motif hình ảnh có thể suy ra từ tiêu đề và nội dung báo cáo; không thêm câu chuyện, slogan hay dữ liệu thị trường không có trong báo cáo.",
    visualEvidence ? `Evidence để định hướng hình ảnh: ${visualEvidence}.` : "",
    "Logo công ty chứng khoán nếu có chỉ là metadata rất nhỏ, không làm logo lớn.",
    "Broker, ngày báo cáo và khuyến nghị đặt ở footer bên trái với font nhỏ.",
    "Không làm như banner quảng cáo. Không tạo chart phức tạp. Không thêm số liệu ngoài nội dung được cung cấp.",
  ].filter(Boolean).join(" ")

  return {
    location: sectorName || categoryLabel(input.report.category),
    headline: title,
    slogan: sectorName || "",
    services,
    contact,
    visuals,
    style: "Premium institutional equity research summary. Landscape A4. Deep navy background, white typography, cyan accents, subtle amber for recommendation and green for positive evidence. Editorial grid, modern sans-serif, clear hierarchy, clean spacing, high readability, detailed report-relevant illustration, minimal decoration.",
  }
}

function imageContentType(value: string | null): GeneratedImage["contentType"] | null {
  const normalized = value?.split(";")[0]?.trim().toLowerCase()
  if (normalized === "image/png") return "image/png"
  if (normalized === "image/jpeg" || normalized === "image/jpg") return "image/jpeg"
  if (normalized === "image/webp") return "image/webp"
  return null
}

function imageExtension(contentType: GeneratedImage["contentType"]): GeneratedImage["extension"] {
  if (contentType === "image/jpeg") return "jpg"
  if (contentType === "image/webp") return "webp"
  return "png"
}

function boundedBytes(bytes: Uint8Array, contentType: GeneratedImage["contentType"]): GeneratedImage {
  if (bytes.byteLength === 0) throw new Error("Image creator returned an empty image")
  if (bytes.byteLength > MAX_IMAGE_BYTES) throw new Error("Generated research image exceeds the 8 MB storage limit")
  return { bytes, contentType, extension: imageExtension(contentType) }
}

function base64ImageContentType(value: unknown): GeneratedImage["contentType"] | null {
  if (typeof value !== "string") return null
  const candidate = value.replace(/\s+/g, "").trim()
  if (
    candidate.length < 12
    || candidate.length > MAX_BASE64_IMAGE_CHARS
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(candidate)
  ) return null

  const prefix = new Uint8Array(Buffer.from(candidate.slice(0, 32), "base64"))
  if (
    prefix.length >= 8
    && prefix[0] === 0x89
    && prefix[1] === 0x50
    && prefix[2] === 0x4e
    && prefix[3] === 0x47
    && prefix[4] === 0x0d
    && prefix[5] === 0x0a
    && prefix[6] === 0x1a
    && prefix[7] === 0x0a
  ) return "image/png"

  if (prefix.length >= 3 && prefix[0] === 0xff && prefix[1] === 0xd8 && prefix[2] === 0xff) {
    return "image/jpeg"
  }

  if (
    prefix.length >= 12
    && String.fromCharCode(...prefix.slice(0, 4)) === "RIFF"
    && String.fromCharCode(...prefix.slice(8, 12)) === "WEBP"
  ) return "image/webp"

  return null
}

function rawBase64ImageSource(value: unknown): string | null {
  if (typeof value !== "string") return null
  const candidate = value.replace(/\s+/g, "").trim()
  const contentType = base64ImageContentType(candidate)
  return contentType ? `data:${contentType};base64,${candidate}` : null
}

function extractImageSource(value: unknown): string | null {
  if (typeof value === "string") {
    const candidate = value.trim().replace(/&amp;/g, "&")
    if (/^data:image\/(?:png|jpeg|jpg|webp);base64,/i.test(candidate)) return candidate
    if (/^https:\/\//i.test(candidate)) return candidate
    return null
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const candidate = extractImageSource(item)
      if (candidate) return candidate
    }
    return null
  }
  if (value && typeof value === "object") {
    const row = value as Record<string, unknown>
    for (const key of ["b64", "base64"]) {
      if (!(key in row)) continue
      const candidate = rawBase64ImageSource(row[key])
      if (candidate) return candidate
    }
    for (const key of ["image_url", "url", "src", "image", "data", "output"]) {
      if (!(key in row)) continue
      const candidate = extractImageSource(row[key])
      if (candidate) return candidate
    }
    for (const nested of Object.values(row)) {
      const candidate = extractImageSource(nested)
      if (candidate) return candidate
    }
  }
  return null
}

async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  input: string,
  init: RequestInit,
  timeoutMs = 45_000,
): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetchImpl(input, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
}

function isAllowedGeneratedImageUrl(url: URL): boolean {
  const hostname = url.hostname.toLowerCase()
  return url.protocol === "https:"
    && (
      hostname === "nguyennhatnam.com"
      || hostname.endsWith(".nguyennhatnam.com")
      || hostname.endsWith(".oaiusercontent.com")
      || hostname.endsWith(".openaiusercontent.com")
      || /^oai[a-z0-9-]*\.blob\.core\.windows\.net$/.test(hostname)
    )
}

async function downloadGeneratedImage(fetchImpl: typeof fetch, source: string): Promise<GeneratedImage> {
  let url = new URL(source, IMAGE_CREATOR_URL)

  for (let redirectCount = 0; redirectCount <= 3; redirectCount += 1) {
    if (!isAllowedGeneratedImageUrl(url)) {
      throw new Error("Image creator returned an untrusted image URL")
    }

    const response = await fetchWithTimeout(fetchImpl, url.toString(), { redirect: "manual" })
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location")
      if (!location || redirectCount === 3) throw new Error("Generated image download redirect was invalid")
      url = new URL(location, url)
      continue
    }

    if (!response.ok) throw new Error(`Generated image download failed with HTTP ${response.status}`)
    const contentType = imageContentType(response.headers.get("content-type"))
    if (!contentType) throw new Error("Generated image download returned a non-image response")
    const contentLength = Number(response.headers.get("content-length") || 0)
    if (Number.isFinite(contentLength) && contentLength > MAX_IMAGE_BYTES) {
      throw new Error("Generated research image exceeds the 8 MB storage limit")
    }
    return boundedBytes(new Uint8Array(await response.arrayBuffer()), contentType)
  }

  throw new Error("Generated image download exceeded redirect limit")
}

async function imageFromSource(fetchImpl: typeof fetch, source: string): Promise<GeneratedImage> {
  if (source.startsWith("data:")) {
    const match = source.match(/^data:(image\/(?:png|jpeg|jpg|webp));base64,(.+)$/i)
    const contentType = imageContentType(match?.[1] || null)
    if (!match || !contentType) throw new Error("Image creator returned an unsupported data URL")
    return boundedBytes(new Uint8Array(Buffer.from(match[2], "base64")), contentType)
  }

  return downloadGeneratedImage(fetchImpl, source)
}

export async function parseResearchReportImageCreatorResponse(fetchImpl: typeof fetch, response: Response): Promise<GeneratedImage> {
  const directType = imageContentType(response.headers.get("content-type"))
  if (directType) {
    if (!response.ok) throw new Error(`Image creator failed with HTTP ${response.status}`)
    return boundedBytes(new Uint8Array(await response.arrayBuffer()), directType)
  }

  const text = await response.text()
  if (!response.ok) {
    throw new Error(`Image creator failed with HTTP ${response.status}: ${text.slice(0, 180)}`)
  }

  let source: string | null = null
  try {
    source = extractImageSource(JSON.parse(text))
  } catch {
    source = null
  }
  if (!source) {
    const htmlMatch = text.match(/<img[^>]+src=["']([^"']+)["']/i)
    source = htmlMatch?.[1]?.trim() || null
  }
  if (!source) {
    if (/security|securify|nonce|csrf|forbidden/i.test(text)) {
      throw new Error(`Image creator security check failed: ${text.slice(0, 180)}`)
    }
    throw new Error("Image creator response did not contain an image")
  }
  return imageFromSource(fetchImpl, source)
}

function requestHeaders(cookie?: string): HeadersInit {
  return {
    Referer: IMAGE_CREATOR_URL,
    Origin: IMAGE_CREATOR_ORIGIN,
    "User-Agent": "Mozilla/5.0",
    ...(cookie ? { Cookie: cookie } : {}),
  }
}

async function submitImageCreator(
  fetchImpl: typeof fetch,
  fields: Record<string, string>,
  nonce: string,
  cookie?: string,
): Promise<GeneratedImage> {
  const form = new FormData()
  form.set("wpaiic_action", "generate")
  form.set("wpaiic_nonce", nonce)
  for (const [key, value] of Object.entries(fields)) form.set(key, value)
  form.set("size_choice", "custom")
  form.set("quality", "auto")
  form.set("custom_width", "1754")
  form.set("custom_height", "1240")
  form.set("model", "gpt-image-2.5-sunburst")

  const response = await fetchWithTimeout(fetchImpl, IMAGE_CREATOR_URL, {
    method: "POST",
    headers: requestHeaders(cookie),
    body: form,
  }, IMAGE_CREATOR_GENERATION_TIMEOUT_MS)
  return parseResearchReportImageCreatorResponse(fetchImpl, response)
}

function extractNonce(html: string): string | null {
  const patterns = [
    /name=["']wpaiic_nonce["'][^>]*value=["']([^"']+)["']/i,
    /value=["']([^"']+)["'][^>]*name=["']wpaiic_nonce["']/i,
    /["']wpaiic_nonce["']\s*[:=]\s*["']([^"']+)["']/i,
  ]
  for (const pattern of patterns) {
    const match = html.match(pattern)
    if (match?.[1]) return match[1]
  }
  return null
}

async function fetchFreshNonceSession(fetchImpl: typeof fetch): Promise<{ nonce: string; cookie?: string } | null> {
  const response = await fetchWithTimeout(fetchImpl, IMAGE_CREATOR_URL, {
    method: "GET",
    headers: requestHeaders(),
    redirect: "follow",
  }, 20_000)
  if (!response.ok) return null
  const nonce = extractNonce(await response.text())
  if (!nonce) return null
  const cookie = response.headers.get("set-cookie")?.split(";")[0]?.trim()
  return { nonce, ...(cookie ? { cookie } : {}) }
}

async function generateRemoteImage(
  fetchImpl: typeof fetch,
  fields: Record<string, string>,
): Promise<GeneratedImage> {
  const configuredNonce = process.env.RESEARCH_REPORT_IMAGE_NONCE?.trim()
  const initialNonce = configuredNonce || DEFAULT_IMAGE_CREATOR_NONCE

  try {
    return await submitImageCreator(fetchImpl, fields, initialNonce)
  } catch (error) {
    const message = sanitizeError(error)
    if (!/security|securify|nonce|csrf|forbidden|http 403/i.test(message)) throw error

    const freshSession = await fetchFreshNonceSession(fetchImpl)
    if (!freshSession || freshSession.nonce === initialNonce) throw error
    return submitImageCreator(fetchImpl, fields, freshSession.nonce, freshSession.cookie)
  }
}

async function updateImageState(
  client: ResearchReportSummaryImageClient,
  reportId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const result = await client.from(REPORT_TABLE).update({
    ...patch,
    updated_at: new Date().toISOString(),
  }).eq("id", reportId)
  if (result.error) throw new Error(`Research report summary image state update failed: ${sanitizeError(result.error.message)}`)
}

export async function generateResearchReportSummaryImage(
  client: ResearchReportSummaryImageClient,
  input: { reportId: string; analysisId: string; fetchImpl?: typeof fetch },
): Promise<ResearchReportSummaryImageResult> {
  const fetchImpl = input.fetchImpl ?? fetch

  const reportResult = await client.from(REPORT_TABLE)
    .select("id,title,source_name,publish_date,category,sector_name,recommendation,target_price,code,summary_image_status,summary_image_path,summary_image_analysis_id")
    .eq("id", input.reportId)
    .maybeSingle()
  if (reportResult.error || !reportResult.data) {
    return { status: "failed", path: null, detail: `Report image metadata lookup failed: ${sanitizeError(reportResult.error?.message)}` }
  }

  if (
    reportResult.data.summary_image_status === "ready"
    && reportResult.data.summary_image_analysis_id === input.analysisId
    && nonEmptyString(reportResult.data.summary_image_path)
  ) {
    return {
      status: "skipped_existing",
      path: nonEmptyString(reportResult.data.summary_image_path),
      detail: "Summary image already exists for this analysis",
    }
  }

  const analysisResult = await client.from(ANALYSIS_TABLE)
    .select("id,report_id,executive_summary,key_points,market_view,sector_outlook,catalysts,risks")
    .eq("id", input.analysisId)
    .eq("report_id", input.reportId)
    .maybeSingle()
  if (analysisResult.error || !analysisResult.data) {
    return { status: "failed", path: null, detail: `Report analysis lookup failed: ${sanitizeError(analysisResult.error?.message)}` }
  }

  const mentionsResult = await client.from(MENTION_TABLE)
    .select("ticker,stance,recommendation_text,target_price,target_currency,rationale")
    .eq("analysis_id", input.analysisId)
    .order("ticker", { ascending: true })
  if (mentionsResult.error) {
    return { status: "failed", path: null, detail: `Report ticker lookup failed: ${sanitizeError(mentionsResult.error.message)}` }
  }
  const mentions = Array.isArray(mentionsResult.data)
    ? mentionsResult.data.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object")
    : []

  try {
    await updateImageState(client, input.reportId, {
      summary_image_status: "generating",
      summary_image_error: null,
    })

    const fields = buildResearchReportSummaryImageFields({
      report: reportResult.data,
      analysis: analysisResult.data,
      mentions,
    })
    const image = await generateRemoteImage(fetchImpl, fields)
    const objectPath = `${input.reportId}/${input.analysisId}.${image.extension}`

    const upload = await client.storage.from(IMAGE_BUCKET).upload(objectPath, image.bytes, {
      upsert: true,
      contentType: image.contentType,
      cacheControl: "31536000",
    })
    if (upload.error) throw new Error(`Research summary image upload failed: ${sanitizeError(upload.error.message)}`)

    await updateImageState(client, input.reportId, {
      summary_image_status: "ready",
      summary_image_path: objectPath,
      summary_image_analysis_id: input.analysisId,
      summary_image_generated_at: new Date().toISOString(),
      summary_image_error: null,
    })

    return { status: "ready", path: objectPath, detail: "Research summary image generated" }
  } catch (error) {
    const detail = sanitizeError(error)
    try {
      await updateImageState(client, input.reportId, {
        summary_image_status: "failed",
        summary_image_error: detail,
      })
    } catch {
      // Keep the original generation failure as the caller-visible detail.
    }
    return { status: "failed", path: null, detail }
  }
}
