import "server-only"

import { readThroughUiCache } from "@/modules/shared/cache/ui-data-cache"
import {
  isValidVn30Membership,
  parseDnseVn30Membership,
  type Vn30Membership,
} from "./vn30-membership-contract"

const VN30_MEMBERSHIP_URL = "https://api.dnse.com.vn/market-api/basket-influence?type=VN30"
const VN30_MEMBERSHIP_TTL_SECONDS = 6 * 60 * 60
const VN30_MEMBERSHIP_TIMEOUT_MS = 4_000

async function fetchVn30Membership(): Promise<Vn30Membership | null> {
  try {
    const response = await fetch(VN30_MEMBERSHIP_URL, {
      cache: "no-store",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(VN30_MEMBERSHIP_TIMEOUT_MS),
    })
    if (!response.ok) return null
    const payload: unknown = await response.json()
    return parseDnseVn30Membership(payload)
  } catch {
    return null
  }
}

export async function getVn30Membership(): Promise<Vn30Membership | null> {
  try {
    return await readThroughUiCache({
      namespace: "vn30-membership-v1",
      key: "current",
      tag: "vn30-membership",
      name: "DNSE VN30 basket membership",
      ttlSeconds: VN30_MEMBERSHIP_TTL_SECONDS,
      validate: (value): value is Vn30Membership | null => isValidVn30Membership(value),
      shouldCache: (value) => value !== null,
      load: fetchVn30Membership,
    })
  } catch {
    return null
  }
}
