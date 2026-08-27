"use client"

import * as React from "react"
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  DollarSign,
  HelpCircle,
  History,
  Layers,
  SlidersHorizontal,
  TrendingDown,
  TrendingUp,
  Zap,
} from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type {
  MarketCloseDashboardData,
  MarketHistoryPoint,
  MarketSectorRow,
} from "@/lib/market-insight-data"
import { MetricGuideDialog } from "@/components/insights/metric-guide-dialog"
import {
  IndexBreadthChart,
  IndexPerformanceChart,
  InstitutionalFlowChart,
  LiquidityLeadersChart,
  MaBreadthChart,
  MarketHistoryChart,
  MarketHistoryFlowChart,
  SectorBreadthChart,
  SectorPerformanceChart,
} from "@/components/insights/market-close-charts"
import { cn } from "@/lib/utils"

interface MarketCloseDashboardProps {
  data: MarketCloseDashboardData | null
  onOpenStockDetail?: (ticker: string) => void
}

function formatNumber(num: number | null | undefined, decimals = 2): string {
  if (num == null || !Number.isFinite(num)) return "—"
  return new Intl.NumberFormat("vi-VN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  }).format(num)
}

function formatSigned(num: number | null | undefined, decimals = 2, suffix = ""): string {
  if (num == null || !Number.isFinite(num)) return "—"
  const sign = num > 0 ? "+" : ""
  return `${sign}${formatNumber(num, decimals)}${suffix}`
}

function formatTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat("vi-VN", {
      timeZone: "Asia/Ho_Chi_Minh",
      hour: "2-digit",
      minute: "2-digit",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(new Date(iso))
  } catch {
    return iso
  }
}

export function MarketCloseDashboard({ data, onOpenStockDetail }: MarketCloseDashboardProps) {
  const [selectedSector, setSelectedSector] = React.useState<MarketSectorRow | null>(null)
  const [guideOpen, setGuideOpen] = React.useState(false)
  const [guideInitialKey, setGuideInitialKey] = React.useState<string | undefined>()

  const openGuide = (key?: string) => {
    setGuideInitialKey(key)
    setGuideOpen(true)
  }

  if (!data) {
    return (
      <Card className="border-dashed py-12 text-center">
        <CardContent className="space-y-3">
          <Activity className="mx-auto h-10 w-10 text-muted-foreground/60" />
          <CardTitle>Chưa có dữ liệu phiên đóng cửa</CardTitle>
          <CardDescription>
            Snapshot thị trường sau phiên sẽ được cập nhật tự động sau 15:15 vào các ngày giao dịch.
          </CardDescription>
        </CardContent>
      </Card>
    )
  }

  const { sessionDate, marketRegime, asOf, dailySummary, indexes, sectors, leaders, observations, history, isStale } = data

  const vnindex = indexes.find((i) => i.indexCode === "VNINDEX")
  const isPositive = (vnindex?.changePct ?? 0) >= 0

  const topVolumeLeaders = leaders.filter((l) => l.category === "top_volume")
  const indexImpactLeaders = leaders.filter((l) => l.category === "index_up" || l.category === "index_down")

  return (
    <div className="space-y-6">
      {/* Stale or Quality Warning */}
      {isStale && (
        <Alert variant="destructive" className="border-amber-500/30 bg-amber-500/10 text-amber-300">
          <AlertTriangle className="h-4 w-4 text-amber-400" />
          <AlertTitle className="text-amber-200">Dữ liệu thị trường cũ (Stale)</AlertTitle>
          <AlertDescription className="text-xs text-amber-300/80">
            Snapshot này được cập nhật từ phiên trước ({sessionDate}). Dữ liệu phiên mới sẽ sẵn sàng sau 15:15.
          </AlertDescription>
        </Alert>
      )}

      {/* Top Banner / Summary Header */}
      <div className="flex flex-col gap-4 rounded-2xl border border-border/60 bg-gradient-to-r from-card via-card to-primary/[0.035] p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="flex items-center gap-3">
          <div className={cn(
            "flex size-12 items-center justify-center rounded-xl font-bold font-mono text-lg",
            isPositive ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30" : "bg-rose-500/15 text-rose-400 border border-rose-500/30"
          )}>
            {isPositive ? <TrendingUp className="size-6" /> : <TrendingDown className="size-6" />}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg sm:text-xl font-bold text-foreground">
                Tổng quan phiên {sessionDate}
              </h2>
              {marketRegime && (
                <Badge
                  variant="outline"
                  className={cn(
                    "font-bold text-xs",
                    marketRegime === "TÍCH CỰC" ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" :
                    marketRegime === "THẬN TRỌNG" ? "border-amber-500/40 bg-amber-500/10 text-amber-300" :
                    marketRegime === "RỦI RO" ? "border-rose-500/40 bg-rose-500/10 text-rose-300" :
                    "border-blue-500/40 bg-blue-500/10 text-blue-300"
                  )}
                >
                  {marketRegime}
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Cập nhật lúc: {formatTime(asOf)} · Nguồn: Market Feeds EOD
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => openGuide()}
            className="text-xs h-8 gap-1.5 border-border/60 hover:bg-muted"
          >
            <HelpCircle className="size-3.5 text-muted-foreground" />
            <span>Sổ tay chỉ số</span>
          </Button>
        </div>
      </div>

      <section aria-labelledby="market-overview-title" className="space-y-6">
        <div className="border-l-2 border-emerald-400 pl-4">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-400">Toàn cảnh</p>
          <h3 id="market-overview-title" className="mt-1 text-xl font-bold text-foreground">Chỉ số, độ rộng và dòng tiền</h3>
          <p className="mt-1 text-sm text-muted-foreground">Các tín hiệu chính của phiên được đặt cạnh nhau để đọc trong một lượt.</p>
        </div>
          {/* 4-step reading rail */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {/* Step 1: Index */}
            <Card className="bg-card/80 border-border/60">
              <CardContent className="p-4">
                <div className="flex items-center justify-between text-xs text-muted-foreground font-semibold mb-1">
                  <span>1. Chỉ số & Điểm số</span>
                  <Activity className="size-3.5 text-primary" />
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-black font-mono tracking-tight text-foreground">
                    {formatNumber(vnindex?.value)}
                  </span>
                  <span className={cn("text-xs font-bold font-mono", isPositive ? "text-emerald-400" : "text-rose-400")}>
                    {formatSigned(vnindex?.change, 2)} ({formatSigned(vnindex?.changePct, 2, "%")})
                  </span>
                </div>
                <div className="text-[11px] text-muted-foreground mt-2 flex items-center justify-between">
                  <span>Khớp: {formatNumber(vnindex?.matchedVolume ? vnindex.matchedVolume / 1_000_000 : null, 1)}M CP</span>
                  <span>{formatNumber(vnindex?.tradedValue, 0)} tỷ</span>
                </div>
              </CardContent>
            </Card>

            {/* Step 2: Breadth */}
            <Card className="bg-card/80 border-border/60">
              <CardContent className="p-4">
                <div className="flex items-center justify-between text-xs text-muted-foreground font-semibold mb-1">
                  <span>2. Độ rộng thị trường</span>
                  <BarChart3 className="size-3.5 text-primary" />
                </div>
                <div className="flex items-baseline justify-between">
                  <div className="flex items-center gap-1.5 text-xs font-bold">
                    <span className="text-emerald-400">{vnindex?.advances ?? 0} tăng</span>
                    <span className="text-muted-foreground">·</span>
                    <span className="text-amber-400">{vnindex?.unchanged ?? 0} ngang</span>
                    <span className="text-muted-foreground">·</span>
                    <span className="text-rose-400">{vnindex?.declines ?? 0} giảm</span>
                  </div>
                </div>
                <div className="text-[11px] text-muted-foreground mt-2 flex items-center justify-between">
                  <span>Trên MA20: <strong className="text-foreground">{formatNumber(dailySummary?.aboveMa20Pct, 1)}%</strong></span>
                  <span>Trên MA50: <strong className="text-foreground">{formatNumber(dailySummary?.aboveMa50Pct, 1)}%</strong></span>
                </div>
              </CardContent>
            </Card>

            {/* Step 3: Flows */}
            <Card className="bg-card/80 border-border/60">
              <CardContent className="p-4">
                <div className="flex items-center justify-between text-xs text-muted-foreground font-semibold mb-1">
                  <span>3. Dòng tiền tổ chức</span>
                  <DollarSign className="size-3.5 text-primary" />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Khối ngoại:</span>
                  {dailySummary?.foreignNetValue != null ? (
                    <span className={cn("text-sm font-mono font-bold", dailySummary.foreignNetValue >= 0 ? "text-emerald-400" : "text-rose-400")}>
                      {dailySummary.foreignNetValue >= 0 ? "Mua ròng " : "Bán ròng "}
                      {formatSigned(dailySummary.foreignNetValue, 1)} tỷ
                    </span>
                  ) : (
                    <Badge variant="outline" className="text-[10px] text-muted-foreground border-border/60">Chưa có dữ liệu</Badge>
                  )}
                </div>
                <div className="flex items-center justify-between mt-1 text-[11px]">
                  <span className="text-muted-foreground">Tự doanh:</span>
                  {dailySummary?.proprietaryNetValue != null ? (
                    <span className={cn("font-mono font-semibold", dailySummary.proprietaryNetValue >= 0 ? "text-emerald-400" : "text-rose-400")}>
                      {dailySummary.proprietaryNetValue >= 0 ? "+" : ""}{formatNumber(dailySummary.proprietaryNetValue, 1)} tỷ
                    </span>
                  ) : (
                    <span className="text-muted-foreground">Chưa cập nhật</span>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Step 4: Risk / Sentiment */}
            <Card className="bg-card/80 border-border/60">
              <CardContent className="p-4">
                <div className="flex items-center justify-between text-xs text-muted-foreground font-semibold mb-1">
                  <span>4. Tâm lý & Rủi ro</span>
                  <SlidersHorizontal className="size-3.5 text-primary" />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Tâm lý:</span>
                  <span className="text-sm font-bold text-cyan-400">
                    {dailySummary?.sentimentScore != null ? `${dailySummary.sentimentScore}/100` : "—"}
                    {dailySummary?.sentimentLabel && ` (${dailySummary.sentimentLabel})`}
                  </span>
                </div>
                <div className="flex items-center justify-between mt-1 text-[11px]">
                  <span className="text-muted-foreground">Phân phối: <strong className="text-foreground">{dailySummary?.distributionCount ?? 0} ngày</strong></span>
                  <span className="text-muted-foreground">Rủi ro: <strong className="text-foreground">{dailySummary?.riskLabel ?? "—"}</strong></span>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 xl:grid-cols-2" data-market-close-chart-grid>
            <Card className="border-border/60 bg-card py-0">
              <CardHeader className="border-b border-border/50 px-5 py-4">
                <CardTitle className="text-base">Hiệu suất & thanh khoản chỉ số</CardTitle>
                <CardDescription>So sánh biến động điểm số với giá trị giao dịch của bốn thị trường chính.</CardDescription>
              </CardHeader>
              <CardContent className="p-4"><IndexPerformanceChart indexes={indexes} /></CardContent>
            </Card>
            <Card className="border-border/60 bg-card py-0">
              <CardHeader className="border-b border-border/50 px-5 py-4">
                <CardTitle className="text-base">Độ rộng theo chỉ số</CardTitle>
                <CardDescription>Tỷ trọng mã tăng, đứng giá và giảm giúp kiểm tra độ lan tỏa của phiên.</CardDescription>
              </CardHeader>
              <CardContent className="p-4"><IndexBreadthChart indexes={indexes} /></CardContent>
            </Card>
            <Card className="border-border/60 bg-card py-0">
              <CardHeader className="border-b border-border/50 px-5 py-4">
                <CardTitle className="text-base">Sức khỏe xu hướng qua MA</CardTitle>
                <CardDescription>Mốc 50% phân biệt độ rộng khỏe và độ rộng còn yếu.</CardDescription>
              </CardHeader>
              <CardContent className="p-4"><MaBreadthChart daily={dailySummary} /></CardContent>
            </Card>
            <Card className="border-border/60 bg-card py-0">
              <CardHeader className="border-b border-border/50 px-5 py-4">
                <CardTitle className="text-base">Dòng tiền tổ chức</CardTitle>
                <CardDescription>Giá trị mua/bán ròng trong phiên, đơn vị tỷ đồng.</CardDescription>
              </CardHeader>
              <CardContent className="p-4"><InstitutionalFlowChart daily={dailySummary} /></CardContent>
            </Card>
          </div>

          {/* Deterministic Vietnamese Observations */}
          {observations.length > 0 && (
            <Card className="border-border/60 bg-card/60">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-bold flex items-center gap-2">
                  <CheckCircle2 className="size-4 text-emerald-400" />
                  <span>Nhận định cốt lõi sau phiên</span>
                </CardTitle>
                <CardDescription className="text-xs text-muted-foreground">
                  Tổng hợp factual hoàn toàn dựa trên dữ liệu thống kê khách quan, không đưa ra suy diễn cảm tính.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 pt-0">
                {observations.map((obs) => (
                  <div
                    key={obs.id}
                    className={cn(
                      "p-3 rounded-lg border text-xs leading-relaxed",
                      obs.sentiment === "positive" ? "border-emerald-500/20 bg-emerald-500/5 text-emerald-200" :
                      obs.sentiment === "warning" ? "border-amber-500/20 bg-amber-500/5 text-amber-200" :
                      obs.sentiment === "negative" ? "border-rose-500/20 bg-rose-500/5 text-rose-200" :
                      "border-border/50 bg-muted/30 text-foreground"
                    )}
                  >
                    <strong className="font-bold text-foreground block mb-0.5">{obs.title}:</strong>
                    <span>{obs.content}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* 4 Canonical Index Cards */}
          <div>
            <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-wider mb-3">
              Chỉ số thị trường chủ chốt
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {indexes.map((idx) => {
                const isIdxPositive = (idx.changePct ?? 0) >= 0
                return (
                  <Card key={idx.indexCode} className="border-border/60 bg-card hover:border-primary/40 transition-colors">
                    <CardHeader className="p-4 pb-2 flex-row items-center justify-between space-y-0">
                      <span className="font-bold font-mono text-sm text-foreground">{idx.indexCode}</span>
                      <Badge variant="outline" className={cn(
                        "text-[10px] font-mono",
                        isIdxPositive ? "border-emerald-500/30 text-emerald-400 bg-emerald-500/10" : "border-rose-500/30 text-rose-400 bg-rose-500/10"
                      )}>
                        {formatSigned(idx.changePct, 2, "%")}
                      </Badge>
                    </CardHeader>
                    <CardContent className="p-4 pt-1">
                      <div className="text-xl font-black font-mono text-foreground">
                        {formatNumber(idx.value)}
                      </div>
                      <div className="text-xs font-mono text-muted-foreground mt-0.5">
                        {formatSigned(idx.change, 2)} điểm
                      </div>
                      <div className="mt-3 pt-2 border-t border-border/40 flex items-center justify-between text-[11px] text-muted-foreground">
                        <span>{idx.advances} tăng / {idx.declines} giảm</span>
                        <span>{formatNumber(idx.tradedValue, 0)} tỷ</span>
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          </div>

          {/* Breadth & Flows Side-by-Side */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* MA Breadth */}
            <Card className="border-border/60 bg-card">
              <CardHeader className="p-4 pb-3">
                <CardTitle className="text-sm font-bold flex items-center gap-2">
                  <BarChart3 className="size-4 text-primary" />
                  <span>Độ rộng đường trung bình (MA Breadth)</span>
                </CardTitle>
                <CardDescription className="text-xs">
                  Tỷ lệ % cổ phiếu duy trì trên các đường xu hướng
                </CardDescription>
              </CardHeader>
              <CardContent className="p-4 pt-0 space-y-3">
                {[
                  { label: "Trên MA10 (Ngắn hạn)", val: dailySummary?.aboveMa10Pct },
                  { label: "Trên MA20 (Trung hạn 1 tháng)", val: dailySummary?.aboveMa20Pct },
                  { label: "Trên MA50 (Trung hạn 1 quý)", val: dailySummary?.aboveMa50Pct },
                  { label: "Trên MA200 (Dài hạn 1 năm)", val: dailySummary?.aboveMa200Pct },
                ].map((row) => (
                  <div key={row.label} className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">{row.label}</span>
                      <span className="font-mono font-bold text-foreground">{formatNumber(row.val, 1)}%</span>
                    </div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div
                        className={cn(
                          "h-full rounded-full",
                          (row.val ?? 0) >= 60 ? "bg-emerald-500" : (row.val ?? 0) >= 40 ? "bg-amber-500" : "bg-rose-500"
                        )}
                        style={{ width: `${Math.min(100, Math.max(0, row.val ?? 0))}%` }}
                      />
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Institutional Flows Detail */}
            <Card className="border-border/60 bg-card">
              <CardHeader className="p-4 pb-3">
                <CardTitle className="text-sm font-bold flex items-center gap-2">
                  <DollarSign className="size-4 text-primary" />
                  <span>Dòng tiền tổ chức & Khối ngoại</span>
                </CardTitle>
                <CardDescription className="text-xs">
                  Giá trị mua bán ròng của khối ngoại và tự doanh
                </CardDescription>
              </CardHeader>
              <CardContent className="p-4 pt-0 space-y-4">
                <div className="p-3 rounded-lg border border-border/50 bg-muted/20 flex items-center justify-between">
                  <div>
                    <div className="text-xs text-muted-foreground">Khối ngoại toàn thị trường</div>
                    <div className="text-lg font-black font-mono mt-0.5">
                      {dailySummary?.foreignNetValue != null ? (
                        <span className={dailySummary.foreignNetValue >= 0 ? "text-emerald-400" : "text-rose-400"}>
                          {dailySummary.foreignNetValue >= 0 ? "Mua ròng " : "Bán ròng "}
                          {formatSigned(dailySummary.foreignNetValue, 1)} tỷ
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-sm">Chưa có dữ liệu</span>
                      )}
                    </div>
                  </div>
                  {dailySummary?.foreignNetValue != null ? (
                    <Badge variant="outline" className={cn(
                      "font-mono text-xs",
                      dailySummary.foreignNetValue >= 0 ? "border-emerald-500/30 text-emerald-400 bg-emerald-500/10" : "border-rose-500/30 text-rose-400 bg-rose-500/10"
                    )}>
                      {dailySummary.foreignNetValue >= 0 ? "MUA RÒNG" : "BÁN RÒNG"}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-xs text-muted-foreground">Chưa có dữ liệu</Badge>
                  )}
                </div>

                <div className="p-3 rounded-lg border border-border/50 bg-muted/20 flex items-center justify-between">
                  <div>
                    <div className="text-xs text-muted-foreground">Khối tự doanh các CTCK</div>
                    <div className="text-lg font-black font-mono mt-0.5">
                      {dailySummary?.proprietaryNetValue != null ? (
                        <span className={dailySummary.proprietaryNetValue >= 0 ? "text-emerald-400" : "text-rose-400"}>
                          {dailySummary.proprietaryNetValue >= 0 ? "Mua ròng " : "Bán ròng "}
                          {formatSigned(dailySummary.proprietaryNetValue, 1)} tỷ
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-sm">Chưa cập nhật</span>
                      )}
                    </div>
                  </div>
                  {dailySummary?.proprietaryNetValue != null ? (
                    <Badge variant="outline" className={cn(
                      "font-mono text-xs",
                      dailySummary.proprietaryNetValue >= 0 ? "border-emerald-500/30 text-emerald-400 bg-emerald-500/10" : "border-rose-500/30 text-rose-400 bg-rose-500/10"
                    )}>
                      {dailySummary.proprietaryNetValue >= 0 ? "MUA RÒNG" : "BÁN RÒNG"}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-xs text-muted-foreground">Chưa cập nhật</Badge>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
      </section>

      <section aria-labelledby="market-sectors-title" className="space-y-4 border-t border-border/60 pt-8">
        <div className="border-l-2 border-cyan-400 pl-4">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-cyan-400">Lan tỏa</p>
          <h3 id="market-sectors-title" className="mt-1 text-xl font-bold text-foreground">Sức mạnh nhóm ngành</h3>
          <p className="mt-1 text-sm text-muted-foreground">So sánh hiệu suất, độ rộng và thanh khoản giữa các ngành.</p>
        </div>
          <div className="grid gap-4 xl:grid-cols-2" data-market-close-chart-grid>
            <Card className="border-border/60 bg-card py-0">
              <CardHeader className="border-b border-border/50 px-5 py-4">
                <CardTitle className="text-base">Bản đồ hiệu suất ngành</CardTitle>
                <CardDescription>12 nhóm ngành có dữ liệu 1D, xếp từ mạnh tới yếu.</CardDescription>
              </CardHeader>
              <CardContent className="p-4"><SectorPerformanceChart sectors={sectors} /></CardContent>
            </Card>
            <Card className="border-border/60 bg-card py-0">
              <CardHeader className="border-b border-border/50 px-5 py-4">
                <CardTitle className="text-base">Độ rộng nhóm ngành</CardTitle>
                <CardDescription>So sánh số mã tăng, đứng giá và giảm trong các nhóm lớn.</CardDescription>
              </CardHeader>
              <CardContent className="p-4"><SectorBreadthChart sectors={sectors} /></CardContent>
            </Card>
          </div>
          <Card className="border-border/60 bg-card">
            <CardHeader className="p-4 pb-3 flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base font-bold flex items-center gap-2">
                  <Layers className="size-4 text-primary" />
                  <span>Xoay vòng nhóm ngành (Sector Rotation)</span>
                </CardTitle>
                <CardDescription className="text-xs">
                  Thống kê hiệu suất và dòng tiền từng nhóm ngành trong phiên
                </CardDescription>
              </div>
              <Badge variant="outline" className="text-xs">
                {sectors.length} nhóm ngành
              </Badge>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="border-border/60 hover:bg-transparent">
                    <TableHead className="w-[180px]">Nhóm ngành</TableHead>
                    <TableHead className="text-right">Thay đổi TB</TableHead>
                    <TableHead className="text-right">Giá trị (tỷ)</TableHead>
                    <TableHead className="text-center">Độ rộng ngành</TableHead>
                    <TableHead className="text-center">Trạng thái xoay vòng</TableHead>
                    <TableHead className="text-center w-[80px]">Chi tiết</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sectors.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8 text-muted-foreground text-xs">
                        Đang cập nhật dữ liệu nhóm ngành...
                      </TableCell>
                    </TableRow>
                  ) : (
                    sectors.map((sec) => {
                      const isSecPositive = (sec.averageChangePct ?? 0) >= 0
                      return (
                        <TableRow
                          key={sec.sectorKey}
                          className="border-border/40 hover:bg-muted/40 cursor-pointer"
                          onClick={() => setSelectedSector(sec)}
                        >
                          <TableCell className="font-semibold text-xs text-foreground">
                            {sec.displayName}
                          </TableCell>
                          <TableCell className={cn("text-right font-mono font-bold text-xs", isSecPositive ? "text-emerald-400" : "text-rose-400")}>
                            {formatSigned(sec.averageChangePct, 2, "%")}
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs text-foreground">
                            {formatNumber(sec.tradedValue, 1)}
                          </TableCell>
                          <TableCell className="text-center font-mono text-xs">
                            <span className="text-emerald-400">{sec.advances}</span>
                            <span className="text-muted-foreground"> / </span>
                            <span className="text-amber-400">{sec.unchanged}</span>
                            <span className="text-muted-foreground"> / </span>
                            <span className="text-rose-400">{sec.declines}</span>
                          </TableCell>
                          <TableCell className="text-center">
                            <Badge
                              variant="outline"
                              className={cn(
                                "text-[10px] uppercase font-bold",
                                sec.rotationState === "leading" ? "border-emerald-500/30 text-emerald-400 bg-emerald-500/10" :
                                sec.rotationState === "recovering" ? "border-blue-500/30 text-blue-400 bg-blue-500/10" :
                                sec.rotationState === "weakening" ? "border-amber-500/30 text-amber-400 bg-amber-500/10" :
                                sec.rotationState === "lagging" ? "border-rose-500/30 text-rose-400 bg-rose-500/10" :
                                "border-border text-muted-foreground"
                              )}
                            >
                              {sec.rotationState === "leading" ? "Dẫn dắt" :
                               sec.rotationState === "recovering" ? "Phục hồi" :
                               sec.rotationState === "weakening" ? "Suy yếu" :
                               sec.rotationState === "lagging" ? "Tụt hậu" : "—"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-center">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 text-xs px-2 text-primary"
                              onClick={(e) => {
                                e.stopPropagation()
                                setSelectedSector(sec)
                              }}
                            >
                              Xem
                            </Button>
                          </TableCell>
                        </TableRow>
                      )
                    })
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
      </section>

      <section aria-labelledby="market-leaders-title" className="space-y-6 border-t border-border/60 pt-8">
        <div className="border-l-2 border-amber-400 pl-4">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-amber-400">Dòng tiền</p>
          <h3 id="market-leaders-title" className="mt-1 text-xl font-bold text-foreground">Dẫn dắt và thanh khoản</h3>
          <p className="mt-1 text-sm text-muted-foreground">Những cổ phiếu tập trung thanh khoản và ảnh hưởng tới chỉ số.</p>
        </div>
          <Card className="border-border/60 bg-card py-0" data-market-close-chart-grid>
            <CardHeader className="border-b border-border/50 px-5 py-4">
              <CardTitle className="text-base">Xếp hạng thanh khoản cổ phiếu</CardTitle>
              <CardDescription>Khối lượng khớp của các mã dẫn đầu, hiển thị theo triệu cổ phiếu.</CardDescription>
            </CardHeader>
            <CardContent className="p-4"><LiquidityLeadersChart leaders={leaders} /></CardContent>
          </Card>
          {/* Top Volume Leaders */}
          <Card className="border-border/60 bg-card">
            <CardHeader className="p-4 pb-3">
              <CardTitle className="text-base font-bold flex items-center gap-2">
                <Zap className="size-4 text-amber-400" />
                <span>Top cổ phiếu khớp lệnh khối lượng lớn nhất</span>
              </CardTitle>
              <CardDescription className="text-xs">
                Các mã thu hút thanh khoản và biến động nổi bật trong phiên
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="border-border/60 hover:bg-transparent">
                    <TableHead className="w-[60px] text-center">Hạng</TableHead>
                    <TableHead className="w-[120px]">Mã CP</TableHead>
                    <TableHead className="text-right">Giá đóng cửa (k)</TableHead>
                    <TableHead className="text-right">Biến động %</TableHead>
                    <TableHead className="text-right">Khối lượng khớp</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {topVolumeLeaders.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-8 text-muted-foreground text-xs">
                        Đang cập nhật danh sách thanh khoản...
                      </TableCell>
                    </TableRow>
                  ) : (
                    topVolumeLeaders.map((lead) => {
                      const isLeadPositive = (lead.changePct ?? 0) >= 0
                      return (
                        <TableRow
                          key={`${lead.category}:${lead.rank}:${lead.ticker}`}
                          className="border-border/40 hover:bg-muted/40 cursor-pointer"
                          onClick={() => onOpenStockDetail?.(lead.ticker)}
                        >
                          <TableCell className="text-center font-mono font-bold text-xs text-muted-foreground">
                            #{lead.rank}
                          </TableCell>
                          <TableCell>
                            <span className="font-mono font-bold text-xs text-foreground bg-muted/60 px-2 py-1 rounded">
                              {lead.ticker}
                            </span>
                          </TableCell>
                          <TableCell className="text-right font-mono font-semibold text-xs text-foreground">
                            {formatNumber(lead.price, 2)}
                          </TableCell>
                          <TableCell className={cn("text-right font-mono font-bold text-xs", isLeadPositive ? "text-emerald-400" : "text-rose-400")}>
                            {formatSigned(lead.changePct, 2, "%")}
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs text-muted-foreground">
                            {lead.metricLabel || (lead.metricValue != null ? `${formatNumber(lead.metricValue / 1_000_000, 1)}M CP` : "—")}
                          </TableCell>
                        </TableRow>
                      )
                    })
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Index Impact Leaders (If available) */}
          {indexImpactLeaders.length > 0 && (
            <Card className="border-border/60 bg-card">
              <CardHeader className="p-4 pb-3">
                <CardTitle className="text-base font-bold flex items-center gap-2">
                  <BarChart3 className="size-4 text-primary" />
                  <span>Tác động điểm số VNINDEX</span>
                </CardTitle>
                <CardDescription className="text-xs">
                  Các mã đóng góp tăng / giảm điểm mạnh nhất
                </CardDescription>
              </CardHeader>
              <CardContent className="p-4 pt-0">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Index UP */}
                  <div className="space-y-2">
                    <h4 className="text-xs font-bold text-emerald-400 uppercase tracking-wider">Đóng góp tăng điểm</h4>
                    {indexImpactLeaders.filter((l) => l.category === "index_up").map((l) => (
                      <div key={l.ticker} className="flex items-center justify-between text-xs p-2 rounded bg-emerald-500/5 border border-emerald-500/10">
                        <span className="font-mono font-bold text-foreground">{l.ticker}</span>
                        <span className="font-mono font-bold text-emerald-400">+{formatNumber(l.estimatedIndexPoints, 2)} đ</span>
                      </div>
                    ))}
                  </div>

                  {/* Index DOWN */}
                  <div className="space-y-2">
                    <h4 className="text-xs font-bold text-rose-400 uppercase tracking-wider">Kéo giảm điểm</h4>
                    {indexImpactLeaders.filter((l) => l.category === "index_down").map((l) => (
                      <div key={l.ticker} className="flex items-center justify-between text-xs p-2 rounded bg-rose-500/5 border border-rose-500/10">
                        <span className="font-mono font-bold text-foreground">{l.ticker}</span>
                        <span className="font-mono font-bold text-rose-400">{formatNumber(l.estimatedIndexPoints, 2)} đ</span>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
      </section>

      <section aria-labelledby="market-history-title" className="space-y-4 border-t border-border/60 pt-8">
        <div className="border-l-2 border-slate-400 pl-4">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Bối cảnh</p>
          <h3 id="market-history-title" className="mt-1 text-xl font-bold text-foreground">Lịch sử các phiên</h3>
          <p className="mt-1 text-sm text-muted-foreground">Đặt phiên hiện tại trong xu hướng tâm lý, rủi ro và dòng tiền gần nhất.</p>
        </div>
          <div className="grid gap-4" data-market-close-chart-grid>
            <Card className="border-border/60 bg-card py-0">
              <CardHeader className="border-b border-border/50 px-5 py-4">
                <CardTitle className="text-base">Tâm lý, rủi ro & độ rộng MA20</CardTitle>
                <CardDescription>Ba trục sức khỏe thị trường trên lịch sử tối đa 20 phiên.</CardDescription>
              </CardHeader>
              <CardContent className="p-4"><MarketHistoryChart history={history} /></CardContent>
            </Card>
            <Card className="border-border/60 bg-card py-0">
              <CardHeader className="border-b border-border/50 px-5 py-4">
                <CardTitle className="text-base">Dòng tiền theo phiên</CardTitle>
                <CardDescription>Đối chiếu dòng tiền nước ngoài và tự doanh quanh trục trung tính.</CardDescription>
              </CardHeader>
              <CardContent className="p-4"><MarketHistoryFlowChart history={history} /></CardContent>
            </Card>
          </div>
          <Card className="border-border/60 bg-card">
            <CardHeader className="p-4 pb-3">
              <CardTitle className="text-base font-bold flex items-center gap-2">
                <History className="size-4 text-primary" />
                <span>Lịch sử các phiên gần nhất</span>
              </CardTitle>
              <CardDescription className="text-xs">
                Theo dõi tiến trình diễn biến trạng thái thị trường và độ rộng trung hạn
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="border-border/60 hover:bg-transparent">
                    <TableHead className="w-[120px]">Ngày</TableHead>
                    <TableHead className="text-right">VNINDEX</TableHead>
                    <TableHead className="text-right">Biến động %</TableHead>
                    <TableHead className="text-right">Thanh khoản (tỷ)</TableHead>
                    <TableHead className="text-right">Độ rộng MA20</TableHead>
                    <TableHead className="text-right">Khối ngoại (tỷ)</TableHead>
                    <TableHead className="text-center">Tâm lý</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {history.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-8 text-muted-foreground text-xs">
                        Chưa có lịch sử các phiên trước. Dữ liệu lịch sử sẽ được tích lũy theo từng phiên đóng cửa.
                      </TableCell>
                    </TableRow>
                  ) : (
                    history.map((row: MarketHistoryPoint) => (
                      <TableRow key={row.sessionDate} className="border-border/40 hover:bg-muted/30">
                        <TableCell className="font-mono font-semibold text-xs text-foreground">
                          {row.sessionDate}
                        </TableCell>
                        <TableCell className="text-right font-mono font-bold text-xs text-foreground">
                          {formatNumber(row.vnindexClose)}
                        </TableCell>
                        <TableCell className={cn("text-right font-mono text-xs", (row.vnindexChangePct ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400")}>
                          {formatSigned(row.vnindexChangePct, 2, "%")}
                        </TableCell>
                        <TableCell className="text-right font-mono font-bold text-xs text-foreground">
                          {formatNumber(row.totalTradedValue, 0)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs text-foreground">
                          {formatNumber(row.aboveMa20Pct, 1)}%
                        </TableCell>
                        <TableCell className={cn("text-right font-mono font-semibold text-xs", (row.foreignNetValue ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400")}>
                          {formatSigned(row.foreignNetValue, 1)}
                        </TableCell>
                        <TableCell className="text-center font-mono text-xs text-cyan-400 font-semibold">
                          {row.sentimentScore != null ? row.sentimentScore : "—"}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
      </section>

      {/* Sector Detail Dialog */}
      <Dialog open={Boolean(selectedSector)} onOpenChange={(open) => { if (!open) setSelectedSector(null) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-bold flex items-center justify-between">
              <span>{selectedSector?.displayName}</span>
              <Badge variant="outline" className="font-mono text-xs">
                {selectedSector?.timeWindow || "1d"}
              </Badge>
            </DialogTitle>
            <DialogDescription className="text-xs">
              Chi tiết chỉ số sức mạnh và thanh khoản ngành
            </DialogDescription>
          </DialogHeader>

          {selectedSector && (
            <div className="space-y-4 py-2 text-xs">
              <div className="grid grid-cols-2 gap-3 p-3 rounded-lg border border-border/50 bg-muted/20 font-mono">
                <div>
                  <span className="text-muted-foreground block text-[11px]">Biến động TB:</span>
                  <strong className={cn("text-sm", (selectedSector.averageChangePct ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400")}>
                    {formatSigned(selectedSector.averageChangePct, 2, "%")}
                  </strong>
                </div>
                <div>
                  <span className="text-muted-foreground block text-[11px]">Thanh khoản:</span>
                  <strong className="text-sm text-foreground">{formatNumber(selectedSector.tradedValue, 1)} tỷ</strong>
                </div>
                <div>
                  <span className="text-muted-foreground block text-[11px]">Độ rộng ngành:</span>
                  <strong className="text-foreground">{selectedSector.advances} Tăng / {selectedSector.declines} Giảm</strong>
                </div>
                <div>
                  <span className="text-muted-foreground block text-[11px]">Điểm RS:</span>
                  <strong className="text-cyan-400">{formatNumber(selectedSector.rsScore, 1) || "—"}</strong>
                </div>
              </div>

              {selectedSector.effortResultState && (
                <div className="p-3 rounded-lg border border-border/50 bg-card text-muted-foreground leading-relaxed">
                  <strong className="text-foreground block mb-1">Nỗ lực & Kết quả (VSA):</strong>
                  {selectedSector.effortResultState}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Metric Guide Dialog */}
      <MetricGuideDialog
        open={guideOpen}
        onOpenChange={setGuideOpen}
        initialMetricKey={guideInitialKey}
      />
    </div>
  )
}
