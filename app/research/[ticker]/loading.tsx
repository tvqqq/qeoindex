import { TopNav } from "@/components/top-nav"

export default function ResearchTickerLoading() {
  return (
    <div className="min-h-screen bg-background text-[15px]">
      <TopNav />

      {/* Header skeleton */}
      <div className="border-b border-border bg-panel/75">
        <div className="mx-auto max-w-[1600px] px-4 py-5 lg:px-6">
          <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
            <div className="w-full">
              <div className="flex flex-wrap items-center gap-2.5">
                <div className="h-4 w-16 animate-pulse rounded bg-panel-2" />
                <div className="h-4 w-2 animate-pulse rounded bg-panel-2" />
                <div className="h-9 w-24 animate-pulse rounded bg-panel-2" />
                <div className="h-5 w-40 animate-pulse rounded bg-panel-2" />
                <div className="h-6 w-32 animate-pulse rounded-md bg-panel-2" />
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2.5">
                <div className="h-6 w-28 animate-pulse rounded-md bg-panel-2" />
                <div className="h-6 w-20 animate-pulse rounded-md bg-panel-2" />
                <div className="h-6 w-24 animate-pulse rounded-md bg-panel-2" />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-9 w-20 animate-pulse rounded-md bg-panel-2" />
              <div className="h-9 w-20 animate-pulse rounded-md bg-panel-2" />
            </div>
          </div>
        </div>
      </div>

      <main className="mx-auto max-w-[1600px] space-y-5 p-4 lg:p-6">
        {/* Price snapshot skeleton */}
        <section className="rounded-xl border border-border bg-panel p-5">
          <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
            <div>
              <div className="h-4 w-36 animate-pulse rounded bg-panel-2" />
              <div className="mt-2 flex flex-wrap items-baseline gap-3">
                <div className="h-10 w-28 animate-pulse rounded bg-panel-2" />
                <div className="h-5 w-16 animate-pulse rounded bg-panel-2" />
              </div>
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
                <div className="h-4 w-24 animate-pulse rounded bg-panel-2" />
                <div className="h-4 w-24 animate-pulse rounded bg-panel-2" />
                <div className="h-4 w-20 animate-pulse rounded bg-panel-2" />
              </div>
            </div>
            <div>
              <div className="mb-3 h-4 w-32 animate-pulse rounded bg-panel-2" />
              <div className="space-y-3">
                {["Bull", "Base", "Bear"].map((label) => (
                  <div key={label}>
                    <div className="mb-1.5 flex items-center justify-between">
                      <div className="h-4 w-10 animate-pulse rounded bg-panel-2" />
                      <div className="h-4 w-10 animate-pulse rounded bg-panel-2" />
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-panel-2">
                      <div className="h-full w-1/3 animate-pulse rounded-full bg-border" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Workstation skeleton */}
        <section className="rounded-xl border border-border bg-panel p-5">
          <div className="h-5 w-48 animate-pulse rounded bg-panel-2" />
          <div className="mt-4 h-[320px] animate-pulse rounded-lg bg-panel-2" />
        </section>

        {/* Chart skeleton */}
        <section className="rounded-xl border border-border bg-panel p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="h-6 w-48 animate-pulse rounded bg-panel-2" />
              <div className="mt-1 h-4 w-80 animate-pulse rounded bg-panel-2" />
            </div>
            <div className="h-4 w-48 animate-pulse rounded bg-panel-2" />
          </div>
          <div className="mt-4 h-[380px] animate-pulse rounded-lg bg-panel-2" />
        </section>

        {/* Metric cards skeleton */}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: skeleton
            <div key={i} className="rounded-xl border border-border bg-panel p-5">
              <div className="flex items-center justify-between">
                <div className="h-4 w-12 animate-pulse rounded bg-panel-2" />
                <div className="h-5 w-5 animate-pulse rounded bg-panel-2" />
              </div>
              <div className="mt-3 h-8 w-20 animate-pulse rounded bg-panel-2" />
              <div className="mt-2 h-4 w-36 animate-pulse rounded bg-panel-2" />
            </div>
          ))}
        </div>

        {/* Body skeleton: two-column layout */}
        <div className="grid gap-5 xl:grid-cols-[1.25fr_0.75fr]">
          <div className="space-y-5">
            <div className="rounded-xl border border-border bg-panel p-5">
              <div className="h-4 w-32 animate-pulse rounded bg-panel-2" />
              <div className="mt-3 space-y-2">
                <div className="h-4 w-full animate-pulse rounded bg-panel-2" />
                <div className="h-4 w-5/6 animate-pulse rounded bg-panel-2" />
              </div>
            </div>
            <div className="rounded-xl border border-border bg-panel p-5">
              <div className="h-4 w-28 animate-pulse rounded bg-panel-2" />
              <div className="mt-3 space-y-2">
                <div className="h-4 w-full animate-pulse rounded bg-panel-2" />
                <div className="h-4 w-4/6 animate-pulse rounded bg-panel-2" />
              </div>
            </div>
            <div className="overflow-hidden rounded-xl border border-border bg-panel">
              <div className="border-b border-border px-5 py-4">
                <div className="h-6 w-36 animate-pulse rounded bg-panel-2" />
              </div>
              {Array.from({ length: 3 }).map((_, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: skeleton
                <div key={i} className="border-b border-border/70 p-5 last:border-0">
                  <div className="h-4 w-24 animate-pulse rounded bg-panel-2" />
                  <div className="mt-2 h-5 w-64 animate-pulse rounded bg-panel-2" />
                  <div className="mt-2 h-4 w-full animate-pulse rounded bg-panel-2" />
                </div>
              ))}
            </div>
          </div>
          <div className="space-y-5">
            <div className="rounded-xl border border-border bg-panel p-5">
              <div className="h-4 w-44 animate-pulse rounded bg-panel-2" />
              <div className="mt-4 space-y-4">
                {Array.from({ length: 3 }).map((_, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: skeleton
                  <div key={i} className="flex items-center justify-between border-t border-border/70 py-3 first:border-t-0 first:pt-0">
                    <div>
                      <div className="h-4 w-12 animate-pulse rounded bg-panel-2" />
                      <div className="mt-1 h-3 w-16 animate-pulse rounded bg-panel-2" />
                    </div>
                    <div className="h-4 w-14 animate-pulse rounded bg-panel-2" />
                  </div>
                ))}
              </div>
            </div>
            {Array.from({ length: 4 }).map((_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: skeleton
              <div key={i} className="rounded-xl border border-border bg-panel p-5">
                <div className="h-4 w-24 animate-pulse rounded bg-panel-2" />
                <div className="mt-3 space-y-2">
                  <div className="h-4 w-full animate-pulse rounded bg-panel-2" />
                  <div className="h-4 w-3/4 animate-pulse rounded bg-panel-2" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  )
}
