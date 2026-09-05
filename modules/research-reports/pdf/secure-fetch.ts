import { createHash } from "node:crypto"
import { lookup } from "node:dns/promises"
import { isIP } from "node:net"

export interface ResearchReportPdfPolicy {
  allowedHosts: ReadonlySet<string>
  maxBytes: number
  timeoutMs: number
  maxRedirects: number
}

export interface DownloadedResearchReportPdf {
  finalUrl: string
  bytes: Uint8Array
  contentHash: string
  contentType: string | null
  byteLength: number
}

interface ResearchReportPdfFetchDeps {
  fetchImpl?: typeof fetch
  resolveHost?: (hostname: string) => Promise<string[]>
}

const DEFAULT_MAX_BYTES = 20 * 1024 * 1024
const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_MAX_REDIRECTS = 3
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

function positiveIntegerEnv(name: string, fallback: number) {
  const parsed = Number(process.env[name])
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

export function getResearchReportPdfPolicy(): ResearchReportPdfPolicy {
  const allowedHosts = new Set(
    (process.env.RESEARCH_REPORT_PDF_ALLOWED_HOSTS || "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  )
  if (allowedHosts.size === 0) {
    throw new Error("RESEARCH_REPORT_PDF_ALLOWED_HOSTS must contain at least one approved PDF host")
  }
  return {
    allowedHosts,
    maxBytes: positiveIntegerEnv("RESEARCH_REPORT_PDF_MAX_BYTES", DEFAULT_MAX_BYTES),
    timeoutMs: positiveIntegerEnv("RESEARCH_REPORT_PDF_TIMEOUT_MS", DEFAULT_TIMEOUT_MS),
    maxRedirects: positiveIntegerEnv("RESEARCH_REPORT_PDF_MAX_REDIRECTS", DEFAULT_MAX_REDIRECTS),
  }
}

function parseIpv4(address: string) {
  const parts = address.split(".").map(Number)
  return parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
    ? parts
    : null
}

function isUnsafeIpv4(address: string) {
  const parts = parseIpv4(address)
  if (!parts) return true
  const [a, b] = parts
  if (a === 0 || a === 10 || a === 127) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 198 && (b === 18 || b === 19)) return true
  if (a >= 224) return true
  return false
}

function isUnsafeIp(address: string) {
  const version = isIP(address)
  if (version === 4) return isUnsafeIpv4(address)
  if (version !== 6) return true

  const normalized = address.toLowerCase()
  if (normalized === "::" || normalized === "::1") return true
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true
  if (/^fe[89ab]/.test(normalized)) return true
  if (normalized.startsWith("ff")) return true
  if (normalized.startsWith("::ffff:")) {
    const mapped = normalized.slice("::ffff:".length)
    if (isIP(mapped) === 4) return isUnsafeIpv4(mapped)
  }
  return false
}

async function defaultResolveHost(hostname: string) {
  const addresses = await lookup(hostname, { all: true, verbatim: true })
  return addresses.map((entry) => entry.address)
}

async function validatePdfUrl(
  rawUrl: string,
  policy: ResearchReportPdfPolicy,
  resolveHost: (hostname: string) => Promise<string[]>,
) {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new Error("Research report PDF URL is invalid")
  }

  if (url.protocol !== "https:") throw new Error("Research report PDF URL must use HTTPS")
  if (url.username || url.password) throw new Error("Research report PDF URL must not contain credentials")
  const hostname = url.hostname.toLowerCase()
  if (isIP(hostname) !== 0) throw new Error("Research report PDF URL cannot target an IP literal")
  if (!policy.allowedHosts.has(hostname)) throw new Error(`Research report PDF host is not in allowlist: ${hostname}`)

  const addresses = await resolveHost(hostname)
  if (addresses.length === 0 || addresses.some(isUnsafeIp)) {
    throw new Error(`Research report PDF host did not resolve exclusively to public addresses: ${hostname}`)
  }
  return url
}

function hasPdfSignature(bytes: Uint8Array) {
  return bytes.byteLength >= 5
    && bytes[0] === 0x25
    && bytes[1] === 0x50
    && bytes[2] === 0x44
    && bytes[3] === 0x46
    && bytes[4] === 0x2d
}

async function readBoundedBody(response: Response, maxBytes: number) {
  const rawLength = response.headers.get("content-length")
  if (rawLength) {
    const declaredLength = Number(rawLength)
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      throw new Error(`Research report PDF exceeds maximum size of ${maxBytes} bytes`)
    }
  }

  if (!response.body) return new Uint8Array()
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel("Research report PDF exceeded byte limit")
        throw new Error(`Research report PDF exceeds maximum size of ${maxBytes} bytes`)
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

export async function fetchResearchReportPdf(
  rawUrl: string,
  policy = getResearchReportPdfPolicy(),
  deps: ResearchReportPdfFetchDeps = {},
): Promise<DownloadedResearchReportPdf> {
  const fetchImpl = deps.fetchImpl || fetch
  const resolveHost = deps.resolveHost || defaultResolveHost
  let currentUrl = rawUrl

  for (let redirectCount = 0; redirectCount <= policy.maxRedirects; redirectCount += 1) {
    const validatedUrl = await validatePdfUrl(currentUrl, policy, resolveHost)
    const response = await fetchImpl(validatedUrl, {
      method: "GET",
      headers: { accept: "application/pdf" },
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(policy.timeoutMs),
    })

    if (REDIRECT_STATUSES.has(response.status)) {
      if (redirectCount >= policy.maxRedirects) {
        throw new Error(`Research report PDF exceeded ${policy.maxRedirects} redirects`)
      }
      const location = response.headers.get("location")
      if (!location) throw new Error("Research report PDF redirect is missing Location header")
      currentUrl = new URL(location, validatedUrl).toString()
      continue
    }

    if (!response.ok) throw new Error(`Research report PDF fetch failed (${response.status})`)
    const bytes = await readBoundedBody(response, policy.maxBytes)
    const contentType = response.headers.get("content-type")
    const mime = contentType?.split(";", 1)[0]?.trim().toLowerCase() || null
    if (mime !== "application/pdf" && !hasPdfSignature(bytes)) {
      throw new Error(`Research report response is not a PDF (${mime || "unknown content type"})`)
    }

    return {
      finalUrl: validatedUrl.toString(),
      bytes,
      contentHash: createHash("sha256").update(bytes).digest("hex"),
      contentType,
      byteLength: bytes.byteLength,
    }
  }

  throw new Error("Research report PDF redirect loop exceeded policy")
}
