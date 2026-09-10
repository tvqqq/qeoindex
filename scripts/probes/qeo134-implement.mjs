import fs from "node:fs"

function replaceOnce(path, oldText, newText) {
  const source = fs.readFileSync(path, "utf8")
  const count = source.split(oldText).length - 1
  if (count !== 1) throw new Error(`${path}: expected exactly one anchor, found ${count}`)
  fs.writeFileSync(path, source.replace(oldText, newText))
}

const provider = `import "server-only"

const TOPI_API_BASE = "https://apiclient.topi.vn/api-web"
const TOPI_TARGET_VNINDEX = 0
const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_TRANSIENT_ATTEMPTS = 3

export interface TopiMarketSentimentData {
  score: number
  label: string | null
  asOf: string | null
  history: Array<{ tradingDate: string; value: number }>
}

export interface FetchTopiMarketSentimentOptions {
  fetchImpl?: typeof fetch
  timeoutMs?: number
  transientAttempts?: number
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function readFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replaceAll(",", ""))
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function unwrapTopiData(payload: unknown): unknown {
  let current = payload
  for (let depth = 0; depth < 5; depth += 1) {
    const record = asRecord(current)
    if (!record) return current
    if (Object.prototype.hasOwnProperty.call(record, "Data")) return record.Data
    if (Object.prototype.hasOwnProperty.call(record, "data")) {
      current = record.data
      continue
    }
    return current
  }
  return current
}

export function parseTopiMarketDate(value: unknown): string | null {
  const text = readString(value)
  if (!text) return null
  const viDate = /^(\\d{2})[/-](\\d{2})[/-](\\d{4})$/.exec(text)
  if (viDate) return \\`${viDate[3]}-${viDate[2]}-${viDate[1]}\\`
  const isoDate = /^(\\d{4})-(\\d{2})-(\\d{2})/.exec(text)
  return isoDate ? \\`${isoDate[1]}-${isoDate[2]}-${isoDate[3]}\\` : null
}

export function parseTopiMarketSentiment(currentPayload: unknown, historyPayload: unknown): TopiMarketSentimentData | null {
  const current = asRecord(unwrapTopiData(currentPayload))
  const score = current ? readFiniteNumber(current.Score ?? current.score) : null
  if (score == null || score < 0 || score > 100) return null

  const rows = unwrapTopiData(historyPayload)
  const historyByDate = new Map<string, number>()
  if (Array.isArray(rows)) {
    for (const value of rows) {
      const row = asRecord(value)
      if (!row) continue
      const tradingDate = parseTopiMarketDate(row.Date ?? row.date)
      const point = readFiniteNumber(row.Score ?? row.score)
      if (!tradingDate || point == null || point < 0 || point > 100) continue
      historyByDate.set(tradingDate, point)
    }
  }

  return {
    score,
    label: readString(current?.SentimentLevel ?? current?.sentimentLevel),
    asOf: parseTopiMarketDate(current?.Date ?? current?.date),
    history: [...historyByDate.entries()]
      .map(([tradingDate, value]) => ({ tradingDate, value }))
      .sort((left, right) => left.tradingDate.localeCompare(right.tradingDate)),
  }
}

function isRetryable(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return /\\b(408|429|5\\d\\d)\\b|timeout|timed out|AbortError|fetch failed|network|ECONNRESET|ENETUNREACH|EAI_AGAIN/i.test(message)
}

async function postTopi(path: "GetFGIndex" | "GetFGChart", body: Record<string, number>, fetchImpl: typeof fetch, timeoutMs: number) {
  const response = await fetchImpl(\\`${TOPI_API_BASE}/\${path}\\`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(\\`TOPI \${path} failed (\${response.status})\\`)
  return response.json() as Promise<unknown>
}

export async function fetchTopiMarketSentiment({
  fetchImpl = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  transientAttempts = DEFAULT_TRANSIENT_ATTEMPTS,
}: FetchTopiMarketSentimentOptions = {}): Promise<TopiMarketSentimentData | null> {
  if (!Number.isInteger(transientAttempts) || transientAttempts < 1 || transientAttempts > 5) {
    throw new Error("TOPI transientAttempts must be between 1 and 5")
  }

  let lastError: unknown = null
  for (let attempt = 1; attempt <= transientAttempts; attempt += 1) {
    try {
      const [current, history] = await Promise.all([
        postTopi("GetFGIndex", { Target: TOPI_TARGET_VNINDEX }, fetchImpl, timeoutMs),
        postTopi("GetFGChart", { Target: TOPI_TARGET_VNINDEX, Days: 0 }, fetchImpl, timeoutMs),
      ])
      return parseTopiMarketSentiment(current, history)
    } catch (error) {
      lastError = error
      if (!isRetryable(error) || attempt >= transientAttempts) break
      await new Promise<void>((resolve) => setTimeout(resolve, Math.min(2_000, 300 * 2 ** (attempt - 1))))
    }
  }

  throw lastError instanceof Error ? lastError : new Error("TOPI sentiment request failed")
}
`
fs.mkdirSync("modules/research/market-insight", { recursive: true })
fs.writeFileSync("modules/research/market-insight/topi-sentiment.ts", provider)

