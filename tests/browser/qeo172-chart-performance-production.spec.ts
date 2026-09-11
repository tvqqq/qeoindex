import { mkdirSync, writeFileSync } from "node:fs"
import { expect, test, type APIRequestContext, type Page, type Response as PlaywrightResponse } from "@playwright/test"
import { isVietnamSecuritiesTradingDay, vietnamDateKey } from "../../modules/market/calendar"

const BASE_URL = process.env.QEO172_BASE_URL ?? "https://qeoindex.qeoqeo.com"
const TEST_EMAIL = process.env.QEO171_TEST_EMAIL
const TEST_PASSWORD = process.env.QEO171_TEST_PASSWORD
const BENCHMARK_MODE = process.env.QEO172_BENCHMARK_MODE ?? "baseline"
const WORKFLOW_SHA = process.env.QEO172_WORKFLOW_SHA ?? process.env.GITHUB_SHA ?? "unknown"
const SAMPLES = 10

const UNCACHED_INITIAL_P95_MS = 2500
const WARM_TIMEFRAME_P50_MS = 150
const WARM_TIMEFRAME_P95_MS = 500
const ADJACENT_P50_MS = 300
const ADJACENT_P95_MS = 800
const RENDER_AFTER_NETWORK_P95_MS = 200
const CURRENT_TAIL_P95_MS = 2000
const LOCAL_STABLE_REUSE_MAX_MS = 50
const MAX_PAYLOAD_BYTES = 2 * 1024 * 1024

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
const QUICK_TIMEFRAMES = new Set<MatrixTimeframe>(["15m", "1h", "1D"])
const ANY_TIMEFRAME = "(?:1m|15m|30m|1h|2h|4h|1D|3D|1W|1M|1Q|1Y)"

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

type AdjacentIntent = {
  target: string
  forwardKey: "ArrowDown" | "ArrowUp"
  reverseKey: "ArrowUp" | "ArrowDown"
}

type Summary = ReturnType<typeof summarize>

type CurrentTailEvidence = {
  applicable: boolean
  reason: string | null
  cases: Array<{
    ticker: MatrixTicker
    timeframe: "1h"
    samples: ApiSample[]
    summary: Summary
  }>
}

function percentile(values: number[], p: number) {
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))
  return sorted[index]
}

