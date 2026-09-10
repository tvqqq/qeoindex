import { mkdirSync, writeFileSync } from "node:fs"
import { expect, test, type APIRequestContext, type Page } from "@playwright/test"

const BASE_URL = process.env.QEO172_BASE_URL ?? "https://qeoindex.qeoqeo.com"
const TEST_EMAIL = process.env.QEO171_TEST_EMAIL
const TEST_PASSWORD = process.env.QEO171_TEST_PASSWORD
const BENCHMARK_MODE = process.env.QEO172_BENCHMARK_MODE ?? "baseline"
const WORKFLOW_SHA = process.env.QEO172_WORKFLOW_SHA ?? process.env.GITHUB_SHA ?? "unknown"
const SAMPLES = 10
const MATRIX = [
  ["VIC", "1D"],
  ["VIC", "4h"],
  ["VIC", "1h"],
  ["VIC", "15m"],
  ["VCB", "1D"],
  ["VCB", "4h"],
  ["VCB", "1h"],
  ["VCB", "15m"],
] as const

type MatrixTicker = (typeof MATRIX)[number][0]
type MatrixTimeframe = (typeof MATRIX)[number][1]
type TimingMap = Record<string, number>

type ApiSample = {
  wallMs: number
  serverTiming: TimingMap
  barCount: number
  payloadBytes: number
}

type UiSample = {
  interactionMs: number
  renderAfterNetworkMs: number | null
  networkRequests: number
}

function percentile(values: number[], p: number) {
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))
  return sorted[index]
}

function summarize(values: number[]) {
  return {
    p50: percentile(values, 0.50),
    p95: percentile(values, 0.95),
    min: Math.min(...values),
    max: Math.max(...values),
  }
}

function parseServerTiming(value: string | undefined): TimingMap {
  const result: TimingMap = {}
  for (const item of (value ?? "").split(",")) {
    const match = /^\s*([^;]+);dur=([0-9.]+)\s*$/.exec(item)
    if (!match) continue
    const duration = Number(match[2])
    if (Number.isFinite(duration)) result[match[1].trim()] = duration
  }
  return result
}

function rangeFor(timeframe: MatrixTimeframe, now: number) {
  const day = 86_400
  if (timeframe === "1D") return { from: 1, to: now }
  if (timeframe === "4h") return { from: now - 186 * day, to: now }
  if (timeframe === "1h") return { from: now - 90 * day, to: now }
  return { from: now - 21 * day, to: now }
}

function alternateTimeframe(target: MatrixTimeframe): MatrixTimeframe {
  if (target === "1D") return "1h"
  if (target === "1h") return "4h"
  return "1D"
}

async function login(page: Page) {
  if (!TEST_EMAIL || !TEST_PASSWORD) {
    throw new Error("QEO171_TEST_EMAIL and QEO171_TEST_PASSWORD are required for QEO-172 production benchmark")
  }
  await page.goto(`${BASE_URL}/`)
  await page.getByLabel(/email/i).fill(TEST_EMAIL)
  await page.getByRole("textbox", { name: "Mật khẩu", exact: true }).fill(TEST_PASSWORD)
  await page.getByRole("button", { name: /đăng nhập/i }).click()
  await expect(page.getByText(/đăng nhập qeoindex/i)).toBeHidden()
  await expect.poll(
    () => page.evaluate(async () => (await fetch("/api/me", { cache: "no-store" })).status),
    { timeout: 15_000 },
  ).toBe(200)
}

async function enterFullscreen(page: Page) {
  if (await page.locator('[title="Phóng to chart"]').isVisible().catch(() => false)) {
    await page.keyboard.press("Backquote")
  }
  await expect(page.locator('[title="Thu nhỏ chart"]')).toBeVisible({ timeout: 15_000 })
}

async function waitRendered(page: Page, ticker: string, timeframe: string, timeout = 30_000) {
  const terminal = page.locator('[data-chart-terminal="true"]')
  await expect(terminal).toHaveAttribute(
    "data-chart-rendered-key",
    new RegExp(`^${ticker.toUpperCase()}:${timeframe}:\\d+:\\d+$`),
    { timeout },
  )
}

