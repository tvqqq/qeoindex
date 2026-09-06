import { createHash } from "node:crypto"

const TARGETS = [
  { id: "vhm-security-detail", url: "https://vsdc.vn/vi/s-detail/6951" },
  { id: "rights-calendar", url: "https://vsdc.vn/vi/lich-giao-dich" },
] as const

const USER_AGENT = "qeoindex-qeo123-source-validation/1.0 (+bounded-read-only-probe)"

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

function relevantHrefs(html: string) {
  return uniqueMatches(html, /\bhref\s*=\s*["']([^"']+)["']/gi)
    .filter((href) => /(?:\/vi\/(?:ad1?|s-detail|lich-giao-dich)|page|paging|pagination|search)/i.test(href))
    .slice(0, 200)
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
  return uniqueMatches(html, /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)
    .filter((src) => /(?:detail|security|calendar|lich|search|paging|page|main|site|app)/i.test(src))
    .slice(0, 100)
}

function contextSnippets(html: string) {
  const flattened = decodeHtmlOnce(html).replace(/\s+/g, " ")
  const needles = [
    "Xem thêm",
    "pagination",
    "paging",
    "pageIndex",
    "pageSize",
    "Tin tức và sự kiện liên quan",
    "Ngày đăng ký cuối cùng",
    "Mã/Tên Chứng khoán",
    "__RequestVerificationToken",
    "__VPToken",
  ]
  const snippets: Record<string, string | null> = {}
  for (const needle of needles) {
    const index = flattened.toLocaleLowerCase("vi-VN").indexOf(needle.toLocaleLowerCase("vi-VN"))
    snippets[needle] = index < 0 ? null : flattened.slice(Math.max(0, index - 220), Math.min(flattened.length, index + 520))
  }
  return snippets
}

async function fetchText(url: string) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 20_000)
  try {
    const response = await fetch(url, {
      redirect: "error",
      headers: {
        accept: "text/html,application/xhtml+xml",
        "user-agent": USER_AGENT,
      },
      signal: controller.signal,
    })
    const text = await response.text()
    return {
      status: response.status,
      contentType: response.headers.get("content-type"),
      bytes: Buffer.byteLength(text),
      sha256: createHash("sha256").update(text).digest("hex"),
      html: text,
    }
  } finally {
    clearTimeout(timeout)
  }
}

const results = []
for (const target of TARGETS) {
  try {
    const fetched = await fetchText(target.url)
    results.push({
      id: target.id,
      url: target.url,
      status: fetched.status,
      contentType: fetched.contentType,
      bytes: fetched.bytes,
      sha256: fetched.sha256,
      eventLinks: relevantHrefs(fetched.html).filter((href) => /\/vi\/ad1?\//i.test(href)),
      relevantHrefs: relevantHrefs(fetched.html),
      forms: formMetadata(fetched.html),
      scripts: scriptSources(fetched.html),
      snippets: contextSnippets(fetched.html),
    })
  } catch (error) {
    results.push({
      id: target.id,
      url: target.url,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

console.log(JSON.stringify({
  generatedAt: new Date().toISOString(),
  targets: results,
}, null, 2))
