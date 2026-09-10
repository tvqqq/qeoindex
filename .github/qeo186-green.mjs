import { readFileSync, writeFileSync } from "node:fs"

const target = "components/insights/market-close-dashboard.tsx"
let source = readFileSync(target, "utf8")

function replaceOnce(oldValue, newValue, label) {
  const first = source.indexOf(oldValue)
  if (first < 0) throw new Error(`Missing patch anchor: ${label}`)
  if (source.indexOf(oldValue, first + oldValue.length) >= 0) throw new Error(`Non-unique patch anchor: ${label}`)
  source = source.replace(oldValue, newValue)
}

replaceOnce(
`import {
  IndexBreadthChart, IndexPerformanceChart, InstitutionalFlowChart,
} from "@/components/insights/market-close-charts"
import { BreadthDivergenceBadge, MaBreadthChart } from "@/components/insights/market-breadth-divergence-chart"`,
`import {
  IndexBreadthChart, IndexImpactChart, IndexPerformanceChart, InstitutionalFlowChart,
} from "@/components/insights/market-close-charts"
import { BreadthDivergenceBadge, MaBreadthChart } from "@/components/insights/market-breadth-divergence-chart"
import { VnindexContributionBadge, VnindexContributorsView } from "@/components/insights/vnindex-contributors-view"`,
"chart imports",
)

replaceOnce(
`import { buildBreadthDivergenceContext } from "@/modules/research/market-insight/breadth-divergence"
import { MarketWidgetChildHeader } from "@/components/insights/market-widget-child-header"`,
`import { buildBreadthDivergenceContext } from "@/modules/research/market-insight/breadth-divergence"
import { buildVnindexContributorsContext } from "@/modules/research/market-insight/vnindex-contributors"
import { MarketWidgetChildHeader } from "@/components/insights/market-widget-child-header"`,
"contributor helper import",
)

replaceOnce(
`  const breadthDivergence = buildBreadthDivergenceContext({
    sessionDate: data.sessionDate,
    history,
  })

  return (`,
`  const breadthDivergence = buildBreadthDivergenceContext({
    sessionDate: data.sessionDate,
    history,
  })
  const vnindex = indexes.find((item) => item.indexCode === "VNINDEX")
  const vnindexContributors = buildVnindexContributorsContext({
    vnindexChange: vnindex?.change ?? null,
    leaders: data.leaders,
  })

  return (`,
"contributor context",
)

replaceOnce(
`          <div data-market-health-embedded className="mt-5 border-t border-white/[0.07] pt-5">
            <MarketHealthView data={data} history={history} />
          </div>

          <div id="market-charts-title" className="mt-5">`,
`          <div data-market-health-embedded className="mt-5 border-t border-white/[0.07] pt-5">
            <MarketHealthView data={data} history={history} />
          </div>

          <div data-vnindex-contributors className="mt-5">
            <ChartPanel
              icon={BarChart3}
              title="Đóng góp VNINDEX"
              description="Top mã kéo tăng/giảm và mức độ tập trung đóng góp"
              actions={<VnindexContributionBadge context={vnindexContributors} />}
            >
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
                <div className="min-w-0">
                  <IndexImpactChart leaders={[...vnindexContributors.pullers.slice(0, 5), ...vnindexContributors.draggers.slice(0, 5)]} />
                </div>
                <VnindexContributorsView context={vnindexContributors} />
              </div>
            </ChartPanel>
          </div>

          <div id="market-charts-title" className="mt-5">`,
"contributors placement",
)

writeFileSync(target, source)