async function selectTimeframe(page: Page, ticker: string, timeframe: MatrixTimeframe) {
  await enterFullscreen(page)
  await page.getByRole("button", { name: timeframe, exact: true }).click()
  await waitRendered(page, ticker, timeframe)
}

async function sampleApi(
  request: APIRequestContext,
  ticker: MatrixTicker,
  timeframe: MatrixTimeframe,
): Promise<ApiSample> {
  const now = Math.floor(Date.now() / 1000)
  const range = rangeFor(timeframe, now)
  const params = new URLSearchParams({
    ticker,
    resolution: timeframe,
    from: String(range.from),
    to: String(range.to),
  })
  const startedAt = performance.now()
  const response = await request.get(`${BASE_URL}/api/market/ohlcv?${params.toString()}`)
  expect(response.status(), `${ticker} ${timeframe} direct API`).toBe(200)
  const body = await response.json() as { ok?: boolean; bars?: unknown[] }
  const wallMs = performance.now() - startedAt
  expect(body.ok).toBe(true)
  expect(Array.isArray(body.bars)).toBe(true)
  expect(body.bars?.length ?? 0).toBeGreaterThan(0)
  return {
    wallMs,
    serverTiming: parseServerTiming(response.headers()["server-timing"]),
    barCount: Number(response.headers()["x-chart-bar-count"] ?? body.bars?.length ?? 0),
    payloadBytes: Number(response.headers()["x-chart-payload-bytes"] ?? 0),
  }
}

async function measureTimeframeInteraction(
  page: Page,
  ticker: MatrixTicker,
  target: MatrixTimeframe,
): Promise<UiSample> {
  const alternate = alternateTimeframe(target)
  await selectTimeframe(page, ticker, alternate)

  let networkRequests = 0
  let lastNetworkFinishedAt = 0
  const onResponse = (response: { url(): string; finished(): Promise<null | Error> }) => {
    if (!response.url().includes("/api/market/ohlcv")) return
    networkRequests += 1
    void response.finished().then(() => { lastNetworkFinishedAt = Date.now() })
  }
  page.on("response", onResponse)

  const startedAt = Date.now()
  await page.getByRole("button", { name: target, exact: true }).click()
  await waitRendered(page, ticker, target)
  const endedAt = Date.now()
  page.off("response", onResponse)

  return {
    interactionMs: endedAt - startedAt,
    renderAfterNetworkMs: lastNetworkFinishedAt >= startedAt ? Math.max(0, endedAt - lastNetworkFinishedAt) : null,
    networkRequests,
  }
}

async function visibleAdjacentHref(page: Page, currentTicker: string): Promise<string> {
  const hrefs = await page.locator('aside a[href^="/insights/"]').evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("href")).filter((href): href is string => Boolean(href)),
  )
  const current = `/insights/${currentTicker.toLowerCase()}`
  const index = hrefs.indexOf(current)
  if (index < 0) throw new Error(`Current ticker ${currentTicker} is not present in visible watchlist links`)
  const candidate = hrefs[index + 1] ?? hrefs[index - 1]
  if (!candidate) throw new Error(`No adjacent visible watchlist ticker for ${currentTicker}`)
  return candidate
}

