import { NextResponse } from "next/server"
import { requireApiFeature } from "@/modules/auth/server"
import { fetchDailyMarketHistory, fetchHourlyMarketHistory } from "@/modules/market/history/index"
import { buildMultiTimeframeStudies, buildPromotionDraft } from "@/modules/research/multi-timeframe"
import { promoteDraftToNotion } from "@/modules/notion/promote"
import { getResearchDataFresh, invalidateResearchDataCache } from "@/modules/research/data"
import { getScannerDataFresh } from "@/modules/signals/scanner/data"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  const auth = await requireApiFeature("research")
  if (!auth.ok) return auth.response

  try {
    const body = await request.json().catch(() => ({}))
    const ticker = String(body?.ticker ?? "").trim().toUpperCase()
    if (!/^[A-Z0-9]{2,10}$/.test(ticker) || ticker === "VNINDEX") return NextResponse.json({ ok: false, error: "Ticker không hợp lệ cho promotion." }, { status: 400 })

    const research = await getResearchDataFresh()
    if (!research.connection.notionLive) return NextResponse.json({ ok: false, error: "Notion canonical source hiện không live; dừng promotion." }, { status: 503 })
    if (research.theses.some((row) => row.ticker === ticker)) return NextResponse.json({ ok: false, error: `${ticker} đã có canonical thesis.` }, { status: 409 })

    const scanner = await getScannerDataFresh()
    if (!scanner.universe.some((row) => row.ticker === ticker)) return NextResponse.json({ ok: false, error: `${ticker} không nằm trong scanner universe hiện tại.` }, { status: 404 })

    const now = new Date()
    const daily = await fetchDailyMarketHistory(ticker, now)
    let hourlyBars = [] as Awaited<ReturnType<typeof fetchHourlyMarketHistory>>["bars"]
    let hourlyProvider = "Unavailable"
    let hourlyDetail = "Không lấy được 1H; promotion sẽ hạ confidence."
    try {
      const hourly = await fetchHourlyMarketHistory(ticker, now)
      hourlyBars = hourly.bars
      hourlyProvider = hourly.provider
      hourlyDetail = hourly.detail
    } catch (error) {
      hourlyDetail = error instanceof Error ? error.message.slice(0, 220) : String(error).slice(0, 220)
    }

    const studies = buildMultiTimeframeStudies({ dailyBars: daily.bars, hourlyBars, dailyProvider: daily.provider, dailyDetail: daily.detail, hourlyProvider, hourlyDetail })
    const draft = buildPromotionDraft(ticker, studies)
    if (draft.timeframes.length < 2) return NextResponse.json({ ok: false, error: "Chưa đủ ít nhất 2 timeframe để promote canonical thesis." }, { status: 422 })

    const vnindex = research.theses.find((row) => row.ticker === "VNINDEX")
    const result = await promoteDraftToNotion(draft, vnindex?.marketRegime || "Neutral")
    await invalidateResearchDataCache()
    return NextResponse.json({ ok: true, ticker, thesisId: result.thesis.id, thesisUrl: result.thesis.url, logId: result.log.id, probabilities: { bull: draft.bullProbability, base: draft.baseProbability, bear: draft.bearProbability } })
  } catch (error) {
    console.error("[QeoIndex promote]", error)
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Promotion failed" }, { status: 500 })
  }
}
