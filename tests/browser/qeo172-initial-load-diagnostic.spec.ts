import { expect, test, type Page } from "@playwright/test"

const BASE_URL = process.env.QEO172_BASE_URL ?? "https://qeoindex.qeoqeo.com"
const TEST_EMAIL = process.env.QEO171_TEST_EMAIL
const TEST_PASSWORD = process.env.QEO171_TEST_PASSWORD
const SAMPLES = 10

async function login(page: Page) {
  if (!TEST_EMAIL || !TEST_PASSWORD) {
    throw new Error("QEO171_TEST_EMAIL and QEO171_TEST_PASSWORD are required for QEO-172 production diagnostic")
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

async function waitAnyRendered(page: Page, ticker: string, timeout = 30_000) {
  const terminal = page.locator('[data-chart-terminal="true"]')
  await expect(terminal).toHaveAttribute(
    "data-chart-rendered-key",
    new RegExp(`^${ticker.toUpperCase()}:(?:1D|3D|1W|1M|1Q|1Y):\\d+:\\d+$`),
    { timeout },
  )
  return terminal.getAttribute("data-chart-rendered-key")
}

test("QEO-172 browser initial-load phase diagnostic", async ({ page }) => {
  await login(page)
  const cdp = await page.context().newCDPSession(page)
  await cdp.send("Network.enable")
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true })

  try {
    for (let index = 0; index < SAMPLES; index += 1) {
      const wallStartedAt = Date.now()
      await page.goto(`${BASE_URL}/insights/vic?qeo172_diag=${index}`, { waitUntil: "domcontentloaded" })
      const renderedKey = await waitAnyRendered(page, "VIC")
      const wallMs = Date.now() - wallStartedAt
      const timing = await page.evaluate(() => {
        const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined
        const resources = performance.getEntriesByType("resource") as PerformanceResourceTiming[]
        const scripts = resources.filter((entry) => entry.initiatorType === "script")
        const paints = performance.getEntriesByType("paint")
        const fcp = paints.find((entry) => entry.name === "first-contentful-paint")?.startTime ?? null
        const topResources = [...resources]
          .sort((a, b) => b.duration - a.duration)
          .slice(0, 8)
          .map((entry) => ({
            name: entry.name.replace(location.origin, ""),
            type: entry.initiatorType,
            start: Math.round(entry.startTime),
            end: Math.round(entry.responseEnd),
            duration: Math.round(entry.duration),
            transferSize: entry.transferSize,
          }))
        return {
          now: Math.round(performance.now()),
          responseStart: navigation ? Math.round(navigation.responseStart) : null,
          responseEnd: navigation ? Math.round(navigation.responseEnd) : null,
          domInteractive: navigation ? Math.round(navigation.domInteractive) : null,
          domContentLoaded: navigation ? Math.round(navigation.domContentLoadedEventEnd) : null,
          loadEventEnd: navigation ? Math.round(navigation.loadEventEnd) : null,
          fcp: fcp == null ? null : Math.round(fcp),
          scriptCount: scripts.length,
          scriptMaxEnd: scripts.length ? Math.round(Math.max(...scripts.map((entry) => entry.responseEnd))) : null,
          scriptTransferBytes: scripts.reduce((sum, entry) => sum + entry.transferSize, 0),
          topResources,
        }
      })
      console.log("[qeo172-initial-diagnostic]", JSON.stringify({ index, wallMs, renderedKey, ...timing }))
    }
  } finally {
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: false })
    await cdp.detach()
  }
})
