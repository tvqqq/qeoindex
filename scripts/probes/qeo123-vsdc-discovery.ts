import { createHash } from "node:crypto"

const TARGETS = [
  { id: "vhm-security-detail", url: "https://vsdc.vn/vi/s-detail/6951" },
  { id: "suggestion-search-js", url: "https://vsdc.vn/js/suggestion-search.js?v=20260906" },
  { id: "site-js", url: "https://vsdc.vn/js/site.js" },
  { id: "script-js", url: "https://vsdc.vn/assets/libs/js/script.js" },
] as const

const USER_AGENT = "qeoindex-qeo123-source-validation/1.0 (+bounded-read-only-probe)"

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

function relevantHrefs(html: string) {
  return allHrefs(html)
    .filter((href) => /(?:\/(?:vi\/)?(?:ad1?|s-detail)|page|paging|pagination|search)/i.test(href))
    .slice(0, 300)
}

function contextSnippets(body: string) {
  const flattened = decodeHtmlOnce(body).replace(/\s+/g, " ")
  const needles = [
    "__VPToken",
    "RequestVerificationToken",
    "X-CSRF",
    "setRequestHeader",
    "ajaxSetup",
    "beforeSend",
    "headers:",
    "changePage_TCDK",
    "tabDetailTCPH_THQ",
    "suggestion-search/isustocks",
    "/isuisser-thq/search",
  ]
  const snippets: Record<string, string | null> = {}
  const normalized = flattened.toLocaleLowerCase("en-US")
  for (const needle of needles) {
    const index = normalized.indexOf(needle.toLocaleLowerCase("en-US"))
    snippets[needle] = index < 0 ? null : flattened.slice(Math.max(0, index - 500), Math.min(flattened.length, index + 1800))
  }
  return snippets
}

function endpointCandidates(body: string) {
  const candidates = [
    ...uniqueMatches(body, /(?:url|action)\s*:\s*["']([^"']+)["']/gi),
    ...uniqueMatches(body, /\$\.(?:get|post)\s*\(\s*["']([^"']+)["']/gi),
    ...uniqueMatches(body, /fetch\s*\(\s*["']([^"']+)["']/gi),
  ]
  return [...new Set(candidates)]
    .filter((value) => value.startsWith("/") || value.startsWith("http"))
    .slice(0, 200)
}

function cookieNames(response: Response) {
  const headersWithCookies = response.headers as Headers & { getSetCookie?: () => string[] }
  const values = typeof headersWithCookies.getSetCookie === "function"
    ? headersWithCookies.getSetCookie()
    : [response.headers.get("set-cookie") ?? ""].filter(Boolean)
  return [...new Set(values.map((value) => value.split(";", 1)[0]?.split("=", 1)[0]?.trim()).filter(Boolean))]
}

async function requestText(url: string, init: RequestInit = {}) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 20_000)
  try {
    const response = await fetch(url, {
      ...init,
      redirect: "error",
      headers: {
        accept: "text/html,application/xhtml+xml,application/json,application/javascript,text/javascript,*/*;q=0.8",
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
      setCookieNames: cookieNames(response),
      body,
    }
  } finally {
    clearTimeout(timeout)
  }
}

async function inspectGet(id: string, url: string) {
  try {
    const fetched = await requestText(url)
    return {
      id,
      url,
      status: fetched.status,
      contentType: fetched.contentType,
      bytes: fetched.bytes,
      sha256: fetched.sha256,
      setCookieNames: fetched.setCookieNames,
      vpTokenPresent: /<meta\b[^>]*name=["']__VPToken["'][^>]*content=["'][^"']+["']/i.test(fetched.body),
      eventLinks: eventHrefs(fetched.body),
      relevantHrefs: relevantHrefs(fetched.body),
      endpointCandidates: endpointCandidates(fetched.body),
      snippets: contextSnippets(fetched.body),
    }
  } catch (error) {
    return { id, url, error: error instanceof Error ? error.message : String(error) }
  }
}

async function main() {
  const results = []
  for (const target of TARGETS) {
    results.push(await inspectGet(target.id, target.url))
    await new Promise((resolve) => setTimeout(resolve, 200))
  }

  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    targets: results,
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
