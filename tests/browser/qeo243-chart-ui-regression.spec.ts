import { mkdirSync } from "node:fs"
import { expect, test, type APIRequestContext, type Page } from "@playwright/test"

const BASE_URL = process.env.QEO243_BASE_URL ?? "https://qeoindex.qeoqeo.com"
const TEST_EMAIL = process.env.QEO171_TEST_EMAIL
const TEST_PASSWORD = process.env.QEO171_TEST_PASSWORD
const TICKERS = ["VIC", "VCB"] as const
const TIMEFRAMES = ["1D", "1W", "1M"] as const

type Ticker = (typeof TICKERS)[number]
type DrawingEnvelope = {
  ok: boolean
  data: {
    ticker: string
    timeframe: string
    chartStyle: string
    indicators: Record<string, boolean>
    drawingsSchemaVersion: number
    drawings: unknown[]
    unresolvedLegacyDrawings?: unknown[]
    viewSettings?: Record<string, unknown>
  }
  viewSettings?: Record<string, unknown>
}

async function login(page: Page) {
  if (!TEST_EMAIL || !TEST_PASSWORD) {
    throw new Error("QEO171_TEST_EMAIL and QEO171_TEST_PASSWORD are required for QEO-243 browser acceptance")
  }
  await page.goto(`${BASE_URL}/`)
  await page.getByLabel(/email/i).fill(TEST_EMAIL)
  await page.getByRole("textbox", { name: "Mật khẩu", exact: true }).fill(TEST_PASSWORD)
  await page.getByRole("button", { name: /đăng nhập/i }).click()
  await expect.poll(
    () => page.evaluate(async () => (await fetch("/api/me", { cache: "no-store" })).status),
    { timeout: 15_000 },
  ).toBe(200)
}

async function getEnvelope(request: APIRequestContext, ticker: Ticker) {
  const response = await request.get(`${BASE_URL}/api/user/chart-drawings?ticker=${ticker}`)
  expect(response.status()).toBe(200)
  return response.json() as Promise<DrawingEnvelope>
}

async function restoreEnvelope(request: APIRequestContext, snapshot: DrawingEnvelope) {
  const data = snapshot.data
  const response = await request.post(`${BASE_URL}/api/user/chart-drawings`, {
    data: {
      ticker: data.ticker,
      timeframe: data.timeframe || "1D",
      chartStyle: data.chartStyle || "candles",
      indicators: data.indicators || {},
      drawingsSchemaVersion: 2,
      drawings: data.drawings || [],
      unresolvedLegacyDrawings: data.unresolvedLegacyDrawings || [],
      viewSettings: snapshot.viewSettings ?? data.viewSettings,
    },
  })
  expect(response.status(), await response.text()).toBe(200)
}

async function enterFullscreen(page: Page) {
  const terminal = page.locator('[data-chart-terminal="true"]')
  await expect(terminal).toBeVisible({ timeout: 20_000 })
  if (await terminal.getAttribute("data-chart-maximized") !== "true") await page.keyboard.press("Backquote")
  await expect(terminal).toHaveAttribute("data-chart-maximized", "true")
  await expect(page.locator('[data-chart-pane-geometry="native"]')).toBeVisible({ timeout: 10_000 })
}

async function selectTimeframe(page: Page, ticker: Ticker, timeframe: (typeof TIMEFRAMES)[number]) {
  await page.getByRole("button", { name: timeframe, exact: true }).click()
  await expect(page.locator('[data-chart-terminal="true"]')).toHaveAttribute(
    "data-chart-rendered-key",
    new RegExp(`^${ticker}:${timeframe}:\\d+:\\d+$`),
    { timeout: 30_000 },
  )
  await expect(page.locator(`[data-chart-plot][data-chart-latest-candle-x]:not([data-chart-latest-candle-x=""])`))
    .toBeVisible({ timeout: 10_000 })
}