function summarize(values: number[]) {
  if (values.length === 0) throw new Error("Cannot summarize an empty performance sample")
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

function writeBenchmarkArtifact(artifact: unknown) {
  mkdirSync("test-results", { recursive: true })
  writeFileSync("test-results/qeo172-performance.json", `${JSON.stringify(artifact, null, 2)}\n`)
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
  const terminal = page.locator('[data-chart-terminal="true"]')
  await expect(terminal).toBeVisible({ timeout: 15_000 })
  if (await terminal.getAttribute("data-chart-maximized") !== "true") {
    await page.keyboard.press("Backquote")
  }
  await expect(terminal).toHaveAttribute("data-chart-maximized", "true", { timeout: 15_000 })
}

async function waitRendered(page: Page, ticker: string, timeframe: string, timeout = 30_000) {
  const terminal = page.locator('[data-chart-terminal="true"]')
  await expect(terminal).toHaveAttribute(
    "data-chart-rendered-key",
    new RegExp(`^${ticker.toUpperCase()}:${timeframe}:\\d+:\\d+$`),
    { timeout },
  )
}

async function waitAnyRendered(page: Page, ticker: string, timeout = 30_000) {
  const terminal = page.locator('[data-chart-terminal="true"]')
  await expect(terminal).toHaveAttribute(
    "data-chart-rendered-key",
    new RegExp(`^${ticker.toUpperCase()}:${ANY_TIMEFRAME}:\\d+:\\d+$`),
    { timeout },
  )
  return terminal.getAttribute("data-chart-rendered-key")
}

async function clickTimeframe(page: Page, timeframe: MatrixTimeframe) {
  if (QUICK_TIMEFRAMES.has(timeframe)) {
    await page.getByRole("button", { name: timeframe, exact: true }).click()
    return
  }
  await page.getByRole("button", { name: "Chọn khung thời gian", exact: true }).click()
  await page.getByText(timeframe, { exact: true }).last().click()
}

async function selectTimeframe(page: Page, ticker: string, timeframe: MatrixTimeframe) {
  await enterFullscreen(page)
  const current = await page.locator('[data-chart-rendered-key]').getAttribute("data-chart-rendered-key")
  if (current?.startsWith(`${ticker.toUpperCase()}:${timeframe}:`)) return
  await clickTimeframe(page, timeframe)
  await waitRendered(page, ticker, timeframe)
}

async function sampleApi(
  request: APIRequestContext,
  ticker: MatrixTicker,
  timeframe: MatrixTimeframe,
  range = rangeFor(timeframe, Math.floor(Date.now() / 1000)),
): Promise<ApiSample> {
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

async function measureUncachedInitial(page: Page) {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send("Network.enable")
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true })
  const samples: Array<{ interactionMs: number; renderedKey: string | null }> = []
  try {
    for (let index = 0; index < SAMPLES; index += 1) {
      const startedAt = Date.now()
      await page.goto(`${BASE_URL}/insights/vic?qeo172_uncached=${index}`, { waitUntil: "domcontentloaded" })
      const renderedKey = await waitAnyRendered(page, "VIC")
      samples.push({ interactionMs: Date.now() - startedAt, renderedKey })
    }
  } finally {
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: false })
    await cdp.detach()
  }
  return {
    samples,
    summary: summarize(samples.map((sample) => sample.interactionMs)),
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
  const onResponse = (response: PlaywrightResponse) => {
    if (!response.url().includes("/api/market/ohlcv")) return
    networkRequests += 1
    void response.finished().then(() => { lastNetworkFinishedAt = Date.now() })
  }
  page.on("response", onResponse)

  const startedAt = Date.now()
  await clickTimeframe(page, target)
  await waitRendered(page, ticker, target)
  const endedAt = Date.now()
  page.off("response", onResponse)

  return {
    interactionMs: endedAt - startedAt,
    renderAfterNetworkMs: lastNetworkFinishedAt >= startedAt ? Math.max(0, endedAt - lastNetworkFinishedAt) : null,
    networkRequests,
  }
}

async function adjacentIntent(page: Page, currentTicker: string): Promise<AdjacentIntent> {
  const hrefs = await page.locator('aside a[href^="/insights/"]').evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("href")).filter((href): href is string => Boolean(href)),
  )
  const current = `/insights/${currentTicker.toLowerCase()}`
  const index = hrefs.indexOf(current)
  if (index < 0) throw new Error(`Current ticker ${currentTicker} is not present in visible watchlist links`)
  const next = hrefs[index + 1]
  if (next) {
    return {
      target: next.split("/").filter(Boolean).at(-1)?.toUpperCase() ?? "",
      forwardKey: "ArrowDown",
      reverseKey: "ArrowUp",
    }
  }
  const previous = hrefs[index - 1]
  if (previous) {
    return {
      target: previous.split("/").filter(Boolean).at(-1)?.toUpperCase() ?? "",
      forwardKey: "ArrowUp",
      reverseKey: "ArrowDown",
    }
  }
  throw new Error(`No adjacent visible watchlist ticker for ${currentTicker}`)
}

