import { createHash } from "node:crypto"

const TARGETS = [
  { id: "vhm-security-detail", url: "https://vsdc.vn/vi/s-detail/6951" },
  { id: "suggestion-search-js", url: "https://vsdc.vn/js/suggestion-search.js?v=20260906" },
] as const

const USER_AGENT = "qeoindex-qeo123-source-validation/1.0 (+bounded-read-only-probe)"
const VSDC_ORIGIN = "https://vsdc.vn"

function decodeHtmlOnce(value: string) {
  return value
    .replace(/&quot;/gi, '"')
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, decimal: string) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&amp;/gi, "&")
}

function uniqueMatches(html: string, pattern: RegExp) {
  return [...new Set([...html.matchAll(pattern)].map((match) => decodeHtmlOnce(match[1] ?? "").trim()).filter(Boolean))]
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

function formMetadata(html: string) {
  return [...html.matchAll(/<form\b([^>]*)>/gi)].slice(0, 20).map((match) => {
    const attrs = match[1] ?? ""
    const action = attrs.match(/\baction\s*=\s*["']([^"']*)["']/i)?.[1] ?? null
    const method = attrs.match(/\bmethod\s*=\s*["']([^"']*)["']/i)?.[1] ?? null
    const id = attrs.match(/\bid\s*=\s*["']([^"']*)["']/i)?.[1] ?? null
    return { action: action ? decodeHtmlOnce(action) : null, method, id }
  })
}

function scriptSources(html: string) {
  return uniqueMatches(html, /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi).slice(0, 200)
}

function contextSnippets(body: string) {
  const flattened = decodeHtmlOnce(body).replace(/\s+/g, " ")
  const needles = [
    "changePage_TCDK",
    "tabDetailTCPH_THQ",
    "divlistArticlesTCPH_THQ",
    "suggestion",
    "autocomplete",
    "ajax",
    "url:",
    "paging",
    "Ngày đăng ký cuối cùng",
    "__VPToken",
  ]
  const snippets: Record<string, string | null> = {}
  for (const needle of needles) {
    const index = flattened.toLocaleLowerCase("vi-VN").indexOf(needle.toLocaleLowerCase("vi-VN"))
    snippets[needle] = index < 0 ? null : flattened.slice(Math.max(0, index - 450), Math.min(flattened.length, index + 1200))
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
      eventLinks: eventHrefs(fetched.body),
      relevantHrefs: relevantHrefs(fetched.body),
      forms: formMetadata(fetched.body),
      scripts: scriptSources(fetched.body),
      endpointCandidates: endpointCandidates(fetched.body),
      snippets: contextSnippets(fetched.body),
    }
  } catch (error) {
    return { id, url, error: error instanceof Error ? error.message : String(error) }
  }
}

async function inspectSuggestion() {
  const url = `${VSDC_ORIGIN}/suggestion-search/isustocks`
  try {
    const fetched = await requestText(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded; charset=UTF-8" },
      body: new URLSearchParams({ keyword: "VHM", issuerOrgId: "" }).toString(),
    })
    let parsed: unknown = null
    try {
      parsed = JSON.parse(fetched.body)
    } catch {
      parsed = null
    }
    return {
      id: "vhm-ticker-suggestion",
      url,
      status: fetched.status,
      contentType: fetched.contentType,
      bytes: fetched.bytes,
      sha256: fetched.sha256,
      json: parsed,
      preview: parsed ? null : fetched.body.slice(0, 2000),
    }
  } catch (error) {
    return { id: "vhm-ticker-suggestion", url, error: error instanceof Error ? error.message : String(error) }
  }
}

async function inspectRightsPage(page: number) {
  const url = `${VSDC_ORIGIN}/isuisser-thq/search`
  try {
    const fetched = await requestText(url, {
      method: "POST",
      headers: { "content-type": "application/json;charset=utf-8" },
      body: JSON.stringify({ SearchKey: "6951", CurrentPage: page, RecordOnPage: 10 }),
    })
    return {
      id: `vhm-rights-page-${page}`,
      url,
      status: fetched.status,
      contentType: fetched.contentType,
      bytes: fetched.bytes,
      sha256: fetched.sha256,
      eventLinks: eventHrefs(fetched.body),
      preview: decodeHtmlOnce(fetched.body).replace(/\s+/g, " ").slice(0, 3000),
    }
  } catch (error) {
    return { id: `vhm-rights-page-${page}`, url, error: error instanceof Error ? error.message : String(error) }
  }
}

async function main() {
  const gets = await Promise.all(TARGETS.map((target) => inspectGet(target.id, target.url)))
  const suggestion = await inspectSuggestion()
  const rightsPages = []
  for (const page of [1, 2]) {
    rightsPages.push(await inspectRightsPage(page))
    if (page === 1) await new Promise((resolve) => setTimeout(resolve, 300))
  }

  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    targets: [...gets, suggestion, ...rightsPages],
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
