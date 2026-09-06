const VSDC_ORIGIN = "https://vsdc.vn"
const VSDC_BOOTSTRAP_URL = `${VSDC_ORIGIN}/vi`
const TICKER = /^[A-Z0-9]{2,12}$/
const NUMERIC_ID = /^\d+$/
const DEFAULT_DELAY_MS = 300
const DEFAULT_MAX_PAGES = 20
const RECORDS_PER_PAGE = 10
const USER_AGENT = "qeoindex-corporate-actions/1.0"

type PrimitiveRecord = Record<string, unknown>

export type VsdcSecuritySuggestion = {
  ticker: string
  securityName: string
  issuerName: string
}

export type VsdcIssuerSearchResult = {
  issuerId: string
  href: string
}

export type VsdcRightsPage = {
  eventIds: string[]
  maxPage: number
}

export type VsdcCorporateActionDiscovery = {
  ticker: string
  issuerId: string
  securityId: string
  securityUrl: string
  eventIds: string[]
}

export type VsdcDiscoveryOptions = {
  fetchImpl?: typeof fetch
  requestDelayMs?: number
  maxPages?: number
}

function normalizedTicker(value: string) {
  const ticker = value.trim().toUpperCase()
  if (!TICKER.test(ticker)) throw new Error("Invalid VSDC ticker")
  return ticker
}

function decodeHtmlOnce(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&quot;/gi, '"')
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, decimal: string) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&")
}

