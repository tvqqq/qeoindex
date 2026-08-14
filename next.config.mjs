import { withWorkflow } from "workflow/next"

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Keep production builds type-safe. Do not hide TypeScript failures on Vercel.
}

export default withWorkflow(nextConfig)