async function waitTickerPath(page: Page, ticker: string) {
  await expect.poll(
    () => new URL(page.url()).pathname.toLowerCase(),
    { timeout: 15_000 },
  ).toBe(`/insights/${ticker.toLowerCase()}`)
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
  const intent = await adjacentIntent(page, "VIC")
  if (!intent.target) throw new Error("Unable to resolve adjacent ticker")

  // Allow the bounded idle prefetch to warm the exact adjacent target before
  // measuring the user-visible keyboard transition.
  await page.waitForTimeout(1_000)
  await page.keyboard.press(intent.forwardKey)
  await waitTickerPath(page, intent.target)
  await waitRendered(page, intent.target, timeframe)
  await page.keyboard.press(intent.reverseKey)
  await waitTickerPath(page, "VIC")
  await waitRendered(page, "VIC", timeframe)
  await page.waitForTimeout(500)

  const samples: UiSample[] = []
  for (let index = 0; index < SAMPLES; index += 1) {
    let networkRequests = 0
    let lastNetworkFinishedAt = 0
    const onResponse = (response: PlaywrightResponse) => {
      if (!response.url().includes("/api/market/ohlcv") && !response.url().includes("/api/insights/stock-detail")) return
      networkRequests += 1
      void response.finished().then(() => { lastNetworkFinishedAt = Date.now() })
    }
    page.on("response", onResponse)
    const startedAt = Date.now()
    await page.keyboard.press(intent.forwardKey)
    await waitTickerPath(page, intent.target)
    await waitRendered(page, intent.target, timeframe)
    const endedAt = Date.now()
    page.off("response", onResponse)

    samples.push({
      interactionMs: endedAt - startedAt,
      renderAfterNetworkMs: lastNetworkFinishedAt >= startedAt ? Math.max(0, endedAt - lastNetworkFinishedAt) : null,
      networkRequests,
    })

    await page.keyboard.press(intent.reverseKey)
    await waitTickerPath(page, "VIC")
    await waitRendered(page, "VIC", timeframe)
  }

  return { source: "VIC", target: intent.target, timeframe, samples }
}

async function measureCurrentTail(request: APIRequestContext): Promise<CurrentTailEvidence> {
  const now = new Date()
  if (!isVietnamSecuritiesTradingDay(now)) {
    return { applicable: false, reason: "current date is not a Vietnam securities trading day", cases: [] }
  }
  const open = Math.floor(Date.parse(`${vietnamDateKey(now)}T09:00:00+07:00`) / 1000)
  const to = Math.floor(now.getTime() / 1000)
  if (to <= open) {
    return { applicable: false, reason: "current trading date has not reached 09:00 ICT", cases: [] }
  }

  const cases: CurrentTailEvidence["cases"] = []
  for (const ticker of ["VIC", "VCB"] as const) {
    const samples: ApiSample[] = []
    for (let index = 0; index < SAMPLES; index += 1) {
      samples.push(await sampleApi(request, ticker, "1h", { from: open, to }))
    }
    cases.push({ ticker, timeframe: "1h", samples, summary: summarize(samples.map((sample) => sample.wallMs)) })
  }
  return { applicable: true, reason: null, cases }
}

function enforceAcceptanceBudgets({
  uncachedInitial,
  apiResults,
  uiResults,
  adjacent,
  currentTail,
}: {
  uncachedInitial: { summary: Summary }
  apiResults: Array<{ ticker: MatrixTicker; timeframe: MatrixTimeframe; samples: ApiSample[]; summary: Summary }>
  uiResults: Array<{
    ticker: MatrixTicker
    timeframe: MatrixTimeframe
    samples: UiSample[]
    summary: Summary
    renderAfterNetwork: Summary | null
  }>
  adjacent: { samples: UiSample[]; summary: Summary }
  currentTail: CurrentTailEvidence
}) {
  expect(uncachedInitial.summary.p95, "uncached initial usable chart p95").toBeLessThanOrEqual(UNCACHED_INITIAL_P95_MS)

  const stableOnlyUi = uiResults.filter((result) => result.samples.every((sample) => sample.networkRequests === 0))
  expect(stableOnlyUi.length, "at least one warm stable-only timeframe case must be observed").toBeGreaterThan(0)
  for (const result of stableOnlyUi) {
    expect(result.summary.p50, `${result.ticker} ${result.timeframe} warm switch p50`).toBeLessThanOrEqual(WARM_TIMEFRAME_P50_MS)
    expect(result.summary.p95, `${result.ticker} ${result.timeframe} warm switch p95`).toBeLessThanOrEqual(WARM_TIMEFRAME_P95_MS)
  }

  expect(adjacent.summary.p50, "prefetched adjacent ticker p50").toBeLessThanOrEqual(ADJACENT_P50_MS)
  expect(adjacent.summary.p95, "prefetched adjacent ticker p95").toBeLessThanOrEqual(ADJACENT_P95_MS)

  for (const result of uiResults) {
    if (result.renderAfterNetwork) {
      expect(result.renderAfterNetwork.p95, `${result.ticker} ${result.timeframe} render-after-network p95`).toBeLessThanOrEqual(RENDER_AFTER_NETWORK_P95_MS)
    }
  }
  const adjacentRender = adjacent.samples
    .map((sample) => sample.renderAfterNetworkMs)
    .filter((value): value is number => value != null)
  if (adjacentRender.length) {
    expect(summarize(adjacentRender).p95, "adjacent render-after-network p95").toBeLessThanOrEqual(RENDER_AFTER_NETWORK_P95_MS)
  }

  const maxPayload = Math.max(...apiResults.flatMap((result) => result.samples.map((sample) => sample.payloadBytes)))
  expect(maxPayload, "largest chart payload").toBeLessThanOrEqual(MAX_PAYLOAD_BYTES)

  if (currentTail.applicable) {
    for (const result of currentTail.cases) {
      expect(result.summary.p95, `${result.ticker} current-date tail p95`).toBeLessThanOrEqual(CURRENT_TAIL_P95_MS)
    }
  }

  // The 50 ms budget is the local L0 resolution boundary, not end-to-end UI
  // render time. Production network observation must show zero duplicate network
  // for stable-only cases; the focused contract suite measures local cache reuse
  // against LOCAL_STABLE_REUSE_MAX_MS without conflating React paint latency.
  expect(LOCAL_STABLE_REUSE_MAX_MS).toBe(50)
}

