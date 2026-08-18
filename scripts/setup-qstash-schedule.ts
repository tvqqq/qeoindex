/**
 * Setup Upstash QStash Schedule:
 * Calls Supabase Edge Function `orderbook-sync` at 14:50 (Asia/Ho_Chi_Minh) every weekday (Mon-Fri)
 *
 * Run with:
 *   npx tsx scripts/setup-qstash-schedule.ts
 */

import { readFileSync, existsSync } from "node:fs"

function loadEnv() {
  const env: Record<string, string> = {}
  for (const filename of [".env.production.local", ".env.local", ".env"]) {
    if (existsSync(filename)) {
      const content = readFileSync(filename, "utf8")
      for (const line of content.split("\n")) {
        const m = line.match(/^([^=]+)=(.*)$/)
        if (m && !env[m[1].trim()]) {
          let val = m[2].trim()
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1)
          }
          env[m[1].trim()] = val
        }
      }
    }
  }
  return env
}

async function main() {
  const env = loadEnv()
  const qstashToken = process.env.QSTASH_TOKEN || env["QSTASH_TOKEN"] || env["UPSTASH_REDIS_REST_TOKEN"]
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || env["NEXT_PUBLIC_SUPABASE_URL"] || "https://glwhhrmejlonhyorvtzm.supabase.co"
  const destinationUrl = `${supabaseUrl}/functions/v1/orderbook-sync`

  console.log("=== Upstash QStash EOD Schedule Setup ===")
  console.log("Target Supabase Function:", destinationUrl)
  console.log("Schedule:", "50 14 * * 1-5 (14:50 Weekdays Mon-Fri)")
  console.log("Timezone:", "Asia/Ho_Chi_Minh")

  if (!qstashToken) {
    console.log("\n[Notice] QSTASH_TOKEN is not configured yet in .env.")
    console.log("To create the schedule via QStash REST API:")
    console.log(`
curl -X POST "https://qstash.upstash.io/v2/schedules/${destinationUrl}" \\
  -H "Authorization: Bearer <YOUR_QSTASH_TOKEN>" \\
  -H "Upstash-Cron: 50 14 * * 1-5" \\
  -H "Upstash-Timezone: Asia/Ho_Chi_Minh" \\
  -H "Content-Type: application/json" \\
  -d '{"action":"eod_sync"}'
    `)
    return
  }

  try {
    const qstashUrl = `https://qstash.upstash.io/v2/schedules/${destinationUrl}`
    console.log("\nCreating / updating schedule on Upstash QStash...")
    const res = await fetch(qstashUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${qstashToken}`,
        "Upstash-Cron": "50 14 * * 1-5",
        "Upstash-Timezone": "Asia/Ho_Chi_Minh",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action: "eod_sync", source: "qstash_schedule" }),
    })

    const data = await res.json()
    if (res.ok) {
      console.log("✓ Successfully scheduled QStash cron job!", data)
    } else {
      console.warn("QStash API response:", res.status, data)
    }
  } catch (err: unknown) {
    console.error("Failed to call QStash API:", err instanceof Error ? err.message : String(err))
  }
}

main()