function stripTags(value: string) {
  return decodeHtmlOnce(value.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim()
}

function payloadRows(payload: unknown) {
  if (!payload || typeof payload !== "object") return []
  const data = (payload as { data?: unknown }).data
  if (!Array.isArray(data)) return []
  return data.filter((row): row is PrimitiveRecord => Boolean(row) && typeof row === "object")
}

function issuerNameFromSecurityName(value: string) {
  return value
    .replace(/^(?:Cổ phiếu|Chứng chỉ quỹ|Chứng quyền có bảo đảm|Trái phiếu)\s+/i, "")
    .trim()
}

export function parseExactVsdcSecuritySuggestion(payload: unknown, tickerInput: string): VsdcSecuritySuggestion | null {
  const ticker = normalizedTicker(tickerInput)
  const exact = payloadRows(payload).filter((row) => (
    typeof row.code === "string" && row.code.trim().toUpperCase() === ticker
  ))
  if (exact.length > 1) throw new Error(`Ambiguous VSDC ticker suggestion: ${ticker}`)
  const row = exact[0]
  if (!row || typeof row.name !== "string") return null
  const securityName = row.name.trim()
  const issuerName = issuerNameFromSecurityName(securityName)
  if (!securityName || !issuerName) return null
  return { ticker, securityName, issuerName }
}

function issuerIdFromHref(value: string) {
  return value.match(/^\/(?:vi\/)?id\/(\d+)(?:[/?#].*)?$/i)?.[1] ?? null
}

export function parseExactVsdcIssuerSearch(payload: unknown, issuerNameInput: string): VsdcIssuerSearchResult | null {
  const issuerName = issuerNameInput.trim()
  if (!issuerName) throw new Error("Missing VSDC issuer name")
  const target = issuerName.toLocaleLowerCase("vi-VN")
  const matches: VsdcIssuerSearchResult[] = []

  for (const row of payloadRows(payload)) {
    const content = typeof row.content === "string" ? row.content.trim() : ""
    const href = typeof row.href === "string" ? row.href.trim() : ""
    const issuerId = issuerIdFromHref(href)
    if (issuerId && content.toLocaleLowerCase("vi-VN").includes(target)) matches.push({ issuerId, href })
  }

  const unique = [...new Map(matches.map((match) => [match.issuerId, match])).values()]
  if (unique.length > 1) throw new Error(`Ambiguous VSDC issuer search: ${issuerName}`)
  return unique[0] ?? null
}

export function parseVsdcSecurityIdForTicker(html: string, tickerInput: string) {
  const ticker = normalizedTicker(tickerInput)
  const matches = new Set<string>()
  for (const match of html.matchAll(/<a\b[^>]*\bhref=["']([^"']*\/(?:vi\/)?s-detail\/(\d+)[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const id = match[2]
    const anchorText = stripTags(match[3] ?? "").toUpperCase()
    if (id && NUMERIC_ID.test(id) && anchorText === ticker) matches.add(id)
  }
  if (matches.size > 1) throw new Error(`Ambiguous VSDC security detail: ${ticker}`)
  return [...matches][0] ?? null
}

export function parseVsdcRightsPage(html: string): VsdcRightsPage {
  const eventIds: string[] = []
  const seen = new Set<string>()
  for (const match of html.matchAll(/\bhref\s*=\s*["']\/?(?:vi\/)?ad1?\/(\d+)(?:[?#][^"']*)?["']/gi)) {
    const id = match[1]
    if (!id || seen.has(id)) continue
    seen.add(id)
    eventIds.push(id)
  }

  let maxPage = 1
  for (const match of html.matchAll(/changePage_THQ\(\s*(\d+)\s*\)/gi)) {
    const page = Number(match[1])
    if (Number.isSafeInteger(page) && page > maxPage) maxPage = page
  }
  return { eventIds, maxPage }
}

function extractVpToken(html: string) {
  const tag = html.match(/<meta\b[^>]*\bname=["']__VPToken["'][^>]*>/i)?.[0]
  return tag?.match(/\bcontent=["']([^"']+)["']/i)?.[1] ?? null
}

function responseSetCookies(response: Response) {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] }
  if (typeof headers.getSetCookie === "function") return headers.getSetCookie()
  const fallback = response.headers.get("set-cookie")
  return fallback ? [fallback] : []
}

function delay(ms: number) {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve()
}

function parseJson(text: string) {
  try { return JSON.parse(text) as unknown } catch { return null }
}

class VsdcBrowserSession {
  private readonly cookies = new Map<string, string>()
  private readonly fetchImpl: typeof fetch
  private vpToken: string | null = null
  private referer = VSDC_BOOTSTRAP_URL

  constructor(fetchImpl: typeof fetch) {
    this.fetchImpl = fetchImpl
  }

  isReady() {
    return Boolean(this.vpToken && this.cookies.has("__VPToken"))
  }

  private cookieHeader() {
    return [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`).join("; ")
  }

  private updateCookies(response: Response) {
    for (const raw of responseSetCookies(response)) {
      const pair = raw.split(";", 1)[0]?.trim()
      const separator = pair?.indexOf("=") ?? -1
      if (!pair || separator <= 0) continue
      this.cookies.set(pair.slice(0, separator), pair.slice(separator + 1))
    }
  }

  async request(url: string, init: RequestInit = {}, ajax = false) {
    if (!url.startsWith(`${VSDC_ORIGIN}/`)) throw new Error("VSDC discovery rejected non-canonical origin")
    const headers = new Headers(init.headers)
    headers.set("accept", "text/html,application/xhtml+xml,application/json,*/*;q=0.8")
    headers.set("user-agent", USER_AGENT)
    const cookie = this.cookieHeader()
    if (cookie) headers.set("cookie", cookie)
    if (ajax) {
      if (!this.vpToken) throw new Error("VSDC discovery AJAX missing __VPToken")
      headers.set("__VPToken", this.vpToken)
      headers.set("referer", this.referer)
      headers.set("x-requested-with", "XMLHttpRequest")
    }

    const response = await this.fetchImpl(url, { ...init, headers, redirect: "follow" })
    const text = await response.text()
    this.updateCookies(response)
    const token = extractVpToken(text)
    if (token) this.vpToken = token
    if (!ajax && response.url) this.referer = response.url
    return { response, text }
  }
}

function verifySecurityPage(html: string, ticker: string) {
  const text = stripTags(html)
  return text.includes(`Mã chứng khoán: ${ticker}`)
}

export async function discoverVsdcCorporateActionEvents(
  tickerInput: string,
  options: VsdcDiscoveryOptions = {},
): Promise<VsdcCorporateActionDiscovery> {
  const ticker = normalizedTicker(tickerInput)
  const fetchImpl = options.fetchImpl ?? fetch
  const requestDelayMs = options.requestDelayMs ?? DEFAULT_DELAY_MS
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES
  if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > DEFAULT_MAX_PAGES) {
    throw new Error(`Invalid VSDC discovery maxPages: ${maxPages}`)
  }
  if (!Number.isFinite(requestDelayMs) || requestDelayMs < 0) throw new Error("Invalid VSDC discovery request delay")

  const session = new VsdcBrowserSession(fetchImpl)
  const bootstrap = await session.request(VSDC_BOOTSTRAP_URL)
  if (!bootstrap.response.ok || !session.isReady()) throw new Error("VSDC discovery bootstrap failed closed")

  await delay(requestDelayMs)
  const suggestionResponse = await session.request(`${VSDC_ORIGIN}/suggestion-search/isustocks`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded; charset=UTF-8" },
    body: new URLSearchParams({ keyword: ticker, issuerOrgId: "" }).toString(),
  }, true)
  if (!suggestionResponse.response.ok) throw new Error(`VSDC ticker suggestion HTTP ${suggestionResponse.response.status}`)
  const suggestion = parseExactVsdcSecuritySuggestion(parseJson(suggestionResponse.text), ticker)
  if (!suggestion) throw new Error(`VSDC exact ticker not found: ${ticker}`)

  await delay(requestDelayMs)
  const issuerSearchResponse = await session.request(`${VSDC_ORIGIN}/search-suggest`, {
    method: "POST",
    headers: { "content-type": "application/json;charset=utf-8" },
    body: JSON.stringify({ text: suggestion.issuerName, type: "1" }),
  }, true)
  if (!issuerSearchResponse.response.ok) throw new Error(`VSDC issuer search HTTP ${issuerSearchResponse.response.status}`)
  const issuer = parseExactVsdcIssuerSearch(parseJson(issuerSearchResponse.text), suggestion.issuerName)
  if (!issuer) throw new Error(`VSDC issuer not found: ${suggestion.issuerName}`)

  await delay(requestDelayMs)
  const issuerUrl = new URL(issuer.href, VSDC_ORIGIN)
  if (issuerUrl.origin !== VSDC_ORIGIN || !/^\/vi\/id\/\d+$/.test(issuerUrl.pathname)) {
    throw new Error("VSDC issuer search returned unsafe href")
  }
  const issuerPage = await session.request(issuerUrl.toString())
  if (!issuerPage.response.ok) throw new Error(`VSDC issuer page HTTP ${issuerPage.response.status}`)
  const securityId = parseVsdcSecurityIdForTicker(issuerPage.text, ticker)
  if (!securityId) throw new Error(`VSDC security detail not found: ${ticker}`)

  await delay(requestDelayMs)
  const securityUrl = `${VSDC_ORIGIN}/vi/s-detail/${securityId}`
  const securityPage = await session.request(securityUrl)
  if (!securityPage.response.ok || !verifySecurityPage(securityPage.text, ticker)) {
    throw new Error(`VSDC security detail verification failed: ${ticker}`)
  }

  const eventIds: string[] = []
  const seenEvents = new Set<string>()
  let discoveredMaxPage: number | null = null

  for (let page = 1; page <= (discoveredMaxPage ?? 1); page += 1) {
    await delay(requestDelayMs)
    const rightsResponse = await session.request(`${VSDC_ORIGIN}/isuisser-thq/search`, {
      method: "POST",
      headers: { "content-type": "application/json;charset=utf-8" },
      body: JSON.stringify({ SearchKey: securityId, CurrentPage: page, RecordOnPage: RECORDS_PER_PAGE }),
    }, true)
    if (!rightsResponse.response.ok) throw new Error(`VSDC rights page HTTP ${rightsResponse.response.status}`)
    const parsed = parseVsdcRightsPage(rightsResponse.text)
    if (page === 1) {
      discoveredMaxPage = parsed.maxPage
      if (discoveredMaxPage > maxPages) {
        throw new Error(`VSDC rights pagination exceeds bound: ${discoveredMaxPage} > ${maxPages}`)
      }
    }
    for (const eventId of parsed.eventIds) {
      if (!seenEvents.has(eventId)) {
        seenEvents.add(eventId)
        eventIds.push(eventId)
      }
    }
  }

  if (eventIds.length === 0) throw new Error(`VSDC rights discovery returned no events: ${ticker}`)

  return {
    ticker,
    issuerId: issuer.issuerId,
    securityId,
    securityUrl,
    eventIds,
  }
}
