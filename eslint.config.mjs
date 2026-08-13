import { defineConfig, globalIgnores } from "eslint/config"
import nextVitals from "eslint-config-next/core-web-vitals"
import nextTypeScript from "eslint-config-next/typescript"

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  {
    // Existing code relies heavily on provider payloads typed as `any` and on
    // initial fetches kicked off by effects. Keep the debt visible without
    // making the newly restored lint command unusable for unrelated PRs.
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "supabase/.branches/**",
    "supabase/.temp/**",
    "next-env.d.ts",
  ]),
])
