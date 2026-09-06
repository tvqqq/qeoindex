import { createHash } from "node:crypto"

const VSDC_ORIGIN = "https://vsdc.vn"
const VHM_DETAIL_URL = `${VSDC_ORIGIN}/vi/s-detail/6951`
const USER_AGENT = "qeoindex-qeo123-source-validation/1.0 (+bounded-read-only-probe)"
const REQUEST_DELAY_MS = 300

type FetchResult = {
  status: number
  contentType: string | null
  bytes: number
  sha256: string
  body: string
  setCookies: string[]
}

function decodeHtmlOnce(value: string) {
  return value
    .replace(/&quot;/gi, '"')
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, decimal: string) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&amp;/gi, "&")
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

function cookieHeader(setCookies: string[]) {
  return setCookies
    .map((value) => value.split(";", 1)[0]?.trim())
    .filter(Boolean)
    .join("; ")
}

function cookieNames(setCookies: string[]) {
  return [...new Set(setCookies
    .map((value) => value.split(";", 1)[0]?.split("=", 1)[0]?.trim())
    .filter((value): value is string => Boolean(value)))]
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function requestText(url: string, init: RequestInit = {}): Promise<FetchResult> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 20_000)
  try {
    const response = await fetch(url, {
      ...init,
      redirect: "error",
      headers: {
        accept: "text/html,application/xhtml+xml,application/json,*/*;q=0.8",
        "user-agent": USER_AGENT,
        ...(init.headers ?? {}),
      },
      signal: controller.signal,
    })
    const body = await response.text()
    return {
      status: response.status,
      contentType: response.headers.get("content-type"),
      bytes: Buffer.byteLength(body),
      sha256: createHash("sha256").update(body).digest("hex"),
      body,
      setCookies: getSetCookies(response),
    }
  } finally {
    clearTimeout(timeout)
  }
}

function exactVhmSuggestion(parsed: unknown) {
  if (!parsed || typeof parsed !== "object") return null
  const data = (parsed as { data?: unknown }).data
  if (!Array.isArray(data)) return null
  for (const row of data) {
    if (!row || typeof row !== "object") continue
    const record = row as Record<string, unknown>
    const name = typeof record.name === "string" ? record.name.trim().toUpperCase() : ""
    const content = typeof record.content === "string" ? record.content.trim() : ""
    if (name === "VHM" || /^VHM\b/i.test(content)) {
      const safe: Record<string, string | number | boolean | null> = {}
      for (const [key, value] of Object.entries(record)) {
        if (typeof value === "string") safe[key] = value.slice(0, 300)
        else if (typeof value === "number" || typeof value === "boolean" || value === null) safe[key] = value
      }
      return safe
    }
  }
  return null
}

