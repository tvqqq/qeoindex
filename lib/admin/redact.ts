const SECRET_KEY_PATTERN = /(authorization|cookie|password|secret|token|api[_-]?key|service[_-]?role|client[_-]?secret)/i
const MAX_DEPTH = 5
const MAX_ARRAY_LENGTH = 25
const MAX_OBJECT_KEYS = 50
const MAX_STRING_LENGTH = 800

export function isSecretKeyName(key: string): boolean {
  return SECRET_KEY_PATTERN.test(key)
}

export function sanitizeAdminValue(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) {
    return "[DEPTH_EXCEEDED]"
  }

  if (value === null || value === undefined) {
    return value
  }

  if (value instanceof Error) {
    return {
      name: value.name || "Error",
      message: value.message ? value.message.slice(0, MAX_STRING_LENGTH) : "Unknown error",
    }
  }

  if (typeof value === "string") {
    if (value.length > MAX_STRING_LENGTH) {
      return value.slice(0, MAX_STRING_LENGTH) + "... [TRUNCATED]"
    }
    return value
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value
  }

  if (typeof value === "bigint") {
    return Number(value)
  }

  if (Array.isArray(value)) {
    const slice = value.slice(0, MAX_ARRAY_LENGTH)
    const sanitizedSlice = slice.map((item) => sanitizeAdminValue(item, depth + 1))
    if (value.length > MAX_ARRAY_LENGTH) {
      sanitizedSlice.push(`[+${value.length - MAX_ARRAY_LENGTH} TRUNCATED ITEMS]` as unknown as unknown)
    }
    return sanitizedSlice
  }

  if (typeof value === "object") {
    const result: Record<string, unknown> = {}
    const entries = Object.entries(value as Record<string, unknown>)
    const cappedEntries = entries.slice(0, MAX_OBJECT_KEYS)

    for (const [k, v] of cappedEntries) {
      if (isSecretKeyName(k)) {
        result[k] = "[REDACTED]"
      } else {
        result[k] = sanitizeAdminValue(v, depth + 1)
      }
    }

    if (entries.length > MAX_OBJECT_KEYS) {
      result["_truncated_keys_count"] = entries.length - MAX_OBJECT_KEYS
    }

    return result
  }

  return String(value).slice(0, MAX_STRING_LENGTH)
}
