import type { Instrumentation } from "next"

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  const message = error instanceof Error ? error.message : String(error)

  console.error("[QeoIndex server error]", {
    message,
    path: request.path,
    method: request.method,
    routePath: context.routePath,
    routeType: context.routeType,
  })

  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.VERCEL_ENV !== "production") return

  try {
    const { notifyOpsError } = await import("@/lib/ops-alerts")
    await notifyOpsError({
      source: `Next.js ${context.routeType}`,
      message,
      stack: error instanceof Error ? error.stack : undefined,
      path: request.path,
      method: request.method,
      metadata: {
        route: context.routePath,
        router: context.routerKind,
      },
    })
  } catch (reportError) {
    console.error(
      "[QeoIndex server error] Slack reporting failed",
      reportError instanceof Error ? reportError.message : String(reportError),
    )
  }
}
