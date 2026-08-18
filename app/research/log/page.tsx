import Link from "next/link"

import { NotionUnavailable } from "@/components/notion-unavailable"
import { ResearchApp } from "@/components/research/research-app"
import { getResearchLogData } from "@/lib/research-data"

export const dynamic = "force-dynamic"

export default async function ResearchLogPage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string | string[] }>
}) {
  const query = await searchParams
  const cursor = typeof query.cursor === "string" ? query.cursor : undefined
  const data = await getResearchLogData(cursor)
  if (!data.connection.notionLive) return <NotionUnavailable section="Nhật ký phân tích" detail={data.connection.message} />
  return (
    <>
      <ResearchApp data={data} mode="log" />
      {data.pagination?.hasMore && data.pagination.nextCursor ? (
        <div className="mx-auto -mt-4 flex max-w-[1600px] justify-end px-4 pb-8 lg:px-6">
          <Link
            href={`/research/log?cursor=${encodeURIComponent(data.pagination.nextCursor)}`}
            className="rounded-md border border-border-strong bg-panel-2 px-4 py-2 text-sm font-medium text-foreground/75 hover:text-brand"
          >
            Trang tiếp →
          </Link>
        </div>
      ) : null}
    </>
  )
}
