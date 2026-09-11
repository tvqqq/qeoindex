import { mkdirSync, writeFileSync } from "node:fs"
import { expect, test, type Page } from "@playwright/test"
import { ALL_TIMEFRAMES } from "../../components/stock-detail/chart/stock-chart-types"

const BASE_URL = process.env.QEO173_BASE_URL ?? "https://qeoindex.qeoqeo.com"
const TEST_EMAIL = process.env.QEO171_TEST_EMAIL
const TEST_PASSWORD = process.env.QEO171_TEST_PASSWORD
const TICKERS = ["VIC", "VCB"] as const
const TIMEFRAME_PATTERN = ALL_TIMEFRAMES.map(({ id }) => id).join("|")

type EvidenceRow = {
  ticker: string
  mode: "compact" | "fullscreen"
  terminalHeight: number
  plotHeight: number
  plotRatio: number
  financialHeader: string
}

async function login(page: Page) {
  if (!TEST_EMAIL || !TEST_PASSWORD) {
    throw new Error("QEO171_TEST_EMAIL and QEO171_TEST_PASSWORD are required for QEO-173 production visual acceptance")
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

async function waitRendered(page: Page, ticker: string) {
  const terminal = page.locator('[data-chart-terminal="true"]')
  await expect(terminal).toBeVisible({ timeout: 20_000 })
  // QEO-173 must preserve the user's persisted timeframe. Production QA only
  // requires the requested ticker to finish rendering on any supported chart
  // timeframe; it must not force or assume the default 1D state.
  await expect(terminal).toHaveAttribute(
    "data-chart-rendered-key",
    new RegExp(`^${ticker}:(?:${TIMEFRAME_PATTERN}):\\d+:\\d+$`),
    { timeout: 30_000 },
  )
  return terminal
}

async function collectEvidence(page: Page, ticker: string, mode: "compact" | "fullscreen"): Promise<EvidenceRow> {
  const terminal = page.locator('[data-chart-terminal="true"]')
  const plot = page.locator('[data-chart-plot="lightweight"]')
  const header = page.locator('[data-chart-financial-header]')

  await expect(header).toBeAttached()
  if (mode === "fullscreen") {
    for (const pane of ["volume", "rsi", "macd"]) {
      await expect(page.locator(`[data-chart-pane-header="${pane}"]`)).toBeAttached()
    }
  }

  const terminalBox = await terminal.boundingBox()
  const plotBox = await plot.boundingBox()
  expect(terminalBox).not.toBeNull()
  expect(plotBox).not.toBeNull()
  const terminalHeight = terminalBox?.height ?? 1
  const plotHeight = plotBox?.height ?? 0
  const plotRatio = plotHeight / terminalHeight

  // Chrome must remain bounded; compact/fullscreen both keep most vertical
  // space inside the actual plotting surface.
  expect(plotRatio).toBeGreaterThan(mode === "fullscreen" ? 0.80 : 0.84)

  const headerText = (await header.textContent())?.replace(/\s+/g, " ").trim() ?? ""
  expect(headerText).toContain(ticker)
  expect(headerText).toMatch(/HOSE|HNX|UPCOM/)
  expect(headerText).toMatch(/LIVE|CLOSED|STALE/)

  await page.screenshot({
    path: `test-results/qeo173-${ticker.toLowerCase()}-${mode}.png`,
    fullPage: false,
  })

  return { ticker, mode, terminalHeight, plotHeight, plotRatio, financialHeader: headerText }
}

test("QEO-173 authenticated VIC + VCB compact/fullscreen visual acceptance", async ({ page }) => {
  test.setTimeout(4 * 60_000)
  mkdirSync("test-results", { recursive: true })
  await login(page)

  const evidence: EvidenceRow[] = []
  for (const ticker of TICKERS) {
    await page.goto(`${BASE_URL}/insights/${ticker.toLowerCase()}`)
    const terminal = await waitRendered(page, ticker)
    await expect(terminal).toHaveAttribute("data-chart-maximized", "false")
    evidence.push(await collectEvidence(page, ticker, "compact"))

    await page.keyboard.press("Backquote")
    await expect(terminal).toHaveAttribute("data-chart-maximized", "true", { timeout: 15_000 })
    evidence.push(await collectEvidence(page, ticker, "fullscreen"))

    // Canonical crosshair timestamp stays owned by the chart legend and is
    // mirrored into every pane header rather than creating independent clocks.
    const legend = page.locator("[data-chart-legend-time]")
    await expect(legend).toBeAttached()
    const legendTime = await legend.getAttribute("data-chart-legend-time")
    for (const pane of ["volume", "rsi", "macd"]) {
      await expect(page.locator(`[data-chart-pane-header="${pane}"]`)).toHaveAttribute(
        "data-chart-pane-time",
        legendTime ?? "",
      )
    }

    // Existing chart render engine/axis contract remains present.
    await expect(page.locator('[data-chart-runtime="lightweight-charts-v5"]')).toBeAttached()
    await expect(page.locator('[data-chart-indicator-overlay="aligned"]')).toHaveAttribute("data-chart-price-axis-gutter", /\d+/)
  }

  // During an uncached ticker navigation the current center column remains
  // fully usable/visible: no opacity dim and no pointer-events lock.
  await page.goto(`${BASE_URL}/insights/vic`)
  await waitRendered(page, "VIC")
  const targetLink = page.locator('aside a[href="/insights/vcb"]').first()
  if (await targetLink.count()) {
    await targetLink.click()
    const transition = page.locator("[data-qeo173-transition-indicator]")
    if (await transition.count()) {
      await expect(transition).toBeVisible()
      const center = page.locator("section[aria-busy]").first()
      await expect(center).not.toHaveClass(/opacity-35/)
      await expect(center).not.toHaveClass(/pointer-events-none/)
    }
  }

  writeFileSync("test-results/qeo173-ui-evidence.json", `${JSON.stringify(evidence, null, 2)}\n`)
})
