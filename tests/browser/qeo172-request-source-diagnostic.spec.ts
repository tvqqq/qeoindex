import { expect, test, type Page } from "@playwright/test"

const BASE_URL = process.env.QEO172_BASE_URL || "https://qeoindex.qeoqeo.com"
const TEST_EMAIL = process.env.QEO171_TEST_EMAIL || ""
const TEST_PASSWORD = process.env.QEO171_TEST_PASSWORD || ""
const ANY_TIMEFRAME = "(?:1D|3D|1W|1M|1Q|1Y)"

type NetworkEvent = {
  kind: "request" | "response"
  at: number
  ticker: string | null
  resolution: string | null
  url: string
}

async function login(page: Page) {
  if (!TEST_EMAIL || !TEST_PASSWORD) throw new Error("QA credentials are required")
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
  if (await terminal.getAttribute("data-chart-maximized") !== "true") await page.keyboard.press("Backquote")
  await expect(terminal).toHaveAttribute("data-chart-maximized", "true", { timeout: 15_000 })
}

async function waitRendered(page: Page, ticker: string, timeframe: string, timeout = 30_000) {
  const terminal = page.locator('[data-chart-terminal="true"]')
  await expect(terminal).toHaveAttribute(
    "data-chart-rendered-key",
    new RegExp(`^${ticker.toUpperCase()}:${timeframe}:\\d+:\\d+$`),
    { timeout },
  )
  return terminal.getAttribute("data-chart-rendered-key")
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

async function clickTimeframe(page: Page, timeframe: "1D" | "3D" | "1W" | "1M") {
  if (timeframe === "1D" || timeframe === "1W") {
    await page.getByRole("button", { name: timeframe, exact: true }).click()
    return
  }
  await page.getByRole("button", { name: "Chọn khung thời gian", exact: true }).click()
  await page.getByText(timeframe, { exact: true }).last().click()
}

async function selectTimeframe(page: Page, timeframe: "1D" | "3D" | "1W" | "1M") {
  const current = await page.locator('[data-chart-rendered-key]').getAttribute("data-chart-rendered-key")
  if (current?.startsWith(`VIC:${timeframe}:`)) return
  await clickTimeframe(page, timeframe)
  await waitRendered(page, "VIC", timeframe)
}

function parseOhlcv(url: string) {
  const parsed = new URL(url)
  return {
    ticker: parsed.searchParams.get("ticker"),
    resolution: parsed.searchParams.get("resolution"),
  }
}

test("QEO-172 production request-source diagnostic", async ({ page }) => {
  test.setTimeout(4 * 60_000)
  await login(page)

  const networkEvents: NetworkEvent[] = []
  page.on("request", (request) => {
    if (!request.url().includes("/api/market/ohlcv")) return
    const parsed = parseOhlcv(request.url())
    networkEvents.push({ kind: "request", at: Date.now(), url: request.url(), ...parsed })
  })
  page.on("response", (response) => {
    if (!response.url().includes("/api/market/ohlcv")) return
    const parsed = parseOhlcv(response.url())
    networkEvents.push({ kind: "response", at: Date.now(), url: response.url(), ...parsed })
  })

  for (let index = 0; index < 3; index += 1) {
    const startedAt = Date.now()
    await page.goto(`${BASE_URL}/insights/vic?qeo172_request_diag=${index}`, { waitUntil: "domcontentloaded" })
    const renderedKey = await waitAnyRendered(page, "VIC")
    const navigation = await page.evaluate(() => {
      const entry = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined
      return entry ? {
        responseEnd: entry.responseEnd,
        domContentLoadedEventEnd: entry.domContentLoadedEventEnd,
        loadEventEnd: entry.loadEventEnd,
      } : null
    })
    const storedTimeframe = await page.evaluate(() => {
      try {
        const raw = localStorage.getItem("qeo_chart_settings_VIC")
        if (!raw) return null
        const parsed = JSON.parse(raw) as { timeframe?: unknown }
        return typeof parsed.timeframe === "string" ? parsed.timeframe : null
      } catch {
        return null
      }
    })
    console.log(`[qeo172-initial-request-diagnostic] ${JSON.stringify({
      index,
      wallMs: Date.now() - startedAt,
      renderedKey,
      storedTimeframe,
      navigation,
    })}`)
  }

  await page.goto(`${BASE_URL}/insights/vic?qeo172_request_diag=sequence`, { waitUntil: "domcontentloaded" })
  await waitAnyRendered(page, "VIC")
  await enterFullscreen(page)
  await selectTimeframe(page, "1D")

  for (const seedTarget of ["1M", "1W"] as const) {
    networkEvents.length = 0
    await selectTimeframe(page, "3D")
    const seedStartedAt = Date.now()
    const eventStart = networkEvents.length
    await clickTimeframe(page, seedTarget)
    const renderedKey = await waitRendered(page, "VIC", seedTarget)
    const renderedAt = Date.now()
    await page.waitForTimeout(1_800)
    const events = networkEvents.slice(eventStart).map((event) => ({
      ...event,
      deltaFromSeedClickMs: event.at - seedStartedAt,
    }))
    console.log(`[qeo172-seed-window-diagnostic] ${JSON.stringify({
      seedTarget,
      renderMs: renderedAt - seedStartedAt,
      renderedKey,
      events,
    })}`)
    await selectTimeframe(page, "1D")
  }
})