replaceOnce(
  "modules/research/insights/data.ts",
  'import { getMarketCloseInsightData, type MarketCloseDashboardData } from "@/modules/research/market-insight/data"',
  'import { getMarketCloseInsightData, type MarketCloseDashboardData } from "@/modules/research/market-insight/data"\nimport { fetchTopiMarketSentiment, type TopiMarketSentimentData } from "@/modules/research/market-insight/topi-sentiment"',
)

replaceOnce(
  "modules/research/insights/data.ts",
  `function settledValue<T>(result: PromiseSettledResult<T>): T | null {
  return result.status === "fulfilled" ? result.value : null
}
`,
  `function settledValue<T>(result: PromiseSettledResult<T>): T | null {
  return result.status === "fulfilled" ? result.value : null
}

function withCurrentMarketSentiment(
  data: MarketCloseDashboardData | null,
  sentiment: TopiMarketSentimentData | null,
): MarketCloseDashboardData | null {
  if (!data) return null
  return {
    ...data,
    dailySummary: {
      ...data.dailySummary,
      sentimentScore: sentiment?.score ?? null,
      sentimentLabel: sentiment?.label ?? null,
      sentimentHistory: sentiment?.history ?? [],
    },
  }
}
`,
)

replaceOnce(
  "modules/research/insights/data.ts",
  `    getResearchOverviewData(),
    getMarketCloseInsightData(supabase),
  ] as const)`,
  `    getResearchOverviewData(),
    getMarketCloseInsightData(supabase),
    fetchTopiMarketSentiment(),
  ] as const)`,
)

replaceOnce(
  "modules/research/insights/data.ts",
  `  const research = settledValue(settled[5])
  const marketClose = settledValue(settled[6])
  const marketAiConclusion = await loadMarketAiConclusion(getSupabaseServerClient(), marketClose)`,
  `  const research = settledValue(settled[5])
  const persistedMarketClose = settledValue(settled[6])
  const currentMarketSentiment = settledValue(settled[7])
  const marketClose = withCurrentMarketSentiment(persistedMarketClose, currentMarketSentiment)
  const marketAiConclusion = await loadMarketAiConclusion(getSupabaseServerClient(), persistedMarketClose)`,
)

replaceOnce(
  "components/insights/market-close-dashboard.tsx",
  'import { MarketHealthView, MarketSentimentCard } from "@/components/insights/market-health-view"',
  'import { MarketHealthView, MarketSentimentCard, MarketSentimentHistoryCard } from "@/components/insights/market-health-view"',
)

replaceOnce(
  "components/insights/market-close-dashboard.tsx",
  `          <CardContent className="p-4 sm:p-5 min-h-[650px]">
            <MarketBubbles`,
  `          <CardContent className="p-4 sm:p-5 min-h-[650px]">
            <div data-market-index-strip className="mb-4 grid grid-cols-2 gap-2 xl:grid-cols-4">
              {data.indexes.map((item) => <IndexTile key={item.indexCode} item={item} />)}
            </div>
            <MarketBubbles`,
)

replaceOnce(
  "components/insights/market-close-dashboard.tsx",
  `  const { dailySummary, indexes, history, marketRegime } = data`,
  `  const { dailySummary, indexes, history, marketRegime } = data`,
)

replaceOnce(
  "components/insights/market-close-dashboard.tsx",
  `            <div data-market-index-column className="flex h-full flex-col rounded-2xl border border-white/[0.08] bg-[#07131d]/90 p-4 shadow-xl sm:p-5">
              <div data-market-index-strip className="grid flex-1 grid-cols-2 gap-2">
                {indexes.map((item) => <IndexTile key={item.indexCode} item={item} />)}
              </div>
              <p className="mt-2 px-1 text-[11px] font-mono text-slate-400">Phiên {data.sessionDate} · cập nhật {formatTime(data.asOf)} · nguồn KFSP Ngành</p>
            </div>`,
  `            <div data-market-sentiment-history-column className="h-full [&>*]:h-full">
              <MarketSentimentHistoryCard data={data}/>
            </div>`,
)

