import { expect, test, type APIRequestContext, type Page } from "@playwright/test"

const BASE_URL = process.env.QEO171_BASE_URL ?? "https://qeoindex.qeoqeo.com"
const TEST_EMAIL = process.env.QEO171_TEST_EMAIL
const TEST_PASSWORD = process.env.QEO171_TEST_PASSWORD
const TICKERS = ["VIC", "VCB"] as const

type Ticker = (typeof TICKERS)[number]

type Drawing = {
  id: string
  tool: string
  locked?: boolean
  hidden?: boolean
  text?: string
  anchors?: Array<{ time: number; price: number }>
}

type ChartSettingsResponse = {
  ok: boolean
  data: {
    ticker: string
    timeframe: string
    chartStyle: string
    indicators: Record<string, boolean>
    drawingsSchemaVersion: number
    drawings: Drawing[]
    unresolvedLegacyDrawings?: unknown[]
    viewSettings?: Record<string, unknown>
  }
  viewSettings?: Record<string, unknown>
}

type OhlcvBar = {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

type OhlcvResponse = {
  ok: boolean
  bars: OhlcvBar[]
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

async function login(page: Page): Promise<void> {
  if (!TEST_EMAIL || !TEST_PASSWORD) {
    throw new Error("QEO171_TEST_EMAIL and QEO171_TEST_PASSWORD are required for production acceptance")
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

async function getSettings(request: APIRequestContext, ticker: Ticker): Promise<ChartSettingsResponse> {
  const response = await request.get(`${BASE_URL}/api/user/chart-drawings?ticker=${ticker}`)
  expect(response.status(), `GET chart settings ${ticker}`).toBe(200)
  const body = (await response.json()) as ChartSettingsResponse
  expect(body.ok).toBe(true)
  return body
}

async function postSettings(
  request: APIRequestContext,
  ticker: Ticker,
  snapshot: ChartSettingsResponse,
  overrides?: { drawings?: Drawing[]; viewSettings?: Record<string, unknown> },
): Promise<void> {
  const data = snapshot.data
  const response = await request.post(`${BASE_URL}/api/user/chart-drawings`, {
    data: {
      ticker,
      timeframe: data.timeframe || "1D",
      chartStyle: data.chartStyle || "candles",
      indicators: data.indicators || {},
      drawingsSchemaVersion: 2,
      drawings: overrides?.drawings ?? data.drawings ?? [],
      unresolvedLegacyDrawings: data.unresolvedLegacyDrawings ?? [],
      viewSettings: overrides?.viewSettings ?? snapshot.viewSettings ?? data.viewSettings,
    },
  })
  expect(response.status(), `POST chart settings ${ticker}: ${await response.text()}`).toBe(200)
}

async function restoreSnapshots(
  request: APIRequestContext,
  snapshots: Record<Ticker, ChartSettingsResponse>,
): Promise<void> {
  // Restore the original global view with the first ticker and then restore
  // each ticker-scoped drawing envelope. The API preserves unrelated settings.
  for (const ticker of TICKERS) {
    await postSettings(request, ticker, snapshots[ticker], {
      drawings: snapshots[ticker].data.drawings,
      viewSettings: snapshots.VIC.viewSettings ?? snapshots.VIC.data.viewSettings,
    })
  }
}

async function waitCloudSaved(page: Page): Promise<void> {
  await expect(page.locator('[title="Đã lưu đám mây"]')).toBeVisible({ timeout: 15_000 })
}

async function enterFullscreen(page: Page): Promise<void> {
  if (await page.locator('[title="Phóng to chart"]').isVisible().catch(() => false)) {
    await page.keyboard.press("Backquote")
  }
  await expect(page.locator('[title="Thu nhỏ chart"]')).toBeVisible()
  await expect(page.getByLabel("Thanh công cụ vẽ TradingView")).toBeVisible()
}

async function selectQuickTimeframe(page: Page, timeframe: "1D" | "1h"): Promise<void> {
  await enterFullscreen(page)
  await page.getByRole("button", { name: timeframe, exact: true }).click()
  await expect(page.getByLabel("Chọn khung thời gian")).toContainText(timeframe)
  await expect(page.getByText("Đang tải dữ liệu nến…")).toBeHidden({ timeout: 20_000 })
}

async function fetchLatestBar(
  request: APIRequestContext,
  ticker: Ticker,
  resolution: "1D" | "1h",
): Promise<OhlcvBar> {
  const now = Math.floor(Date.now() / 1000)
  const lookbackDays = resolution === "1D" ? 60 : 30
  const from = now - lookbackDays * 86_400
  const response = await request.get(
    `${BASE_URL}/api/market/ohlcv?ticker=${ticker}&resolution=${resolution}&from=${from}&to=${now}`,
  )
  expect(response.status(), `GET OHLCV ${ticker} ${resolution}`).toBe(200)
  const body = (await response.json()) as OhlcvResponse
  expect(body.ok).toBe(true)
  expect(body.bars.length).toBeGreaterThan(0)
  return body.bars.at(-1) as OhlcvBar
}

async function assertVisibleLatestCandleMatchesApi(
  page: Page,
  request: APIRequestContext,
  ticker: Ticker,
  resolution: "1D" | "1h",
): Promise<void> {
  await selectQuickTimeframe(page, resolution)
  const latest = await fetchLatestBar(request, ticker, resolution)
  const overlay = page.locator("[data-chart-ohlcv-overlay]")
  await expect(overlay).toBeVisible()
  await expect(overlay).toContainText(`O ${latest.open.toFixed(2)}`)
  await expect(overlay).toContainText(`H ${latest.high.toFixed(2)}`)
  await expect(overlay).toContainText(`L ${latest.low.toFixed(2)}`)
  await expect(overlay).toContainText(`C ${latest.close.toFixed(2)}`)
}

async function waitForDrawing(
  request: APIRequestContext,
  ticker: Ticker,
  predicate: (drawing: Drawing) => boolean,
): Promise<Drawing> {
  let match: Drawing | undefined
  await expect.poll(async () => {
    const settings = await getSettings(request, ticker)
    match = settings.data.drawings.find(predicate)
    return Boolean(match)
  }, { timeout: 15_000 }).toBe(true)
  return match as Drawing
}

async function openObjectManager(page: Page): Promise<void> {
  const button = page.locator('[title^="Quản lý đối tượng"]')
  await expect(button).toBeEnabled()
  await button.click()
  await expect(page.getByText(/Quản lý đối tượng \(\d+\)/)).toBeVisible()
}

function maOpacity(settings: ChartSettingsResponse): number | null {
  const view = (settings.viewSettings ?? settings.data.viewSettings ?? {}) as Record<string, unknown>
  const styles = view.indicatorStyles as Record<string, unknown> | undefined
  const ma = styles?.ma as Record<string, unknown> | undefined
  const opacity = ma?.opacity
  return typeof opacity === "number" && Number.isFinite(opacity) ? opacity : null
}

async function waitForMaOpacityPersisted(
  request: APIRequestContext,
  ticker: Ticker,
  value: number,
): Promise<void> {
  await expect.poll(async () => maOpacity(await getSettings(request, ticker)), { timeout: 15_000 }).toBe(value)
}

async function setMaOpacity(
  page: Page,
  request: APIRequestContext,
  ticker: Ticker,
  value: string,
): Promise<void> {
  await page.locator('[title="Chỉ báo kỹ thuật"]').click()
  const input = page.getByLabel("MA (20, 50, 200) opacity")
  await expect(input).toBeVisible()
  await input.focus()
  await input.press("Home")
  const target = Number(value)
  const steps = Math.round((target - 0.1) / 0.05)
  for (let index = 0; index < steps; index += 1) await input.press("ArrowRight")
  await expect(input).toHaveValue(value)
  await page.getByLabel("Đóng bảng chỉ báo").click()
  await waitForMaOpacityPersisted(request, ticker, target)
}

async function expectMaOpacity(page: Page, value: string): Promise<void> {
  await page.locator('[title="Chỉ báo kỹ thuật"]').click()
  await expect(page.getByLabel("MA (20, 50, 200) opacity")).toHaveValue(value)
  await page.getByLabel("Đóng bảng chỉ báo").click()
}


function parseMetric(text: string, label: string): number | null {
  const match = new RegExp(`^${label}\\s+(-?\\d+(?:\\.\\d+)?)$`).exec(text.trim())
  if (!match) return null
  const value = Number(match[1])
  return Number.isFinite(value) ? value : null
}

async function assertMacdPresentation(page: Page): Promise<void> {
  const overlay = page.locator("[data-chart-ohlcv-overlay]")
  const histogram = overlay.locator("span").filter({ hasText: /^HIST / }).first()
  await expect(histogram).toBeVisible()
  const text = (await histogram.textContent()) ?? ""
  const value = parseMetric(text, "HIST")
  expect(value, `MACD histogram must be numeric: ${text}`).not.toBeNull()
  if (value == null) throw new Error(`MACD histogram is not numeric: ${text}`)
  const className = (await histogram.getAttribute("class")) ?? ""
  expect(className).toContain(value >= 0 ? "text-emerald-300" : "text-rose-300")
  await expect(page.locator('[data-chart-runtime="lightweight-charts-v5"]'))
    .toHaveAttribute("data-chart-macd-zero-baseline", "0")
}

async function assertVolumeProfileAxisClearance(page: Page): Promise<void> {
  const canvas = page.locator('canvas[data-chart-indicator-overlay="aligned"]')
  await expect(canvas).toBeVisible()
  const sample = await canvas.evaluate((node) => {
    const element = node as HTMLCanvasElement
    const gutterCss = Number(element.dataset.chartPriceAxisGutter)
    const rect = element.getBoundingClientRect()
    const context = element.getContext("2d")
    if (!context || !Number.isFinite(gutterCss) || gutterCss <= 0 || rect.width <= 0) {
      return { gutterCss, amberPixelsInAxis: -1 }
    }
    const scaleX = element.width / rect.width
    const seamPaddingCss = 2
    const startX = Math.max(0, Math.min(
      element.width - 1,
      Math.round((rect.width - gutterCss + seamPaddingCss) * scaleX),
    ))
    const width = Math.max(1, element.width - startX)
    const pixels = context.getImageData(startX, 0, width, element.height).data
    let amberPixelsInAxis = 0
    for (let index = 0; index < pixels.length; index += 4) {
      const red = pixels[index]
      const green = pixels[index + 1]
      const blue = pixels[index + 2]
      const alpha = pixels[index + 3]
      if (alpha > 24 && red > 180 && green > 90 && green < 240 && blue < 210) {
        amberPixelsInAxis += 1
      }
    }
    return { gutterCss, amberPixelsInAxis }
  })
  expect(sample.gutterCss).toBeGreaterThan(20)
  expect(sample.amberPixelsInAxis, "VPVR/POC must not paint inside the right price-axis gutter").toBe(0)
}

async function assertCrosshairTimestampConsistency(
  page: Page,
  request: APIRequestContext,
  ticker: Ticker,
  resolution: "1D" | "1h",
): Promise<void> {
  await selectQuickTimeframe(page, resolution)
  const now = Math.floor(Date.now() / 1000)
  const from = now - (resolution === "1D" ? 420 : 45) * 86_400
  const response = await request.get(
    `${BASE_URL}/api/market/ohlcv?ticker=${ticker}&resolution=${resolution}&from=${from}&to=${now}`,
  )
  expect(response.status(), `crosshair OHLCV ${ticker} ${resolution}`).toBe(200)
  const body = (await response.json()) as OhlcvResponse
  expect(body.ok).toBe(true)
  expect(body.bars.length).toBeGreaterThan(30)

  const host = page.locator('[data-chart-runtime="lightweight-charts-v5"]')
  const box = await host.boundingBox()
  expect(box).not.toBeNull()
  if (!box) throw new Error("chart host has no bounding box")
  const overlay = page.locator("[data-chart-ohlcv-overlay]")
  const latestTime = body.bars.at(-1)?.time
  let active: OhlcvBar | undefined
  for (const fraction of [0.68, 0.74, 0.80, 0.86, 0.90]) {
    await page.mouse.move(box.x + box.width * fraction, box.y + box.height * 0.28)
    await page.waitForTimeout(100)
    const raw = await overlay.getAttribute("data-chart-active-bar-time")
    const activeTime = raw ? Number(raw) : NaN
    active = body.bars.find((bar) => bar.time === activeTime && bar.time !== latestTime)
    if (active) break
  }
  expect(active, `${ticker} ${resolution} crosshair must resolve a non-latest canonical candle`).toBeTruthy()
  if (!active) throw new Error(`${ticker} ${resolution} crosshair did not resolve a canonical candle`)

  const legendTime = Number(await overlay.getAttribute("data-chart-legend-time"))
  const activeBarTime = Number(await overlay.getAttribute("data-chart-active-bar-time"))
  expect(legendTime).toBe(active.time)
  expect(activeBarTime).toBe(active.time)
  await expect(overlay).toContainText(`O ${active.open.toFixed(2)}`)
  await expect(overlay).toContainText(`H ${active.high.toFixed(2)}`)
  await expect(overlay).toContainText(`L ${active.low.toFixed(2)}`)
  await expect(overlay).toContainText(`C ${active.close.toFixed(2)}`)
  for (const label of ["RSI", "MACD", "SIG", "HIST"]) {
    await expect(overlay.locator("span").filter({ hasText: new RegExp(`^${label} `) }).first()).not.toContainText("—")
  }
}

async function assertDrawingSurvivesViewportChanges(
  page: Page,
  request: APIRequestContext,
  ticker: Ticker,
  drawingId: string,
): Promise<void> {
  const readAnchors = async () => {
    const settings = await getSettings(request, ticker)
    return JSON.stringify(settings.data.drawings.find((drawing) => drawing.id === drawingId)?.anchors ?? null)
  }
  const before = await readAnchors()
  expect(before).not.toBe("null")

  await page.locator('[title="Con trỏ (Crosshair)"]').click()
  const host = page.locator('[data-chart-runtime="lightweight-charts-v5"]')
  const box = await host.boundingBox()
  expect(box).not.toBeNull()
  if (!box) throw new Error("chart host has no bounding box")

  // Native Lightweight Charts zoom + pan must only transform projection.
  await page.mouse.move(box.x + box.width * 0.86, box.y + box.height * 0.22)
  await page.mouse.wheel(0, -600)
  await page.waitForTimeout(180)
  await page.mouse.move(box.x + box.width * 0.88, box.y + box.height * 0.24)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.70, box.y + box.height * 0.24, { steps: 8 })
  await page.mouse.up()
  await expect.poll(readAnchors).toBe(before)

  const originalViewport = page.viewportSize()
  expect(originalViewport).not.toBeNull()
  if (!originalViewport) throw new Error("desktop viewport is unavailable")
  await page.setViewportSize({
    width: Math.max(1100, originalViewport.width - 180),
    height: Math.max(720, originalViewport.height - 90),
  })
  await page.waitForTimeout(180)
  await expect.poll(readAnchors).toBe(before)
  await page.setViewportSize(originalViewport)

  // Re-hydrate a different bar family then return to Daily; market anchors
  // must remain identical and project back into two editable handles.
  await selectQuickTimeframe(page, "1h")
  await selectQuickTimeframe(page, "1D")
  await expect.poll(readAnchors).toBe(before)
  const drawingSvg = page.locator('svg[data-drawing-gesture]')
  await expect(drawingSvg.locator("circle.cursor-nwse-resize")).toHaveCount(2)
}

test("QEO-171 authenticated production acceptance reconciles QEO-90", async ({ page }) => {
  test.setTimeout(180_000)
  const request = page.context().request

  await login(page)

  const snapshots = {
    VIC: await getSettings(request, "VIC"),
    VCB: await getSettings(request, "VCB"),
  }

  try {
    const testView = clone(snapshots.VIC.viewSettings ?? snapshots.VIC.data.viewSettings ?? {})
    const indicatorVisibility = {
      ...((testView.indicatorVisibility as Record<string, boolean> | undefined) ?? {}),
      showMa: true,
      showRsi: true,
      showMacd: true,
      showVolumeProfile: true,
    }
    testView.indicatorVisibility = indicatorVisibility
    testView.rsiCollapsed = false
    testView.macdCollapsed = false

    // Dedicated test account state is made deterministic before the UI matrix.
    await postSettings(request, "VIC", snapshots.VIC, { drawings: [], viewSettings: testView })
    await postSettings(request, "VCB", snapshots.VCB, { drawings: [], viewSettings: testView })

    await page.goto(`${BASE_URL}/insights/vic`)
    await expect(page.locator('[data-chart-runtime="lightweight-charts-v5"]')).toBeVisible({ timeout: 20_000 })

    // Compact projection is intentionally constrained and drawing-free.
    await expect(page.getByText("Nến Nhật · Volume · MA20", { exact: true })).toBeVisible()
    await expect(page.getByLabel("Thanh công cụ vẽ TradingView")).toBeHidden()

    await assertVisibleLatestCandleMatchesApi(page, request, "VIC", "1D")
    const overlay = page.locator("[data-chart-ohlcv-overlay]")
    await expect(overlay).toContainText("RSI ")
    await expect(overlay).toContainText("MACD ")
    await expect(overlay).toContainText("SIG ")
    await expect(overlay).toContainText("HIST ")
    await expect(overlay).toContainText("POC ")
    await expect(page.getByText("VPVR xấp xỉ OHLCV", { exact: true })).toBeVisible()
    await assertMacdPresentation(page)
    await assertVolumeProfileAxisClearance(page)
    await assertCrosshairTimestampConsistency(page, request, "VIC", "1D")

    // Create a canonical two-anchor drawing.
    await page.locator('[title="Đường xu hướng (Trendline)"]').click()
    const drawingSvg = page.locator('svg[data-drawing-gesture]')
    await expect(drawingSvg).toBeVisible()
    const svgBox = await drawingSvg.boundingBox()
    expect(svgBox).not.toBeNull()
    if (!svgBox) throw new Error("drawing SVG has no bounding box")
    await page.mouse.click(svgBox.x + svgBox.width * 0.30, svgBox.y + svgBox.height * 0.34)
    await page.mouse.click(svgBox.x + svgBox.width * 0.62, svgBox.y + svgBox.height * 0.52)
    await waitCloudSaved(page)

    const trendline = await waitForDrawing(request, "VIC", (drawing) => drawing.tool === "trendline")
    expect(trendline.anchors?.length).toBe(2)
    const anchorsAfterCreate = JSON.stringify(trendline.anchors)

    // Select + edit one anchor using the live chart projection.
    await page.locator('[title="Con trỏ (Crosshair)"]').click()
    const handles = drawingSvg.locator("circle.cursor-nwse-resize")
    await expect(handles).toHaveCount(2)
    const handleBox = await handles.nth(1).boundingBox()
    expect(handleBox).not.toBeNull()
    if (!handleBox) throw new Error("drawing handle has no bounding box")
    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(handleBox.x + handleBox.width / 2 + 28, handleBox.y + handleBox.height / 2 - 14, { steps: 5 })
    await page.mouse.up()
    await waitCloudSaved(page)
    await expect.poll(async () => {
      const updated = await getSettings(request, "VIC")
      return JSON.stringify(updated.data.drawings.find((drawing) => drawing.id === trendline.id)?.anchors)
    }).not.toBe(anchorsAfterCreate)

    // Move the whole drawing and prove the persisted market anchors change again.
    const beforeBodyMove = await getSettings(request, "VIC")
    const anchorsBeforeBodyMove = JSON.stringify(beforeBodyMove.data.drawings.find((drawing) => drawing.id === trendline.id)?.anchors)
    const drawingGroup = drawingSvg.locator("g").first()
    const groupBox = await drawingGroup.boundingBox()
    expect(groupBox).not.toBeNull()
    if (!groupBox) throw new Error("drawing group has no bounding box")
    await page.mouse.move(groupBox.x + groupBox.width / 2, groupBox.y + groupBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(groupBox.x + groupBox.width / 2 + 24, groupBox.y + groupBox.height / 2 + 12, { steps: 5 })
    await page.mouse.up()
    await waitCloudSaved(page)
    await expect.poll(async () => {
      const updated = await getSettings(request, "VIC")
      return JSON.stringify(updated.data.drawings.find((drawing) => drawing.id === trendline.id)?.anchors)
    }).not.toBe(anchorsBeforeBodyMove)
    await assertDrawingSurvivesViewportChanges(page, request, "VIC", trendline.id)

    // Object-manager lock/hide state is persisted, not just painted locally.
    await openObjectManager(page)
    await page.locator('[title="Khóa đối tượng"]').first().click()
    await expect(page.locator('[title="Mở khóa"]').first()).toBeVisible()
    await expect.poll(async () => (await getSettings(request, "VIC")).data.drawings.find((drawing) => drawing.id === trendline.id)?.locked).toBe(true)
    await page.locator('[title="Ẩn đối tượng"]').first().click()
    await expect(page.locator('[title="Hiện đối tượng"]').first()).toBeVisible()
    await expect.poll(async () => (await getSettings(request, "VIC")).data.drawings.find((drawing) => drawing.id === trendline.id)?.hidden).toBe(true)
    await page.locator('[title="Hiện đối tượng"]').first().click()
    await page.locator('[title="Mở khóa"]').first().click()

    // Text editor gives us a real editable-field shortcut guard and edit flow.
    await page.getByText(/Quản lý đối tượng \(\d+\)/).locator("..").locator("..").getByRole("button").click()
    await page.locator('[title="Chèn văn bản (Text)"]').click()
    await page.mouse.click(svgBox.x + svgBox.width * 0.48, svgBox.y + svgBox.height * 0.30)
    const editor = page.getByPlaceholder("Nhập nội dung ghi chú...")
    await expect(editor).toBeVisible()
    const note = `QEO-171 ${Date.now()}`
    await editor.fill(note)
    const vicUrl = page.url()
    await page.keyboard.press("Backquote")
    await expect(page.locator('[title="Thu nhỏ chart"]')).toBeVisible()
    await page.keyboard.press("Backspace")
    await page.keyboard.press("ArrowDown")
    expect(page.url()).toBe(vicUrl)
    await page.getByRole("button", { name: "Lưu", exact: true }).click()
    await waitCloudSaved(page)
    const textDrawing = await waitForDrawing(request, "VIC", (drawing) => drawing.tool === "text" && drawing.text === note)
    expect(textDrawing.text).toBe(note)

    // Reload must hydrate ticker drawings and the authenticated global view.
    await page.reload()
    await expect(page.locator('[data-chart-runtime="lightweight-charts-v5"]')).toBeVisible({ timeout: 20_000 })
    await enterFullscreen(page)
    await openObjectManager(page)
    await expect(page.getByText("Đường xu hướng (Trendline)", { exact: true })).toBeVisible()
    await expect(page.getByText(new RegExp(note.slice(0, 18))).first()).toBeVisible()

    // Global indicator style + pane layout persist across tickers; drawings do not.
    await page.getByText(/Quản lý đối tượng \(\d+\)/).locator("..").locator("..").getByRole("button").click()
    await setMaOpacity(page, request, "VIC", "0.55")
    await page.locator('[title="Thu gọn pane RSI"]').click()
    await expect(page.locator('[title="Mở pane RSI"]')).toBeVisible()
    await waitCloudSaved(page)
    await waitForMaOpacityPersisted(request, "VCB", 0.55)

    await page.goto(`${BASE_URL}/insights/vcb`)
    await expect(page.locator('[data-chart-runtime="lightweight-charts-v5"]')).toBeVisible({ timeout: 20_000 })
    await enterFullscreen(page)
    await expect(page.locator('[title="Mở pane RSI"]')).toBeVisible()
    await expectMaOpacity(page, "0.55")
    const vcbSettings = await getSettings(request, "VCB")
    expect(vcbSettings.data.drawings).toHaveLength(0)

    await assertVisibleLatestCandleMatchesApi(page, request, "VCB", "1h")
    await assertCrosshairTimestampConsistency(page, request, "VCB", "1h")

    // Fullscreen watchlist navigation preserves timeframe; editable fields were
    // already proven to suppress these shortcuts above.
    const beforeNavigation = page.url()
    await page.keyboard.press("ArrowDown")
    await expect.poll(() => page.url()).not.toBe(beforeNavigation)
    await expect(page.getByLabel("Chọn khung thời gian")).toContainText("1h")
    await page.keyboard.press("ArrowUp")
    await expect.poll(() => page.url()).toContain("/insights/vcb")

    await page.screenshot({ path: test.info().outputPath("qeo171-vcb-fullscreen.png"), fullPage: true })

    // Return to VIC and prove delete is durable after the reload-persistence proof.
    await page.goto(`${BASE_URL}/insights/vic`)
    await expect(page.locator('[data-chart-runtime="lightweight-charts-v5"]')).toBeVisible({ timeout: 20_000 })
    await enterFullscreen(page)
    await page.screenshot({ path: test.info().outputPath("qeo171-vic-fullscreen.png"), fullPage: true })
    await openObjectManager(page)
    const deleteButtons = page.locator('[title="Xóa đối tượng này"]')
    while (await deleteButtons.count()) {
      await deleteButtons.first().click()
    }
    await waitCloudSaved(page)
    await expect.poll(async () => (await getSettings(request, "VIC")).data.drawings.length).toBe(0)

    // Hydration failure is explicit/retryable. Interception changes only this
    // browser's response; production storage is not corrupted for the test.
    await page.route("**/api/user/chart-drawings?ticker=VIC", async (route) => {
      await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ ok: false, error: "QEO-171 injected hydration failure" }) })
    })
    await page.reload()
    await enterFullscreen(page)
    await expect(page.getByText("Nét vẽ offline — chưa thể sửa", { exact: true })).toBeVisible()
    await page.unroute("**/api/user/chart-drawings?ticker=VIC")
    await page.getByRole("button", { name: "Thử lại", exact: true }).click()
    await expect(page.getByText("Nét vẽ offline — chưa thể sửa", { exact: true })).toBeHidden({ timeout: 15_000 })
    await expect(page.locator('[title="Đường xu hướng (Trendline)"]')).toBeEnabled()
  } finally {
    await page.unroute("**/api/user/chart-drawings?ticker=VIC").catch(() => {})
    await restoreSnapshots(request, snapshots)
  }
})
