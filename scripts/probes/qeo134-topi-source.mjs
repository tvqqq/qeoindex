const PAGE_URL = "https://online.topi.vn/market/chi-so-thi-truong-topi?type=vn-index"
const API_BASE = "https://apiclient.topi.vn/api-web"

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

async function postJson(path, body) {
  const response = await fetch(`${API_BASE}/${path}`, {
    method: "POST",
    headers: {
      accept: "application/json, text/plain, */*",
      "content-type": "application/json",
      "user-agent": "Mozilla/5.0 (compatible; QeoIndex-QEO-134-probe/1.0)",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  })
  const text = await response.text()
  let json = null
  try { json = JSON.parse(text) } catch {}
  return { status: response.status, ok: response.ok, json, text: json ? undefined : text.slice(0, 600) }
}

const page = await fetchText(PAGE_URL)
if (!page.ok) throw new Error(`TOPI page failed: ${page.status}`)

const scripts = [...page.text.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)]
  .map((match) => absoluteUrl(PAGE_URL, match[1]))
  .filter(Boolean)

const filterEvidence = []
for (const scriptUrl of scripts) {
  const script = await fetchText(scriptUrl)
  if (!script.ok) continue
  const text = script.text
  const lowered = text.toLowerCase()
  for (const anchor of ["1 tháng", "3 tháng", "6 tháng", "12 tháng", "toàn bộ", "filter-day-assets"]) {
    let from = 0
    for (let count = 0; count < 4; count += 1) {
      const index = lowered.indexOf(anchor, from)
      if (index < 0) break
      filterEvidence.push({
        script: scriptUrl,
        anchor,
        snippet: text.slice(Math.max(0, index - 900), Math.min(text.length, index + 1800)),
      })
      from = index + anchor.length
    }
  }
}

const current = await postJson("GetFGIndex", { Target: 0 })
const history30 = await postJson("GetFGChart", { Target: 0, Days: 30 })

function summarizeCurrent(result) {
  const payload = result.json
  return {
    status: result.status,
    ok: result.ok,
    code: payload?.Code ?? payload?.code ?? null,
    data: payload?.Data ?? payload?.data ?? null,
    raw: result.text,
  }
}

function summarizeHistory(result) {
  const payload = result.json
  const data = payload?.Data ?? payload?.data
  return {
    status: result.status,
    ok: result.ok,
    code: payload?.Code ?? payload?.code ?? null,
    count: Array.isArray(data) ? data.length : null,
    first: Array.isArray(data) ? data[0] ?? null : null,
    last: Array.isArray(data) ? data.at(-1) ?? null : null,
    raw: result.text,
  }
}

console.log(JSON.stringify({
  pageStatus: page.status,
  filterEvidence,
  current: summarizeCurrent(current),
  history30: summarizeHistory(history30),
}, null, 2))