replaceOnce(
  "components/insights/market-health-view.tsx",
  `export function MarketSentimentCard({ data }: { data: MarketCloseDashboardData }) {
  const score = data.dailySummary.sentimentScore
  return (
    <div className="rounded-2xl border border-white/[0.08] bg-[#07131d]/90 p-4 sm:p-5 shadow-xl">
      <MarketWidgetChildHeader icon={HeartPulse} title="Chỉ báo tâm lý" description="Đo lường mức độ hưng phấn / sợ hãi" asOf={data.asOf} quality={data.qualityStatus} />
      {score == null ? <div className="flex h-[210px] items-center justify-center text-sm text-slate-500">KFSP chưa trả chỉ báo tâm lý.</div> : <SentimentGauge score={score} />}
    </div>
  )
}`,
  `export function MarketSentimentCard({ data }: { data: MarketCloseDashboardData }) {
  const score = data.dailySummary.sentimentScore
  return (
    <div className="rounded-2xl border border-white/[0.08] bg-[#07131d]/90 p-4 sm:p-5 shadow-xl">
      <MarketWidgetChildHeader icon={HeartPulse} title="Chỉ báo tâm lý" description="Đo lường mức độ hưng phấn / sợ hãi" asOf={data.asOf} quality={data.qualityStatus} />
      {score == null ? <div className="flex h-[210px] items-center justify-center text-sm text-slate-500">Chưa có dữ liệu chỉ báo tâm lý.</div> : <SentimentGauge score={score} />}
    </div>
  )
}

const SENTIMENT_HISTORY_RANGES = [
  { label: "1M", days: 30 },
  { label: "3M", days: 90 },
  { label: "6M", days: 180 },
  { label: "12M", days: 360 },
  { label: "Tất cả", days: 0 },
] as const

function SentimentHistoryTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload?: { tradingDate?: string; value?: number } }> }) {
  const point = payload?.[0]?.payload
  if (!active || !point || point.value == null) return null
  return (
    <div className="rounded-lg border border-white/15 bg-[#08131e] p-2.5 font-mono text-xs shadow-xl">
      <p className="text-[11px] text-slate-400">{point.tradingDate}</p>
      <p className="mt-1 font-bold text-cyan-300">Điểm tâm lý: {point.value.toFixed(1)}</p>
    </div>
  )
}

export function MarketSentimentHistoryCard({ data }: { data: MarketCloseDashboardData }) {
  const [rangeDays, setRangeDays] = React.useState<number>(90)
  const history = data.dailySummary.sentimentHistory
  const visibleHistory = React.useMemo(() => {
    if (rangeDays === 0 || history.length < 2) return history
    const latest = Date.parse(history[history.length - 1]?.tradingDate || "")
    if (!Number.isFinite(latest)) return history
    const cutoff = latest - rangeDays * 24 * 60 * 60 * 1000
    return history.filter((point) => {
      const timestamp = Date.parse(point.tradingDate)
      return Number.isFinite(timestamp) && timestamp >= cutoff
    })
  }, [history, rangeDays])

  return (
    <div className="rounded-2xl border border-white/[0.08] bg-[#07131d]/90 p-4 shadow-xl sm:p-5">
      <MarketWidgetChildHeader icon={BarChart3} title="Lịch sử chỉ báo tâm lý" description="Diễn biến điểm tâm lý theo thời gian" asOf={data.asOf} quality={data.qualityStatus} />
      <div className="mt-3 flex items-center justify-end gap-2">
        <label htmlFor="market-sentiment-history-range" className="text-xs font-medium text-slate-400">Hiển thị</label>
        <select
          id="market-sentiment-history-range"
          value={rangeDays}
          onChange={(event) => setRangeDays(Number(event.target.value))}
          className="h-8 rounded-md border border-white/10 bg-[#08131e] px-2 font-mono text-xs font-bold text-slate-200 outline-none focus:border-cyan-400/50"
        >
          {SENTIMENT_HISTORY_RANGES.map((range) => <option key={range.days} value={range.days}>{range.label}</option>)}
        </select>
      </div>
      {visibleHistory.length === 0 ? (
        <div className="flex h-[210px] items-center justify-center text-sm text-slate-500">Chưa có lịch sử chỉ báo tâm lý.</div>
      ) : (
        <div className="mt-2 h-[210px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={visibleHistory} margin={{ top: 12, right: 8, left: -24, bottom: 0 }}>
              <defs>
                <linearGradient id="sentimentHistoryGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#22d3ee" stopOpacity={0.38} />
                  <stop offset="100%" stopColor="#22d3ee" stopOpacity={0.03} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={GRID_COLOR} vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="tradingDate" axisLine={{ stroke: "rgba(255,255,255,0.16)" }} tickLine={false} tick={{ fill: AXIS_COLOR, fontSize: 9, fontFamily: "monospace" }} minTickGap={28} tickFormatter={(value) => String(value).slice(5)} />
              <YAxis domain={[0, 100]} ticks={[0, 30, 45, 56, 71, 100]} axisLine={false} tickLine={false} tick={{ fill: AXIS_COLOR, fontSize: 9, fontFamily: "monospace" }} />
              <ReferenceLine y={30} stroke="rgba(244,63,94,0.4)" strokeDasharray="3 3" />
              <ReferenceLine y={45} stroke="rgba(251,191,36,0.35)" strokeDasharray="3 3" />
              <ReferenceLine y={56} stroke="rgba(148,163,184,0.3)" strokeDasharray="3 3" />
              <ReferenceLine y={71} stroke="rgba(45,212,191,0.35)" strokeDasharray="3 3" />
              <Tooltip content={<SentimentHistoryTooltip />} />
              <Area type="monotone" dataKey="value" stroke="#22d3ee" strokeWidth={2.4} fill="url(#sentimentHistoryGradient)" dot={false} activeDot={{ r: 3.5 }} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}`,
)

console.log("QEO-134 production codemod applied")
