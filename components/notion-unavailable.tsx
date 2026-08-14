import { AlertTriangle, Database } from "lucide-react"
import { TopNav } from "@/components/top-nav"

export function NotionUnavailable({ section = "StockOS", detail }: { section?: string; detail?: string }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <TopNav />
      <main className="mx-auto max-w-3xl p-6 lg:p-10">
        <div className="rounded-xl border border-warning/30 bg-panel p-6">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-warning/10 p-2 text-warning"><AlertTriangle className="h-5 w-5" /></div>
            <div>
              <h1 className="text-xl font-semibold">{section}: Notion unavailable</h1>
              <p className="mt-2 text-sm leading-6 text-foreground/65">{detail || "Không thể đọc canonical Notion data trong environment hiện tại."}</p>
              <div className="mt-4 flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground/55">
                <Database className="h-4 w-4" /> Persistent backend: Notion only · không dùng Supabase/snapshot fallback
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
