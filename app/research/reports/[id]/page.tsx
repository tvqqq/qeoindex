import { notFound } from "next/navigation"

import { ReportDetailShell } from "@/components/research-reports/report-detail-shell"
import { TopNav } from "@/components/top-nav"
import { getServerAuthContext } from "@/modules/auth/server"
import { getResearchReportDetail } from "@/modules/research-reports"

export const dynamic = "force-dynamic"
export const revalidate = 0

export default async function ResearchReportDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const auth = await getServerAuthContext()
  if (!auth) return null

  const { id } = await params
  const result = await getResearchReportDetail(
    auth.supabase as unknown as Parameters<typeof getResearchReportDetail>[0],
    id,
  )

  if (result.status === "invalid_id" || result.status === "not_found") notFound()

  return (
    <div className="min-h-screen bg-background text-foreground">
      <TopNav />
      <ReportDetailShell report={result.report} />
    </div>
  )
}