async function assertNativeGeometryAndViewport(page: Page) {
  const plot = page.locator('[data-chart-plot="lightweight"]')
  const drawing = page.locator("svg[data-drawing-height]")
  const values = await plot.evaluate((node) => {
    const element = node as HTMLElement
    return {
      price: Number(element.dataset.chartPricePaneHeight),
      volume: Number(element.dataset.chartVolumePaneHeight),
      rsi: Number(element.dataset.chartRsiPaneHeight),
      macd: Number(element.dataset.chartMacdPaneHeight),
      latestX: Number(element.dataset.chartLatestCandleX),
      drawableWidth: Number(element.dataset.chartDrawableWidth),
      plotHeight: element.getBoundingClientRect().height,
      geometry: element.dataset.chartPaneGeometry,
    }
  })
  const drawingBox = await drawing.boundingBox()
  expect(values.geometry).toBe("native")
  expect(drawingBox).not.toBeNull()
  expect(Math.abs((drawingBox?.height ?? 0) - values.price)).toBeLessThanOrEqual(1)
  expect(values.price + values.volume + values.rsi + values.macd).toBeLessThan(values.plotHeight)
  expect(values.latestX / values.drawableWidth).toBeGreaterThan(0.55)
  expect(values.latestX / values.drawableWidth).toBeLessThan(0.98)

  const plotBox = await plot.boundingBox()
  expect(plotBox).not.toBeNull()
  const expectedTops = [
    (plotBox?.y ?? 0) + values.price,
    (plotBox?.y ?? 0) + values.price + values.volume,
    (plotBox?.y ?? 0) + values.price + values.volume + values.rsi,
  ]
  for (const [index, pane] of ["volume", "rsi", "macd"].entries()) {
    const headerBox = await page.locator(`[data-chart-pane-header="${pane}"]`).boundingBox()
    expect(headerBox).not.toBeNull()
    expect(Math.abs((headerBox?.y ?? 0) - expectedTops[index])).toBeLessThanOrEqual(6)
  }
}

test("QEO-243 timeframe viewport, pane geometry, wheel and drawing bounds", async ({ page }) => {
  test.setTimeout(4 * 60_000)
  mkdirSync("test-results", { recursive: true })
  await login(page)
  const request = page.context().request
  const vicSnapshot = await getEnvelope(request, "VIC")

  try {
    for (const viewport of [{ width: 2048, height: 1300 }, { width: 1440, height: 900 }]) {
      await page.setViewportSize(viewport)
      for (const ticker of TICKERS) {
        await page.goto(`${BASE_URL}/insights/${ticker.toLowerCase()}`)
        await enterFullscreen(page)
        for (const timeframe of [...TIMEFRAMES, "1D", "1M", "1W", "1D"] as const) {
          await selectTimeframe(page, ticker, timeframe)
          await assertNativeGeometryAndViewport(page)
        }

        const beforeWheelHeight = await page.locator('[data-chart-plot="lightweight"]').getAttribute("data-chart-price-pane-height")
        await page.locator('[data-chart-plot="lightweight"]').hover()
        await page.mouse.wheel(0, 180)
        await page.waitForTimeout(250)
        await expect(page.locator('[data-chart-plot="lightweight"]')).toHaveAttribute("data-chart-price-pane-height", beforeWheelHeight ?? "")
        await expect(page.getByText("Đang tải thêm lịch sử…", { exact: true })).toBeHidden()

        await page.screenshot({
          path: `test-results/qeo243-${ticker.toLowerCase()}-${viewport.width}x${viewport.height}.png`,
          fullPage: false,
        })
      }
    }

    await page.goto(`${BASE_URL}/insights/vic`)
    await page.setViewportSize({ width: 1440, height: 900 })
    await enterFullscreen(page)
    await selectTimeframe(page, "VIC", "1D")
    const beforeCount = (await getEnvelope(request, "VIC")).data.drawings.length
    await page.locator('[title="Đường xu hướng (Trendline)"]').click()
    const drawing = page.locator("svg[data-drawing-height]")
    const box = await drawing.boundingBox()
    expect(box).not.toBeNull()
    await page.mouse.click((box?.x ?? 0) + (box?.width ?? 0) * 0.35, (box?.y ?? 0) + (box?.height ?? 0) * 0.35)
    await page.mouse.click((box?.x ?? 0) + (box?.width ?? 0) * 0.60, (box?.y ?? 0) + (box?.height ?? 0) * 0.55)
    await expect(page.locator('[title="Con trỏ (Crosshair)"]')).toHaveAttribute("aria-pressed", "true")
    await expect.poll(async () => (await getEnvelope(request, "VIC")).data.drawings.length).toBe(beforeCount + 1)
    await page.mouse.click((box?.x ?? 0) + (box?.width ?? 0) * 0.75, (box?.y ?? 0) + (box?.height ?? 0) * 0.70)
    await page.waitForTimeout(300)
    expect((await getEnvelope(request, "VIC")).data.drawings).toHaveLength(beforeCount + 1)
  } finally {
    await restoreEnvelope(request, vicSnapshot)
  }
})
