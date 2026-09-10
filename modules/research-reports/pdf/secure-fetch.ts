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

interface ParsedContentRange {
  start: number
  end: number
  total: number
}

interface PdfRangeSpec {
  index: number
  start: number
  end: number
}

const DEFAULT_MAX_BYTES = 20 * 1024 * 1024
const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_MAX_REDIRECTS = 3
const RANGE_CHUNK_BYTES = 256 * 1024
const RANGE_MAX_CONCURRENCY = 8
const RANGE_REQUEST_TIMEOUT_MS = 20_000
const RANGE_TRANSIENT_ATTEMPTS = 3
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

function parseContentRange(value: string | null): ParsedContentRange | null {
  if (!value) return null
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/i.exec(value.trim())
  if (!match) return null
  const start = Number(match[1])
  const end = Number(match[2])
  const total = Number(match[3])
  if (![start, end, total].every(Number.isSafeInteger)) return null
  if (start < 0 || end < start || total <= end) return null
  return { start, end, total }
}

function concatenateChunks(chunks: Uint8Array[], totalBytes: number) {
  const bytes = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    if (!chunk) throw new Error("Research report PDF range download is missing a chunk")
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  if (offset !== totalBytes) {
    throw new Error(`Research report PDF range download length mismatch: expected ${totalBytes}, received ${offset}`)
  }
  return bytes
}

