from pathlib import Path
import re


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"missing replacement target: {label}")
    return text.replace(old, new, 1)


chart_path = Path("components/stock-detail/stock-tradingview-chart.tsx")
chart = chart_path.read_text()

chart = replace_once(
    chart,
    '  const rsiSeriesAll = useMemo(() => {\n    return isMaximized && indicators.showRsi ? calculateRsiSeries(displayBars, 14) : []\n  }, [displayBars, isMaximized, indicators.showRsi])',
    '  const rsiSeriesAll = useMemo(() => {\n    return isMaximized ? calculateRsiSeries(displayBars, 14) : []\n  }, [displayBars, isMaximized])',
    "always-on RSI math",
)
chart = replace_once(
    chart,
    '  const macdSeriesAllRaw = useMemo(() => {\n    return isMaximized && indicators.showMacd ? calculateMacdSeries(displayBars) : null\n  }, [displayBars, isMaximized, indicators.showMacd])',
    '  const macdSeriesAllRaw = useMemo(() => {\n    return isMaximized ? calculateMacdSeries(displayBars) : null\n  }, [displayBars, isMaximized])',
    "always-on MACD math",
)
chart = replace_once(
    chart,
    '  const hasRsi = isMaximized && indicators.showRsi\n  const hasMacd = isMaximized && indicators.showMacd',
    '  const hasRsi = isMaximized\n  const hasMacd = isMaximized',
    "always-on lower panes",
)

old_zoom = '''    // Keep bar under cursor stable: proportionally adjust scrollOffset
    const offsetDelta = Math.round(diff * (1 - cursorRatio))
    const nextOffset = Math.max(0, Math.min(maxScrollOffset, scrollOffset + offsetDelta))

    setVisibleBarsCount(nextCount)
    setScrollOffset(nextOffset)'''
new_zoom = '''    // Keep the latest candle anchored when zooming out from the live edge. Older candles
    // are revealed on the left while the future blank area remains available on the right.
    const offsetDelta = Math.round(diff * (1 - cursorRatio))
    const isZoomingOutAtLiveEdge = diff > 0 && scrollOffset === 0
    const nextOffset = isZoomingOutAtLiveEdge
      ? 0
      : Math.max(0, Math.min(maxScrollOffset, scrollOffset + offsetDelta))

    setVisibleBarsCount(nextCount)
    setScrollOffset(nextOffset)'''
chart = replace_once(chart, old_zoom, new_zoom, "live-edge zoom anchoring")

chart, count = re.subn(
    r'\n\s*\{/\* Maximized: Chart Style Dropdown \*/\}.*?\n\s*\{/\* Maximized: Indicators Popover Button \*/\}',
    '\n\n          {/* Maximized: Indicators Popover Button */}',
    chart,
    count=1,
    flags=re.S,
)
if count != 1:
    raise SystemExit("failed to remove chart-style dropdown")

chart, count = re.subn(
    r'\n\s*\{/\* OHLCV live readout \*/\}.*?\n\s*\{/\* Action Buttons: Reset View, Screenshot, Maximize/Minimize \*/\}',
    '\n\n          {/* Action Buttons: Reset View, Screenshot, Maximize/Minimize */}',
    chart,
    count=1,
    flags=re.S,
)
if count != 1:
    raise SystemExit("failed to relocate OHLCV readout")

candle_block = '''          {/* 5. Main Candlesticks — canonical Japanese candles */}
          {visibleBars.map((bar, i) => {
            const x = getX(i)
            const isBull = bar.close >= bar.open
            const color = isBull ? "#10b981" : "#f43f5e"
            const highY = getY(bar.high)
            const lowY = getY(bar.low)
            const openY = getY(bar.open)
            const closeY = getY(bar.close)
            const bodyTop = Math.min(openY, closeY)
            const bodyHeight = Math.max(1.5, Math.abs(closeY - openY))
            const candleW = Math.max(2, plotWidth / visibleSlotCount - 2)

            return (
              <g key={`c-${bar.time}-${i}`}>
                <line x1={x} y1={highY} x2={x} y2={lowY} stroke={color} strokeWidth="1.2" />
                <rect
                  x={x - candleW / 2}
                  y={bodyTop}
                  width={candleW}
                  height={bodyHeight}
                  fill={color}
                  stroke="none"
                  rx="1"
                />
              </g>
            )
          })}

'''
chart, count = re.subn(
    r'\s*\{/\* 5\. Main Candlesticks / Line Chart \*/\}.*?(?=\s*\{/\* Moving Averages)',
    '\n' + candle_block,
    chart,
    count=1,
    flags=re.S,
)
if count != 1:
    raise SystemExit("failed to canonicalize candle renderer")

chart = replace_once(
    chart,
    '  const activeIndicatorsCount = Object.values(indicators).filter(Boolean).length',
    '  const activeIndicatorsCount = [\n    indicators.showMa,\n    indicators.showIchimoku,\n    indicators.showQeoBase129,\n    indicators.showBollinger,\n    indicators.showVolumeProfile,\n  ].filter(Boolean).length',
    "indicator counter",
)