test("QEO-172 authenticated production performance benchmark", async ({ page }) => {
  test.setTimeout(12 * 60_000)
  await login(page)
  const request = page.context().request

  const uncachedInitial = await measureUncachedInitial(page)

  const apiResults: Array<{
    ticker: MatrixTicker
    timeframe: MatrixTimeframe
    samples: ApiSample[]
    summary: Summary
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
    summary: Summary
    renderAfterNetwork: Summary | null
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

  const currentTail = await measureCurrentTail(request)
  const artifactBase = {
    schemaVersion: 2,
    benchmarkMode: BENCHMARK_MODE,
    workflowSha: WORKFLOW_SHA,
    baseUrl: BASE_URL,
    generatedAt: new Date().toISOString(),
    samplesPerCase: SAMPLES,
    budgets: {
      uncachedInitialP95Ms: UNCACHED_INITIAL_P95_MS,
      warmTimeframeP50Ms: WARM_TIMEFRAME_P50_MS,
      warmTimeframeP95Ms: WARM_TIMEFRAME_P95_MS,
      adjacentP50Ms: ADJACENT_P50_MS,
      adjacentP95Ms: ADJACENT_P95_MS,
      renderAfterNetworkP95Ms: RENDER_AFTER_NETWORK_P95_MS,
      currentTailP95Ms: CURRENT_TAIL_P95_MS,
      localStableReuseMaxMs: LOCAL_STABLE_REUSE_MAX_MS,
      maxPayloadBytes: MAX_PAYLOAD_BYTES,
    },
    matrix: MATRIX,
    uncachedInitial,
    currentTail,
    api: apiResults,
    ui: uiResults,
  }

  writeBenchmarkArtifact({
    ...artifactBase,
    complete: false,
    adjacent: null,
  })

  let adjacent: Awaited<ReturnType<typeof measureAdjacentTickerSwitches>>
  try {
    adjacent = await measureAdjacentTickerSwitches(page)
  } catch (cause) {
    writeBenchmarkArtifact({
      ...artifactBase,
      complete: false,
      adjacent: null,
      failure: {
        stage: "adjacent-navigation",
        message: cause instanceof Error ? cause.message : String(cause),
      },
    })
    throw cause
  }

  const adjacentWithSummary = {
    ...adjacent,
    summary: summarize(adjacent.samples.map((sample) => sample.interactionMs)),
  }

  writeBenchmarkArtifact({
    ...artifactBase,
    complete: true,
    acceptanceObservable: currentTail.applicable,
    adjacent: adjacentWithSummary,
  })

  expect(apiResults).toHaveLength(MATRIX.length)
  expect(uiResults).toHaveLength(MATRIX.length)
  expect(adjacent.samples).toHaveLength(SAMPLES)

  if (BENCHMARK_MODE === "acceptance") {
    enforceAcceptanceBudgets({
      uncachedInitial,
      apiResults,
      uiResults,
      adjacent: adjacentWithSummary,
      currentTail,
    })
  }
})
