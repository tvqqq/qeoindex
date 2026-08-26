type JsonObject = Record<string, unknown>

export type HistoryRow = {
  ticker: string
  period: string
  period_year: number
  period_quarter: number
  fourm_score: number | null
  canslim_score: number | null
  fourm_components: Record<string, number>
  canslim_components: Record<string, number>
  fetched_at: string
}

function asObject(value: unknown): JsonObject | null {
  return value != null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null
}

function numeric(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = Number(trimmed.replace(/,/g, ""))
  return Number.isFinite(parsed) ? parsed : null
}

function boundedScore(value: unknown): number | null {
  const parsed = numeric(value)
  return parsed != null && parsed >= 0 && parsed <= 100 ? parsed : null
}

function periodParts(period: string) {
  const match = /^Q([1-4])\.(\d{2})$/.exec(period)
  if (!match) return null
  return { quarter: Number(match[1]), year: 2000 + Number(match[2]) }
}

function comparePeriods(left: string, right: string) {
  const a = periodParts(left)
  const b = periodParts(right)
  if (!a || !b) return left.localeCompare(right)
  return a.year - b.year || a.quarter - b.quarter
}

function historyPeriods(option: unknown) {
  const root = asObject(option)
  const xAxis = asObject(root?.xAxis)
  return (Array.isArray(xAxis?.data) ? xAxis.data.map(String) : []).filter((period) => periodParts(period))
}

function tablePeriods(table: unknown) {
  if (!Array.isArray(table) || !Array.isArray(table[0])) return []
  return (table[0] as unknown[]).slice(1).map(String).filter((period) => periodParts(period))
}

function parseHistorySeries(option: unknown) {
  const root = asObject(option)
  const periods = historyPeriods(option)
  const series = Array.isArray(root?.series) ? root.series : []
  const firstSeries = asObject(series[0])
  const values = Array.isArray(firstSeries?.data) ? firstSeries.data : []
  const result = new Map<string, number>()
  for (let index = 0; index < Math.min(periods.length, values.length); index += 1) {
    const value = boundedScore(values[index])
    if (value != null) result.set(periods[index], value)
  }
  return result
}

function parseComponentTable(table: unknown) {
  if (!Array.isArray(table) || !Array.isArray(table[0])) return new Map<string, Record<string, number>>()
  const periods = tablePeriods(table)
  const result = new Map<string, Record<string, number>>()
  for (const rawRow of table.slice(1)) {
    if (!Array.isArray(rawRow) || rawRow.length < 2) continue
    const label = String(rawRow[0] || "").trim()
    if (!label) continue
    const values = rawRow.slice(1)
    // KFSP occasionally returns fewer values than headers. Right alignment keeps
    // the latest values attached to the latest provider periods.
    const offset = Math.max(0, periods.length - values.length)
    values.forEach((rawValue, index) => {
      const period = periods[offset + index]
      const value = boundedScore(rawValue)
      if (!period || value == null) return
      const bucket = result.get(period) || {}
      bucket[label] = value
      result.set(period, bucket)
    })
  }
  return result
}

function parseCurrentRadar(option: unknown) {
  const root = asObject(option)
  const radar = asObject(root?.radar)
  const indicators = Array.isArray(radar?.indicator) ? radar.indicator : []
  const series = Array.isArray(root?.series) ? root.series : []
  const firstSeries = asObject(series[0])
  const firstData = Array.isArray(firstSeries?.data) ? firstSeries.data[0] : null
  const values = Array.isArray(firstData) ? firstData : []
  const result: Record<string, number> = {}
  indicators.forEach((indicator, index) => {
    const name = String(asObject(indicator)?.name || "").trim()
    const value = boundedScore(values[index])
    if (name && value != null) result[name] = value
  })
  return result
}

export function normalizeTtaiHistory(ticker: string, payload: unknown, fetchedAt: string): HistoryRow[] {
  const root = asObject(payload)
  if (!root) throw new Error("KFSP_TTAI_RESPONSE_INVALID")

  const periods = [...new Set([
    ...historyPeriods(root.fourm_option_history_chart),
    ...historyPeriods(root.canslim_option_history_chart),
    ...tablePeriods(root.data_table_4m),
    ...tablePeriods(root.data_table_canslim),
  ])].sort(comparePeriods)
  if (!periods.length) throw new Error("KFSP_TTAI_PERIODS_MISSING")

  const fourmScores = parseHistorySeries(root.fourm_option_history_chart)
  const canslimScores = parseHistorySeries(root.canslim_option_history_chart)
  const fourmComponents = parseComponentTable(root.data_table_4m)
  const canslimComponents = parseComponentTable(root.data_table_canslim)

  const latestPeriod = periods.at(-1)!
  const currentFourm = boundedScore(root.fourm_point)
  const currentCanslim = boundedScore(root.canslim_point)
  if (currentFourm != null) fourmScores.set(latestPeriod, currentFourm)
  if (currentCanslim != null) canslimScores.set(latestPeriod, currentCanslim)

  const latestFourmRadar = parseCurrentRadar(root.fourm_option_chart)
  const latestCanslimRadar = parseCurrentRadar(root.canslim_option_chart)
  if (Object.keys(latestFourmRadar).length) fourmComponents.set(latestPeriod, latestFourmRadar)
  if (Object.keys(latestCanslimRadar).length) canslimComponents.set(latestPeriod, latestCanslimRadar)

  return periods.map((period) => {
    const parts = periodParts(period)!
    return {
      ticker,
      period,
      period_year: parts.year,
      period_quarter: parts.quarter,
      fourm_score: fourmScores.get(period) ?? null,
      canslim_score: canslimScores.get(period) ?? null,
      fourm_components: fourmComponents.get(period) || {},
      canslim_components: canslimComponents.get(period) || {},
      fetched_at: fetchedAt,
    }
  })
}

export function isTtaiNoHistoryError(error: unknown) {
  return error instanceof Error && error.message === "KFSP_TTAI_PERIODS_MISSING"
}
