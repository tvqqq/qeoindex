const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

export function parseRootAdminUserIds(raw = ""): ReadonlySet<string> {
  return new Set(raw.split(",").map((value) => value.trim()).filter((value) => CANONICAL_UUID.test(value)))
}

export function isRootAdminUserId(userId: string, raw = ""): boolean {
  return CANONICAL_UUID.test(userId) && parseRootAdminUserIds(raw).has(userId)
}
