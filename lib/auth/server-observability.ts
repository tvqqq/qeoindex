export type ServerAuthTransportFailureCategory = "timeout" | "abort" | "transport"

export type ServerAuthTransportFailureEvent = {
  event: "server_auth_transport_failure"
  operation: "supabase.auth.getUser"
  category: ServerAuthTransportFailureCategory
}

type ServerAuthTransportFailureLogger = (event: ServerAuthTransportFailureEvent) => void

function readErrorField(error: unknown, field: "name" | "message") {
  if (!error || typeof error !== "object") return ""
  const value = (error as Record<string, unknown>)[field]
  return typeof value === "string" ? value.toLowerCase() : ""
}

export function classifyServerAuthTransportFailure(error: unknown): ServerAuthTransportFailureCategory {
  const name = readErrorField(error, "name")
  const message = readErrorField(error, "message")

  if (name === "timeouterror" || /timeout|timed out/.test(message)) return "timeout"
  if (name === "aborterror" || /aborted|\babort\b/.test(message)) return "abort"
  return "transport"
}

function logServerAuthTransportFailure(event: ServerAuthTransportFailureEvent) {
  console.error(event)
}

export function reportServerAuthTransportFailure(
  error: unknown,
  logger: ServerAuthTransportFailureLogger = logServerAuthTransportFailure,
) {
  const event: ServerAuthTransportFailureEvent = {
    event: "server_auth_transport_failure",
    operation: "supabase.auth.getUser",
    category: classifyServerAuthTransportFailure(error),
  }
  logger(event)
  return event
}
