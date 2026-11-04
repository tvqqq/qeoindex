/**
 * Firebase App Hosting uses request-scoped Cloud Run instances. The Vercel
 * Workflow World is deliberately unavailable there until a separately
 * validated durable worker is configured.
 */
export function isFirebaseAppHosting(env: Record<string, string | undefined> = process.env): boolean {
  return env.QEO_HOSTING_PROVIDER === "firebase"
}

export function supportsManagedWorkflows(env: Record<string, string | undefined> = process.env): boolean {
  return !isFirebaseAppHosting(env)
}

export function pausedWorkflowResponse(): Response {
  return Response.json({
    ok: false,
    error: "WORKFLOW_PAUSED_FOR_FIREBASE_MIGRATION",
    message: "Durable workflows remain on hold until an external scheduler and durable worker are verified.",
  }, {
    status: 503,
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  })
}