async function fetchPdfResponse(
  rawUrl: string,
  range: string,
  policy: ResearchReportPdfPolicy,
  fetchImpl: typeof fetch,
  resolveHost: (hostname: string) => Promise<string[]>,
  timeoutMs: number,
) {
  let currentUrl = rawUrl

  for (let redirectCount = 0; redirectCount <= policy.maxRedirects; redirectCount += 1) {
    const validatedUrl = await validatePdfUrl(currentUrl, policy, resolveHost)
    const response = await fetchImpl(validatedUrl, {
      method: "GET",
      headers: {
        accept: "application/pdf",
        range,
      },
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
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

    return { response, finalUrl: validatedUrl.toString() }
  }

  throw new Error("Research report PDF redirect loop exceeded policy")
}

function isRetryableRangeFailure(error: unknown) {
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error)
  return /\b(408|429|5\d\d)\b|timeout|timed out|aborterror|fetch failed|network|econnreset|enetunreach|eai_again/i.test(message)
}

function isRetryableRangeStatus(status: number) {
  return status === 408 || status === 429 || status >= 500
}

async function rangeRetryDelay(attempt: number) {
  await new Promise<void>((resolve) => setTimeout(resolve, Math.min(1_000, 250 * 2 ** Math.max(0, attempt - 1))))
}

async function fetchPdfResponseWithRetry(
  rawUrl: string,
  range: string,
  policy: ResearchReportPdfPolicy,
  fetchImpl: typeof fetch,
  resolveHost: (hostname: string) => Promise<string[]>,
) {
  const timeoutMs = Math.min(policy.timeoutMs, RANGE_REQUEST_TIMEOUT_MS)
  let lastError: unknown

  for (let attempt = 1; attempt <= RANGE_TRANSIENT_ATTEMPTS; attempt += 1) {
    try {
      const result = await fetchPdfResponse(rawUrl, range, policy, fetchImpl, resolveHost, timeoutMs)
      if (!isRetryableRangeStatus(result.response.status) || attempt === RANGE_TRANSIENT_ATTEMPTS) {
        return result
      }
      try {
        await result.response.body?.cancel()
      } catch {
        // Best-effort release before retrying the same bounded byte range.
      }
      lastError = new Error(`Research report PDF transient fetch failed (${result.response.status})`)
    } catch (error) {
      lastError = error
      if (!isRetryableRangeFailure(error) || attempt === RANGE_TRANSIENT_ATTEMPTS) throw error
    }
    await rangeRetryDelay(attempt)
  }

  throw lastError instanceof Error ? lastError : new Error("Research report PDF range fetch failed")
}

async function readExactRangeBody(response: Response, expectedBytes: number) {
  const bytes = await readBoundedBody(response, expectedBytes)
  if (bytes.byteLength !== expectedBytes) {
    throw new Error(`Research report PDF range chunk length mismatch: expected ${expectedBytes}, received ${bytes.byteLength}`)
  }
  return bytes
}

function validatePdfResult(finalUrl: string, bytes: Uint8Array, contentType: string | null): DownloadedResearchReportPdf {
  const mime = contentType?.split(";", 1)[0]?.trim().toLowerCase() || null
  if (mime !== "application/pdf" && !hasPdfSignature(bytes)) {
    throw new Error(`Research report response is not a PDF (${mime || "unknown content type"})`)
  }

  return {
    finalUrl,
    bytes,
    contentHash: createHash("sha256").update(bytes).digest("hex"),
    contentType,
    byteLength: bytes.byteLength,
  }
}

function remainingRangeSpecs(firstEnd: number, totalBytes: number): PdfRangeSpec[] {
  const specs: PdfRangeSpec[] = []
  let start = firstEnd + 1
  let index = 1
  while (start < totalBytes) {
    const end = Math.min(start + RANGE_CHUNK_BYTES - 1, totalBytes - 1)
    specs.push({ index, start, end })
    start = end + 1
    index += 1
  }
  return specs
}

export async function fetchResearchReportPdf(
  rawUrl: string,
  policy = getResearchReportPdfPolicy(),
  deps: ResearchReportPdfFetchDeps = {},
): Promise<DownloadedResearchReportPdf> {
  const fetchImpl = deps.fetchImpl || fetch
  const resolveHost = deps.resolveHost || defaultResolveHost
  const firstEnd = Math.min(RANGE_CHUNK_BYTES, policy.maxBytes) - 1
  const firstRange = `bytes=0-${firstEnd}`
  const first = await fetchPdfResponseWithRetry(rawUrl, firstRange, policy, fetchImpl, resolveHost)
  const firstResponse = first.response

  if (firstResponse.status === 200) {
    const bytes = await readBoundedBody(firstResponse, policy.maxBytes)
    return validatePdfResult(first.finalUrl, bytes, firstResponse.headers.get("content-type"))
  }
  if (firstResponse.status !== 206) {
    throw new Error(`Research report PDF fetch failed (${firstResponse.status})`)
  }

  const firstContentRange = parseContentRange(firstResponse.headers.get("content-range"))
  if (!firstContentRange) throw new Error("Research report PDF partial response has invalid Content-Range")
  if (firstContentRange.start !== 0) {
    throw new Error(`Research report PDF first range is not contiguous from byte 0: ${firstContentRange.start}`)
  }
  if (firstContentRange.total > policy.maxBytes) {
    throw new Error(`Research report PDF exceeds maximum size of ${policy.maxBytes} bytes`)
  }

  const expectedFirstEnd = Math.min(firstEnd, firstContentRange.total - 1)
  if (firstContentRange.end !== expectedFirstEnd) {
    throw new Error(`Research report PDF first range mismatch: expected end ${expectedFirstEnd}, received ${firstContentRange.end}`)
  }

  const totalBytes = firstContentRange.total
  const specs = remainingRangeSpecs(firstContentRange.end, totalBytes)
  const chunks = new Array<Uint8Array>(specs.length + 1)
  chunks[0] = await readExactRangeBody(
    firstResponse,
    firstContentRange.end - firstContentRange.start + 1,
  )

  let cursor = 0
  async function worker() {
    while (cursor < specs.length) {
      const spec = specs[cursor]
      cursor += 1
      const range = `bytes=${spec.start}-${spec.end}`
      const next = await fetchPdfResponseWithRetry(first.finalUrl, range, policy, fetchImpl, resolveHost)
      const response = next.response
      if (response.status !== 206) {
        throw new Error(`Research report PDF range request expected HTTP 206 but received ${response.status}`)
      }

      const contentRange = parseContentRange(response.headers.get("content-range"))
      if (!contentRange) throw new Error("Research report PDF partial response has invalid Content-Range")
      if (contentRange.total !== totalBytes) {
        throw new Error(`Research report PDF range total changed from ${totalBytes} to ${contentRange.total}`)
      }
      if (contentRange.start !== spec.start || contentRange.end !== spec.end) {
        throw new Error(
          `Research report PDF range is not contiguous: expected ${spec.start}-${spec.end}, received ${contentRange.start}-${contentRange.end}`,
        )
      }

      chunks[spec.index] = await readExactRangeBody(response, spec.end - spec.start + 1)
    }
  }

  const workerCount = Math.min(RANGE_MAX_CONCURRENCY, specs.length)
  await Promise.all(Array.from({ length: workerCount }, () => worker()))

  const bytes = concatenateChunks(chunks, totalBytes)
  return validatePdfResult(first.finalUrl, bytes, firstResponse.headers.get("content-type"))
}