function hrefSecurityId(value: unknown) {
  if (typeof value !== "string") return null
  return value.match(/\/(?:vi\/)?s-detail\/(\d+)(?:[/?#]|$)/i)?.[1] ?? null
}

function exactVhmGlobalSearch(parsed: unknown) {
  if (!parsed || typeof parsed !== "object") return null
  const data = (parsed as { data?: unknown }).data
  if (!Array.isArray(data)) return null
  for (const row of data) {
    if (!row || typeof row !== "object") continue
    const record = row as Record<string, unknown>
    const content = typeof record.content === "string" ? record.content.trim() : ""
    const href = typeof record.href === "string" ? record.href.trim() : ""
    const securityId = hrefSecurityId(href)
    if (/\bVHM\b/i.test(content) && securityId) {
      return {
        content: content.slice(0, 300),
        href: href.slice(0, 300),
        securityId,
      }
    }
  }
  return null
}

async function main() {
  const bootstrap = await requestText(VHM_DETAIL_URL)
  const vpToken = extractVpToken(bootstrap.body)
  const cookies = cookieHeader(bootstrap.setCookies)
  const bootstrapEventLinks = eventHrefs(bootstrap.body)

  if (bootstrap.status !== 200 || !vpToken || !cookies || bootstrapEventLinks.length === 0) {
    throw new Error("VSDC discovery bootstrap failed closed")
  }

  const sessionHeaders = {
    "__VPToken": vpToken,
    cookie: cookies,
    referer: VHM_DETAIL_URL,
    "x-requested-with": "XMLHttpRequest",
  }

  await delay(REQUEST_DELAY_MS)
  const suggestion = await requestText(`${VSDC_ORIGIN}/suggestion-search/isustocks`, {
    method: "POST",
    headers: {
      ...sessionHeaders,
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
    },
    body: new URLSearchParams({ keyword: "VHM", issuerOrgId: "" }).toString(),
  })
  let suggestionJson: unknown = null
  try { suggestionJson = JSON.parse(suggestion.body) } catch { suggestionJson = null }
  const exactSuggestion = exactVhmSuggestion(suggestionJson)

  await delay(REQUEST_DELAY_MS)
  const globalSearch = await requestText(`${VSDC_ORIGIN}/search-suggest`, {
    method: "POST",
    headers: {
      ...sessionHeaders,
      "content-type": "application/json;charset=utf-8",
    },
    body: JSON.stringify({ text: "VHM", type: "1" }),
  })
  let globalSearchJson: unknown = null
  try { globalSearchJson = JSON.parse(globalSearch.body) } catch { globalSearchJson = null }
  const exactGlobal = exactVhmGlobalSearch(globalSearchJson)
  const resolvedSecurityId = exactGlobal?.securityId ?? null

  if (suggestion.status !== 200 || !exactSuggestion) {
    throw new Error(`VSDC ticker suggestion failed closed: status=${suggestion.status}`)
  }
  if (globalSearch.status !== 200 || !exactGlobal || resolvedSecurityId !== "6951") {
    throw new Error(`VSDC ticker-to-security discovery failed closed: status=${globalSearch.status} id=${resolvedSecurityId ?? "missing"}`)
  }

  const rightsPages = []
  for (const page of [1, 2]) {
    await delay(REQUEST_DELAY_MS)
    const fetched = await requestText(`${VSDC_ORIGIN}/isuisser-thq/search`, {
      method: "POST",
      headers: {
        ...sessionHeaders,
        "content-type": "application/json;charset=utf-8",
      },
      body: JSON.stringify({ SearchKey: resolvedSecurityId, CurrentPage: page, RecordOnPage: 10 }),
    })
    const links = eventHrefs(fetched.body)
    if (fetched.status !== 200 || links.length === 0) {
      throw new Error(`VSDC rights pagination failed closed: page=${page} status=${fetched.status}`)
    }
    rightsPages.push({
      page,
      status: fetched.status,
      contentType: fetched.contentType,
      bytes: fetched.bytes,
      sha256: fetched.sha256,
      eventLinks: links,
    })
  }

  const pageOneIds = new Set(rightsPages[0].eventLinks)
  const pageTwoHasNewEvent = rightsPages[1].eventLinks.some((href) => !pageOneIds.has(href))
  if (!pageTwoHasNewEvent) {
    throw new Error("VSDC rights pagination did not advance to distinct events")
  }

  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    gate: "PASS",
    bootstrap: {
      url: VHM_DETAIL_URL,
      status: bootstrap.status,
      contentType: bootstrap.contentType,
      bytes: bootstrap.bytes,
      sha256: bootstrap.sha256,
      setCookieNames: cookieNames(bootstrap.setCookies),
      vpTokenPresent: Boolean(vpToken),
      eventLinkCount: bootstrapEventLinks.length,
    },
    tickerDiscovery: {
      suggestionStatus: suggestion.status,
      exactSuggestion,
      globalSearchStatus: globalSearch.status,
      exactGlobal,
      resolvedSecurityId,
    },
    rightsPages,
  }, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