marker = '        {/* Floating Drawing Toolbar on the Left (Only in Maximized Mode) */}'
overlay = '''        {/* TradingView-style in-plot OHLCV readout, below the timeframe rail. */}
        {isMaximized && activeBar && (
          <div className="pointer-events-none absolute left-14 top-2 z-20 flex flex-wrap items-center gap-2 font-mono text-[10px] text-slate-400">
            <span className="text-slate-500">
              {new Date(activeBar.time * 1000).toLocaleDateString("vi-VN", {
                day: "2-digit",
                month: "2-digit",
                year: "numeric",
              })}
            </span>
            <span>O: <b className="text-slate-200">{activeBar.open.toLocaleString()}</b></span>
            <span>H: <b className="text-emerald-300">{activeBar.high.toLocaleString()}</b></span>
            <span>L: <b className="text-rose-300">{activeBar.low.toLocaleString()}</b></span>
            <span>C: <b className={activeBar.close >= activeBar.open ? "text-emerald-300" : "text-rose-300"}>{activeBar.close.toLocaleString()}</b></span>
            <span>V: <b className="text-slate-200">{formatCompactVolume(activeBar.volume)}</b></span>
          </div>
        )}

'''
chart = replace_once(chart, marker, overlay + marker, "in-plot OHLCV overlay")
chart = chart.replace('    chartStyle,\n    setChartStyle,\n', '', 1)
chart = chart.replace('  const [showStyleDropdown, setShowStyleDropdown] = useState(false)\n', '', 1)
chart_path.write_text(chart)

css_path = Path("components/stock-detail/chart/stock-chart-terminal-shell.module.css")
css = css_path.read_text()
css, count = re.subn(
    r'/\* Turn the drawing toolbox into a compact TradingView-style rail instead of a floating card\. \*/.*?(?=/\* Keep the main rail controls)',
    '''/* Floating TradingView-style drawing capsule; do not consume a fixed chart column. */
.terminalSurface > div:first-child > div:nth-child(2) aside[aria-label="Thanh công cụ vẽ TradingView"] {
  top: 12px !important;
  left: 12px !important;
  bottom: auto !important;
  max-height: calc(100% - 24px);
  gap: 3px !important;
  overflow-y: auto;
  border: 1px solid rgba(255, 255, 255, 0.1) !important;
  border-radius: 18px !important;
  background: rgba(10, 15, 22, 0.94) !important;
  padding: 7px 5px !important;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.62) !important;
  backdrop-filter: blur(10px);
}

''',
    css,
    count=1,
    flags=re.S,
)
if count != 1:
    raise SystemExit("failed to restore floating drawing capsule")
css = css.replace(
    "/* Keep the main rail controls a touch larger and softly rounded like the earlier UI. */",
    "/* Keep floating capsule controls comfortably sized and softly rounded. */",
    1,
)
css_path.write_text(css)

modal_path = Path("components/stock-detail/chart/stock-chart-indicator-modal.tsx")
modal = modal_path.read_text()
modal = modal.replace(
    "Check, Activity, BarChart2, TrendingUp, Layers, Compass, Sparkles, X",
    "Check, BarChart2, TrendingUp, Layers, Compass, Sparkles, X",
    1,
)
modal, rsi_count = re.subn(r'\n\s*\{\n\s*key: "showRsi",.*?\n\s*\},', '', modal, count=1, flags=re.S)
modal, macd_count = re.subn(r'\n\s*\{\n\s*key: "showMacd",.*?\n\s*\},', '', modal, count=1, flags=re.S)
if rsi_count != 1 or macd_count != 1:
    raise SystemExit("failed to remove RSI/MACD indicator picker rows")
modal = modal.replace(
    "  const enabledCount = Object.values(config).filter(Boolean).length",
    "  const enabledCount = indicators.filter((ind) => Boolean(config[ind.key])).length",
    1,
)
modal_path.write_text(modal)

test_path = Path("tests/stock-chart-interaction.test.ts")
tests = test_path.read_text()
anchor = 'test("StockTradingViewChart keeps TradingView-style future space and scalable price rail", () => {'
guard = '''test("StockTradingViewChart keeps live-edge zoom history, floating tools, canonical candles and permanent lower panes", () => {
  const chartCode = source("components/stock-detail/stock-tradingview-chart.tsx")
  const modalCode = source("components/stock-detail/chart/stock-chart-indicator-modal.tsx")
  const shellCode = source("components/stock-detail/chart/stock-chart-terminal-shell.module.css")

  assert.match(chartCode, /isZoomingOutAtLiveEdge = diff > 0 && scrollOffset === 0/)
  assert.match(chartCode, /Main Candlesticks — canonical Japanese candles/)
  assert.doesNotMatch(chartCode, /Maximized: Chart Style Dropdown/)
  assert.match(chartCode, /const hasRsi = isMaximized/)
  assert.match(chartCode, /const hasMacd = isMaximized/)
  assert.match(chartCode, /TradingView-style in-plot OHLCV readout/)
  assert.doesNotMatch(modalCode, /key: "showRsi"/)
  assert.doesNotMatch(modalCode, /key: "showMacd"/)
  assert.match(shellCode, /border-radius: 18px !important/)
  assert.match(shellCode, /bottom: auto !important/)
})

'''
if guard not in tests:
    tests = replace_once(tests, anchor, guard + anchor, "interaction regression guard")
test_path.write_text(tests)
