import fs from "node:fs"
import { execFileSync } from "node:child_process"

function replaceOnce(source, oldValue, newValue, label) {
  const first = source.indexOf(oldValue)
  if (first < 0) throw new Error(`Missing patch anchor: ${label}`)
  if (source.indexOf(oldValue, first + oldValue.length) >= 0) throw new Error(`Ambiguous patch anchor: ${label}`)
  return source.slice(0, first) + newValue + source.slice(first + oldValue.length)
}

const dataPath = "modules/research/market-insight/data.ts"
let data = fs.readFileSync(dataPath, "utf8")
data = replaceOnce(
  data,
  "  foreignNetValue: number | null\n  proprietaryNetValue: number | null\n  totalTradedValue: number | null\n",
  "  foreignNetValue: number | null\n  proprietaryNetValue: number | null\n  otherFlowNetValue: number | null\n  totalTradedValue: number | null\n",
  "MarketHistoryPoint other flow",
)
data = replaceOnce(
  data,
  "foreign_net_value,proprietary_net_value,total_traded_value",
  "foreign_net_value,proprietary_net_value,other_flow_net_value,total_traded_value",
  "history select other flow",
)
data = replaceOnce(
  data,
  "      foreignNetValue: row.foreign_net_value != null ? Number(row.foreign_net_value) : null,\n      proprietaryNetValue: row.proprietary_net_value != null ? Number(row.proprietary_net_value) : null,\n      totalTradedValue: row.total_traded_value != null ? Number(row.total_traded_value) : null,\n",
  "      foreignNetValue: row.foreign_net_value != null ? Number(row.foreign_net_value) : null,\n      proprietaryNetValue: row.proprietary_net_value != null ? Number(row.proprietary_net_value) : null,\n      otherFlowNetValue: row.other_flow_net_value != null ? Number(row.other_flow_net_value) : null,\n      totalTradedValue: row.total_traded_value != null ? Number(row.total_traded_value) : null,\n",
  "history mapping other flow",
)
fs.writeFileSync(dataPath, data)

const dashboardPath = "components/insights/market-close-dashboard.tsx"
let dashboard = fs.readFileSync(dashboardPath, "utf8")
dashboard = replaceOnce(
  dashboard,
  'import { buildVnindexContributorsContext } from "@/modules/research/market-insight/vnindex-contributors"\n',
  'import { buildVnindexContributorsContext } from "@/modules/research/market-insight/vnindex-contributors"\nimport { buildInstitutionalFlowPersistence } from "@/modules/research/market-insight/institutional-flow-persistence"\n',
  "dashboard flow helper import",
)
dashboard = replaceOnce(
  dashboard,
  "  const vnindexContributors = buildVnindexContributorsContext({\n    vnindexChange: vnindex?.change ?? null,\n    leaders: data.leaders,\n  })\n",
  "  const vnindexContributors = buildVnindexContributorsContext({\n    vnindexChange: vnindex?.change ?? null,\n    leaders: data.leaders,\n  })\n  const flowPersistence = buildInstitutionalFlowPersistence({\n    sessionDate: data.sessionDate,\n    history,\n  })\n",
  "dashboard flow context",
)
dashboard = replaceOnce(
  dashboard,
  '<ChartPanel icon={CircleDollarSign} title="Dòng tiền tổ chức" description="Mua bán ròng theo nhóm nhà đầu tư"><InstitutionalFlowChart daily={dailySummary} /></ChartPanel>',
  '<ChartPanel icon={CircleDollarSign} title="Dòng tiền tổ chức" description="Persistence dòng tiền · Today / 5D / 20D"><InstitutionalFlowChart context={flowPersistence} /></ChartPanel>',
  "dashboard institutional flow card",
)
fs.writeFileSync(dashboardPath, dashboard)

const chartsPath = "components/insights/market-close-charts.tsx"
let charts = fs.readFileSync(chartsPath, "utf8")
charts = replaceOnce(
  charts,
  '} from "@/modules/research/market-insight/data"\n',
  '} from "@/modules/research/market-insight/data"\nimport type { InstitutionalFlowPersistenceContext, InstitutionalFlowPersistenceRow } from "@/modules/research/market-insight/institutional-flow-persistence"\n',
  "charts flow type import",
)

