import { createHash } from "node:crypto"

const VSDC_ORIGIN = "https://vsdc.vn"
const BOOTSTRAP_URL = `${VSDC_ORIGIN}/vi`
const USER_AGENT = "qeoindex-qeo123-source-validation/1.0 (+bounded-read-only-probe)"
const REQUEST_DELAY_MS = 300

type FetchResult = {
  status: number
  finalUrl: string
  contentType: string | null
  bytes: number
  sha256: string
  body: string
  setCookies: string[]
}

function decodeHtmlOnce(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&quot;/gi, '"')
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, decimal: string) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&amp;/gi, "&")
}

function stripTags(value: string) {
  return decodeHtmlOnce(value.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim()
}

function uniqueMatches(body: string, pattern: RegExp) {
  return [...new Set([...body.matchAll(pattern)].map((match) => decodeHtmlOnce(match[1] ?? "").trim()).filter(Boolean))]
}

function allHrefs(html: string) {
  return uniqueMatches(html, /\bhref\s*=\s*["']([^"']+)["']/gi)
}

function eventHrefs(html: string) {
  return allHrefs(html)
    .filter((href) => /\/(?:vi\/)?ad1?\/\d+(?:[?#].*)?$/i.test(href))
    .slice(0, 200)
}

function extractVpToken(html: string) {
  const metaTag = html.match(/<meta\b[^>]*\bname=["']__VPToken["'][^>]*>/i)?.[0]
  return metaTag?.match(/\bcontent=["']([^"']+)["']/i)?.[1] ?? null
}

function getSetCookies(response: Response) {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] }
  if (typeof headers.getSetCookie === "function") return headers.getSetCookie()
  const fallback = response.headers.get("set-cookie")
  return fallback ? [fallback] : []
}

function cookieNames(setCookies: string[]) {
  return [...new Set(setCookies
    .map((value) => value.split(";", 1)[0]?.split("=", 1)[0]?.trim())
    .filter((value): value is string => Boolean(value)))]
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function sanitizeRecord(record: Record<string, unknown>) {
  const safe: Record<string, string | number | boolean | null> = {}
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === "string") safe[key] = value.slice(0, 300)
    else if (typeof value === "number" || typeof value === "boolean" || value === null) safe[key] = value
  }
  return safe
}

function responseRows(parsed: unknown, limit = 10) {
  if (!parsed || typeof parsed !== "object") return []
  const data = (parsed as { data?: unknown }).data
  if (!Array.isArray(data)) return []
  return data
    .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object")
    .slice(0, limit)
    .map(sanitizeRecord)
}

function exactTickerSuggestion(parsed: unknown, ticker: string) {
  return responseRows(parsed, 100).find((record) => (
    typeof record.code === "string" && record.code.trim().toUpperCase() === ticker
  )) ?? null
}

function issuerNameFromSecurityName(value: unknown) {
  if (typeof value !== "string") return null
  const normalized = value
    .replace(/^(?:Cổ phiếu|Chứng chỉ quỹ|Chứng quyền có bảo đảm|Trái phiếu)\s+/i, "")
    .trim()
  return normalized || null
}

function issuerIdFromHref(value: unknown) {
  if (typeof value !== "string") return null
  return value.match(/\/(?:vi\/)?id\/(\d+)(?:[/?#]|$)/i)?.[1] ?? null
}

function exactIssuerSearch(parsed: unknown, issuerName: string) {
  const target = issuerName.toLocaleLowerCase("vi-VN")
  for (const record of responseRows(parsed, 100)) {
    const content = typeof record.content === "string" ? record.content.trim() : ""
    const href = typeof record.href === "string" ? record.href.trim() : ""
    const issuerId = issuerIdFromHref(href)
    if (issuerId && content.toLocaleLowerCase("vi-VN").includes(target)) {
      return { content: content.slice(0, 300), href: href.slice(0, 300), issuerId }
    }
  }
  return null
}

function securityIdFromIssuerHtml(html: string, ticker: string) {
  for (const match of html.matchAll(/<a\b[^>]*\bhref=["']([^"']*\/(?:vi\/)?s-detail\/(\d+)[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const anchorText = stripTags(match[3] ?? "").toUpperCase()
    if (anchorText === ticker) return match[2] ?? null
  }
  return null
}

class VsdcSession {
  private readonly cookies = new Map<string, string>()
  private vpToken: string | null = null
  private referer = BOOTSTRAP_URL

  cookieNameList() {
    return [...this.cookies.keys()].sort()
  }

  hasVpToken() {
    return Boolean(this.vpToken)
  }

  private cookieHeader() {
    return [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`).join("; ")
  }

  private updateSession(result: FetchResult) {
    for (const setCookie of result.setCookies) {
      const pair = setCookie.split(";", 1)[0]?.trim()
      const separator = pair?.indexOf("=") ?? -1
      if (!pair || separator <= 0) continue
      this.cookies.set(pair.slice(0, separator), pair.slice(separator + 1))
    }
    const token = extractVpToken(result.body)
    if (token) this.vpToken = token
    this.referer = result.finalUrl
  }

  async request(url: string, init: RequestInit = {}, ajax = false): Promise<FetchResult> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 20_000)
    try {
      const headers: Record<string, string> = {
        accept: "text/html,application/xhtml+xml,application/json,*/*;q=0.8",
        "user-agent": USER_AGENT,
        ...(init.headers as Record<string, string> | undefined ?? {}),
      }
      const cookie = this.cookieHeader()
      if (cookie) headers.cookie = cookie
      if (ajax) {
        if (!this.vpToken) throw new Error("VSDC AJAX attempted without __VPToken")
        headers.__VPToken = this.vpToken
        headers.referer = this.referer
        headers["x-requested-with"] = "XMLHttpRequest"
      }

      const response = await fetch(url, { ...init, redirect: "follow", headers, signal: controller.signal })
      const body = await response.text()
      const result: FetchResult = {
        status: response.status,
        finalUrl: response.url,
        contentType: response.headers.get("content-type"),
        bytes: Buffer.byteLength(body),
        sha256: createHash("sha256").update(body).digest("hex"),
        body,
        setCookies: getSetCookies(response),
      }
      this.updateSession(result)
      return result
    } finally {
      clearTimeout(timeout)
    }
  }
}

async function parseJson(result: FetchResult) {
  try { return JSON.parse(result.body) as unknown } catch { return null }
}

async function main() {
  const session = new VsdcSession()
  const bootstrap = await session.request(BOOTSTRAP_URL)
  if (bootstrap.status !== 200 || !session.hasVpToken() || !session.cookieNameList().includes("__VPToken")) {
    throw new Error(`VSDC generic bootstrap failed closed: status=${bootstrap.status}`)
  }

  await delay(REQUEST_DELAY_MS)
  const suggestion = await session.request(`${VSDC_ORIGIN}/suggestion-search/isustocks`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded; charset=UTF-8" },
    body: new URLSearchParams({ keyword: "VHM", issuerOrgId: "" }).toString(),
  }, true)
  const suggestionJson = await parseJson(suggestion)
  const exactSuggestion = exactTickerSuggestion(suggestionJson, "VHM")
  const issuerName = issuerNameFromSecurityName(exactSuggestion?.name)

  if (suggestion.status !== 200 || !exactSuggestion || !issuerName) {
    console.log(JSON.stringify({ suggestionStatus: suggestion.status, suggestionRows: responseRows(suggestionJson) }, null, 2))
    throw new Error("VSDC exact VHM autocomplete failed closed")
  }

  await delay(REQUEST_DELAY_MS)
  const issuerSearch = await session.request(`${VSDC_ORIGIN}/search-suggest`, {
    method: "POST",
    headers: { "content-type": "application/json;charset=utf-8" },
    body: JSON.stringify({ text: issuerName, type: "1" }),
  }, true)
  const issuerSearchJson = await parseJson(issuerSearch)
  const exactIssuer = exactIssuerSearch(issuerSearchJson, issuerName)

  if (issuerSearch.status !== 200 || !exactIssuer) {
    console.log(JSON.stringify({ issuerName, issuerSearchStatus: issuerSearch.status, issuerRows: responseRows(issuerSearchJson) }, null, 2))
    throw new Error("VSDC issuer search failed closed")
  }

  await delay(REQUEST_DELAY_MS)
  const issuerPage = await session.request(new URL(exactIssuer.href, VSDC_ORIGIN).toString())
  const securityId = securityIdFromIssuerHtml(issuerPage.body, "VHM")
  if (issuerPage.status !== 200 || !securityId) {
    throw new Error(`VSDC issuer-to-security lookup failed closed: status=${issuerPage.status}`)
  }

  await delay(REQUEST_DELAY_MS)
  const securityUrl = `${VSDC_ORIGIN}/vi/s-detail/${securityId}`
  const securityPage = await session.request(securityUrl)
  const securityText = stripTags(securityPage.body)
  const securityVerified = securityPage.status === 200
    && securityText.includes("Mã chứng khoán: VHM")
    && securityText.includes("Mã ISIN: VN000000VHM0")
  if (!securityVerified) {
    throw new Error(`VSDC security detail verification failed closed: status=${securityPage.status}`)
  }

  const rightsPages = []
  for (const page of [1, 2]) {
    await delay(REQUEST_DELAY_MS)
    const fetched = await session.request(`${VSDC_ORIGIN}/isuisser-thq/search`, {
      method: "POST",
      headers: { "content-type": "application/json;charset=utf-8" },
      body: JSON.stringify({ SearchKey: securityId, CurrentPage: page, RecordOnPage: 10 }),
    }, true)
    const links = eventHrefs(fetched.body)
    if (fetched.status !== 200 || links.length === 0) {
      throw new Error(`VSDC rights pagination failed closed: page=${page} status=${fetched.status}`)
    }
    rightsPages.push({ page, status: fetched.status, bytes: fetched.bytes, sha256: fetched.sha256, eventLinks: links })
  }

  const pageOne = new Set(rightsPages[0].eventLinks)
  if (!rightsPages[1].eventLinks.some((href) => !pageOne.has(href))) {
    throw new Error("VSDC rights pagination did not advance to distinct events")
  }

  if (securityId !== "6951") {
    throw new Error(`VHM security-id regression: expected 6951, got ${securityId}`)
  }

  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    gate: "PASS",
    bootstrap: {
      status: bootstrap.status,
      finalUrl: bootstrap.finalUrl,
      cookieNames: session.cookieNameList(),
      vpTokenPresent: session.hasVpToken(),
    },
    tickerDiscovery: {
      suggestionStatus: suggestion.status,
      exactSuggestion,
      issuerName,
      issuerSearchStatus: issuerSearch.status,
      exactIssuer,
      issuerPageStatus: issuerPage.status,
      securityId,
      securityUrl,
      securityPageStatus: securityPage.status,
    },
    rightsPages,
  }, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
