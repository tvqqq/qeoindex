<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## QeoIndex project orientation

- Read `docs/HANDOVER.md` after this file. It is the canonical architecture, source-of-truth, validation, deployment, and troubleshooting guide.
- Use `docs/market-board.md` for the detailed realtime/EOD market-board data flow.

## Git and production deployment invariants

- `main` is the only deployment-enabled Git branch. Vercel Git Integration is the single source of truth for production deployments.
- Normal workflow: make changes on a feature/work branch, validate locally, commit/push the branch, then merge or squash once into `main` when the release is approved.
- A push/merge to `main` is itself the production deployment trigger. Do not run `vercel --prod`, `vercel deploy --prod`, a Vercel Deploy Hook, or another manual production deployment for the same release.
- Agents may use Vercel tooling to inspect deployments, logs, or production health, but must not create a production deployment unless the user explicitly requests an exceptional manual recovery and confirms Git auto-deploy will not also run for that release.
- Never redeploy merely to verify a release. Verify the Git-triggered deployment and smoke-test the live domain instead.
- If Vercel reports a deployment quota/rate limit, stop retrying and report the blocked release. Repeated retries can consume additional deployment attempts.
- Target invariant: one approved release merged to `main` → one Vercel production deployment.