async function measureAdjacentTickerSwitches(page: Page): Promise<{
  source: string
  target: string
  timeframe: MatrixTimeframe
  samples: UiSample[]
}> {
  const timeframe: MatrixTimeframe = "1h"
  await page.goto(`${BASE_URL}/insights/vic`)
  await enterFullscreen(page)
  await selectTimeframe(page, "VIC", timeframe)
  const targetHref = await visibleAdjacentHref(page, "VIC")
  const target = targetHref.split("/").filter(Boolean).at(-1)?.toUpperCase()
  if (!target) throw new Error("Unable to resolve adjacent ticker")

  const samples: UiSample[] = []
  for (let index = 0; index < SAMPLES + 1; index += 1) {
    // Return to VIC before each measured adjacent switch. After the first
    // round both directions use the app's normal in-memory stock-detail cache.
    if (!page.url().toLowerCase().endsWith("/insights/vic")) {
      await page.locator('a[href="/insights/vic"]').first().click()
      await waitRendered(page, "VIC", timeframe)
    }

    let networkRequests = 0
    let lastNetworkFinishedAt = 0
    const onResponse = (response: { url(): string; finished(): Promise<null | Error> }) => {
      if (!response.url().includes("/api/market/ohlcv") && !response.url().includes("/api/insights/stock-detail")) return
      networkRequests += 1
      void response.finished().then(() => { lastNetworkFinishedAt = Date.now() })
    }
    page.on("response", onResponse)
    const startedAt = Date.now()
    await page.locator(`a[href="${targetHref}"]`).first().click()
    await waitRendered(page, target, timeframe)
    const endedAt = Date.now()
    page.off("response", onResponse)

    if (index > 0) {
      samples.push({
        interactionMs: endedAt - startedAt,
        renderAfterNetworkMs: lastNetworkFinishedAt >= startedAt ? Math.max(0, endedAt - lastNetworkFinishedAt) : null,
        networkRequests,
      })
    }
  }

  return { source: "VIC", target, timeframe, samples }
}

test("QEO-172 authenticated production performance benchmark", async ({ page }) => {
  test.setTimeout(10 * 60_000)
  await login(page)
  const request = page.context().request

  const apiResults: Array<{
    ticker: MatrixTicker
    timeframe: MatrixTimeframe
    samples: ApiSample[]
    summary: ReturnType<typeof summarize>
  }> = []

  for (const [ticker, timeframe] of MATRIX) {
    await sampleApi(request, ticker, timeframe) // warm-up
    const samples: ApiSample[] = []
    for (let index = 0; index < SAMPLES; index += 1) {
      samples.push(await sampleApi(request, ticker, timeframe))
    }
    apiResults.push({
      ticker,
      timeframe,
      samples,
      summary: summarize(samples.map((sample) => sample.wallMs)),
    })
  }

  const uiResults: Array<{
    ticker: MatrixTicker
    timeframe: MatrixTimeframe
    samples: UiSample[]
    summary: ReturnType<typeof summarize>
    renderAfterNetwork: ReturnType<typeof summarize> | null
  }> = []

  for (const ticker of ["VIC", "VCB"] as const) {
    await page.goto(`${BASE_URL}/insights/${ticker.toLowerCase()}`)
    await enterFullscreen(page)
    for (const timeframe of ["1D", "4h", "1h", "15m"] as const) {
      await measureTimeframeInteraction(page, ticker, timeframe) // warm-up
      const samples: UiSample[] = []
      for (let index = 0; index < SAMPLES; index += 1) {
        samples.push(await measureTimeframeInteraction(page, ticker, timeframe))
      }
      const renderSamples = samples
        .map((sample) => sample.renderAfterNetworkMs)
        .filter((value): value is number => value != null)
      uiResults.push({
        ticker,
        timeframe,
        samples,
        summary: summarize(samples.map((sample) => sample.interactionMs)),
        renderAfterNetwork: renderSamples.length ? summarize(renderSamples) : null,
      })
    }
  }

  const adjacent = await measureAdjacentTickerSwitches(page)
  const artifact = {
    schemaVersion: 1,
    benchmarkMode: BENCHMARK_MODE,
    workflowSha: WORKFLOW_SHA,
    baseUrl: BASE_URL,
    generatedAt: new Date().toISOString(),
    samplesPerCase: SAMPLES,
    matrix: MATRIX,
    api: apiResults,
    ui: uiResults,
    adjacent: {
      ...adjacent,
      summary: summarize(adjacent.samples.map((sample) => sample.interactionMs)),
    },
  }

  mkdirSync("test-results", { recursive: true })
  writeFileSync("test-results/qeo172-performance.json", `${JSON.stringify(artifact, null, 2)}\n`)

  // The instrumentation baseline is evidence only. Acceptance mode will use
  // the exact same benchmark script after behavior changes and can enforce the
  // frozen budgets without moving the goalposts.
  expect(apiResults).toHaveLength(MATRIX.length)
  expect(uiResults).toHaveLength(MATRIX.length)
  expect(adjacent.samples).toHaveLength(SAMPLES)
})
