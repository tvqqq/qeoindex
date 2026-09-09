import { createClient } from "@supabase/supabase-js"

const apiUrl = process.env.API_URL
const serviceRoleKey = process.env.SERVICE_ROLE_KEY
const email = "qeo144-acceptance@example.invalid"
const password = "Qeo144!LocalOnly"

if (!apiUrl || !serviceRoleKey) {
  console.error("API_URL and SERVICE_ROLE_KEY are required")
  process.exit(1)
}

const hostname = new URL(apiUrl).hostname
if (!["127.0.0.1", "localhost", "::1"].includes(hostname)) {
  console.error(`Refusing to create the QEO-144 acceptance user outside local Supabase: ${hostname}`)
  process.exit(1)
}

const supabase = createClient(apiUrl, serviceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
})

const listed = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 })
if (listed.error) {
  console.error(listed.error.message)
  process.exit(1)
}

let user = listed.data.users.find((candidate) => candidate.email === email) ?? null

if (user) {
  const updated = await supabase.auth.admin.updateUserById(user.id, {
    password,
    email_confirm: true,
    user_metadata: { display_name: "QEO-144 Acceptance Fixture" },
  })
  if (updated.error) {
    console.error(updated.error.message)
    process.exit(1)
  }
  user = updated.data.user
} else {
  const created = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: "QEO-144 Acceptance Fixture" },
  })
  if (created.error) {
    console.error(created.error.message)
    process.exit(1)
  }
  user = created.data.user
}

process.stdout.write(`${user.id}\n`)