const flowStart = charts.indexOf("const flowConfig = {")
const sectorStart = charts.indexOf("const sectorConfig = {", flowStart)
if (flowStart < 0 || sectorStart < 0) throw new Error("Institutional flow chart block anchors not found")
const flowBlock = `function formatFlowValue(value: number | null) {
  if (value == null || !Number.isFinite(value)) return "Chưa đủ dữ liệu"
  const absolute = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 }).format(Math.abs(value))
  return \`\${value > 0 ? "+" : value < 0 ? "-" : ""}\${absolute} tỷ\`
}

function flowStateLabel(row: InstitutionalFlowPersistenceRow) {
  if (row.state === "persistent_buying") return "Duy trì mua ròng"
  if (row.state === "persistent_selling") return "Duy trì bán ròng"
  if (row.state === "reversal_to_buying") return "Đảo chiều → mua"
  if (row.state === "reversal_to_selling") return "Đảo chiều → bán"
  return row.fiveDay != null && row.twentyDay != null ? "Chưa xác nhận" : "Chưa đủ dữ liệu"
}

function flowStateClass(row: InstitutionalFlowPersistenceRow) {
  if (row.state === "persistent_buying" || row.state === "reversal_to_buying") return "border-emerald-300/20 bg-emerald-300/[0.08] text-emerald-300"
  if (row.state === "persistent_selling" || row.state === "reversal_to_selling") return "border-rose-300/20 bg-rose-300/[0.08] text-rose-300"
  return "border-white/[0.08] bg-white/[0.03] text-slate-400"
}

function FlowPersistenceValue({ value, maxAbs }: { value: number | null; maxAbs: number }) {
  const available = value != null && Number.isFinite(value)
  const width = available && maxAbs > 0 ? Math.min(100, Math.abs(value) / maxAbs * 100) : 0
  const tone = !available || value === 0 ? "text-slate-300" : value > 0 ? "text-emerald-300" : "text-rose-300"
  const barTone = !available || value === 0 ? "bg-slate-500" : value > 0 ? "bg-emerald-400" : "bg-rose-400"

  return (
    <div className="min-w-[78px] px-2 py-2.5">
      <span className={\`block whitespace-nowrap font-mono text-[11px] font-bold \${tone}\`}>{formatFlowValue(value)}</span>
      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/[0.05]">
        {width > 0 ? <span className={\`block h-full rounded-full \${barTone}\`} style={{ width: \`\${width}%\` }} /> : null}
      </div>
    </div>
  )
}

export function InstitutionalFlowChart({ context }: { context: InstitutionalFlowPersistenceContext }) {
  const maxFor = (field: "today" | "fiveDay" | "twentyDay") => Math.max(
    1,
    ...context.rows.flatMap((row) => row[field] != null && Number.isFinite(row[field]) ? [Math.abs(row[field] as number)] : []),
  )
  const todayMax = maxFor("today")
  const fiveDayMax = maxFor("fiveDay")
  const twentyDayMax = maxFor("twentyDay")

  return (
    <div data-institutional-flow-persistence className="overflow-x-auto rounded-xl border border-white/[0.07] bg-[#07131d]/70" role="table" aria-label="Institutional flow persistence Today 5D 20D">
      <div className="min-w-[640px]">
        <div className="grid grid-cols-[minmax(92px,1.15fr)_repeat(3,minmax(88px,1fr))_minmax(132px,1.35fr)] border-b border-white/[0.07] bg-black/10 px-2 text-[10px] font-black uppercase tracking-[0.12em] text-slate-400" role="row">
          <span className="px-2 py-2.5">Nhóm</span>
          <span className="px-2 py-2.5">Today</span>
          <span className="px-2 py-2.5">5D</span>
          <span className="px-2 py-2.5">20D</span>
          <span className="px-2 py-2.5">Xu hướng</span>
        </div>
        {context.rows.map((row) => (
          <div key={row.key} className="grid grid-cols-[minmax(92px,1.15fr)_repeat(3,minmax(88px,1fr))_minmax(132px,1.35fr)] items-center border-b border-white/[0.05] px-2 last:border-b-0" role="row">
            <strong className="px-2 py-2.5 text-xs font-bold text-white">{row.label}</strong>
            <FlowPersistenceValue value={row.today} maxAbs={todayMax} />
            <FlowPersistenceValue value={row.fiveDay} maxAbs={fiveDayMax} />
            <FlowPersistenceValue value={row.twentyDay} maxAbs={twentyDayMax} />
            <div className="px-2 py-2.5">
              <span className={\`inline-flex rounded-full border px-2 py-1 text-[10px] font-bold \${flowStateClass(row)}\`}>
                {flowStateLabel(row)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

`
charts = charts.slice(0, flowStart) + flowBlock + charts.slice(sectorStart)
fs.writeFileSync(chartsPath, charts)

execFileSync("git", ["config", "user.name", "github-actions[bot]"])
execFileSync("git", ["config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com"])
execFileSync("git", ["add", dataPath, dashboardPath, chartsPath])
execFileSync("git", ["commit", "-m", "feat(QEO-187): add institutional flow persistence view"], { stdio: "inherit" })
execFileSync("git", ["push", "origin", "HEAD"], { stdio: "inherit" })
