const PAGE_URL = "https://online.topi.vn/market/chi-so-thi-truong-topi?type=vn-index"

function absoluteUrl(base, candidate) {
  try { return new URL(candidate, base).toString() } catch { return null }
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      accept: "text/html,application/javascript,application/json;q=0.9,*/*;q=0.8",
      "user-agent": "Mozilla/5.0 (compatible; QeoIndex-QEO-134-probe/1.0)",
    },
    signal: AbortSignal.timeout(15_000),
  })
  return { status: response.status, ok: response.ok, text: await response.text() }
}

const page = await fetchText(PAGE_URL)
if (!page.ok) throw new Error(`TOPI page failed: ${page.status}`)

const scripts = [...page.text.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)]
  .map((match) => absoluteUrl(PAGE_URL, match[1]))
  .filter(Boolean)

const discovered = new Set()
const context = []
for (const scriptUrl of scripts) {
  const script = await fetchText(scriptUrl)
  if (!script.ok) continue
  for (const match of script.text.matchAll(/https?:\/\/apiclient\.topi\.vn\/api-web\/[A-Za-z0-9_?=&./-]+|\/api-web\/[A-Za-z0-9_?=&./-]+/g)) {
    discovered.add(match[0])
  }
  const lowered = script.text.toLowerCase()
  for (const needle of ["vn-index", "fear", "greed", "tamly", "tâm lý", "marketindex", "market-index"]) {
    let from = 0
    for (let count = 0; count < 5; count += 1) {
      const index = lowered.indexOf(needle, from)
      if (index < 0) break
      context.push({
        script: scriptUrl,
        needle,
        snippet: script.text.slice(Math.max(0, index - 240), Math.min(script.text.length, index + 420)),
      })
      from = index + needle.length
    }
  }
}

console.log(JSON.stringify({
  pageStatus: page.status,
  scriptCount: scripts.length,
  scripts,
  endpoints: [...discovered],
  context,
}, null, 2))
