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

const evidence = []
for (const scriptUrl of scripts) {
  const script = await fetchText(scriptUrl)
  if (!script.ok) continue
  const text = script.text
  const lowered = text.toLowerCase()
  const anchors = [
    "changefilter:function(t){this.filterday=t},fetchdata:function",
    "fgchart",
    "sentimentlevelid",
    "getmarket",
    "marketindex",
  ]
  for (const anchor of anchors) {
    let from = 0
    for (let count = 0; count < 12; count += 1) {
      const index = lowered.indexOf(anchor, from)
      if (index < 0) break
      evidence.push({
        script: scriptUrl,
        anchor,
        snippet: text.slice(Math.max(0, index - 1600), Math.min(text.length, index + 5000)),
      })
      from = index + anchor.length
    }
  }
}

console.log(JSON.stringify({ pageStatus: page.status, scripts, evidence }, null, 2))
