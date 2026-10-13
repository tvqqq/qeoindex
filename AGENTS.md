<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## QeoIndex project orientation

- Read `docs/README.md` after this file for the documentation map and source-of-truth hierarchy.
- Read `docs/HANDOVER.md` before material implementation. It is the canonical active architecture, source-of-truth, validation, deployment, and troubleshooting guide.
- Use `docs/market-board.md` for the detailed realtime/EOD market-board data flow.
- Before any UI/design implementation or review, read `docs/UI_LESSONS_LEARNED.md`. Its UI performance rules are mandatory for all agents.
- Treat Linear as the current work-state source. Do not add repo-wide `NEXT_AGENT_*`, `*-LEGACY` handoffs, or copy-ready status dumps; update canonical docs when architecture changes and use Git history for historical context.

## Mandatory UI design and performance invariants

- Realtime, chart, canvas, order-book, and dense-table screens are performance-sensitive by default. Stable interaction and low CPU/GPU cost take priority over decorative fidelity.
- Do not add large persistent `backdrop-filter` / `backdrop-blur-*` surfaces near charts, canvas, realtime boards, or dense tables unless browser profiling demonstrates they are safe.
- Avoid CSS `filter` stacks such as `drop-shadow(...)`, blur, or brightness on large/frequently repainting UI. Prefer borders, backgrounds, gradients, and small bounded `box-shadow`.
- Do not move decorative typography/font classes to a page root solely to style a small subset of children. Scope typography to the component that needs it.
- Do not use `transition-all` in performance-sensitive UI. Transition only the required properties; prefer transform/opacity for motion and honor `prefers-reduced-motion`.
- Dense/dynamic ticker links must not rely on automatic Next.js viewport prefetch. Use `prefetch={false}` or the project intent-prefetch helper. Review even small new dynamic links when they mount beside a heavy chart.
- Keep chart/canvas containers dimensionally stable. Do not introduce ancestor layout animation, cosmetic remounts, or overlapping compositor-heavy effects that can force resize/repaint loops.
- When debugging UI jitter, inspect React renders, layout/style recalculation, paint/compositing/GPU layers, and background navigation/network work. Do not assume the chart library is the cause without comparing the surrounding shell to the last known-good commit.
- Mockups and shadcn/SmoothUI examples define visual intent, not mandatory rendering primitives. Agents must simplify expensive blur/glow/filter/animation effects when needed to preserve responsiveness.
- Every UI performance regression fix should add a deterministic guardrail where practical, and material chart/realtime UI changes require a real-browser visual check before release.

## Git and production deployment invariants

- `main` is the only deployment-enabled Git branch. Vercel Git Integration is the single source of truth for production deployments.
- Default ChatGPT inline-coding workflow: inspect repo instructions and relevant code → implement directly on a feature/work branch using the GitHub Connector → review diff → verify with GitHub Actions → **automatically squash-merge into `main` when required checks pass**. The user's normal coding request (fix/implement/update/refactor) already authorizes the routine PR, merge and Git-triggered production release; do not ask for a second merge/deploy confirmation.
- QeoIndex inline-only execution policy still applies: do not run shell commands, local/remote builds, tests, lint, typecheck or deploy commands by default. GitHub Actions is the validation environment. Never bypass branch protection, checks or review requirements, and never report tests as passed without CI evidence.
- Pause and ask only for blockers requiring decisions: missing access, unresolved CI failures, merge conflicts, destructive/irreversible operations, database or infrastructure changes with significant production/security risk, or genuinely ambiguous requirements. If release is blocked, keep the PR open and report the actual blocker; do not silently push to `main`.
- A push/merge to `main` is itself the production deployment trigger. Do not run `vercel --prod`, `vercel deploy --prod`, a Vercel Deploy Hook, or another manual production deployment for the same release.
- Agents may use Vercel tooling to inspect deployments, logs, or production health, but must not create a production deployment unless the user explicitly requests an exceptional manual recovery and confirms Git auto-deploy will not also run for that release.
- Never redeploy merely to verify a release. Verify the Git-triggered deployment and smoke-test the live domain instead.
- If Vercel reports a deployment quota/rate limit, stop retrying and report the blocked release. Repeated retries can consume additional deployment attempts.
- Target invariant: one CI-green, authorized release squash-merged to `main` → one Vercel Git Integration production deployment. Verify the exact merge SHA, READY state and live smoke when access permits; do not manually trigger another deployment.

## Supabase production deployment invariants

- Whenever changes are made to Supabase resources:
  - Database schema / migrations in `supabase/migrations/`: immediately run `npx supabase db push` to apply migrations to Supabase production database.
  - Edge Functions in `supabase/functions/<name>/`: immediately run `npx supabase functions deploy <name> --no-verify-jwt` to deploy Edge Functions to Supabase production.
